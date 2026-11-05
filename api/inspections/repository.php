<?php
declare(strict_types=1);

function rgInspectionQuery(PDO $db, string $sql, array $values = []): PDOStatement
{
    $statement = $db->prepare($sql);
    $statement->execute($values);
    return $statement;
}

function rgInspectionRow(array $row): array
{
    $row['revision'] = (int) $row['revision'];
    $row['document'] = rgInspectionDecode($row['document']);
    $row['scoring_snapshot'] = $row['scoring_snapshot'] === null ? null : rgInspectionDecode($row['scoring_snapshot']);
    foreach (['created_at','updated_at','approved_at','published_at'] as $field) {
        if (isset($row[$field])) $row[$field] = str_replace(' ', 'T', $row[$field]) . 'Z';
    }
    return $row;
}

function rgInspectionFind(PDO $db, string $id, bool $lock = false): array
{
    $row = rgInspectionQuery($db, 'SELECT * FROM rg_inspections WHERE id = ?' . ($lock ? ' FOR UPDATE' : ''), [$id])->fetch();
    if (!$row) throw new RgcInspectionHttpError(404, 'No se encontró el peritaje.');
    return rgInspectionRow($row);
}

function rgInspectionList(PDO $db, string $vehicleId): array
{
    $rows = rgInspectionQuery($db, 'SELECT * FROM rg_inspections WHERE vehicle_id = ? ORDER BY created_at DESC,id DESC', [$vehicleId])->fetchAll();
    return array_map(static function (array $stored): array {
        $row = rgInspectionRow($stored);
        return array_intersect_key($row, array_flip(['id','vehicle_id','status','revision','created_at','updated_at','approved_at','published_at']))
            + ['inspection_date' => $row['document']['inspection_date'] ?? '', 'inspector_name' => $row['document']['inspector_name'] ?? ''];
    }, $rows);
}

function rgInspectionCurrent(PDO $db, string $vehicleId, bool $lock = false): ?array
{
    $row = rgInspectionQuery($db, "SELECT i.* FROM rg_inspection_current c JOIN rg_inspections i ON i.id=c.inspection_id AND i.vehicle_id=c.vehicle_id WHERE c.vehicle_id=? AND i.status='published' AND i.approved_at IS NOT NULL" . ($lock ? ' FOR UPDATE' : ''), [$vehicleId])->fetch();
    return $row ? rgInspectionRow($row) : null;
}

function rgInspectionFullRow(PDO $db, array $row, array $actor): array
{
    $row['evidence'] = rgInspectionEvidenceList($db, $row['id'], false, $actor['id']);
    $audit = rgInspectionQuery($db, 'SELECT action,from_status,to_status,revision,created_at,actor_id FROM rg_inspection_audit WHERE inspection_id=? ORDER BY id', [$row['id']])->fetchAll();
    foreach ($audit as &$entry) {
        $entry['revision'] = (int) $entry['revision'];
        $entry['created_at'] = str_replace(' ', 'T', $entry['created_at']) . 'Z';
    }
    unset($entry);
    $row['audit'] = $audit;
    return $row;
}

/** Check local grants again while holding their row until the write commits. */
function rgInspectionLockPermission(PDO $db, array $actor): array
{
    if (($actor['capabilities']['can_edit'] ?? false) !== true) throw new RgcInspectionHttpError(403, 'Tu usuario no está habilitado para peritajes.');
    $grant = rgInspectionQuery($db, 'SELECT role,can_na,is_active FROM rg_inspection_permissions WHERE user_id=? FOR UPDATE', [$actor['id']])->fetch();
    if (!$grant || (int) $grant['is_active'] !== 1) throw new RgcInspectionHttpError(403, 'Tu permiso para peritajes fue revocado.');
    return ['can_edit' => true, 'can_approve' => $grant['role'] === 'admin', 'can_na' => (int) $grant['can_na'] === 1];
}

function rgInspectionLockVehicle(PDO $db, string $vehicleId): void
{
    // An upsert acquires an exclusive duplicate-key lock directly. INSERT IGNORE
    // first takes a shared lock and competing publishers can deadlock upgrading it.
    rgInspectionQuery($db, 'INSERT INTO rg_inspection_vehicle_locks(vehicle_id) VALUES (?) ON DUPLICATE KEY UPDATE vehicle_id=VALUES(vehicle_id)', [$vehicleId]);
    rgInspectionQuery($db, 'SELECT vehicle_id FROM rg_inspection_vehicle_locks WHERE vehicle_id=? FOR UPDATE', [$vehicleId])->fetch();
}

function rgInspectionRegisterConfig(PDO $db): void
{
    $config = rgInspectionConfig();
    rgInspectionQuery($db, 'INSERT INTO rg_inspection_scoring_configs(version,config) VALUES (?,?) ON DUPLICATE KEY UPDATE version=VALUES(version)', [$config['version'], rgInspectionEncode($config)]);
    $stored = rgInspectionQuery($db, 'SELECT config FROM rg_inspection_scoring_configs WHERE version=? FOR UPDATE', [$config['version']])->fetchColumn();
    if (!is_string($stored) || rgInspectionDecode($stored) != $config) {
        throw new RgcInspectionHttpError(409, 'La versión de criterios ya existe con otros valores. Publicá una versión nueva de la configuración.');
    }
}

function rgInspectionAudit(PDO $db, array $row, string $actorId, string $action, ?string $from, array $metadata = []): void
{
    rgInspectionQuery($db, 'INSERT INTO rg_inspection_audit(inspection_id,actor_id,action,from_status,to_status,revision,metadata) VALUES (?,?,?,?,?,?,?)',
        [$row['id'], $actorId, $action, $from, $row['status'], $row['revision'], rgInspectionEncode($metadata ?: new stdClass())]);
}

