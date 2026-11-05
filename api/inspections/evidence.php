<?php
declare(strict_types=1);

function rgInspectionStorageRoot(): string
{
    $root = rtrim(rgInspectionSetting('RGC_INSPECTION_STORAGE_ROOT', dirname(__DIR__, 3) . '/rgcars-private/inspections'), '/\\');
    if ($root === '' || (!str_starts_with($root, '/') && !preg_match('/^[A-Za-z]:[\\\\\/]/D', $root))) {
        throw new RgcInspectionHttpError(503, 'La ruta privada de evidencias no está configurada correctamente.');
    }
    if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) throw new RgcInspectionHttpError(503, 'No se pudo preparar el almacenamiento privado.');
    $resolved = realpath($root);
    $webroot = realpath(dirname(__DIR__, 2));
    if ($resolved === false || ($webroot !== false && ($resolved === $webroot || str_starts_with(str_replace('\\', '/', $resolved), rtrim(str_replace('\\', '/', $webroot), '/') . '/')))) {
        throw new RgcInspectionHttpError(503, 'Las evidencias deben guardarse fuera del directorio público.');
    }
    @chmod($resolved, 0700);
    return $resolved;
}

function rgInspectionEvidencePath(string $relative): string
{
    if (!preg_match('#^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$#D', $relative)) throw new RgcInspectionHttpError(400, 'Ruta de evidencia inválida.');
    $root = rgInspectionStorageRoot();
    $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    $parent = realpath(dirname($path));
    if ($parent !== false && !str_starts_with(str_replace('\\', '/', $parent), rtrim(str_replace('\\', '/', $root), '/') . '/')) {
        throw new RgcInspectionHttpError(400, 'Ruta de evidencia inválida.');
    }
    if (is_link($path)) throw new RgcInspectionHttpError(400, 'Ruta de evidencia inválida.');
    return $path;
}

function rgInspectionSigningKey(): string
{
    $key = rgInspectionSetting('RGC_INSPECTION_SIGNING_KEY');
    if (strlen($key) < 32) throw new RgcInspectionHttpError(503, 'Falta configurar la clave privada de enlaces de evidencia.');
    return $key;
}

function rgInspectionEvidenceSignature(string $id, string $scope, int $expires, string $actor): string
{
    return hash_hmac('sha256', implode('|', [$id, $scope, (string) $expires, $actor]), rgInspectionSigningKey());
}

function rgInspectionEvidenceUrl(string $id, bool $public, string $actor = ''): string
{
    $base = rgInspectionSetting('RGC_INSPECTION_ENDPOINT_URL', rtrim(rgInspectionSetting('RGC_SITE_URL', 'https://rgcars.com.ar'), '/') . '/api/inspections.php');
    $parsed = parse_url($base);
    if (!is_array($parsed) || ($parsed['scheme'] ?? '') !== 'https' || empty($parsed['host']) || isset($parsed['user']) || isset($parsed['pass']) || isset($parsed['query']) || isset($parsed['fragment'])) {
        throw new RgcInspectionHttpError(503, 'La URL de evidencias debe ser un endpoint HTTPS válido.');
    }
    $scope = $public ? 'public' : 'private';
    $expires = time() + ($public ? 60 : 300);
    $actor = $public ? '' : rgInspectionUuid($actor);
    return $base . '?' . http_build_query([
        'action' => 'evidence', 'id' => $id, 'scope' => $scope, 'exp' => $expires,
        'actor' => $actor, 'signature' => rgInspectionEvidenceSignature($id, $scope, $expires, $actor),
    ], '', '&', PHP_QUERY_RFC3986);
}

function rgInspectionEvidenceList(PDO $db, string $inspectionId, bool $public, string $actor = ''): array
{
    $rows = rgInspectionQuery($db, 'SELECT id,item_id,caption,approved_public,mime_type,size_bytes,created_at FROM rg_inspection_evidence WHERE inspection_id=?' . ($public ? ' AND approved_public=1' : '') . ' ORDER BY created_at,id', [$inspectionId])->fetchAll();
    return array_map(static function (array $row) use ($public, $actor): array {
        $row['approved_public'] = (bool) $row['approved_public'];
        $row['size_bytes'] = (int) $row['size_bytes'];
        $row['created_at'] = str_replace(' ', 'T', $row['created_at']) . 'Z';
        $row['signed_url'] = rgInspectionEvidenceUrl($row['id'], $public, $actor);
        return $row;
    }, $rows);
}

