# Migración de fotos de Supabase Storage a cPanel

La aplicación conserva Supabase para base de datos y autenticación. Solamente las imágenes de vehículos pasan a `public_html/uploads/vehicles`.

## 1. Publicar el endpoint

El despliegue definido en `.cpanel.yml` crea `api` y `uploads/vehicles` sin borrar las fotos existentes. Después de desplegar, abrir:

`https://TU-DOMINIO/api/vehicle-images.php`

Una petición normal desde el navegador debe responder JSON con estado 405. Eso confirma que PHP está ejecutando el endpoint.

Luego, desde el backoffice, subir una foto de prueba. La URL guardada debe comenzar con el dominio del sitio y contener `/uploads/vehicles/`.

### Validación local de sesiones

Mientras Supabase esté restringido por cuota, incluso el servicio Auth responde 402. Para que cPanel pueda validar localmente una sesión ya emitida, copiar `storage-secrets.example.php` como:

`/home2/rgcarsco/rgcars-storage-secrets.php`

El archivo queda fuera de `public_html`. Hay que reemplazar `PEGAR_EL_JWT_SECRET_DE_SUPABASE` por el JWT secret del proyecto y limitar `RGC_STORAGE_ALLOWED_EMAILS` a los usuarios reales del backoffice. No agregar el archivo resultante al repositorio.

Esto permite validar tokens vigentes sin consultar Auth, pero no reemplaza el inicio de sesión ni la base de datos: para ejecutar la migración y seguir usando el panel se debe quitar la restricción del proyecto, aunque sea durante la ventana de migración.

## 2. Contar las fotos pendientes

Con Node.js 18 o posterior:

```powershell
node scripts/migrate-supabase-storage-to-cpanel.mjs
```

Este comando es una simulación: sólo cuenta las URLs actuales de Supabase Storage.

## 3. Copiar y actualizar las URLs

La migración requiere una sesión de administrador. En PowerShell, las credenciales pueden cargarse temporalmente sin escribir la contraseña en el historial:

```powershell
$credential = Get-Credential
$env:RGC_ADMIN_EMAIL = $credential.UserName
$env:RGC_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
$env:RGC_STORAGE_ENDPOINT = "https://TU-DOMINIO/api/vehicle-images.php"
node scripts/migrate-supabase-storage-to-cpanel.mjs --apply
```

Para probar primero con una sola foto:

```powershell
node scripts/migrate-supabase-storage-to-cpanel.mjs --apply --limit=1
```

También se puede limitar la ejecución a un vehículo:

```powershell
node scripts/migrate-supabase-storage-to-cpanel.mjs --apply --vehicle=ID_DEL_VEHICULO
```

El proceso es reanudable: usa nombres determinísticos para no duplicar archivos si se vuelve a ejecutar. Cada vehículo se actualiza en Supabase sólo después de que todas sus fotos seleccionadas se copiaron correctamente.

## 4. Verificar antes de limpiar Supabase

Revisar el catálogo, la ficha individual y el editor de fotos. La herramienta no elimina los originales de Supabase Storage. Esa limpieza debe hacerse únicamente después de confirmar que ya no quedan URLs con `/storage/v1/object/public/vehicles/` en la tabla `vehicles` y que el backup es suficiente.
