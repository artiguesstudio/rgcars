# Peritajes en cPanel: viabilidad y alcance

Revisión del repositorio realizada el 14 de octubre de 2026. La alternativa PHP del módulo ya está implementada en el proyecto. Consultar [instalación y verificaciones del hosting](inspection-cpanel-deployment.md) para el estado operativo; el resto de este documento conserva el análisis de alcance que dio origen al cambio.

Es viable ejecutar el módulo de peritajes con PHP, MySQL/MariaDB y archivos privados en el hosting cPanel. Se conservan el formulario, los 83 componentes, la vista pública y el generador PDF. La implementación inicial usaba Supabase para la API, persistencia, permisos y evidencias; la alternativa PHP sustituye esos componentes y mantiene la autenticación y el inventario existentes.

## Lo comprobado en este proyecto

| Componente | Implementación observada |
|---|---|
| Publicación del sitio | `.cpanel.yml` copia HTML, JavaScript, CSS y PHP a `/home2/rgcarsco/public_html` |
| Imágenes del inventario | `api/vehicle-images.php` guarda archivos en `uploads/vehicles`; valida una sesión Supabase |
| Archivos privados | `api/job-applications.php` tiene almacenamiento fuera de `public_html`, en `rgcars-private/job-applications`, con acceso mediante PHP |
| Secretos | `storage-secrets.example.php` documenta un archivo privado fuera de `public_html` |
| Login y cuentas | `admin/admin.js` utiliza Supabase Auth: inicio de sesión, sesión vigente, cambio de contraseña y cierre de sesión |
| Vehículos | `app.js`, `vehicle.js` y `admin/admin.js` consultan o modifican `vehicles` en Supabase |
| Peritajes | `admin/inspections.mjs` y `inspections/public.mjs` llaman a `functions/v1/inspections-api`; el administrador también consulta `vehicles` directamente |
| Backend de peritajes | Edge Function Deno, tablas PostgreSQL, funciones transaccionales, permisos enlazados a Auth y bucket privado Supabase |
| Configuración/puntuación/PDF | Configuración y motor puro JavaScript reutilizables; PDF generado en el navegador con jsPDF |

`STORAGE-MIGRATION.md` confirma expresamente que la migración anterior movía únicamente imágenes y conservaba Supabase para datos y autenticación. Validar localmente un JWT ya emitido no proporciona un inicio de sesión independiente ni reemplaza la consulta del estado actual de una cuenta.

No se encontraron `php`, `mysql` ni `mariadb` en el PATH local. Tampoco se encontró `php.exe` en las ubicaciones locales revisadas. Esto no permite inferir qué versiones o extensiones están habilitadas en el hosting.

## Dos alcances distintos

| Alcance | Qué se movería a cPanel | Qué seguiría en Supabase |
|---|---|---|
| Solo backend de peritajes | API PHP, tablas del módulo en MySQL/MariaDB y evidencias privadas | Login del administrador, cuentas/perfiles e inventario existente |
| Plataforma independiente de Supabase | Lo anterior, más autenticación, inventario y los demás servicios que hoy lo consultan | Ninguna dependencia operativa, una vez migrados y validados todos los consumidores |

Para limitar el cambio al módulo, la primera alternativa reutiliza el login y el inventario actual y evita nuevas Edge Functions, tablas o buckets de peritajes en Supabase. Sigue siendo una solución híbrida: si Supabase no está disponible, el login y el catálogo actuales siguen afectados.

Si la intención es poder apagar Supabase, hace falta una migración de plataforma. Incluye identidad y recuperación de cuentas, vehículos y estados de publicación, leads/CRM y métricas dependientes, las integraciones de sus funciones, y la validación de sesiones que ya realizan los endpoints PHP. No se deben crear cuentas duplicadas ni un segundo inventario mantenido manualmente para simular esa independencia.

## Propuesta para migrar únicamente peritajes