function rgInspectionEvidenceFind(PDO $db, string $id, string $inspectionId): array
{
    $row = rgInspectionQuery($db, 'SELECT * FROM rg_inspection_evidence WHERE id=? AND inspection_id=?', [$id, $inspectionId])->fetch();
    if (!$row) throw new RgcInspectionHttpError(404, 'La foto no pertenece a este peritaje.');
    return $row;
}

function rgInspectionImageFormat(string $path): array
{
    if (!class_exists('finfo')) throw new RgcInspectionHttpError(503, 'La validación de imágenes no está disponible.');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path);
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!is_string($mime) || !isset($extensions[$mime])) throw new RgcInspectionHttpError(400, 'Usá una foto JPEG, PNG o WebP real.');
    $dimensions = @getimagesize($path);
    if (!$dimensions || ($dimensions['mime'] ?? null) !== $mime || $dimensions[0] < 1 || $dimensions[1] < 1) {
        throw new RgcInspectionHttpError(400, 'La imagen está dañada o tiene un formato inválido.');
    }
    return [$mime, $extensions[$mime]];
}

/** Move to a private random path before the DB transaction; caller cleans on rollback. */
function rgInspectionReceiveEvidence(string $inspectionId, array $caps, array $body, array $file): array
{
    rgInspectionSigningKey(); // Do not store photos if the response cannot sign them.
    $item = rgInspectionText($body['item_id'] ?? '', 100, 'Componente');
    $known = false;
    foreach (rgInspectionConfig()['categories'] as $category) foreach ($category['items'] as $entry) if ($entry['id'] === $item) $known = true;
    if (!$known) throw new RgcInspectionHttpError(400, 'Componente desconocido.');
    $public = ($body['approved_public'] ?? false) === true;
    if ($public && !$caps['can_approve']) throw new RgcInspectionHttpError(403, 'Solo un administrador puede aprobar fotos públicas.');
    $caption = rgInspectionText($body['caption'] ?? '', 1000, 'Descripción');
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) throw new RgcInspectionHttpError(400, 'No se pudo recibir la foto. Revisá el límite de subida del servidor.');
    $path = $file['tmp_name'] ?? '';
    $size = is_string($path) && is_uploaded_file($path) ? filesize($path) : false;
    if (!is_int($size) || $size < 1 || $size > RGC_INSPECTION_MAX_IMAGE_BYTES) throw new RgcInspectionHttpError(413, 'La foto debe pesar como máximo 8 MiB.');
    [$mime, $extension] = rgInspectionImageFormat($path);
    $id = rgInspectionUuid();
    $relative = $inspectionId . '/' . $id . '.' . $extension;
    $destination = rgInspectionEvidencePath($relative);
    if (!is_dir(dirname($destination)) && !@mkdir(dirname($destination), 0700) && !is_dir(dirname($destination))) throw new RgcInspectionHttpError(503, 'No se pudo preparar la carpeta privada.');
    $destination = rgInspectionEvidencePath($relative); // Resolve the newly-created parent as well.
    if (!move_uploaded_file($path, $destination)) throw new RgcInspectionHttpError(503, 'No se pudo guardar la evidencia.');
    @chmod($destination, 0600);
    return ['id' => $id, 'item_id' => $item, 'storage_path' => $relative, 'mime_type' => $mime, 'size_bytes' => $size, 'caption' => $caption, 'approved_public' => $public];
}

function rgInspectionRemoveEvidenceFile(string $relative): void
{
    $path = rgInspectionEvidencePath($relative);
    if (is_file($path) && !@unlink($path)) error_log('[inspections] Private orphan file requires cleanup');
}

