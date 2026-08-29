<?php

declare(strict_types=1);

const RGC_JOB_MAX_CV_BYTES = 5242880; // 5 MiB
const RGC_JOB_DOWNLOAD_TTL_SECONDS = 7776000; // 90 días
const RGC_JOB_DEFAULT_RECIPIENTS = 'rgcarstdf@gmail.com';
const RGC_JOB_DEFAULT_FROM = 'no-responder@rgcars.com.ar';
const RGC_SUPABASE_URL = 'https://hqnthnpgiqngokyqgdsw.supabase.co';
const RGC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxbnRobnBnaXFuZ29reXFnZHN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTg3MjcsImV4cCI6MjA4NjM5NDcyN30.SoI_NV1SBKZ1E7_9-TuZ6fHFoREZ2IBwvmPLW960-T4';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? ''));

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($method === 'GET') {
    $action = normalizeText($_GET['action'] ?? '', 40);
    if ($action === 'list') {
        requireAdminUser();
        listJobApplications();
    }
    if ($action === 'download') {
        requireAdminUser();
        serveAdminCv();
    }
    servePrivateCv();
}

if ($method !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Método no permitido.']);
}

$contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
if (strpos($contentType, 'application/json') !== false) {
    $payload = readJsonPayload();
    $action = normalizeText($payload['action'] ?? '', 40);
    if ($action === 'update') {
        $adminUser = requireAdminUser();
        updateJobApplication($payload, $adminUser);
    }
    respond(400, ['ok' => false, 'error' => 'Acción administrativa no reconocida.']);
}

if (!isSameOriginRequest()) {
    respond(403, ['ok' => false, 'error' => 'Origen de solicitud no permitido.']);
}

$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > RGC_JOB_MAX_CV_BYTES + 1048576) {
    respond(413, ['ok' => false, 'error' => 'El CV no puede superar los 5 MB.']);
}

// Campo trampa: los bots reciben una respuesta neutra sin guardar información.
if (normalizeText($_POST['website'] ?? '', 200) !== '') {
    respond(201, ['ok' => true, 'saved' => true]);
}

$fullName = normalizeText($_POST['full_name'] ?? '', 120);
$email = strtolower(normalizeText($_POST['email'] ?? '', 160));
$phone = normalizeText($_POST['phone'] ?? '', 40);
$age = parseInteger($_POST['age'] ?? null);
$maritalStatus = normalizeText($_POST['marital_status'] ?? '', 40);
$childrenCount = parseInteger($_POST['children_count'] ?? null);
$salesExperienceYears = parseInteger($_POST['sales_experience_years'] ?? null);
$automotiveSalesExperience = normalizeText($_POST['automotive_sales_experience'] ?? '', 10);
$targetBasedSalesExperience = normalizeText($_POST['target_based_sales_experience'] ?? '', 10);
$crmExperience = normalizeText($_POST['crm_experience'] ?? '', 10);
$fullTimeAvailability = normalizeText($_POST['full_time_availability'] ?? '', 10);
$hasDrivingLicense = normalizeText($_POST['has_driving_license'] ?? '', 10) === 'yes';
$experience = normalizeText($_POST['experience'] ?? '', 3000, true);
$position = normalizeText($_POST['position'] ?? '', 120) ?: 'Vendedor/a con experiencia';
$sourcePage = normalizeText($_POST['source_page'] ?? '', 80) ?: 'site';
$sourceUrl = sanitizeSourceUrl($_POST['source_url'] ?? '');
$privacyConsent = normalizeText($_POST['privacy_consent'] ?? '', 20) === 'accepted';

