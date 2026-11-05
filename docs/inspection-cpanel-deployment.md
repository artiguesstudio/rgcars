# Peritajes en cPanel: instalación y operación

El backend PHP mantiene el contrato del administrador, la ficha pública y el PDF. Los informes, permisos del módulo, auditoría y evidencias se almacenan en cPanel. El login, los perfiles activos y el inventario siguen siendo los actuales de Supabase. No requiere Edge Functions, tablas ni buckets nuevos en Supabase.

## Actualización publicada el 05/11/2026

Se publicó el commit `7214ee2ff7de16272d2d978b22ba655a5aa66188` mediante Git de cPanel a las 18:48 de Argentina. La carga usa opciones Bueno / Regular / Malo / N/A en una fila, observaciones visibles con altura automática y un desplegable separado para fotos. Neumáticos usa Bueno y ya no exige marca, medida, desgaste ni profundidad; conserva los datos técnicos que existían en informes anteriores.

La configuración `rgcars-83-v2` aplica `peso × porcentaje / 100` únicamente a vida útil de frenos delanteros y traseros, sin exigir una valoración cualitativa. El 0 % es válido; un porcentaje vacío queda pendiente. Los borradores usan los criterios actuales; los informes aprobados conservan su configuración y resultado originales. No se realizaron migraciones ni cambios de permisos ni se editaron informes reales.

Verificación: 56 pruebas Node/PHP aprobadas, ninguna omitida; paridad con PHP 8.4.27 portable y sintaxis de los seis PHP comprobadas. Recorridos de navegador para administración y vista pública aprobados, incluyendo guardado, porcentaje 0/50/100, N/A con permiso revocado, snapshots antiguos, PDF y privacidad. Sin errores de consola ni desbordamiento a 1366, 768, 390 y 320 px; las filas comunes de escritorio miden 51 px. La integración con una base MariaDB nueva no se repitió en esta actualización.

Los diez archivos estáticos del módulo publicados responden HTTP 200 y coinciden con los archivos probados (normalizando finales de línea). La consulta pública de la API responde HTTP 200 sin error. Los cuatro archivos PHP sin cambios se compararon con el respaldo real del servidor y coincidieron; el diff de `domain.php` contiene únicamente validación y cálculo de los nuevos criterios.

Respaldo previo del backend: `/home2/rgcarsco/rgcars-private/peritajes-pre-v2-20261105-ec23507.zip`, fuera del sitio público. Copia local de los estáticos anteriores y del backend en `output/peritajes-compactos/backup-antes-v2`. El módulo completo y su despliegue ahora están versionados; `.cpanel.yml` incluye `inspections/`, la API y su `.htaccess`, excluyendo secretos y archivos de instalación.

## Hosting verificado el 14/10/2026

- Dominio: `rgcars.com.ar`; PHP real del sitio **8.1.34**.
- Extensiones disponibles: PDO MySQL, fileinfo, mbstring, OpenSSL, JSON y cURL.
- MariaDB **11.4.8**, servidor privado `10.0.10.74:3306`.
- Base independiente creada: `rgcarsco_peritajes`.
- `upload_max_filesize=32M`, `post_max_size=32M`, memoria PHP `128M`. El módulo limita cada foto a 8 MiB.
- `/home2/rgcarsco/rgcars-private` existe y PHP puede escribir allí. Las evidencias van en su subcarpeta `inspections`, con carpetas 0700 y archivos 0600.
- Se retiró el diagnóstico temporal de `public_html`; su URL devuelve 404.

### Formulario compacto publicado el 14/10/2026

Se reemplazó la carga extensa por filas compactas como las referencias del cliente: un selector de estado por componente, datos técnicos en la fila y un único desplegable **Observaciones y fotos**. Regular/Malo despliega las notas sin quitar el foco al selector. Historial en **Informe** y acciones secundarias en **Más opciones**; Guardar y el siguiente paso quedan visibles. El guardado conserva secciones abiertas/cerradas y guarda también los cambios de las fotos. No se cambiaron los 83 ítems, los pesos, el motor, el contrato de datos, el backend ni los permisos.