function rgInspectionTransaction(PDO $db, callable $operation): mixed
{
    $db->beginTransaction();
    try {
        $result = $operation();
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function rgInspectionCreate(PDO $db, array $actor, string $vehicleId, array $vehicle): array
{
    return rgInspectionTransaction($db, static function () use ($db, $actor, $vehicleId, $vehicle): array {
        $caps = rgInspectionLockPermission($db, $actor);
        rgInspectionLockVehicle($db, $vehicleId);
        rgInspectionRegisterConfig($db);
        $document = rgInspectionCreateDocument($vehicle);
        rgInspectionValidateOrFail($document, $caps);
        $id = rgInspectionUuid();
        rgInspectionQuery($db, 'INSERT INTO rg_inspections(id,vehicle_id,document,created_by) VALUES (?,?,?,?)', [$id, $vehicleId, rgInspectionEncode($document), $actor['id']]);
        $row = rgInspectionFind($db, $id);
        rgInspectionAudit($db, $row, $actor['id'], 'create', null);
        return $row;
    });
}

function rgInspectionUpdateColumns(PDO $db, string $id, array $fields): void
{
    $allowed = ['revision','status','document','scoring_snapshot','approved_by','approved_at','published_at'];
    $parts = [];
    $values = [];
    foreach ($fields as $column => $value) {
        if (!in_array($column, $allowed, true)) throw new LogicException('Unknown inspection column');
        $parts[] = $column . '=?';
        $values[] = $value;
    }
    $values[] = $id;
    rgInspectionQuery($db, 'UPDATE rg_inspections SET ' . implode(',', $parts) . ',updated_at=CURRENT_TIMESTAMP(6) WHERE id=?', $values);
}

function rgInspectionMutate(PDO $db, array $actor, string $id, int $revision, string $action, array $body): array
{
    return rgInspectionTransaction($db, static function () use ($db, $actor, $id, $revision, $action, $body): array {
        $caps = rgInspectionLockPermission($db, $actor);
        $existing = rgInspectionFind($db, $id);
        rgInspectionLockVehicle($db, $existing['vehicle_id']);
        $row = rgInspectionFind($db, $id, true);
        if ($row['revision'] !== $revision) throw new RgcInspectionHttpError(409, 'Otra persona modificó este peritaje. Recargá antes de continuar.');
        $fields = ['revision' => $row['revision'] + 1];
        $metadata = [];

        if ($action === 'save') {
            if ($row['status'] !== 'draft') throw new RgcInspectionHttpError(409, 'Solo se pueden editar borradores.');
            rgInspectionValidateOrFail($body['document'] ?? null, $caps);
            $fields['document'] = rgInspectionEncode($body['document']);
        } elseif ($action === 'transition') {
            $status = is_string($body['status'] ?? null) ? $body['status'] : '';
            if (!rgInspectionCanTransition($row['status'], $status, $caps)) throw new RgcInspectionHttpError(403, 'No tenés permiso para esta transición.');
            if (in_array($status, ['in_review','approved'], true)) rgInspectionValidateOrFail($row['document'], $caps, true);
            if ($status === 'approved') {
                rgInspectionRegisterConfig($db);
                $fields['scoring_snapshot'] = rgInspectionEncode(rgInspectionCreateSnapshot($row['document']));
                $fields['approved_by'] = $actor['id'];
                $fields['approved_at'] = gmdate('Y-m-d H:i:s');
            }
            if ($status === 'published') {
                if (!$row['approved_at'] || ($row['scoring_snapshot']['score']['complete'] ?? false) !== true) throw new RgcInspectionHttpError(409, 'Falta una aprobación completa.');
                // A locking read sees the latest committed publication even if
                // MySQL REPEATABLE READ established an earlier read view above.
                $previous = rgInspectionCurrent($db, $row['vehicle_id'], true);
                if ($previous !== null && $previous['id'] !== $row['id']) {
                    rgInspectionUpdateColumns($db, $previous['id'], ['status' => 'archived', 'revision' => $previous['revision'] + 1]);
                    $previous['status'] = 'archived'; $previous['revision']++;
                    rgInspectionAudit($db, $previous, $actor['id'], 'superseded', 'published', ['replacement_id' => $id]);
                }
                rgInspectionQuery($db, 'INSERT INTO rg_inspection_current(vehicle_id,inspection_id) VALUES (?,?) ON DUPLICATE KEY UPDATE inspection_id=VALUES(inspection_id)', [$row['vehicle_id'], $id]);
                $fields['published_at'] = gmdate('Y-m-d H:i:s');
            }
            if ($status === 'archived') rgInspectionQuery($db, 'DELETE FROM rg_inspection_current WHERE vehicle_id=? AND inspection_id=?', [$row['vehicle_id'], $id]);
            $fields['status'] = $status;
        } elseif (in_array($action, ['upload_evidence','update_evidence','delete_evidence'], true)) {
            if ($row['status'] !== 'draft') throw new RgcInspectionHttpError(409, 'Las fotos solo se pueden modificar en borrador.');
            $metadata = rgInspectionMutateEvidence($db, $row, $actor, $caps, $action, $body);
        } else throw new RgcInspectionHttpError(400, 'Acción desconocida.');

        rgInspectionUpdateColumns($db, $id, $fields);
        $saved = rgInspectionFind($db, $id);
        rgInspectionAudit($db, $saved, $actor['id'], $action === 'upload_evidence' ? 'add_evidence' : $action, $row['status'], $metadata);
        return $saved;
    });
}