if (textLength($fullName) < 3) {
    respond(422, ['ok' => false, 'error' => 'Ingresá tu nombre y apellido.']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(422, ['ok' => false, 'error' => 'Ingresá un email válido.']);
}
$phoneDigits = preg_replace('/\D+/', '', $phone) ?: '';
if (!preg_match('/^[\d\s()+-]+$/', $phone) || strlen($phoneDigits) < 8) {
    respond(422, ['ok' => false, 'error' => 'Ingresá un teléfono o WhatsApp válido.']);
}
if ($age === null || $age < 18 || $age > 80) {
    respond(422, ['ok' => false, 'error' => 'Ingresá una edad válida.']);
}

$maritalLabels = [
    'single' => 'Soltero/a',
    'married' => 'Casado/a',
    'domestic_partnership' => 'Unión convivencial',
    'divorced' => 'Divorciado/a',
    'widowed' => 'Viudo/a',
    'prefer_not_to_say' => 'Prefiere no informarlo',
];
if (!isset($maritalLabels[$maritalStatus])) {
    respond(422, ['ok' => false, 'error' => 'Seleccioná un estado civil válido.']);
}
if ($childrenCount === null || $childrenCount < 0 || $childrenCount > 20) {
    respond(422, ['ok' => false, 'error' => 'Ingresá una cantidad de hijos válida.']);
}
if ($salesExperienceYears === null || $salesExperienceYears < 0 || $salesExperienceYears > 40) {
    respond(422, ['ok' => false, 'error' => 'Ingresá tus años de experiencia en ventas.']);
}
if (!in_array($automotiveSalesExperience, ['yes', 'no'], true)) {
    respond(422, ['ok' => false, 'error' => 'Indicá si tenés experiencia en venta de vehículos.']);
}
if (!in_array($targetBasedSalesExperience, ['yes', 'no'], true)) {
    respond(422, ['ok' => false, 'error' => 'Indicá si trabajaste con objetivos o comisiones.']);
}
if (!in_array($crmExperience, ['yes', 'no'], true)) {
    respond(422, ['ok' => false, 'error' => 'Indicá si utilizaste CRM o seguimiento digital.']);
}
if (!in_array($fullTimeAvailability, ['yes', 'no'], true)) {
    respond(422, ['ok' => false, 'error' => 'Indicá tu disponibilidad horaria.']);
}
if (!$hasDrivingLicense) {
    respond(422, ['ok' => false, 'error' => 'Para esta búsqueda es obligatorio contar con carnet de conducir vigente.']);
}
if (textLength($experience) < 30) {
    respond(422, ['ok' => false, 'error' => 'Contanos un poco más sobre tu experiencia en ventas.']);
}
if (!$privacyConsent) {
    respond(422, ['ok' => false, 'error' => 'Necesitamos tu autorización para tratar los datos de la postulación.']);
}

$cv = $_FILES['cv'] ?? null;
if (!is_array($cv)) {
    respond(422, ['ok' => false, 'error' => 'Adjuntá tu CV para completar la postulación.']);
}

$uploadError = (int) ($cv['error'] ?? UPLOAD_ERR_NO_FILE);
if ($uploadError !== UPLOAD_ERR_OK) {
    $message = in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
        ? 'El CV no puede superar los 5 MB.'
        : 'No pudimos recibir el CV. Intentá adjuntarlo nuevamente.';
    respond(422, ['ok' => false, 'error' => $message]);
}

$cvSize = (int) ($cv['size'] ?? 0);
$temporaryPath = (string) ($cv['tmp_name'] ?? '');
if ($cvSize < 1 || $cvSize > RGC_JOB_MAX_CV_BYTES || !is_uploaded_file($temporaryPath)) {
    respond(422, ['ok' => false, 'error' => 'El CV debe pesar entre 1 byte y 5 MB.']);
}

$originalName = safeOriginalFileName((string) ($cv['name'] ?? 'cv'));
$extension = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
$mimeType = verifiedCvMimeType($temporaryPath, $extension);
if ($mimeType === '') {
    respond(415, ['ok' => false, 'error' => 'Adjuntá un archivo PDF, DOC o DOCX válido.']);
}

try {
    $applicationId = bin2hex(random_bytes(16));
    $downloadToken = bin2hex(random_bytes(32));
} catch (Throwable $error) {
    respond(500, ['ok' => false, 'error' => 'No pudimos preparar la postulación. Intentá nuevamente.']);
}

$storageRoot = jobApplicationStorageRoot();
ensurePrivateDirectory($storageRoot);
$applicationDirectory = $storageRoot . DIRECTORY_SEPARATOR . $applicationId;
ensurePrivateDirectory($applicationDirectory);

$storedFileName = 'cv.' . $extension;
$destination = $applicationDirectory . DIRECTORY_SEPARATOR . $storedFileName;
if (!move_uploaded_file($temporaryPath, $destination)) {
    respond(500, ['ok' => false, 'error' => 'El servidor no pudo guardar el CV. Intentá nuevamente.']);
}
@chmod($destination, 0600);

$createdAt = new DateTimeImmutable('now', new DateTimeZone('America/Argentina/Buenos_Aires'));
$fit = calculateApplicantFit(
    $salesExperienceYears,
    $automotiveSalesExperience === 'yes',
    $targetBasedSalesExperience === 'yes',
    $crmExperience === 'yes',
    $fullTimeAvailability === 'yes'
);
$metadata = [
    'id' => $applicationId,
    'created_at' => $createdAt->format(DateTimeInterface::ATOM),
    'position' => $position,
    'full_name' => $fullName,
    'email' => $email,
    'phone' => $phone,
    'age' => $age,
    'marital_status' => $maritalStatus,
    'marital_status_label' => $maritalLabels[$maritalStatus],
    'children_count' => $childrenCount,
    'has_driving_license' => true,
    'sales_experience_years' => $salesExperienceYears,
    'automotive_sales_experience' => $automotiveSalesExperience === 'yes',
    'target_based_sales_experience' => $targetBasedSalesExperience === 'yes',
    'crm_experience' => $crmExperience === 'yes',
    'full_time_availability' => $fullTimeAvailability === 'yes',
    'fit_score' => $fit['score'],
    'fit_label' => $fit['label'],
    'fit_breakdown' => $fit['breakdown'],
    'fit_model_version' => 'sales-profile-v1',
    'experience' => $experience,
    'source_page' => $sourcePage,
    'source_url' => $sourceUrl,
    'privacy_consent_at' => $createdAt->format(DateTimeInterface::ATOM),
    'cv_file' => $storedFileName,
    'cv_original_name' => $originalName,
    'cv_mime_type' => $mimeType,
    'cv_size_bytes' => $cvSize,
    'download_token_hash' => hash('sha256', $downloadToken),
    'download_expires_at' => $createdAt->modify('+' . RGC_JOB_DOWNLOAD_TTL_SECONDS . ' seconds')->format(DateTimeInterface::ATOM),
    'email_sent_to_applicant' => false,
    'email_sent_to_team' => false,
    'status' => 'new',
    'admin_notes' => '',
];

$metadataPath = $applicationDirectory . DIRECTORY_SEPARATOR . 'application.json';
if (!writePrivateMetadata($metadataPath, $metadata)) {
    @unlink($destination);
    @rmdir($applicationDirectory);
    respond(500, ['ok' => false, 'error' => 'No pudimos registrar la postulación. Intentá nuevamente.']);
}

$downloadUrl = jobApplicationDownloadUrl($applicationId, $downloadToken);
$createdAtLabel = $createdAt->format('d/m/Y H:i');
$teamRecipients = jobApplicationRecipients();

$teamSubject = 'Nueva postulación · Afinidad ' . $fit['score'] . '/100: ' . $fullName;
$teamBody = buildTeamEmail([
    'full_name' => $fullName,
    'email' => $email,
    'phone' => $phone,
    'age' => $age,
    'marital_status_label' => $maritalLabels[$maritalStatus],
    'children_count' => $childrenCount,
    'sales_experience_years' => $salesExperienceYears,
    'automotive_sales_experience' => $automotiveSalesExperience === 'yes',
    'target_based_sales_experience' => $targetBasedSalesExperience === 'yes',
    'crm_experience' => $crmExperience === 'yes',
    'full_time_availability' => $fullTimeAvailability === 'yes',
    'fit_score' => $fit['score'],
    'fit_label' => $fit['label'],
    'fit_breakdown' => $fit['breakdown'],
    'experience' => $experience,
    'created_at' => $createdAtLabel,
    'download_url' => $downloadUrl,
]);
$emailSentToTeam = $teamRecipients
    ? sendHtmlMail($teamRecipients, $teamSubject, $teamBody, $email)
    : false;

$applicantSubject = 'Recibimos tu postulación · RG Cars TDF';
$applicantBody = buildApplicantEmail($fullName);
$emailSentToApplicant = sendHtmlMail([$email], $applicantSubject, $applicantBody);

$metadata['email_sent_to_applicant'] = $emailSentToApplicant;
$metadata['email_sent_to_team'] = $emailSentToTeam;
$metadata['notified_at'] = ($emailSentToApplicant || $emailSentToTeam)
    ? (new DateTimeImmutable('now', new DateTimeZone('America/Argentina/Buenos_Aires')))->format(DateTimeInterface::ATOM)
    : null;
writePrivateMetadata($metadataPath, $metadata);

respond(201, [
    'ok' => true,
    'saved' => true,
    'applicationId' => $applicationId,
    'emailSentToApplicant' => $emailSentToApplicant,
]);

function calculateApplicantFit(
    int $salesExperienceYears,
    bool $automotiveSalesExperience,
    bool $targetBasedSalesExperience,
    bool $crmExperience,
    bool $fullTimeAvailability
): array {
    if ($salesExperienceYears >= 6) {
        $yearsPoints = 35;
    } elseif ($salesExperienceYears >= 4) {
        $yearsPoints = 30;
    } elseif ($salesExperienceYears >= 2) {
        $yearsPoints = 22;
    } elseif ($salesExperienceYears >= 1) {
        $yearsPoints = 12;
    } else {
        $yearsPoints = 0;
    }

    $breakdown = [
        ['key' => 'sales_years', 'label' => 'Experiencia en ventas', 'points' => $yearsPoints, 'max' => 35],
        ['key' => 'automotive', 'label' => 'Experiencia automotriz', 'points' => $automotiveSalesExperience ? 25 : 0, 'max' => 25],
        ['key' => 'targets', 'label' => 'Trabajo por objetivos', 'points' => $targetBasedSalesExperience ? 15 : 0, 'max' => 15],
        ['key' => 'crm', 'label' => 'Uso de CRM', 'points' => $crmExperience ? 10 : 0, 'max' => 10],
        ['key' => 'availability', 'label' => 'Disponibilidad full time', 'points' => $fullTimeAvailability ? 15 : 0, 'max' => 15],
    ];
    $score = array_reduce($breakdown, static function (int $total, array $item): int {
        return $total + (int) ($item['points'] ?? 0);
    }, 0);
    $label = $score >= 85 ? 'Muy alta' : ($score >= 70 ? 'Alta' : ($score >= 50 ? 'Media' : 'Inicial'));
    return ['score' => $score, 'label' => $label, 'breakdown' => $breakdown];
}

function readJsonPayload(): array
{
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

function requireAdminUser(): array
{
    $token = bearerToken();
    if ($token === '') {
        respond(401, ['ok' => false, 'error' => 'Falta la sesión de administrador.']);
    }
    $user = validateSupabaseUser($token);
    if (!$user || empty($user['id'])) {
        respond(401, ['ok' => false, 'error' => 'La sesión venció o no es válida. Volvé a ingresar.']);
    }
    enforceOptionalEmailAllowlist((string) ($user['email'] ?? ''));
    return $user;
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
    return ['id' => $subject, 'email' => (string) ($payload['email'] ?? '')];
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
    $allowed = array_values(array_filter(array_map(static function ($value): string {
        return strtolower(trim((string) $value));
    }, explode(',', $rawAllowlist))));
    if (!in_array(strtolower(trim($email)), $allowed, true)) {
        respond(403, ['ok' => false, 'error' => 'Tu usuario no tiene permiso para gestionar postulantes.']);
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
    return ['status' => $status, 'json' => is_array($decoded) ? $decoded : null];
}

function jobApplicationMetadata(string $id): ?array
{
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        return null;
    }
    $path = jobApplicationStorageRoot() . DIRECTORY_SEPARATOR . $id . DIRECTORY_SEPARATOR . 'application.json';
    $raw = @file_get_contents($path);
    $metadata = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($metadata) ? $metadata : null;
}

function adminApplicationPayload(array $metadata): array
{
    $cvFile = basename((string) ($metadata['cv_file'] ?? ''));
    unset($metadata['download_token_hash'], $metadata['cv_file']);
    $id = strtolower((string) ($metadata['id'] ?? ''));
    $metadata['cv_available'] = preg_match('/^[a-f0-9]{32}$/', $id)
        && preg_match('/^cv\.(pdf|doc|docx)$/', $cvFile)
        && is_file(jobApplicationStorageRoot() . DIRECTORY_SEPARATOR . $id . DIRECTORY_SEPARATOR . $cvFile);
    $metadata['status'] = normalizeText($metadata['status'] ?? '', 30) ?: 'new';
    $metadata['admin_notes'] = normalizeText($metadata['admin_notes'] ?? '', 3000, true);
    if (!isset($metadata['fit_score'])) {
        $fit = calculateApplicantFit(
            (int) ($metadata['sales_experience_years'] ?? 0),
            ($metadata['automotive_sales_experience'] ?? false) === true,
            ($metadata['target_based_sales_experience'] ?? false) === true,
            ($metadata['crm_experience'] ?? false) === true,
            ($metadata['full_time_availability'] ?? false) === true
        );
        $metadata['fit_score'] = $fit['score'];
        $metadata['fit_label'] = $fit['label'];
        $metadata['fit_breakdown'] = $fit['breakdown'];
    }
    return $metadata;
}

function listJobApplications(): void
{
    $root = jobApplicationStorageRoot();
    if (!is_dir($root)) {
        respond(200, ['ok' => true, 'items' => []]);
    }
    $items = [];
    try {
        $iterator = new DirectoryIterator($root);
    } catch (Throwable $error) {
        respond(500, ['ok' => false, 'error' => 'No pudimos abrir el almacenamiento de postulantes.']);
    }
    foreach ($iterator as $entry) {
        if ($entry->isDot() || !$entry->isDir() || !preg_match('/^[a-f0-9]{32}$/', $entry->getFilename())) {
            continue;
        }
        $metadata = jobApplicationMetadata($entry->getFilename());
        if (is_array($metadata)) {
            $items[] = adminApplicationPayload($metadata);
        }
    }
    usort($items, static function (array $a, array $b): int {
        $scoreDiff = (int) ($b['fit_score'] ?? 0) <=> (int) ($a['fit_score'] ?? 0);
        if ($scoreDiff !== 0) {
            return $scoreDiff;
        }
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    respond(200, ['ok' => true, 'items' => $items]);
}

function updateJobApplication(array $payload, array $adminUser): void
{
    $id = strtolower(normalizeText($payload['id'] ?? '', 40));
    $status = normalizeText($payload['status'] ?? '', 30);
    $notes = normalizeText($payload['admin_notes'] ?? '', 3000, true);
    $allowedStatuses = ['new', 'review', 'interview', 'rejected', 'hired'];
    if (!preg_match('/^[a-f0-9]{32}$/', $id) || !in_array($status, $allowedStatuses, true)) {
        respond(422, ['ok' => false, 'error' => 'Los datos de actualización no son válidos.']);
    }
    $metadata = jobApplicationMetadata($id);
    if (!is_array($metadata)) {
        respond(404, ['ok' => false, 'error' => 'No encontramos esa postulación.']);
    }
    $now = (new DateTimeImmutable('now', new DateTimeZone('America/Argentina/Buenos_Aires')))->format(DateTimeInterface::ATOM);
    $metadata['status'] = $status;
    $metadata['admin_notes'] = $notes;
    $metadata['updated_at'] = $now;
    $metadata['updated_by_email'] = strtolower(normalizeText($adminUser['email'] ?? '', 160));
    if ($status === 'interview' && empty($metadata['interview_at'])) {
        $metadata['interview_at'] = $now;
    }
    if (in_array($status, ['rejected', 'hired'], true)) {
        $metadata['closed_at'] = $metadata['closed_at'] ?? $now;
    }
    $path = jobApplicationStorageRoot() . DIRECTORY_SEPARATOR . $id . DIRECTORY_SEPARATOR . 'application.json';
    if (!writePrivateMetadata($path, $metadata)) {
        respond(500, ['ok' => false, 'error' => 'No pudimos guardar los cambios.']);
    }
    respond(200, ['ok' => true, 'item' => adminApplicationPayload($metadata)]);
}

function serveAdminCv(): void
{
    $id = strtolower(normalizeText($_GET['id'] ?? '', 40));
    $metadata = jobApplicationMetadata($id);
    if (!is_array($metadata)) {
        downloadError(404);
    }
    streamStoredCv($id, $metadata);
}

function respond(int $status, array $body): void
{
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function normalizeText($value, int $maxLength, bool $preserveLines = false): string
{
    $normalized = trim((string) $value);
    $pattern = $preserveLines
        ? '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u'
        : '/[\x00-\x1F\x7F]+/u';
    $normalized = preg_replace($pattern, $preserveLines ? '' : ' ', $normalized) ?? '';
    if (function_exists('mb_substr')) {
        return mb_substr($normalized, 0, $maxLength, 'UTF-8');
    }
    return substr($normalized, 0, $maxLength);
}

function textLength(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
}

function parseInteger($value): ?int
{
    $normalized = trim((string) $value);
    if ($normalized === '' || !preg_match('/^-?\d+$/', $normalized)) {
        return null;
    }
    return (int) $normalized;
}

function sanitizeSourceUrl($value): ?string
{
    $url = filter_var(trim((string) $value), FILTER_VALIDATE_URL);
    if (!is_string($url) || $url === '') {
        return null;
    }
    $parts = parse_url($url);
    if (!is_array($parts) || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)) {
        return null;
    }
    $host = strtolower((string) ($parts['host'] ?? ''));
    if ($host === '') {
        return null;
    }
    $scheme = strtolower((string) $parts['scheme']);
    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    $path = (string) ($parts['path'] ?? '/');
    return substr($scheme . '://' . $host . $port . $path, 0, 1200);
}

function safeOriginalFileName(string $value): string
{
    $name = basename(str_replace('\\', '/', $value));
    $name = preg_replace('/[^\pL\pN._ -]+/u', '-', $name) ?? 'cv';
    $name = trim($name, " .-");
    if ($name === '') {
        $name = 'cv';
    }
    return normalizeText($name, 180);
}

function verifiedCvMimeType(string $path, string $extension): string
{
    if (!in_array($extension, ['pdf', 'doc', 'docx'], true)) {
        return '';
    }
    $head = file_get_contents($path, false, null, 0, 8);
    if (!is_string($head)) {
        return '';
    }
    if ($extension === 'pdf' && strncmp($head, '%PDF-', 5) === 0) {
        return 'application/pdf';
    }
    if ($extension === 'doc' && substr($head, 0, 8) === "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1") {
        return 'application/msword';
    }
    if ($extension === 'docx' && substr($head, 0, 4) === "PK\x03\x04") {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    return '';
}

function isSameOriginRequest(): bool
{
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') {
        return true;
    }
    $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
    $requestHost = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $requestHost = preg_replace('/:\d+$/', '', $requestHost) ?? '';
    return $originHost !== '' && hash_equals($requestHost, $originHost);
}

function jobApplicationStorageRoot(): string
{
    $configured = serverSetting('RGC_JOB_APPLICATION_STORAGE_ROOT');
    if ($configured !== '') {
        return rtrim($configured, "\\/");
    }
    return dirname(dirname(__DIR__)) . DIRECTORY_SEPARATOR . 'rgcars-private' . DIRECTORY_SEPARATOR . 'job-applications';
}

function ensurePrivateDirectory(string $path): void
{
    if (is_dir($path)) {
        return;
    }
    if (!@mkdir($path, 0700, true) && !is_dir($path)) {
        respond(500, ['ok' => false, 'error' => 'No pudimos preparar el almacenamiento privado.']);
    }
    @chmod($path, 0700);
}

function writePrivateMetadata(string $path, array $metadata): bool
{
    $encoded = json_encode($metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($encoded)) {
        return false;
    }
    $written = @file_put_contents($path, $encoded, LOCK_EX);
    if ($written === false) {
        return false;
    }
    @chmod($path, 0600);
    return true;
}

function jobApplicationRecipients(): array
{
    $raw = serverSetting('RGC_JOB_APPLICATION_RECIPIENTS', RGC_JOB_DEFAULT_RECIPIENTS);
    $recipients = [];
    foreach (explode(',', $raw) as $item) {
        $candidate = strtolower(trim($item));
        if (filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
            $recipients[$candidate] = true;
        }
    }
    return array_keys($recipients);
}

function jobApplicationDownloadUrl(string $id, string $token): string
{
    $configuredSiteUrl = rtrim(serverSetting('RGC_SITE_URL'), '/');
    if ($configuredSiteUrl !== '' && filter_var($configuredSiteUrl, FILTER_VALIDATE_URL)) {
        $baseUrl = $configuredSiteUrl;
    } else {
        $forwardedProto = strtolower(trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')));
        $https = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
        $scheme = $https || $forwardedProto === 'https' ? 'https' : 'http';
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'rgcars.com.ar');
        if (!preg_match('/^[A-Za-z0-9.-]+(?::\d+)?$/', $host)) {
            $host = 'rgcars.com.ar';
        }
        $baseUrl = $scheme . '://' . $host;
    }
    $scriptPath = (string) ($_SERVER['SCRIPT_NAME'] ?? '/api/job-applications.php');
    return $baseUrl . $scriptPath . '?id=' . rawurlencode($id) . '&token=' . rawurlencode($token);
}

function sendHtmlMail(array $recipients, string $subject, string $html, string $replyTo = ''): bool
{
    $validRecipients = array_values(array_filter($recipients, static function ($value): bool {
        return filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
    }));
    if (!$validRecipients) {
        return false;
    }

    $from = strtolower(serverSetting('RGC_JOB_APPLICATION_FROM', RGC_JOB_DEFAULT_FROM));
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)) {
        $from = RGC_JOB_DEFAULT_FROM;
    }
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'From: RG Cars TDF <' . $from . '>',
        'X-Mailer: RG Cars TDF Website',
    ];
    if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
        $headers[] = 'Reply-To: ' . $replyTo;
    }
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    return @mail(implode(', ', $validRecipients), $encodedSubject, $html, implode("\r\n", $headers));
}

