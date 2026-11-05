<?php
declare(strict_types=1);

// Shared runtime for the cPanel inspection API. No application secrets belong here.
const RGC_INSPECTION_MAX_IMAGE_BYTES = 8388608;
const RGC_INSPECTION_MAX_JSON_BYTES = 1048576;

final class RgcInspectionHttpError extends RuntimeException
{
    public int $status;
    public array $details;
    public function __construct(int $status, string $message, array $details = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->details = $details;
    }
}

function rgInspectionSettings(): array
{
    static $settings;
    if (is_array($settings)) return $settings;
    $configured = getenv('RGC_INSPECTIONS_SECRETS_FILE');
    $path = is_string($configured) && $configured !== ''
        ? $configured : dirname(__DIR__, 3) . '/rgcars-inspections-secrets.php';
    if (!is_file($path)) return $settings = [];
    $resolved = realpath($path);
    $webroot = realpath(dirname(__DIR__, 2));
    if ($resolved === false || ($webroot !== false && str_starts_with(str_replace('\\', '/', $resolved), rtrim(str_replace('\\', '/', $webroot), '/') . '/'))) {
        throw new RgcInspectionHttpError(503, 'La configuración privada del módulo debe estar fuera del directorio público.');
    }
    $loaded = require $resolved;
    if (!is_array($loaded)) throw new RgcInspectionHttpError(503, 'La configuración del módulo no es válida.');
    return $settings = $loaded;
}

function rgInspectionSetting(string $key, string $default = ''): string
{
    $environment = getenv($key);
    if (is_string($environment) && $environment !== '') return $environment;
    $value = rgInspectionSettings()[$key] ?? $default;
    return is_scalar($value) ? (string) $value : $default;
}

function rgInspectionDatabase(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) return $pdo;
    $database = rgInspectionSetting('RGC_INSPECTION_DB_NAME');
    $user = rgInspectionSetting('RGC_INSPECTION_DB_USER');
    if ($database === '' || $user === '' || !extension_loaded('pdo_mysql')) {
        throw new RgcInspectionHttpError(503, 'El almacenamiento de peritajes todavía no está configurado.');
    }
    $host = rgInspectionSetting('RGC_INSPECTION_DB_HOST', 'localhost');
    $port = rgInspectionSetting('RGC_INSPECTION_DB_PORT', '3306');
    if (!preg_match('/^[A-Za-z0-9_.-]+$/D', $host) || !preg_match('/^[A-Za-z0-9_$-]+$/D', $database) || !ctype_digit($port)) {
        throw new RgcInspectionHttpError(503, 'La conexión de peritajes no está configurada correctamente.');
    }
    $pdo = new PDO("mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4", $user, rgInspectionSetting('RGC_INSPECTION_DB_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 10,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function rgInspectionEncode(mixed $value): string
{
    return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}

/** Keep empty JSON objects distinct from arrays across PHP/JS round trips. */
function rgInspectionDecode(string $json): mixed
{
    $value = json_decode($json, false, 64, JSON_THROW_ON_ERROR);
    $convert = static function (mixed $node) use (&$convert): mixed {
        if ($node instanceof stdClass) {
            $properties = get_object_vars($node);
            if ($properties === []) return new stdClass();
            return array_map($convert, $properties);
        }
        return is_array($node) ? array_map($convert, $node) : $node;
    };
    return $convert($value);
}

function rgInspectionRespond(array $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo rgInspectionEncode($body);
    exit;
}

function rgInspectionUuid(?string $value = null): string
{
    if ($value !== null) {
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iD', $value)) {
            throw new RgcInspectionHttpError(400, 'Identificador de peritaje o evidencia inválido.');
        }
        return strtolower($value);
    }
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 15) | 64);
    $bytes[8] = chr((ord($bytes[8]) & 63) | 128);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}

function rgInspectionText(mixed $value, int $limit, string $label): string
{
    if (!is_string($value) || !preg_match('//u', $value) || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value)
        || (function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value)) > $limit) {
        throw new RgcInspectionHttpError(400, $label . ' inválido.');
    }
    return trim($value);
}

function rgInspectionVehicleId(mixed $value): string
{
    if (!is_string($value) && !is_int($value)) throw new RgcInspectionHttpError(400, 'Vehículo inválido.');
    $id = rgInspectionText((string) $value, 150, 'Vehículo');
    if ($id === '') throw new RgcInspectionHttpError(400, 'Falta el vehículo.');
    return $id;
}

function rgInspectionRevision(mixed $value): int
{
    if (!is_int($value) || $value < 1 || $value > 2147483646) throw new RgcInspectionHttpError(400, 'Revisión inválida.');
    return $value;
}

function rgInspectionBearer(): string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }
    if (!is_string($header) || strlen($header) > 16384 || !preg_match('/^Bearer\s+([^\s]+)$/iD', trim($header), $match)) {
        throw new RgcInspectionHttpError(401, 'Iniciá sesión para acceder a peritajes.');
    }
    return $match[1];
}

