<?php
declare(strict_types=1);

require_once __DIR__ . '/inspections/bootstrap.php';
require_once __DIR__ . '/inspections/domain.php';
require_once __DIR__ . '/inspections/repository.php';
require_once __DIR__ . '/inspections/evidence.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? '');
    if ($method === 'OPTIONS') {
        header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
        header('Access-Control-Allow-Headers: authorization, apikey, content-type');
        http_response_code(204);
        exit;
    }
    if ($method === 'GET' && ($_GET['action'] ?? '') === 'evidence') rgInspectionServeEvidence(rgInspectionDatabase());
    if ($method !== 'POST') throw new RgcInspectionHttpError(405, 'Método no permitido.');
    $multipart = str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data');
    $maxBody = $multipart ? RGC_INSPECTION_MAX_IMAGE_BYTES + 65536 : RGC_INSPECTION_MAX_JSON_BYTES;
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $maxBody) throw new RgcInspectionHttpError(413, 'El archivo o formulario supera el tamaño permitido.');
    if ($multipart) {
        if (!$_POST && !$_FILES) throw new RgcInspectionHttpError(413, 'El servidor no recibió el archivo. Revisá sus límites de subida.');
        $body = $_POST;
        $revision = filter_var($body['revision'] ?? null, FILTER_VALIDATE_INT);
        $body['revision'] = $revision === false ? null : $revision;
        if (!in_array($body['approved_public'] ?? 'false', ['true','false'], true)) throw new RgcInspectionHttpError(400, 'Autorización de evidencia inválida.');
        $body['approved_public'] = ($body['approved_public'] ?? 'false') === 'true';
    } else {
        $raw = file_get_contents('php://input', false, null, 0, RGC_INSPECTION_MAX_JSON_BYTES + 1);
        if (!is_string($raw) || strlen($raw) > RGC_INSPECTION_MAX_JSON_BYTES) throw new RgcInspectionHttpError(413, 'El formulario supera el tamaño permitido.');
        try {
            // Decode through objects first: JSON [] must not become a valid {}.
            $rawObject = json_decode($raw, false, 64, JSON_THROW_ON_ERROR);
            if (!$rawObject instanceof stdClass) throw new JsonException('Expected an object');
            if (property_exists($rawObject, 'document')) {
                if (!$rawObject->document instanceof stdClass) throw new JsonException('Expected a document object');
                foreach (['owner','vehicle','signature','answers'] as $field) {
                    if (property_exists($rawObject->document, $field) && !$rawObject->document->{$field} instanceof stdClass) throw new JsonException('Expected a field object');
                }
                if (isset($rawObject->document->answers) && $rawObject->document->answers instanceof stdClass) {
                    foreach (get_object_vars($rawObject->document->answers) as $answer) {
                        if (!$answer instanceof stdClass || (property_exists($answer, 'value') && !$answer->value instanceof stdClass)) throw new JsonException('Expected an answer object');
                    }
                }
            }
            $body = rgInspectionDecode($raw);
        } catch (JsonException $error) { throw new RgcInspectionHttpError(400, 'Solicitud JSON inválida.'); }
    }
    if (!is_array($body) || !is_string($body['action'] ?? null)) throw new RgcInspectionHttpError(400, 'Falta la acción.');
    $action = $body['action'];
    // Reject absent/malformed credentials before opening any private resources.
    if ($action !== 'public') rgInspectionBearer();
    $db = rgInspectionDatabase();

    if ($action === 'public') {
        $vehicleId = rgInspectionVehicleId($body['vehicle_id'] ?? null);
        $vehicle = rgInspectionRemoteVehicle($vehicleId);
        if ($vehicle === null || !in_array($vehicle['status'] ?? '', ['available','incoming','reserved','sold'], true)) rgInspectionRespond(['data' => null]);
        $row = rgInspectionCurrent($db, $vehicleId);
        if ($row === null || ($row['scoring_snapshot']['score']['complete'] ?? false) !== true) rgInspectionRespond(['data' => null]);
        rgInspectionRespond(['data' => rgInspectionPublicReport($row, rgInspectionEvidenceList($db, $row['id'], true))]);
    }

    $actor = rgInspectionAuthenticate($db);
    $caps = $actor['capabilities'];
    if ($action === 'capabilities') rgInspectionRespond(['data' => $caps]);
    if (!$caps['can_edit']) throw new RgcInspectionHttpError(403, 'Tu cuenta no tiene permiso para acceder a peritajes.');
    if ($action === 'list') rgInspectionRespond(['data' => rgInspectionList($db, rgInspectionVehicleId($body['vehicle_id'] ?? null))]);
    if ($action === 'create') {
        $vehicleId = rgInspectionVehicleId($body['vehicle_id'] ?? null);
        $vehicle = rgInspectionRemoteVehicle($vehicleId, $actor['token']);
        if ($vehicle === null) throw new RgcInspectionHttpError(404, 'No se encontró el vehículo.');
        rgInspectionRespond(['data' => rgInspectionFullRow($db, rgInspectionCreate($db, $actor, $vehicleId, $vehicle), $actor)]);
    }
    $id = rgInspectionUuid(is_string($body['id'] ?? null) ? $body['id'] : '');
    $row = rgInspectionFind($db, $id);
    if ($action === 'get') rgInspectionRespond(['data' => rgInspectionFullRow($db, $row, $actor)]);
    if (!in_array($action, ['save','transition','upload_evidence','update_evidence','delete_evidence'], true)) throw new RgcInspectionHttpError(400, 'Acción desconocida.');
    $revision = rgInspectionRevision($body['revision'] ?? null);
    if ($row['revision'] !== $revision) throw new RgcInspectionHttpError(409, 'Otra persona modificó este peritaje. Recargá antes de continuar.');
    $uploadPath = null;
    $deletePath = null;
    if ($action === 'upload_evidence') {
        if (!$multipart || !is_array($_FILES['file'] ?? null)) throw new RgcInspectionHttpError(400, 'Falta la foto.');
        if ($row['status'] !== 'draft') throw new RgcInspectionHttpError(409, 'Las fotos solo se pueden modificar en borrador.');
        $body['_evidence'] = rgInspectionReceiveEvidence($id, $caps, $body, $_FILES['file']);
        $uploadPath = $body['_evidence']['storage_path'];
    } elseif ($action === 'delete_evidence') {
        $photo = rgInspectionEvidenceFind($db, rgInspectionUuid(is_string($body['evidence_id'] ?? null) ? $body['evidence_id'] : ''), $id);
        $deletePath = $photo['storage_path'];
    }
    try { $saved = rgInspectionMutate($db, $actor, $id, $revision, $action, $body); }
    catch (Throwable $error) {
        if ($uploadPath !== null) rgInspectionRemoveEvidenceFile($uploadPath);
        throw $error;
    }
    if ($deletePath !== null) rgInspectionRemoveEvidenceFile($deletePath);
    rgInspectionRespond(['data' => rgInspectionFullRow($db, $saved, $actor)]);
} catch (RgcInspectionHttpError $error) {
    $result = ['error' => $error->getMessage()];
    if ($error->details) $result['details'] = $error->details;
    rgInspectionRespond($result, $error->status);
} catch (PDOException $error) {
    $state = $error->errorInfo[0] ?? (string) $error->getCode();
    $code = (int) ($error->errorInfo[1] ?? 0);
    if ($state === '40001' || in_array($code, [1205,1213], true)) rgInspectionRespond(['error' => 'Hubo una edición concurrente. Recargá antes de continuar.'], 409);
    // Diagnostics contain only stable SQLSTATE/error codes, never SQL, PII or credentials.
    error_log('[inspections] Database failure state=' . $state . ' code=' . $code);
    rgInspectionRespond(['error' => 'No se pudo completar la operación de peritajes. Verificá la configuración del módulo.'], 503);
} catch (Throwable $error) {
    error_log('[inspections] Unexpected ' . get_class($error));
    rgInspectionRespond(['error' => 'No se pudo completar la operación de peritajes.'], 500);
}