function buildTeamEmail(array $application): string
{
    $experience = nl2br(escapeHtml($application['experience'] ?? ''));
    $downloadUrl = escapeHtml($application['download_url'] ?? '');
    $fitScore = (int) ($application['fit_score'] ?? 0);
    $fitLabel = escapeHtml($application['fit_label'] ?? 'Sin evaluar');
    $yesNo = static function ($value): string {
        return $value === true ? 'Sí' : 'No';
    };
    $fitRows = '';
    foreach (($application['fit_breakdown'] ?? []) as $criterion) {
        $fitRows .= '<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 9px;border-radius:999px;background:#f1f3f6;font-size:12px">'
            . escapeHtml($criterion['label'] ?? '') . ': <strong>' . (int) ($criterion['points'] ?? 0) . '/' . (int) ($criterion['max'] ?? 0) . '</strong></span>';
    }
    return '<div style="font-family:Arial,sans-serif;color:#151922;line-height:1.55;max-width:680px;margin:auto">'
        . '<div style="background:#0a0c10;color:#fff;padding:22px 26px;border-radius:18px 18px 0 0">'
        . '<div style="color:#ed333a;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Nueva postulación</div>'
        . '<strong style="font-size:23px">Vendedor/a con experiencia</strong></div>'
        . '<div style="border:1px solid #e2e6ec;border-top:0;padding:26px;border-radius:0 0 18px 18px">'
        . '<div style="display:flex;align-items:center;gap:14px;margin:0 0 20px;padding:16px;border-radius:14px;background:#fff1f2">'
        . '<strong style="font-size:28px;color:#b40f16">' . $fitScore . '/100</strong><span><strong>Afinidad ' . $fitLabel . '</strong><br><small>Orden preliminar basado sólo en experiencia comercial y disponibilidad.</small></span></div>'
        . '<div style="margin-bottom:16px">' . $fitRows . '</div>'
        . '<p><strong>Nombre:</strong> ' . escapeHtml($application['full_name'] ?? '') . '<br>'
        . '<strong>Email:</strong> ' . escapeHtml($application['email'] ?? '') . '<br>'
        . '<strong>Teléfono / WhatsApp:</strong> ' . escapeHtml($application['phone'] ?? '') . '<br>'
        . '<strong>Edad:</strong> ' . (int) ($application['age'] ?? 0) . '<br>'
        . '<strong>Estado civil:</strong> ' . escapeHtml($application['marital_status_label'] ?? '') . '<br>'
        . '<strong>Hijos:</strong> ' . (int) ($application['children_count'] ?? 0) . '<br>'
        . '<strong>Carnet de conducir vigente:</strong> Sí<br><br>'
        . '<strong>Años en ventas:</strong> ' . (int) ($application['sales_experience_years'] ?? 0) . '<br>'
        . '<strong>Experiencia automotriz:</strong> ' . $yesNo($application['automotive_sales_experience'] ?? false) . '<br>'
        . '<strong>Trabajo por objetivos:</strong> ' . $yesNo($application['target_based_sales_experience'] ?? false) . '<br>'
        . '<strong>Uso de CRM:</strong> ' . $yesNo($application['crm_experience'] ?? false) . '<br>'
        . '<strong>Disponibilidad full time:</strong> ' . $yesNo($application['full_time_availability'] ?? false) . '<br>'
        . '<strong>Fecha:</strong> ' . escapeHtml($application['created_at'] ?? '') . '</p>'
        . '<h2 style="font-size:18px;margin:20px 0 8px">Experiencia</h2>'
        . '<p style="background:#f5f6f8;padding:15px;border-radius:12px">' . $experience . '</p>'
        . '<p style="margin:22px 0 0"><a href="' . $downloadUrl . '" style="display:inline-block;background:#d71920;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Descargar CV</a></p>'
        . '<p style="color:#687284;font-size:12px">El enlace privado vence en 90 días.</p>'
        . '</div></div>';
}

