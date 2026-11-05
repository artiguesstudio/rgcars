<?php
declare(strict_types=1);

// Integration test against an isolated local MariaDB/MySQL server only.
// RGC_TEST_MYSQL_PORT defaults to 33317. No production settings are loaded.
// Creates and drops its own randomly named rg_inspections_test_* database.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../api/inspections/bootstrap.php';
require __DIR__ . '/../api/inspections/domain.php';
require __DIR__ . '/../api/inspections/repository.php';
require __DIR__ . '/../api/inspections/evidence.php';

function testDb(?string $name = null): PDO
{
    if ($name !== null && !preg_match('/^rg_inspections_test_[a-f0-9]+$/D', $name)) throw new RuntimeException('Unsafe test database name');
    $port = getenv('RGC_TEST_MYSQL_PORT') ?: '33317';
    if (!ctype_digit($port)) throw new RuntimeException('Invalid local test port');
    return new PDO('mysql:host=127.0.0.1;port=' . $port . ($name ? ';dbname=' . $name : '') . ';charset=utf8mb4', getenv('RGC_TEST_MYSQL_USER') ?: 'root', getenv('RGC_TEST_MYSQL_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
}

function actor(string $id): array
{
    return ['id' => $id, 'email' => 'fixture@example.invalid', 'capabilities' => ['can_edit' => true, 'can_approve' => true, 'can_na' => true]];
}

if (($argv[1] ?? '') === '--publish-worker') {
    try {
        $result = rgInspectionMutate(testDb($argv[2]), actor($argv[5]), $argv[3], (int) $argv[4], 'transition', ['status' => 'published']);
        echo json_encode(['status' => $result['status']]);
        exit(0);
    } catch (Throwable $error) { fwrite(STDERR, $error->getMessage()); exit(1); }
}

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function reject(callable $operation, ?int $status = null): Throwable
{
    try { $operation(); } catch (Throwable $error) {
        if ($status !== null) check($error instanceof RgcInspectionHttpError && $error->status === $status, 'Expected HTTP ' . $status . ', got ' . get_class($error) . ': ' . $error->getMessage());
        return $error;
    }
    throw new RuntimeException('Expected operation to fail');
}

function test(string $label, callable $operation): void
{
    $operation();
    echo 'PASS ' . $label . PHP_EOL;
}

function importSchema(PDO $db): void
{
    $delimiter = ';'; $buffer = '';
    foreach (file(__DIR__ . '/../scripts/inspection-cpanel-schema.sql') as $line) {
        if (preg_match('/^DELIMITER\s+(\S+)\s*$/', trim($line), $match)) { $delimiter = $match[1]; continue; }
        $buffer .= $line;
        if (str_ends_with(trim($buffer), $delimiter)) {
            $statement = substr(trim($buffer), 0, -strlen($delimiter));
            if (trim($statement) !== '') $db->exec($statement);
            $buffer = '';
        }
    }
    check(trim($buffer) === '', 'Unparsed schema SQL');
}

function completeDocumentForTest(array $vehicle): array
{
    $doc = rgInspectionCreateDocument($vehicle);
    $doc['inspection_date'] = '2026-10-14';
    $doc['inspector_name'] = 'Perito ficticio';
    $doc['fitness'] = 'Apto'; $doc['risk'] = 'Bajo'; $doc['verdict_reason'] = 'Inspección de prueba aislada.';
    $doc['signature'] = ['name' => 'Perito ficticio', 'signed_at' => '2026-10-14', 'consent_public' => false, 'image_data_url' => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII='];
    foreach (rgInspectionItems(rgInspectionConfig()) as $item) {
        $value = match ($item['type']) {
            'windshield' => ['findings' => ['Sin daños']], 'percentage' => ['percent' => rgInspectionUsesPercentageScore($item) ? 100 : 75],
            'damage' => ['detail' => 'Sin daños visibles', 'zone' => 'Inspección general'],
            'tire' => ['brand' => 'Ejemplo', 'size' => '205/55 R16', 'wear_percent' => 30, 'depth_mm' => 5.4],
            default => new stdClass(),
        };
        $doc['answers'][$item['id']] = ['rating' => rgInspectionUsesPercentageScore($item) ? null : 'B', 'notes' => '', 'na_reason' => '', 'value' => $value];
    }
    check(rgInspectionValidateDocument($doc, ['final' => true]) === [], 'Fixture must be complete');
    return $doc;
}

function readyReport(PDO $db, array $admin, string $vehicleId, array $vehicle, array $document): array
{
    $row = rgInspectionCreate($db, $admin, $vehicleId, $vehicle);
    $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'save', ['document' => $document]);
    $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'transition', ['status' => 'in_review']);
    return rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'transition', ['status' => 'approved']);
}

