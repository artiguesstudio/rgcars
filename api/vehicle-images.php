<?php

declare(strict_types=1);

const RGC_SUPABASE_URL = 'https://hqnthnpgiqngokyqgdsw.supabase.co';
const RGC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxbnRobnBnaXFuZ29reXFnZHN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTg3MjcsImV4cCI6MjA4NjM5NDcyN30.SoI_NV1SBKZ1E7_9-TuZ6fHFoREZ2IBwvmPLW960-T4';
const RGC_MAX_IMAGE_BYTES = 15728640; // 15 MiB

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['error' => 'Método no permitido.']);
}

$payload = readJsonPayload();
$action = trim((string) ($_POST['action'] ?? $payload['action'] ?? ''));

if ($action === '') {
    respond(400, ['error' => 'Falta indicar la acción.']);
}

$token = bearerToken();
if ($token === '') {
    respond(401, ['error' => 'Falta la sesión de administrador.']);
}

$user = validateSupabaseUser($token);
if (!$user || empty($user['id'])) {
    respond(401, ['error' => 'La sesión venció o no es válida. Volvé a ingresar.']);
}

enforceOptionalEmailAllowlist((string) ($user['email'] ?? ''));

if ($action === 'upload') {
    uploadImage();
}

if ($action === 'delete') {
    deleteImage((string) ($payload['path'] ?? $_POST['path'] ?? ''));
}

respond(400, ['error' => 'Acción no reconocida.']);

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function readJsonPayload(): array
{
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (strpos($contentType, 'application/json') === false) {
        return [];
    }

    $raw = file_get_contents('php://input');
    if (!is_string($raw) || $raw === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function bearerToken(): string
{
    $authorization = (string) (
        $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? ''
    );

    if ($authorization === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $authorization = (string) ($headers['Authorization'] ?? $headers['authorization'] ?? '');
    }

    if (!preg_match('/^Bearer\s+(.+)$/i', trim($authorization), $matches)) {
        return '';
    }

    return trim($matches[1]);
}

function validateSupabaseUser(string $token): ?array
{
    $jwtSecret = serverSetting('RGC_SUPABASE_JWT_SECRET');
    if ($jwtSecret !== '') {
        return validateLocalJwtUser($token, $jwtSecret);
    }

    $supabaseUrl = rtrim(serverSetting('RGC_SUPABASE_URL', RGC_SUPABASE_URL), '/');
    $anonKey = serverSetting('RGC_SUPABASE_ANON_KEY', RGC_SUPABASE_ANON_KEY);
    $response = httpRequest(
        $supabaseUrl . '/auth/v1/user',
        [
            'apikey: ' . $anonKey,
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ]
    );

    if ($response['status'] !== 200 || !is_array($response['json'])) {
        return null;
    }

    return $response['json'];
}

function validateLocalJwtUser(string $token, string $secret): ?array
{
    $segments = explode('.', $token);
    if (count($segments) !== 3) {
        return null;
    }

    [$encodedHeader, $encodedPayload, $encodedSignature] = $segments;
    $header = json_decode(base64UrlDecode($encodedHeader), true);
    $payload = json_decode(base64UrlDecode($encodedPayload), true);
    $signature = base64UrlDecode($encodedSignature);
    if (!is_array($header) || !is_array($payload) || $signature === '') {
        return null;
    }

    if (($header['alg'] ?? '') !== 'HS256') {
        return null;
    }

    $expectedSignature = hash_hmac('sha256', $encodedHeader . '.' . $encodedPayload, $secret, true);
    if (!hash_equals($expectedSignature, $signature)) {
        return null;
    }

    $expiresAt = (int) ($payload['exp'] ?? 0);
    $subject = trim((string) ($payload['sub'] ?? ''));
    $role = trim((string) ($payload['role'] ?? ''));
    if ($expiresAt < time() || $subject === '' || $role !== 'authenticated') {
        return null;
    }

    return [
        'id' => $subject,
        'email' => (string) ($payload['email'] ?? ''),
    ];
}

function base64UrlDecode(string $value): string
{
    $padding = strlen($value) % 4;
    if ($padding > 0) {
        $value .= str_repeat('=', 4 - $padding);
    }
    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    return is_string($decoded) ? $decoded : '';
}

function enforceOptionalEmailAllowlist(string $email): void
{
    $rawAllowlist = trim(serverSetting('RGC_STORAGE_ALLOWED_EMAILS'));
    if ($rawAllowlist === '') {
        return;
    }

    $allowed = array_values(array_filter(array_map(
        static function ($value): string {
            return strtolower(trim((string) $value));
        },
        explode(',', $rawAllowlist)
    )));

    if (!in_array(strtolower(trim($email)), $allowed, true)) {
        respond(403, ['error' => 'Tu usuario no tiene permiso para administrar archivos.']);
    }
}

function httpRequest(string $url, array $headers): array
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => implode("\r\n", $headers),
                'ignore_errors' => true,
                'timeout' => 15,
            ],
        ]);
        $body = @file_get_contents($url, false, $context);
        $status = 0;
        foreach (($http_response_header ?? []) as $line) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $matches)) {
                $status = (int) $matches[1];
                break;
            }
        }
    }

    $decoded = is_string($body) ? json_decode($body, true) : null;
    return [
        'status' => $status,
        'json' => is_array($decoded) ? $decoded : null,
    ];
}