- Publicados únicamente `admin/inspections.html`, `admin/inspections.mjs` e `inspections/admin.css`, con versión de caché `20261014-compact`; HTTP 200, MIME correcto y SHA-256 idéntico al local para los tres.
- Copia de las tres versiones anteriores en `/home2/rgcarsco/rgcars-private/peritajes-backup-20261014`, además de los respaldos de la instalación inicial.
- Sin migraciones ni cambios de base de datos. Las actualizaciones de prueba/guía quedaron en `tests/inspections-admin.browser.mjs`, `docs/peritajes.md` y esta guía.
- Verificación local: 22 pruebas de dominio/presentación aprobadas; recorrido del administrador en escritorio y móvil aprobado, sin desbordamiento ni errores JavaScript. Los 29 ítems exteriores ocupan 1692 px a 1366 px de ancho; las filas simples miden 55 px. Cubiertos teclado, N/A, preservación de valores, guardado global de fotos, historial y cambios pendientes, apertura de errores (incluida firma), estados bloqueados y privacidad del informe público.
- Verificación real con `ventas@rgcars.com.ar` (Inspector): carga del borrador existente del Peugeot, 83 selectores y ocho categorías, cero errores JavaScript. No se editaron ni guardaron respuestas reales durante esta comprobación. Se abrió una pestaña nueva y se conservó la anterior, que tenía un cambio sin guardar.
- Validación manual restante de esta actualización: comodidad de carga durante una inspección real y captura táctil de la firma/fotos en los dispositivos del equipo.

### Estado de despliegue del 14/10/2026

La migración `scripts/inspection-cpanel-schema.sql` ya fue importada en `rgcarsco_peritajes`: siete tablas InnoDB y ocho triggers, mediante 25 sentencias. El usuario creó `rgcarsco_perito`; quedó asociado a esa base y se verificaron SELECT, INSERT, UPDATE y DELETE, sin privilegios DDL. Se aplicaron y confirmaron las dos concesiones de peritajes de la tabla siguiente. **El backend y las integraciones están publicados y la conexión funciona.** No quedan migraciones por aplicar para esta instalación PHP; no aplicar las migraciones de la alternativa Supabase. Queda pendiente la validación operativa con las cuentas habilitadas y un informe real.

Permisos del módulo confirmados el 14/10/2026:

| Cuenta | Rol de peritajes | Alcance |
| --- | --- | --- |
| `alejandro.perez@rgcars.com.ar` | Administrador | Cargar y modificar borradores; aprobar, publicar y archivar; aprobar fotos públicas; N/A justificado. |
| `ventas@rgcars.com.ar` | Inspector | Cargar y modificar borradores, subir evidencia privada y enviar a revisión; N/A justificado. Sin aprobación ni publicación. |

La plantilla SQL del repositorio sigue completamente comentada. Las dos sentencias seleccionadas se aplicaron por separado en phpMyAdmin: una fila nueva por cuenta. No se autorizó `rgcarstdf@gmail.com`. El usuario confirmó que Alejandro ya tiene acceso total a la plataforma. El rol administrador de esta tabla es exclusivo de peritajes; sigue exigiendo un login válido y un perfil activo en Supabase.

Configuración instalada con permiso 0600 en `/home2/rgcarsco/rgcars-inspections-secrets.php`, con clave de firma aleatoria propia. Lee la contraseña desde `/home2/rgcarsco/rgcars-private/inspection-db-password.txt`, también con permiso 0600 confirmado después del guardado. El usuario guardó allí su contraseña existente desde cPanel. No se leyó, registró ni solicitó la contraseña por chat. La consulta pública de prueba devuelve HTTP 200 con `{"data":null}` para una unidad sin informe publicado, confirmando la conexión con MariaDB y el catálogo.

