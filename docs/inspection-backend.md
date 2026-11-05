# Peritajes: backend alternativo Supabase

El backend predeterminado de la interfaz es ahora PHP en cPanel (`/api/inspections.php`). Consultar [instalación en cPanel](inspection-cpanel-deployment.md). Esta guía conserva la alternativa Edge; para utilizarla, configurar explícitamente `RG.INSPECTIONS_ENDPOINT` con la URL de la función. No aplicar estas migraciones para instalar únicamente el backend PHP.

## Migración y función

1. Aplicar `supabase/migrations/20261014_vehicle_inspections.sql` con una cuenta de administración de la base. Requiere las tablas existentes `public.vehicles`, `auth.users`, `storage.buckets` y `storage.objects`. La migración detecta el tipo real de `vehicles.id` para crear una clave foránea del mismo tipo. No altera ni elimina vehículos, leads ni perfiles existentes.
2. Aplicar `supabase/migrations/202610140001_vehicle_inspection_config.sql`, generado desde la configuración compartida. Registra idempotentemente ocho secciones y 83 componentes; rechaza reutilizar una versión con otros criterios.
3. Desplegar desde la raíz del repositorio:

   ```sh
   supabase functions deploy inspections-api --no-verify-jwt
   ```

   La desactivación del control JWT en la pasarela permite la lectura pública. La función ejecuta `auth.getUser(token)` y consulta los permisos en base para **cada** acción privada. No usar la clave service role en el navegador. `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son variables de servidor provistas por Supabase.
4. Subir junto al sitio los módulos de `inspections/` y los cambios del administrador/ficha. Los imports relativos de la función incluyen `inspections/config.mjs` y `inspections/domain.mjs`: volver a desplegar la función cuando cambie cualquiera de ellos.
5. Validar los permisos con usuarios reales y comprobar subida, descarga firmada, revisión y publicación en un entorno de prueba antes de habilitar la operación.

La configuración inicial de los 83 componentes es `inspections/config.mjs`. No hay valores calculados desde datos del navegador: la aprobación genera el snapshot en el servidor. Cambiar una configuración exige cambiar su versión; los informes aprobados conservan la anterior.

## Habilitar usuarios

Se requieren simultáneamente un usuario de Supabase Auth, un perfil **activo** en `admin_access_profiles` y un permiso **activo** en `inspection_permissions`. Si falta cualquiera, se deniega el acceso. El rol del frontend no concede derechos.

La migración agrega permisos, únicamente cuando ya existen en Auth, a las cuentas establecidas en el proyecto: `rgcarstdf@gmail.com` como administrador y `ventas@rgcars.com.ar` como inspector. No modifica concesiones previas al volver a ejecutarse. Si esas cuentas no existen todavía, o se incorpora otro perito, un administrador de la base debe ejecutar una asignación explícita:

```sql
-- Reemplazar el email por una cuenta real que ya tenga perfil administrativo activo.
insert into public.inspection_permissions(user_id, role, can_na, is_active)
select id, 'inspector', true, true
from auth.users where lower(email) = lower('perito@ejemplo.com')
on conflict(user_id) do update
set role = excluded.role, can_na = excluded.can_na, is_active = excluded.is_active;
```

`inspector` permite leer, crear, editar, subir fotos y enviar/devolver revisión. `admin` agrega aprobación, publicación y archivo. `can_na` habilita No aplica; un aprobador de un informe con N/A también necesita este permiso. Para revocar acceso, poner `is_active = false` en la concesión o desactivar el perfil existente. No existe concesión implícita a todos los usuarios autenticados.

## Contrato y privacidad

Endpoint: `POST /functions/v1/inspections-api`. JSON `{ "action": "...", ... }`; respuesta `{ "data": ... }`, error `{ "error": "...", "details": [...] }` cuando corresponde.

| Acción | Campos | Respuesta |
|---|---|---|
| `public` | `vehicle_id` | Informe público aprobado y publicado, o `null`; sin sesión |
| `capabilities` | — | `can_edit`, `can_approve`, `can_na` |
| `list` | `vehicle_id` | Resumen del historial |
| `create` | `vehicle_id` | Borrador con copia del vehículo |
| `get` | `id` | Informe privado, evidencia y auditoría |
| `save` | `id`, `revision`, `document` | Fila guardada con nueva revisión |
| `transition` | `id`, `revision`, `status` | Fila con nuevo estado |
| `update_evidence` | `id`, `revision`, `evidence_id`, `caption`, `approved_public` | Fila con nueva revisión |
| `delete_evidence` | `id`, `revision`, `evidence_id` | Fila con nueva revisión |
| `upload_evidence` | Multipart: `action`, `id`, `revision`, `item_id`, `file`, `caption`, `approved_public` (`true`/`false`) | Fila con nueva revisión |

En las acciones privadas enviar `Authorization: Bearer <access_token>`. Cada mutación usa la revisión vigente; HTTP 409 requiere recargar para evitar sobrescribir el trabajo de otra persona. La base vuelve a verificar permisos, bloquea por vehículo y compara la revisión en una transacción.

Las tablas de peritajes carecen de acceso directo para `anon` y `authenticated`. La service role tiene lectura directa; las escrituras se realizan mediante funciones SQL con permisos restringidos. La publicación archiva el informe vigente y publica su reemplazo en una misma transacción, respaldada por un índice único. Documentos y evidencias aprobados son inmutables; las correcciones se hacen en un nuevo peritaje.

El bucket privado `inspection-evidence` acepta JPEG, PNG y WebP de hasta 8 MiB, cinco fotos por componente y cien por informe. Se verifican tamaño, MIME y cabeceras binarias; nombres de objetos aleatorios y relaciones con el peritaje impiden acceso cruzado. No se usan las subidas públicas del inventario. Las fotos deben revisarse para evitar datos personales visibles antes de aprobar su publicación. El sistema no realiza reconocimiento ni anonimización automática del contenido de una fotografía.

Solo administradores pueden marcar fotos para publicación; los inspectores pueden cargarlas privadas. Si un inspector cambia el pie de una foto aprobada mientras el informe aún es borrador, se revoca su aprobación pública hasta la siguiente revisión del administrador. Solo las fotos marcadas salen en el informe público aprobado. Los enlaces firmados vencen en 60 segundos para público y 300 para administrador; volver a cargar el informe renueva los enlaces. Un enlace firmado ya emitido puede seguir funcionando hasta su vencimiento aun si se archiva el informe. Las respuestas no se almacenan en caché HTTP. Si se elimina la referencia de una foto pero falla su eliminación del storage, queda un objeto privado sin referencia; se registra un aviso técnico para limpieza, sin exponer datos personales.

## Pruebas reproducibles

```sh
node --test tests/inspections-api.test.mjs
deno check supabase/functions/inspections-api/index.ts
```

La prueba SQL opcional usa PostgreSQL embebido, sin conexión a producción. Instalar `@electric-sql/pglite` en una carpeta temporal y establecer `RG_INSPECTION_PGLITE_PATH` con la ruta del paquete, luego ejecutar:

```sh
node --test tests/inspections-database.test.mjs
```

Comprueba ejecución idempotente de la migración, FK con tipo real, denegación por defecto, revocación por perfil, revisión optimista, roles, snapshots inmutables, reemplazo atómico y ausencia de acceso directo. PGlite no incluye la extensión `pgcrypto`; la prueba omite únicamente su declaración y usa `gen_random_uuid()` del núcleo PostgreSQL. No sustituye la validación de Storage/Auth/Edge Functions en Supabase.

No se aplicaron migraciones ni se desplegaron funciones en el proyecto remoto durante la implementación.