/** Remote calls remain explicit: this module migration retains existing Auth and inventory. */
function rgInspectionSupabase(string $path, ?string $token = null, array $query = []): array
{
    $base = rtrim(rgInspectionSetting('RGC_SUPABASE_URL', 'https://hqnthnpgiqngokyqgdsw.supabase.co'), '/');
    $anon = rgInspectionSetting('RGC_SUPABASE_ANON_KEY');
    if ($anon === '' || !preg_match('#^https://[A-Za-z0-9.-]+$#D', $base) || !extension_loaded('curl')) {
        throw new RgcInspectionHttpError(503, 'La conexión con cuentas y vehículos todavía no está configurada.');
    }
    $url = $base . $path . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
    $curl = curl_init($url);
    $body = '';
    curl_setopt_array($curl, [
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 20,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER => ['apikey: ' . $anon, 'Authorization: Bearer ' . ($token ?? $anon), 'Accept: application/json'],
        CURLOPT_WRITEFUNCTION => static function ($handle, string $part) use (&$body): int {
            if (strlen($body) + strlen($part) > 2097152) return 0;
            $body .= $part;
            return strlen($part);
        },
    ]);
    $ok = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if ($ok === false || $status >= 500 || $status === 0 || $status === 402 || $status === 429) {
        throw new RgcInspectionHttpError(503, 'No se pudo verificar la cuenta o el vehículo. Intentá nuevamente.');
    }
    $decoded = json_decode($body, true);
    return ['status' => $status, 'data' => is_array($decoded) ? $decoded : null];
}

function rgInspectionAuthenticate(PDO $db): array
{
    $token = rgInspectionBearer();
    $response = rgInspectionSupabase('/auth/v1/user', $token);
    $user = $response['data'];
    if ($response['status'] !== 200 || !is_array($user) || !is_string($user['id'] ?? null) || !is_string($user['email'] ?? null)) {
        throw new RgcInspectionHttpError(401, 'La sesión no es válida. Volvé a ingresar.');
    }
    $id = rgInspectionUuid($user['id']);
    $email = strtolower(trim($user['email']));
    // The existing backoffice already reads active profiles through its RLS.
    // Missing/denied profiles fail closed; no front-end roles or email defaults.
    $profiles = rgInspectionSupabase('/rest/v1/admin_access_profiles', $token, ['select' => 'email,is_active', 'email' => 'eq.' . $email, 'is_active' => 'eq.true', 'limit' => '2']);
    $activeProfile = $profiles['status'] === 200 && count($profiles['data'] ?? []) === 1 && ($profiles['data'][0]['is_active'] ?? false) === true;
    $stmt = $db->prepare('SELECT email,user_id,role,can_na,is_active FROM rg_inspection_permissions WHERE email = ?');
    $stmt->execute([$email]);
    $grant = $stmt->fetch();
    $allowed = $activeProfile && $grant && (int) $grant['is_active'] === 1 && ($grant['user_id'] === null || hash_equals($grant['user_id'], $id));
    if ($allowed && $grant['user_id'] === null) {
        // Bind explicitly seeded email to its first verified Auth UUID. A later
        // account with the same email needs a deliberate permission reassignment.
        $bind = $db->prepare('UPDATE rg_inspection_permissions SET user_id = ? WHERE email = ? AND user_id IS NULL AND is_active = 1');
        $bind->execute([$id, $email]);
        $stmt->execute([$email]);
        $grant = $stmt->fetch();
        $allowed = $grant && is_string($grant['user_id']) && hash_equals($grant['user_id'], $id);
    }
    return ['id' => $id, 'email' => $email, 'token' => $token, 'capabilities' => [
        'can_edit' => (bool) $allowed,
        'can_approve' => $allowed && $grant['role'] === 'admin',
        'can_na' => $allowed && (int) $grant['can_na'] === 1,
    ]];
}

function rgInspectionRemoteVehicle(string $id, ?string $token = null): ?array
{
    $response = rgInspectionSupabase('/rest/v1/vehicles', $token, ['select' => $token === null ? 'id,status' : '*', 'id' => 'eq.' . $id, 'limit' => '2']);
    if ($response['status'] !== 200) throw new RgcInspectionHttpError(503, 'No se pudo verificar el vehículo vinculado.');
    if (count($response['data'] ?? []) !== 1) return null;
    $row = $response['data'][0];
    return is_array($row) && (string) ($row['id'] ?? '') === $id ? $row : null;
}

function rgInspectionValidateOrFail(mixed $document, array $capabilities, bool $final = false): void
{
    $issues = rgInspectionValidateDocument($document, ['final' => $final, 'allowNA' => ($capabilities['can_na'] ?? false) === true]);
    if ($issues) throw new RgcInspectionHttpError(400, 'Revisá los datos del peritaje.', $issues);
}