Publicados los 19 archivos del módulo: API y sus auxiliares, componentes de `inspections/`, `admin/inspections.html`/`inspections.mjs`, y las cuatro integraciones `config.js`, `vehicle.html`, `vehicle.js` y `admin/admin.js`. Los 14 archivos estáticos comparados por HTTP tienen SHA-256 idéntico al local; `.mjs` responde con `text/javascript`. Los cinco PHP se ejecutan sin exponer su fuente. La API devuelve GET 405, OPTIONS 204, privada anónima 401 y JSON malformado 400. Inicio, ficha y administrador responden HTTP 200. Estas pruebas HTTP no usaron credenciales ni modificaron informes.

En el navegador real, el administrador cargó 57 vehículos y mostró el enlace **Peritaje** en la unidad seleccionada. La ficha pública cargó sin errores JavaScript y mantuvo oculto **Ver peritaje** porque todavía no tiene informe publicado, comportamiento esperado. El recorrido privado fue rechazado correctamente para la sesión abierta de `ariel.ledesma@rgcars.com.ar`, que no es una de las dos cuentas autorizadas. El encabezado ahora muestra email y rol de la sesión, también cuando no tiene acceso. No se amplió su acceso automáticamente. Debe completarse la validación operativa con Alejandro o Ventas. No se crearon ni publicaron informes ficticios sobre vehículos reales.

El paquete inicial `rgcars-peritajes-release-20261014-v1.zip` está cargado y extraído en `/home2/rgcarsco/rgcars-private`, fuera de `public_html`. Contiene 19 archivos públicos del módulo, un manifiesto SHA-256 y material de instalación separado. No incluye contraseñas, claves privadas, datos reales, el `.htaccess` del hosting ni cambios de otros módulos. SHA-256 del ZIP: `AF3FEC6C3321EF1A1855570CEB539AFA524B986F632D6F431E34925C3CE1F94D`. Después se publicaron `admin/inspections.html` y `admin/inspections.mjs` actualizados para mostrar cuenta/rol; ambos coinciden por SHA-256 con el repositorio. El ZIP inicial no contiene ese ajuste ni las últimas actualizaciones de documentación y plantilla de permisos: para una instalación nueva, generar otro paquete desde el estado actual.

Respaldo confirmado en `/home2/rgcarsco/rgcars-private/peritajes-backup-20261014`: `config.js`, `vehicle.html`, `vehicle.js`, `admin.js` y `.htaccess`. `admin.js` corresponde a `public_html/admin/admin.js`; los restantes provienen de `public_html`. El `.htaccess` original coincidía con el del repositorio anterior al módulo: se conservó su configuración y se añadió soporte MIME/cache para `.mjs`. También se verificó `public_html/api/.htaccess`: conserva el reenvío de Authorization, no-store y nosniff; no fue modificado.

Pruebas locales aprobadas: paridad PHP/JavaScript (10), dominio (15), HTTP/Edge (15), presentación/transporte (7), dos recorridos de navegador en escritorio/móvil y la integración con MariaDB real. Se usaron PHP 8.1.34 y MariaDB 11.4.8, incluidas publicación concurrente, reversión transaccional, revisión obsoleta, revocación de permisos e inmutabilidad del historial. Esto no sustituye la validación autenticada en producción.

## Archivos creados y modificados del módulo

- **Backend PHP creado:** `api/inspections.php` y `api/inspections/{bootstrap.php,repository.php,evidence.php,domain.php,config.json}`. Es la implementación elegida para cPanel.
- **Interfaz y transporte creados:** `admin/inspections.html`, `admin/inspections.mjs` e `inspections/{config.mjs,domain.mjs,transport.mjs,admin.css,public.mjs,public.css,pdf.mjs}`. Comparten los 83 ítems y el contrato de respuestas entre administración, ficha pública y PDF.
- **Integraciones modificadas:** `admin/admin.js`, `vehicle.html`, `vehicle.js` y `config.js`. También se prepararon `.cpanel.yml` y `.htaccess` en el repositorio; el ZIP no reemplaza el `.htaccess` existente del hosting. `.gitignore` excluye las copias completadas `inspection-secrets.php`, `rgcars-inspections-secrets.php` e `inspection-db-password.txt`.
- **Instalación y documentación creadas:** `inspection-secrets.example.php`, `scripts/{inspection-cpanel-schema.sql,inspection-cpanel-permissions.sql,generate-inspection-php-config.mjs,package-inspections-cpanel.ps1}` y `docs/{peritajes.md,inspection-cpanel-deployment.md,inspection-cpanel-options.md,inspection-backend.md}`. La plantilla de secretos no contiene una credencial real y la de permisos requiere completar las autorizaciones confirmadas.
- **Pruebas y fixtures creados:** `tests/inspections.test.mjs`, `tests/inspection-php-parity.test.mjs`, `tests/inspection-php-runner.php`, `tests/inspections-cpanel-http.test.mjs`, `tests/inspections-cpanel-mariadb.php`, `tests/inspection-presentation.test.mjs`, `tests/inspection-public-browser.mjs`, `tests/inspections-admin.browser.mjs`, `tests/inspection-fixture.mjs` y `tests/inspection-fixtures.mjs`. No se publican en `public_html`.