function photoForTest(array $row, string $item, bool $public = false): array
{
    $id = rgInspectionUuid();
    return ['id' => $id, 'item_id' => $item, 'storage_path' => $row['id'] . '/' . $id . '.png', 'mime_type' => 'image/png', 'size_bytes' => 68, 'caption' => 'Evidencia ficticia', 'approved_public' => $public];
}

$control = testDb();
$name = 'rg_inspections_test_' . bin2hex(random_bytes(8));
$control->exec('CREATE DATABASE `' . $name . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
$db = testDb($name);
try {
    test('schema imports twice on real MariaDB/MySQL with immutable-history triggers', function () use ($db): void { importSchema($db); importSchema($db); });
    $admin = actor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    $inspector = actor('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    $secondAdmin = actor('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    rgInspectionQuery($db, "INSERT INTO rg_inspection_permissions(email,user_id,role,can_na,is_active) VALUES ('admin@example.invalid',?,'admin',1,1),('inspector@example.invalid',?,'inspector',1,1),('admin2@example.invalid',?,'admin',1,1)", [$admin['id'], $inspector['id'], $secondAdmin['id']]);
    $vehicle = ['brand' => 'Marca ficticia', 'model' => 'Modelo ficticio', 'version' => 'Versión', 'plate' => 'DEMO001', 'km' => 42000, 'year' => 2022];
    $document = completeDocumentForTest($vehicle);
    $vehicleId = 'fixture-unit';
    $row = rgInspectionCreate($db, $admin, $vehicleId, $vehicle);

    test('draft persists 83 pending answers, server roles and stale revisions are enforced', function () use ($db, $admin, $inspector, $vehicle, $document, &$row): void {
        check(count($row['document']['answers']) === 83 && rgInspectionScore($row['document']['answers'])['complete'] === false, 'New draft must have no final score');
        $row = rgInspectionMutate($db, $inspector, $row['id'], 1, 'save', ['document' => $document]);
        reject(fn() => rgInspectionMutate($db, $admin, $row['id'], 1, 'save', ['document' => $document]), 409);
        reject(fn() => rgInspectionCreate($db, actor('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'unauthorized', $vehicle), 403);
        rgInspectionQuery($db, 'UPDATE rg_inspection_permissions SET is_active=0 WHERE user_id=?', [$inspector['id']]);
        reject(fn() => rgInspectionMutate($db, $inspector, $row['id'], $row['revision'], 'save', ['document' => $document]), 403);
        rgInspectionQuery($db, 'UPDATE rg_inspection_permissions SET is_active=1,can_na=0 WHERE user_id=?', [$inspector['id']]);
        $na = $document; $item = array_key_first($na['answers']); $na['answers'][$item]['rating'] = 'NA'; $na['answers'][$item]['na_reason'] = 'No equipado';
        reject(fn() => rgInspectionMutate($db, $inspector, $row['id'], $row['revision'], 'save', ['document' => $na]), 400);
        check(rgInspectionFind($db, $row['id'])['revision'] === $row['revision'], 'Failed mutations must not increment revision');
    });

    test('approval permissions, snapshot and database history immutability', function () use ($db, $admin, $inspector, &$row): void {
        $row = rgInspectionMutate($db, $inspector, $row['id'], $row['revision'], 'transition', ['status' => 'in_review']);
        reject(fn() => rgInspectionMutate($db, $inspector, $row['id'], $row['revision'], 'transition', ['status' => 'approved']), 403);
        $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'transition', ['status' => 'approved']);
        check($row['scoring_snapshot']['score']['total_100'] === 100.0 || $row['scoring_snapshot']['score']['total_100'] === 100, 'Approved snapshot must score 100');
        reject(fn() => rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'save', ['document' => $row['document']]), 409);
        reject(fn() => rgInspectionQuery($db, 'UPDATE rg_inspections SET document=? WHERE id=?', ['{}', $row['id']]));
        reject(fn() => rgInspectionQuery($db, 'UPDATE rg_inspections SET scoring_snapshot=? WHERE id=?', ['{}', $row['id']]));
        reject(fn() => rgInspectionQuery($db, 'DELETE FROM rg_inspections WHERE id=?', [$row['id']]));
        reject(fn() => rgInspectionQuery($db, 'UPDATE rg_inspection_audit SET action=? WHERE inspection_id=?', ['tampered', $row['id']]));
        reject(fn() => rgInspectionQuery($db, 'DELETE FROM rg_inspection_audit WHERE inspection_id=?', [$row['id']]));
        reject(fn() => rgInspectionQuery($db, 'UPDATE rg_inspection_scoring_configs SET config=?', ['{}']));
        $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'transition', ['status' => 'published']);
    });

    test('replacement publication archives the old report atomically and preserves its snapshot', function () use ($db, $admin, $vehicleId, $vehicle, $document, &$row): void {
        $old = $row;
        $next = readyReport($db, $admin, $vehicleId, $vehicle, $document);
        $next = rgInspectionMutate($db, $admin, $next['id'], $next['revision'], 'transition', ['status' => 'published']);
        $archived = rgInspectionFind($db, $old['id']);
        check($archived['status'] === 'archived' && $archived['revision'] === $old['revision'] + 1, 'Previous report must be archived');
        check($archived['scoring_snapshot'] == $old['scoring_snapshot'], 'Previous snapshot must stay unchanged');
        check(rgInspectionCurrent($db, $vehicleId)['id'] === $next['id'], 'Current pointer must reference replacement');
        check((int) rgInspectionQuery($db, "SELECT COUNT(*) FROM rg_inspections WHERE vehicle_id=? AND status='published'", [$vehicleId])->fetchColumn() === 1, 'Exactly one published report');
        $row = $next;
    });

    test('failure after pointer replacement rolls back old archive, new publication and audit', function () use ($db, $admin, $vehicleId, $vehicle, $document, $row): void {
        $next = readyReport($db, $admin, $vehicleId, $vehicle, $document);
        $db->exec("CREATE TRIGGER test_fail_publication BEFORE INSERT ON rg_inspection_audit FOR EACH ROW BEGIN IF NEW.inspection_id='" . $next['id'] . "' AND NEW.to_status='published' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Injected test rollback'; END IF; END");
        try { reject(fn() => rgInspectionMutate($db, $admin, $next['id'], $next['revision'], 'transition', ['status' => 'published'])); }
        finally { $db->exec('DROP TRIGGER test_fail_publication'); }
        check(rgInspectionCurrent($db, $vehicleId)['id'] === $row['id'], 'Rollback must restore current pointer');
        $current = rgInspectionFind($db, $row['id']);
        check($current['status'] === 'published' && $current['revision'] === $row['revision'], 'Rollback must preserve prior report');
        $unpublished = rgInspectionFind($db, $next['id']);
        check($unpublished['status'] === 'approved' && $unpublished['revision'] === $next['revision'], 'Failed publication must leave approved report unchanged');
        check(!$db->inTransaction(), 'Failed operation must close its transaction');
    });

    test('concurrent publications by distinct admins serialize on the same vehicle and keep one published report', function () use ($db, $admin, $secondAdmin, $vehicleId, $vehicle, $document, $name): void {
        $candidates = [readyReport($db, $admin, $vehicleId, $vehicle, $document), readyReport($db, $admin, $vehicleId, $vehicle, $document)];
        $db->beginTransaction(); rgInspectionLockVehicle($db, $vehicleId);
        $workers = [];
        try {
            foreach ($candidates as $index => $candidate) {
                $pipes = [];
                $process = proc_open([PHP_BINARY, '-n', '-d', 'extension_dir=' . ini_get('extension_dir'), '-d', 'extension=pdo_mysql', __FILE__, '--publish-worker', $name, $candidate['id'], (string) $candidate['revision'], [$admin, $secondAdmin][$index]['id']], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
                check(is_resource($process), 'Worker must start'); fclose($pipes[0]); $workers[] = [$process, $pipes];
            }
            // Both transactions must have read their original snapshots before
            // the vehicle lock is released; otherwise a stale-read race can hide.
            $waiting = 0; $deadline = microtime(true) + 5;
            do {
                usleep(25000);
                $waiting = (int) rgInspectionQuery($db, "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB=? AND COMMAND<>'Sleep' AND INFO LIKE '%rg_inspection_vehicle_locks%' AND ID<>CONNECTION_ID()", [$name])->fetchColumn();
            } while ($waiting < 2 && microtime(true) < $deadline);
            $db->commit();
            $failures = [];
            foreach ($workers as [$process, $pipes]) {
                $out = stream_get_contents($pipes[1]); $err = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
                if (proc_close($process) !== 0) $failures[] = $err;
                elseif ((json_decode($out, true)['status'] ?? null) !== 'published') $failures[] = 'Worker did not publish';
            }
            check(!$failures, 'Concurrent worker failed: ' . implode('; ', $failures));
            check($waiting === 2, 'Both publishers must contend on the vehicle lock for this regression test');
        } finally { if ($db->inTransaction()) $db->rollBack(); }
        check((int) rgInspectionQuery($db, "SELECT COUNT(*) FROM rg_inspections WHERE vehicle_id=? AND status='published'", [$vehicleId])->fetchColumn() === 1, 'Concurrency must preserve one published report');
        check(in_array(rgInspectionCurrent($db, $vehicleId)['id'], array_column($candidates, 'id'), true), 'Current pointer must choose one candidate');
    });

    test('evidence ownership, moderation, limits, failed mutations and approved-photo immutability', function () use ($db, $admin, $inspector, $vehicle, $document): void {
        $row = rgInspectionCreate($db, $admin, 'evidence-unit', $vehicle);
        $items = array_column(rgInspectionItems(rgInspectionConfig()), 'id');
        $first = photoForTest($row, $items[0], true);
        reject(fn() => rgInspectionMutate($db, $inspector, $row['id'], $row['revision'], 'upload_evidence', ['_evidence' => $first]), 403);
        $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'upload_evidence', ['_evidence' => $first]);
        $row = rgInspectionMutate($db, $inspector, $row['id'], $row['revision'], 'update_evidence', ['evidence_id' => $first['id'], 'approved_public' => true, 'caption' => 'Descripción cambiada']);
        check((int) rgInspectionQuery($db, 'SELECT approved_public FROM rg_inspection_evidence WHERE id=?', [$first['id']])->fetchColumn() === 0, 'Inspector caption edit must revoke approval');
        reject(fn() => rgInspectionMutate($db, $inspector, $row['id'], $row['revision'], 'update_evidence', ['evidence_id' => $first['id'], 'approved_public' => true, 'caption' => 'Descripción cambiada']), 403);
        $other = rgInspectionCreate($db, $admin, 'other-evidence-unit', $vehicle);
        reject(fn() => rgInspectionMutate($db, $admin, $other['id'], $other['revision'], 'delete_evidence', ['evidence_id' => $first['id']]), 404);
        $oversized = photoForTest($other, $items[0]); $oversized['size_bytes'] = 8388609;
        reject(fn() => rgInspectionMutate($db, $admin, $other['id'], $other['revision'], 'upload_evidence', ['_evidence' => $oversized]));
        check((int) rgInspectionQuery($db, 'SELECT COUNT(*) FROM rg_inspection_evidence WHERE inspection_id=?', [$other['id']])->fetchColumn() === 0, 'Oversized evidence must roll back');
        check(rgInspectionFind($db, $other['id'])['revision'] === 1, 'Oversized upload must not change the report');
        for ($i = 1; $i < 5; $i++) $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'upload_evidence', ['_evidence' => photoForTest($row, $items[0])]);
        $revision = $row['revision'];
        reject(fn() => rgInspectionMutate($db, $admin, $row['id'], $revision, 'upload_evidence', ['_evidence' => photoForTest($row, $items[0])]), 400);
        for ($i = 5; $i < 100; $i++) $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'upload_evidence', ['_evidence' => photoForTest($row, $items[intdiv($i, 5)])]);
        reject(fn() => rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'upload_evidence', ['_evidence' => photoForTest($row, $items[20])]), 400);
        check((int) rgInspectionQuery($db, 'SELECT COUNT(*) FROM rg_inspection_evidence WHERE inspection_id=?', [$row['id']])->fetchColumn() === 100, 'Evidence cap must hold');
        check(rgInspectionFind($db, $row['id'])['revision'] === $row['revision'], 'Rejected evidence must not increment revision');
        $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'save', ['document' => $document]);
        $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'transition', ['status' => 'in_review']);
        $row = rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'transition', ['status' => 'approved']);
        reject(fn() => rgInspectionMutate($db, $admin, $row['id'], $row['revision'], 'delete_evidence', ['evidence_id' => $first['id']]), 409);
        reject(fn() => rgInspectionQuery($db, 'UPDATE rg_inspection_evidence SET caption=? WHERE id=?', ['Tampered', $first['id']]));
        reject(fn() => rgInspectionQuery($db, 'DELETE FROM rg_inspection_evidence WHERE id=?', [$first['id']]));
    });
    echo 'PASS all real database integration checks (' . $db->query('SELECT VERSION()')->fetchColumn() . ')' . PHP_EOL;
} finally {
    if ($db->inTransaction()) $db->rollBack();
    $db = null;
    $control->exec('DROP DATABASE `' . $name . '`');
}
