param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $releaseRoot) { throw 'El destino ya existe. Usar una carpeta nueva para conservar paquetes previos.' }
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
$publicFiles = @(
  'api/inspections.php',
  'api/inspections/bootstrap.php', 'api/inspections/domain.php',
  'api/inspections/repository.php', 'api/inspections/evidence.php', 'api/inspections/config.json',
  'admin/inspections.html', 'admin/inspections.mjs', 'admin/admin.js',
  'inspections/config.mjs', 'inspections/domain.mjs', 'inspections/admin.css',
  'inspections/public.mjs', 'inspections/public.css', 'inspections/presentation.mjs', 'inspections/pdf.mjs', 'inspections/transport.mjs',
  'vehicle.html', 'vehicle.js', 'vehicle.css', 'index.css', 'config.js'
)
$manifest = foreach ($relativePath in $publicFiles) {
  $sourcePath = Join-Path $projectRoot $relativePath
  $destinationPath = Join-Path (Join-Path $releaseRoot 'public_html') $relativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
  [PSCustomObject]@{Path=$relativePath; SHA256=(Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash; Bytes=(Get-Item -LiteralPath $destinationPath).Length}
}
$installRoot = Join-Path $releaseRoot 'install'
New-Item -ItemType Directory -Path $installRoot | Out-Null
foreach ($relativePath in @('scripts/inspection-cpanel-schema.sql','scripts/inspection-cpanel-permissions.sql','inspection-secrets.example.php','docs/inspection-cpanel-deployment.md')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $installRoot
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $releaseRoot 'manifest.json')
@'
Paquete de peritajes RG Cars. Extraer fuera de public_html.
public_html/ contiene solo los archivos del modulo e integraciones indicados en manifest.json.
install/ y manifest.json NO son contenido publico.
El esquema NO concede permisos. Configurar la conexion privada antes de activar.
Respaldar los archivos publicos que se reemplazaran.
La regla AddType text/javascript .mjs debe conservarse/agregarse sin reemplazar
otras directivas propias del .htaccess del hosting.
No contiene contrasenas, claves privadas, datos reales ni cambios de otros modulos.
'@ | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $releaseRoot 'LEER-ANTES-DE-ACTIVAR.txt')
$archivePath = $releaseRoot + '.zip'
Compress-Archive -LiteralPath $releaseRoot -DestinationPath $archivePath
[PSCustomObject]@{Directory=$releaseRoot; Archive=$archivePath; PublicFiles=$publicFiles.Count; SHA256=(Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash} | ConvertTo-Json