**Alternativa Edge conservada, no activada por esta instalación:** `supabase/functions/inspections-api/{index.ts,handler.mjs}`, las migraciones `supabase/migrations/20261014_vehicle_inspections.sql` y `202610140001_vehicle_inspection_config.sql`, `scripts/seed-inspection-config.mjs` y sus pruebas `tests/inspections-api.test.mjs` y `tests/inspections-database.test.mjs`. Esos archivos no forman parte del backend PHP desplegable ni sustituyen el esquema MariaDB ya aplicado; su uso se documenta por separado en `docs/inspection-backend.md`.

## Instalación

1. Seleccionar `rgcarsco_peritajes` en phpMyAdmin e importar `scripts/inspection-cpanel-schema.sql`. Crea exclusivamente tablas `rg_inspection_*`/`rg_inspections` y sus triggers; no concede permisos a cuentas ni crea usuarios de base de datos. Una repetición conserva datos existentes. El esquema usa InnoDB y UTF-8.
2. Crear en cPanel un usuario exclusivo para esta base, con contraseña propia. Para la operación normal necesita SELECT, INSERT, UPDATE y DELETE; la importación del esquema se hace con la sesión administrativa de phpMyAdmin. No abrir acceso remoto a la base.
3. Completar `inspection-secrets.example.php` y guardarlo como `/home2/rgcarsco/rgcars-inspections-secrets.php`, fuera de `public_html`, con permiso 0600. Usar la clave pública de `config.js` para Auth/inventario; no necesita la clave service role. Generar una clave aleatoria de al menos 32 bytes para firmar los enlaces de evidencia.
4. Habilitar las cuentas y roles concretos aprobados por el responsable con la plantilla comentada `scripts/inspection-cpanel-permissions.sql`. Además de esta concesión local, cada sesión debe pertenecer a un perfil activo en `admin_access_profiles`. Sin ambos requisitos, se deniega el acceso. La primera sesión válida vincula el email autorizado al UUID de Auth.
5. Publicar únicamente los archivos del módulo: `api/inspections.php`, los cinco archivos de `api/inspections/`, `admin/inspections.html`, `admin/inspections.mjs`, los módulos/estilos de `inspections/`, y las integraciones en `admin/admin.js`, `vehicle.html`, `vehicle.js`, `config.js`. Conservar una copia de los archivos reemplazados fuera de `public_html`.
6. Asegurar MIME `text/javascript` para `.mjs`. El archivo `.htaccess` del proyecto incluye esa regla; al actualizar un hosting existente, preservar sus directivas propias. `RG.INSPECTIONS_ENDPOINT` debe apuntar a `/api/inspections.php`.
7. Probar con las cuentas reales y un vehículo de pruebas antes de publicar un informe real. Las pruebas locales usan datos ficticios y no sustituyen esta comprobación de RLS, sesión y permisos remotos.