1. Agregar `api/inspections.php` con el mismo contrato de acciones y respuestas que consume la interfaz: crear, guardar, historial, revisar, aprobar, publicar, evidencias y lectura pública. Parametrizar la URL en la configuración del sitio para poder cambiar de backend de forma controlada.
2. Crear tablas del módulo en MySQL/MariaDB con motor transaccional. Mantener los IDs originales de vehículos y usuarios como referencias externas. Al estar el inventario en otra base, no existiría una FK SQL entre ambos sistemas: el PHP debe comprobar la existencia y visibilidad del vehículo en la fuente actual, y preservar su copia histórica en el informe.
3. Autenticar en el servidor cada acción privada y comprobar permisos explícitos del módulo y cuenta activa. El patrón PHP actual de una lista opcional de emails no alcanza por sí solo para conservar los controles del nuevo módulo. La autorización debe denegar por defecto y diferenciar edición, N/A, aprobación y publicación.
4. Exportar automáticamente la configuración versionada JavaScript a JSON para que PHP use exactamente los mismos 83 ítems y ponderaciones. Portar al servidor las validaciones, la proyección pública y la puntuación. Ejecutar pruebas de paridad JavaScript/PHP; nunca aceptar la nota calculada por el navegador como resultado autorizado.
5. Mantener revisión optimista y publicación atómica. Usar transacciones y bloqueo por vehículo; una relación de informe vigente con `vehicle_id` único puede sustituir el índice parcial PostgreSQL. El estado, el reemplazo del informe previo y la auditoría deben confirmarse juntos. Guardar snapshots aprobados inmutables y exigir un nuevo informe para corregirlos.
6. Guardar las evidencias fuera de `public_html`, por ejemplo en una nueva carpeta `rgcars-private/inspections`. Servirlas mediante un controlador PHP que compruebe sesión o publicación autorizada; no reutilizar la carpeta pública de fotos de inventario para evidencia privada. Conservar validación MIME/tamaño, límites, asociación al ítem y aprobación individual de fotos.
7. Conservar el PDF y la interfaz actuales. Sustituir los enlaces firmados de Storage por URLs privadas/públicas controladas del nuevo backend. La API pública debe seguir enviando exclusivamente el informe aprobado vigente y los campos autorizados, sin datos del propietario, notas internas ni firmas sin consentimiento.

La transacción debe utilizar un motor de tablas que la soporte. PHP documenta que la disponibilidad de PDO por sí sola no garantiza transacciones para cualquier motor, y que ciertas sentencias DDL provocan confirmaciones implícitas; las migraciones deben separarse del flujo de publicación. [Documentación de transacciones PDO](https://www.php.net/manual/en/pdo.transactions.php).

Las migraciones actuales PostgreSQL no se pueden importar directamente en MySQL/MariaDB: usan `jsonb`, RLS, funciones PL/pgSQL, bloqueos consultivos y esquemas de Auth/Storage específicos. Hace falta una migración equivalente nueva y pruebas contra el motor elegido.

## Lo que falta confirmar del hosting

- Versión PHP disponible para el dominio y extensiones `PDO_MYSQL`, `fileinfo`, `mbstring`, `openssl` y soporte JSON; acceso HTTPS saliente si se mantiene Auth/inventario Supabase. La extensión de conexión MySQL debe estar instalada además de PHP. [PDO_MYSQL](https://www.php.net/manual/en/ref.pdo-mysql.php).
- Disponibilidad y versión de MySQL/MariaDB, motor InnoDB, permisos para crear las tablas y restricciones necesarias, y una base/usuario exclusivos para la aplicación. cPanel ofrece interfaces de bases de datos, pero el proveedor puede deshabilitarlas. [Bases de datos en cPanel](https://docs.cpanel.net/cpanel/databases/mysql-databases/).
- Ruta privada real, permisos de escritura y si `open_basedir` permite usarla; cuotas de disco y copias/restauración conjunta de datos y archivos.
- Límites de subida: para conservar fotos de hasta 8 MiB, `upload_max_filesize` debe admitirlas y `post_max_size` debe ser mayor, incluyendo el formulario multipart. También deben comprobarse límites del servidor/proxy y memoria. [Directivas de subida PHP](https://www.php.net/manual/en/ini.core.php).
- Entorno de pruebas y posibilidad de ejecutar migraciones y tests; no es indispensable que cPanel tenga Node.js o Deno si el backend se implementa en PHP y el PDF sigue en el navegador.

MultiPHP permite consultar y seleccionar las versiones instaladas disponibles para una cuenta, pero esa interfaz y sus opciones dependen del proveedor. La documentación no acredita la configuración real de la cuenta RG Cars. [MultiPHP Manager](https://docs.cpanel.net/cpanel/software/multiphp-manager-for-cpanel/).

## Si ya hubiera informes guardados en Supabase

Exportar documentos, snapshots, auditoría, permisos y evidencias sin recalcular las notas históricas. Preservar IDs, fechas y revisiones; comparar cantidades, hashes de archivos y resultados antes del cambio de endpoint. Durante el corte debe existir una sola fuente de escritura. Mantener respaldo recuperable y comprobar lectura pública, PII, roles, conflictos concurrentes, reemplazo del vigente y PDFs antes de retirar el backend anterior.

No se verificó la existencia de informes remotos en el análisis inicial. La revisión posterior de cPanel confirmó PHP 8.1.34, MariaDB 11.4.8, las extensiones necesarias y almacenamiento privado escribible; esos resultados y los pasos de activación están registrados en la guía de instalación.