function buildApplicantEmail(string $fullName): string
{
    return '<div style="font-family:Arial,sans-serif;color:#151922;line-height:1.6;max-width:620px;margin:auto">'
        . '<div style="background:#0a0c10;color:#fff;padding:22px 26px;border-radius:18px 18px 0 0"><strong style="font-size:21px">RG Cars TDF</strong></div>'
        . '<div style="border:1px solid #e2e6ec;border-top:0;padding:26px;border-radius:0 0 18px 18px">'
        . '<h1 style="font-size:24px;margin:0 0 12px">Recibimos tu postulación</h1>'
        . '<p>Hola ' . escapeHtml($fullName) . ',</p>'
        . '<p>Recibimos correctamente tu postulación para el puesto de <strong>vendedor/a</strong> y tu CV.</p>'
        . '<p>Nuestro equipo va a revisar la información y, si tu perfil avanza, se pondrá en contacto por los datos que nos compartiste.</p>'
        . '<p style="margin-bottom:0">Gracias por tu interés en sumarte a RG Cars TDF.</p>'
        . '</div></div>';
}

function escapeHtml($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function servePrivateCv(): void
{
    $id = strtolower(trim((string) ($_GET['id'] ?? '')));
    $token = strtolower(trim((string) ($_GET['token'] ?? '')));
    if (!preg_match('/^[a-f0-9]{32}$/', $id) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        downloadError(404);
    }

    $applicationDirectory = jobApplicationStorageRoot() . DIRECTORY_SEPARATOR . $id;
    $metadataPath = $applicationDirectory . DIRECTORY_SEPARATOR . 'application.json';
    $raw = @file_get_contents($metadataPath);
    $metadata = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($metadata)) {
        downloadError(404);
    }

    $expectedHash = (string) ($metadata['download_token_hash'] ?? '');
    if ($expectedHash === '' || !hash_equals($expectedHash, hash('sha256', $token))) {
        downloadError(404);
    }

    $createdAt = strtotime((string) ($metadata['created_at'] ?? ''));
    if ($createdAt === false || time() - $createdAt > RGC_JOB_DOWNLOAD_TTL_SECONDS) {
        downloadError(410, 'El enlace privado para descargar este CV venció.');
    }

    streamStoredCv($id, $metadata);
}