function uploadImage(): void
{
    $vehicleId = trim((string) ($_POST['vehicle_id'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $vehicleId)) {
        respond(422, ['error' => 'El identificador del vehículo no es válido.']);
    }

    if (!isset($_FILES['image']) || !is_array($_FILES['image'])) {
        respond(422, ['error' => 'No se recibió ninguna imagen.']);
    }

    $file = $_FILES['image'];
    $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($uploadError !== UPLOAD_ERR_OK) {
        $message = in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
            ? 'La imagen supera el límite permitido por el servidor.'
            : 'No se pudo recibir la imagen.';
        respond(422, ['error' => $message]);
    }

    $size = (int) ($file['size'] ?? 0);
    $temporaryPath = (string) ($file['tmp_name'] ?? '');
    if ($size < 1 || $size > RGC_MAX_IMAGE_BYTES || !is_uploaded_file($temporaryPath)) {
        respond(422, ['error' => 'La imagen debe pesar entre 1 byte y 15 MB.']);
    }

    $mime = detectMimeType($temporaryPath);
    $extensions = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
        'image/avif' => 'avif',
    ];
    if (!isset($extensions[$mime])) {
        respond(415, ['error' => 'Formato no admitido. Usá JPG, PNG, WebP, GIF o AVIF.']);
    }

    $migrationKey = strtolower(trim((string) ($_POST['migration_key'] ?? '')));
    if ($migrationKey !== '' && !preg_match('/^[a-f0-9]{64}$/', $migrationKey)) {
        respond(422, ['error' => 'La clave de migración no es válida.']);
    }

    $storageRoot = storageRoot();
    $vehicleDirectory = $storageRoot . DIRECTORY_SEPARATOR . $vehicleId;
    ensureDirectory($vehicleDirectory);

    try {
        $basename = $migrationKey !== '' ? $migrationKey : bin2hex(random_bytes(16));
    } catch (Throwable $error) {
        respond(500, ['error' => 'No se pudo generar un nombre seguro para la imagen.']);
    }

    $filename = $basename . '.' . $extensions[$mime];
    $destination = $vehicleDirectory . DIRECTORY_SEPARATOR . $filename;
    $relativePath = $vehicleId . '/' . $filename;

    if ($migrationKey !== '' && is_file($destination)) {
        respond(200, [
            'ok' => true,
            'url' => publicImageUrl($relativePath),
            'path' => $relativePath,
            'existing' => true,
        ]);
    }

    if (!move_uploaded_file($temporaryPath, $destination)) {
        respond(500, ['error' => 'El servidor no pudo guardar la imagen.']);
    }
    @chmod($destination, 0644);

    respond(201, [
        'ok' => true,
        'url' => publicImageUrl($relativePath),
        'path' => $relativePath,
    ]);
}