Antes de dar de alta a Alejandro, comprobar si ya dispone de usuario en Supabase Auth y de un perfil activo en `admin_access_profiles` que su sesión pueda consultar mediante RLS. Si ambos existen, alcanza con la concesión local de peritajes, sin cambiar roles globales. Si falta el usuario Auth, su alta no sustituye el perfil requerido. Si falta o está inactivo el perfil, no crearlo ni activarlo automáticamente como parte de la concesión local: la función existente `is_rg_admin()` acepta cualquier perfil activo, sin consultar `role_key` ni `restricted`, y sus políticas también autorizan acciones en CRM y métricas (`supabase/migrations/20260821_measurement_crm.sql`). El administrador visual además asigna el perfil general por defecto a cuentas sin una entrada especial en `admin/admin-access.js`. El código actual, por tanto, no permite garantizar un alta nueva limitada a peritajes agregando únicamente un perfil activo; primero se necesita definir ese acceso aislado o autorizar expresamente el alcance global existente. El esquema y las políticas remotas de `admin_access_profiles` no están definidos en este repositorio y deben verificarse antes de cualquier alta.

El motor PHP recibe `api/inspections/config.json`, generado desde el único catálogo JavaScript con `node scripts/generate-inspection-php-config.mjs`. Comprobar sincronización con `--check`. Cada aprobación conserva configuración, respuestas, escala y puntuación; cambiar criterios requiere una nueva versión. La validación de firmas exige fechas ISO reales, sin fechas relativas ni normalización de días inexistentes.

## Privacidad y concurrencia

El endpoint recalcula y valida en PHP. Las escrituras bloquean por vehículo y comparan revisión. Publicar archiva el vigente anterior dentro de la misma transacción; una lectura bloqueada evita snapshots obsoletos al publicar simultáneamente. Triggers protegen documentos aprobados, evidencia y auditoría.

La referencia al inventario es externa: no hay una FK entre MariaDB y Supabase. El servidor comprueba el vehículo en el catálogo existente al crear y en cada consulta pública; guarda una copia histórica. Eliminar un vehículo del inventario no elimina su historial local, pero retira su acceso público. Los estados públicos reconocidos incluyen disponible, reservado, entrante y vendido.

Las fotos nunca se guardan en `uploads/vehicles`. Los enlaces firmados vencen a los 60 segundos en público y 300 en administración. La entrega pública vuelve a verificar que la foto esté aprobada y el informe siga vigente; archivar lo retira de inmediato. La visibilidad del vehículo se valida al emitir el enlace, por lo que un enlace previo puede durar hasta 60 segundos tras ocultar la unidad. Los enlaces privados comprueban también la concesión local vigente; la desactivación del perfil remoto se verifica al emitir nuevos enlaces. Los PDF ya descargados no se pueden revocar.

## Verificación reproducible

Ejecutar las pruebas Node habituales y las de navegador indicadas en `peritajes.md`. Para paridad PHP/JavaScript, definir `PHP_BIN` con la ruta de PHP 8.1 o superior y ejecutar:

```sh
node scripts/generate-inspection-php-config.mjs --check
node --test tests/inspection-php-parity.test.mjs
```

La prueba compara los 83 ítems, los ocho topes, todos B/R/M, motor malo, turbo N/A, pendientes, categorías no evaluables, 64 matrices mixtas, validación, privacidad, historial y permisos. Las pruebas de repositorio MariaDB se describen en sus archivos `tests/inspections-cpanel-*`; se deben ejecutar sobre una base de pruebas vacía y aislada.

Validación manual de activación: login real con administrador e inspector, denegación anónima y revocada, creación/guardado, dos editores concurrentes, foto real de móvil, autorización pública de fotos, firma táctil, revisión, aprobación, publicación/reemplazo/archivo, botón «Ver peritaje», PDF y renovación de enlaces.

## Respaldo y reversión

Respaldar juntos la base MariaDB, la carpeta privada de evidencias y la configuración privada; los secretos no van a Git ni a ZIP públicos. Antes de cambiar archivos públicos, guardar las versiones anteriores. Para revertir una activación, restaurar esos archivos o el endpoint configurado y conservar la base/evidencias para recuperación. Nunca borrar informes aprobados para revertir un despliegue.

Si ya existen informes en Supabase, exportar y reconciliar IDs, snapshots, auditoría y hashes de fotos antes de cambiar la fuente de escritura. No se ha realizado una migración de datos remotos en este trabajo.