function streamStoredCv(string $id, array $metadata): void
{
    $applicationDirectory = jobApplicationStorageRoot() . DIRECTORY_SEPARATOR . $id;
    $fileName = basename((string) ($metadata['cv_file'] ?? ''));
    if (!preg_match('/^cv\.(pdf|doc|docx)$/', $fileName)) {
        downloadError(404);
    }
    $filePath = $applicationDirectory . DIRECTORY_SEPARATOR . $fileName;
    if (!is_file($filePath)) {
        downloadError(404);
    }

    $originalName = safeOriginalFileName((string) ($metadata['cv_original_name'] ?? $fileName));
    $asciiName = preg_replace('/[^A-Za-z0-9._-]+/', '-', $originalName) ?: $fileName;
    header('Content-Type: ' . (string) ($metadata['cv_mime_type'] ?? 'application/octet-stream'));
    header('Content-Length: ' . (string) filesize($filePath));
    header('Content-Disposition: attachment; filename="' . $asciiName . '"; filename*=UTF-8\'\'' . rawurlencode($originalName));
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    readfile($filePath);
    exit;
}

function downloadError(int $status, string $message = 'Archivo no encontrado.'): void
{
    header('Content-Type: text/plain; charset=utf-8');
    http_response_code($status);
    echo $message;
    exit;
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
