<?php
declare(strict_types=1);
require __DIR__ . '/../api/inspections/domain.php';
require __DIR__ . '/../api/inspections/bootstrap.php';

// CLI-only batch bridge. Never expose this test file through the public deployment.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
set_error_handler(static function(int $severity, string $message, string $file, int $line): never { throw new ErrorException($message,0,$severity,$file,$line); });
$commands = rgInspectionDecode(stream_get_contents(STDIN));
$results = [];
foreach ($commands as $command) {
    try {
        $value = $command['value'] ?? null; $options = rgInspectionMap($command['options'] ?? []);
        $results[] = match ($command['op']) {
            'config' => rgInspectionConfig(),
            'validate_config' => rgInspectionValidateConfig($value),
            'create' => rgInspectionCreateDocument(rgInspectionMap($value)),
            'score' => rgInspectionScore($value,$command['config'] ?? null),
            'answer' => rgInspectionValidateAnswer($value,$command['item'],$options),
            'validate' => rgInspectionValidateDocument($value,$options),
            'snapshot' => rgInspectionCreateSnapshot($value,$command['config'] ?? null),
            'public' => rgInspectionPublicReport($value,$command['evidence'] ?? [],$options),
            'internal' => rgInspectionInternalReport($value,$command['evidence'] ?? []),
            'authorize' => rgInspectionAuthorize(rgInspectionMap($value),$command['action']),
            'transition' => rgInspectionCanTransition($command['from'],$command['to'],rgInspectionMap($value)),
            default => throw new InvalidArgumentException('Unknown operation'),
        };
    } catch (Throwable $error) { $results[] = ['error'=>$error->getMessage(),'details'=>$error instanceof RGInspectionValidationException ? $error->details : []]; }
}
echo json_encode($results,JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