function rgInspectionMutateEvidence(PDO $db, array $row, array $actor, array $caps, string $action, array $body): array
{
    if ($action === 'upload_evidence') {
        $photo = $body['_evidence'] ?? null; // Server-created metadata, never taken from JSON requests.
        if (!is_array($photo)) throw new RgcInspectionHttpError(400, 'Falta la evidencia recibida.');
        if (($photo['approved_public'] ?? false) && !$caps['can_approve']) throw new RgcInspectionHttpError(403, 'Solo un administrador puede aprobar fotos públicas.');
        if (!array_key_exists($photo['item_id'], (array) ($row['document']['answers'] ?? []))) throw new RgcInspectionHttpError(400, 'Componente desconocido en el informe.');
        $counts = rgInspectionQuery($db, 'SELECT COUNT(*) AS total,SUM(item_id=?) AS item_count FROM rg_inspection_evidence WHERE inspection_id=?', [$photo['item_id'], $row['id']])->fetch();
        if ((int) $counts['total'] >= 100 || (int) $counts['item_count'] >= 5) throw new RgcInspectionHttpError(400, 'Máximo cinco fotos por componente y cien por informe.');
        if (!str_starts_with($photo['storage_path'], $row['id'] . '/')) throw new RgcInspectionHttpError(400, 'La evidencia no corresponde al informe.');
        rgInspectionQuery($db, 'INSERT INTO rg_inspection_evidence(id,inspection_id,item_id,storage_path,mime_type,size_bytes,caption,approved_public,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
            [$photo['id'], $row['id'], $photo['item_id'], $photo['storage_path'], $photo['mime_type'], $photo['size_bytes'], $photo['caption'], (int) $photo['approved_public'], $actor['id']]);
        return ['evidence_id' => $photo['id']];
    }
    $id = rgInspectionUuid(is_string($body['evidence_id'] ?? null) ? $body['evidence_id'] : '');
    $photo = rgInspectionEvidenceFind($db, $id, $row['id']);
    if ($action === 'delete_evidence') {
        rgInspectionQuery($db, 'DELETE FROM rg_inspection_evidence WHERE id=? AND inspection_id=?', [$id, $row['id']]);
    } else {
        if (!is_bool($body['approved_public'] ?? null)) throw new RgcInspectionHttpError(400, 'Indicá si la foto se puede publicar.');
        $caption = rgInspectionText($body['caption'] ?? '', 1000, 'Descripción');
        $public = $body['approved_public'];
        if (!$caps['can_approve']) {
            if ($public && !(bool) $photo['approved_public']) throw new RgcInspectionHttpError(403, 'Solo un administrador puede aprobar fotos públicas.');
            if ($caption !== $photo['caption']) $public = false;
        }
        rgInspectionQuery($db, 'UPDATE rg_inspection_evidence SET caption=?,approved_public=? WHERE id=? AND inspection_id=?', [$caption, (int) $public, $id, $row['id']]);
    }
    return ['evidence_id' => $id];
}

function rgInspectionServeEvidence(PDO $db): never
{
    $id = rgInspectionUuid(is_string($_GET['id'] ?? null) ? $_GET['id'] : '');
    $scope = $_GET['scope'] ?? '';
    $expires = filter_var($_GET['exp'] ?? null, FILTER_VALIDATE_INT);
    $actor = is_string($_GET['actor'] ?? null) ? $_GET['actor'] : '';
    $signature = is_string($_GET['signature'] ?? null) ? $_GET['signature'] : '';
    if (!in_array($scope, ['public','private'], true) || !is_int($expires) || $expires < time()
        || $expires > time() + ($scope === 'public' ? 60 : 300) + 30 || !preg_match('/^[a-f0-9]{64}$/D', $signature)
        || !hash_equals(rgInspectionEvidenceSignature($id, $scope, $expires, $actor), $signature)) {
        throw new RgcInspectionHttpError(403, 'El enlace de evidencia venció o no es válido. Actualizá el informe.');
    }
    $photo = rgInspectionQuery($db, 'SELECT e.*,i.status,i.vehicle_id FROM rg_inspection_evidence e JOIN rg_inspections i ON i.id=e.inspection_id WHERE e.id=?', [$id])->fetch();
    if (!$photo) throw new RgcInspectionHttpError(404, 'La evidencia no está disponible.');
    if ($scope === 'public') {
        $current = rgInspectionQuery($db, 'SELECT inspection_id FROM rg_inspection_current WHERE vehicle_id=?', [$photo['vehicle_id']])->fetchColumn();
        if ($actor !== '' || !(bool) $photo['approved_public'] || $photo['status'] !== 'published' || $current !== $photo['inspection_id']) throw new RgcInspectionHttpError(404, 'La evidencia no está publicada.');
        // Vehicle visibility was checked when issuing this 60-second URL. Current
        // report/photo approval is checked again here, including archived reports.
    } else {
        $actor = rgInspectionUuid($actor);
        $active = rgInspectionQuery($db, 'SELECT is_active FROM rg_inspection_permissions WHERE user_id=?', [$actor])->fetchColumn();
        if ((int) $active !== 1) throw new RgcInspectionHttpError(403, 'El acceso a la evidencia fue revocado.');
    }
    $path = rgInspectionEvidencePath($photo['storage_path']);
    if (!is_file($path) || !is_readable($path)) throw new RgcInspectionHttpError(404, 'La foto no está disponible.');
    header('Content-Type: ' . $photo['mime_type']);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . basename($path) . '"');
    header('Access-Control-Allow-Origin: *'); // Signed bearer URL; permits canvas/PDF on www and apex hosts.
    header("Content-Security-Policy: default-src 'none'; sandbox");
    readfile($path);
    exit;
}