function deleteImage(string $inputPath): void
{
    $relativePath = storageRelativePath($inputPath);
    if ($relativePath === '') {
        respond(422, ['error' => 'La ruta de la imagen no es válida.']);
    }

    $target = storageRoot() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
    if (is_file($target) && !@unlink($target)) {
        respond(500, ['error' => 'El servidor no pudo eliminar la imagen.']);
    }

    $parent = dirname($target);
    if (is_dir($parent)) {
        $entries = array_diff(scandir($parent) ?: [], ['.', '..']);
        if (!$entries) {
            @rmdir($parent);
        }
    }

    respond(200, ['ok' => true, 'path' => $relativePath]);
}

function detectMimeType(string $path): string
{
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        return strtolower((string) $finfo->file($path));
    }

    if (function_exists('mime_content_type')) {
        return strtolower((string) mime_content_type($path));
    }

    return '';
}

function storageRoot(): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'vehicles';
}

function ensureDirectory(string $path): void
{
    if (is_dir($path)) {
        return;
    }

    if (!@mkdir($path, 0755, true) && !is_dir($path)) {
        respond(500, ['error' => 'No se pudo preparar la carpeta de imágenes.']);
    }
}

function publicImageUrl(string $relativePath): string
{
    $configuredBase = trim(serverSetting('RGC_STORAGE_PUBLIC_BASE_URL'));
    $encodedPath = implode('/', array_map('rawurlencode', explode('/', $relativePath)));
    if ($configuredBase !== '') {
        return rtrim($configuredBase, '/') . '/' . $encodedPath;
    }

    $scriptPath = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/api/vehicle-images.php'));
    $siteBase = rtrim(str_replace('\\', '/', dirname(dirname($scriptPath))), '/.');
    return ($siteBase === '' ? '' : $siteBase) . '/uploads/vehicles/' . $encodedPath;
}

function storageRelativePath(string $input): string
{
    $input = trim($input);
    if ($input === '') {
        return '';
    }

    $urlPath = parse_url($input, PHP_URL_PATH);
    $path = rawurldecode(is_string($urlPath) ? $urlPath : $input);
    $path = str_replace('\\', '/', $path);
    $marker = '/uploads/vehicles/';
    $markerIndex = strpos($path, $marker);
    if ($markerIndex !== false) {
        $path = substr($path, $markerIndex + strlen($marker));
    }
    $path = ltrim($path, '/');

    if (!preg_match('#^[A-Za-z0-9_-]{1,80}/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$#', $path)) {
        return '';
    }

    if (strpos($path, '..') !== false) {
        return '';
    }

    return $path;
}

function serverSetting(string $name, string $fallback = ''): string
{
    $environmentValue = getenv($name);
    if (is_string($environmentValue) && $environmentValue !== '') {
        return $environmentValue;
    }

    $settings = serverSettings();
    $fileValue = $settings[$name] ?? '';
    return is_scalar($fileValue) && (string) $fileValue !== '' ? (string) $fileValue : $fallback;
}

function serverSettings(): array
{
    static $settings = null;
    if (is_array($settings)) {
        return $settings;
    }

    $configuredPath = getenv('RGC_STORAGE_SECRETS_FILE');
    $path = is_string($configuredPath) && $configuredPath !== ''
        ? $configuredPath
        : dirname(dirname(__DIR__)) . DIRECTORY_SEPARATOR . 'rgcars-storage-secrets.php';
    if (!is_file($path)) {
        $settings = [];
        return $settings;
    }

    $loaded = include $path;
    $settings = is_array($loaded) ? $loaded : [];
    return $settings;
}
