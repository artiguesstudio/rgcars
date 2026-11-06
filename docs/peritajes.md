# Módulo de peritajes RG Cars

## Arquitectura y alcance

Se integra en el sitio HTML/JavaScript existente, con la sesión de Supabase Auth, vehículos de `public.vehicles`, el administrador actual y jsPDF 2.5.1 ya utilizado en el proyecto. La acción **Peritaje** aparece en cada vehículo del stock, en precios rápidos y después de guardar una unidad. Abre `admin/inspections.html?vehicle_id=...`.

El formulario comercial `peritaje.html` continúa recibiendo consultas. No se modifican sus leads ni la edición/publicación del inventario. Editar los datos del auto en un peritaje modifica únicamente su copia histórica. En PHP, la referencia al inventario es externa y el historial permanece aunque se retire la unidad del catálogo; no existe una FK entre bases. La alternativa Supabase sí impide eliminar vehículos con peritajes mediante FK.

La ficha pública incorpora **Ver peritaje** junto a WhatsApp, financiación y seguro. El botón aparece únicamente después de obtener un informe aprobado y publicado; desplaza el foco al informe y abre su detalle completo. Se oculta cuando no existe informe publicado y no interfiere con **Solicitar peritaje**, que sigue siendo la consulta comercial. La nota y las barras varían de rojo a amarillo y verde según su porcentaje; Estado general y Riesgo aparecen después de las barras. La ficha pública permite consultar el informe; las descargas PDF se realizan únicamente desde el administrador.

El catálogo único está en `inspections/config.mjs`: ocho categorías, 83 identificadores estables, etiquetas originales (incluida **Tasas**), tipos, orden y pesos. Los pesos internos suman **120, 100, 100, 100, 83, 22, 100, 50** y los topes suman 100. No se detectaron divergencias respecto del Markdown recibido. No se adjuntó el PDF físico mencionado; se preservan los campos enumerados, pero no se afirma reproducir exactamente su diagramación original de tres páginas.

`inspections/domain.mjs` contiene la validación y el cálculo JavaScript; `api/inspections/domain.php` conserva esas reglas en PHP, con pruebas de paridad. El JSON de configuración PHP se genera desde el catálogo único. Bueno = 1, Regular = 0,5 y Malo = 0 es un **criterio interno propuesto, pendiente de validación del cliente**. En `rgcars-83-v2`, los frenos delanteros y traseros usan directamente el porcentaje de vida útil dividido por 100 como factor, sin una valoración B/R/M adicional. N/A requiere motivo y permiso. Los campos pendientes, mediciones inválidas y categorías sin ningún ítem aplicable bloquean el resultado definitivo. No se redistribuyen puntos ni se calculan automáticamente aptitud, riesgo o umbrales técnicos. Los resultados mantienen su precisión hasta mostrarlos.

El puntaje de cada área es su máximo multiplicado por la suma de `peso × factor`, dividida por los pesos aplicables. Por ejemplo, un freno con 80 % de vida útil aporta el 80 % de su peso a esa suma; 0 % es una respuesta válida y aporta cero. Las mediciones de pintura, caja y amortiguadores conservan su valoración B/R/M independiente. En v2, los cinco neumáticos requieren estado y permiten observaciones, sin exigir marca, medida, desgaste ni profundidad. Los datos técnicos ya registrados se conservan en los informes y PDF.

## Instalación

La instalación predeterminada usa [PHP y MariaDB en cPanel](inspection-cpanel-deployment.md), con `scripts/inspection-cpanel-schema.sql`, configuración privada fuera de `public_html` y habilitación explícita de cuentas. `RG.INSPECTIONS_ENDPOINT` apunta a `/api/inspections.php`. No requiere migraciones ni funciones nuevas en Supabase.

La [guía alternativa Supabase](inspection-backend.md) conserva sus dos migraciones y el despliegue Edge para quien elija ese backend mediante configuración explícita. `.cpanel.yml` incorpora archivos públicos y APIs por lista; los secretos quedan excluidos. `.htaccess` declara el MIME de `.mjs`.

En ambos backends se necesita un perfil activo existente en `admin_access_profiles` **y** una concesión activa del módulo (`rg_inspection_permissions` en MariaDB o `inspection_permissions` en Supabase). No se concede acceso a cualquier usuario autenticado. La instalación cPanel deja los permisos vacíos hasta una asignación explícita.

El seed es idempotente y se genera desde el catálogo compartido:

```sh
node scripts/generate-inspection-php-config.mjs --check
```

Si se cambian criterios, crear una nueva versión, regenerar el JSON PHP y desplegar catálogo y motor juntos. En la alternativa Edge, generar una **nueva** migración de configuración con `scripts/seed-inspection-config.mjs` y redesplegar la función. Nunca editar el contenido de una versión aprobada ni cambiar una migración ya aplicada. Cada aprobación conserva el catálogo, la escala, las respuestas y el resultado usados. La configuración actual es `rgcars-83-v2`, con escala `propuesta-interna-v2`; los snapshots aprobados con v1 conservan su cálculo original y muestran el estado histórico de los frenos junto con su medición.

## Guía para el personal

La carga utiliza un formulario compacto de ancho completo. Cada componente presenta las opciones **Bueno · Regular · Malo · N/A** en un renglón, con selección única y sin desplegable; N/A depende del permiso. El botón **×** limpia el estado y deja el componente pendiente. Las observaciones están siempre visibles junto a la evaluación y su campo crece al escribir. **Fotos** abre por separado las imágenes y sus controles. En frenos se muestra únicamente **Vida útil (%)**, más N/A cuando corresponde. Las ocho categorías pueden plegarse; guardar conserva su estado abierto o cerrado. Se mantienen los 83 ítems y sus pesos.

1. En **Vehículos**, abrir **Peritaje** en la unidad correspondiente y elegir **Nuevo peritaje** o un borrador en el selector **Informe**.
2. Confirmar fecha, localidad, datos históricos del vehículo y perito. El propietario se carga en la sección privada. Ningún componente viene marcado Bueno.
3. Completar las ocho secciones. En neumáticos, incluido el auxilio, elegir Bueno, Regular o Malo y escribir las observaciones que correspondan. Cargar también hallazgos del parabrisas, porcentajes de pintura, caja y amortiguadores, y daños por zona. El porcentaje de pintura repintada se deriva de la partición original/repintado. Para frenos delanteros y traseros, ingresar solo la vida útil de 0 a 100 %: ese valor participa proporcionalmente en el puntaje. Las demás mediciones mantienen su valoración B/R/M.
4. Usar **No aplica** únicamente si el componente realmente no está equipado y explicar el motivo. Un faltante o una pieza rota debe evaluarse. Agregar observaciones desfavorables y fotos cuando correspondan. Las fotos se cargan privadas; un administrador debe aprobar su salida pública.
5. **Guardar borrador** antes de salir; también guarda las descripciones y autorizaciones de las fotos. La barra inferior mantiene visibles Guardar y el siguiente paso. **Más opciones** contiene previsualización, PDF, actualización y descarte de cambios. El formulario advierte sobre cambios pendientes y evita cambiar de informe mientras estén sin guardar. No se guardan datos del propietario en localStorage. Si hay un conflicto de revisiones, conservar los cambios de pantalla, revisar la versión del servidor y resolverlo antes de continuar; nunca sobrescribir a ciegas. Los enlaces de los errores abren el campo que necesita corrección.
6. Completar **Apto/No apto**, **Bajo/Medio/Alto**, el fundamento, las observaciones, la firma electrónica capturada o adjunta y la fecha de conformidad. La firma es electrónica simple, no certificada. El nombre del perito y su firma tienen autorizaciones públicas separadas y desactivadas inicialmente.
7. **Enviar a revisión**. Un administrador revisa datos técnicos, hallazgos, dictámenes y contenido público, incluidas notas y fotos que pudieran contener información personal. Puede devolver a borrador para corregir o **Aprobar informe**. La aprobación congela respuestas, criterios, datos y evidencias.
8. **Publicar como vigente** hace visible el informe y archiva atómicamente el anterior de esa unidad. Para corregir un informe aprobado, crear otro; no se reescribe el historial. **Archivar** un vigente lo retira de la consulta pública.
9. Desde **Más opciones** del administrador, usar previsualización y **PDF interno** para operación privada. **PDF público** elimina los campos privados; las vistas previas aprobadas aún no publicadas se identifican como tales. Ambas descargas están disponibles solo en el backoffice para usuarios habilitados. El PDF se genera a pedido, con todas las secciones y los 83 componentes, y agrega páginas para contenido extenso/evidencias. El navegador permite imprimir el archivo descargado.

## Privacidad y publicación

Las tablas privadas y las evidencias no se leen directamente desde el navegador. La API valida la sesión y los permisos en cada acción privada. Solo una proyección explícita de un informe aprobado y publicado llega a la ficha pública. Incluye resultados negativos, detalles y evidencia aprobada; excluye propietario, contacto, notas internas y firma/nombre sin autorización. Una unidad sin informe publicado no muestra calificación. No se introduce información privada en SEO.

Los textos de observaciones y pies de foto son contenido destinado al público cuando se aprueba el informe: el revisor debe comprobar que no incluyan contactos o datos personales escritos libremente. No hay un detector automático de PII dentro de texto o fotografías. El motor no garantiza seguridad mecánica.

Los enlaces de fotos son temporales: 60 segundos en público y 300 en administración. Los controles de consulta renuevan enlaces para evitar usar URLs vencidas. En PHP, archivar retira también el acceso por enlaces públicos ya emitidos; con Storage de Supabase, pueden seguir disponibles hasta su vencimiento. Los PDF ya descargados no pueden revocarse.

## Verificación y validación manual

La suite existente usa `node:test`; no hay `package.json` ni comandos de lint/build definidos. Verificar con:

```sh
node --test tests/*.test.mjs
node scripts/seed-inspection-config.mjs --check
deno check supabase/functions/inspections-api/index.ts
```

Las pruebas cubren fórmula y ejemplos solicitados, los 83 pesos, validación de campos, permisos, publicación, snapshots inmutables, serialización pública, PDF, subida de evidencia y conflictos. La prueba opcional de PostgreSQL embebido y las pruebas de navegador tienen instrucciones junto a sus archivos de prueba y en la guía del backend; no requieren datos de producción.

Para las pruebas de navegador, disponer de Playwright por resolución normal de Node o indicar su `index.mjs` en `PLAYWRIGHT_MODULE_PATH`. `PLAYWRIGHT_CHANNEL=msedge` utiliza Edge instalado. Ejecutar:

```sh
node tests/inspections-admin.browser.mjs
node tests/inspection-public-browser.mjs
```

Resultado de la verificación local del 14/10/2026: **54 pruebas Node aprobadas, cero omitidas** al habilitar PGlite; ambas pruebas de navegador aprobadas; seed sincronizado; comprobación Deno y sintaxis JavaScript correctas; `git diff --check` sin errores. El PDF real de prueba se generó con jsPDF 2.5.1, se renderizaron sus cinco páginas con Poppler y se verificaron visualmente y por extracción de texto: 83 ítems, hallazgos desfavorables y ausencia de datos privados. Los navegadores comprobaron móvil y escritorio, publicación, privacidad, protección de cambios y recuperación del PDF después de una foto fallida. Estas pruebas usan datos simulados y no afirman validar el despliegue remoto.

Antes de operar con datos reales, validar:

- Instalación del backend elegido: esquema MariaDB, configuración privada y permisos locales para PHP; migraciones y función para la alternativa Edge.
- Acceso con administrador, inspector, usuario deshabilitado y visitante anónimo; rechazo de acceso directo a tablas y evidencias privadas.
- Creación, guardado, fotos reales de móvil, firma táctil, revisión, publicación, reemplazo, archivo y descarga de PDF en el hosting, incluido el MIME `.mjs`.
- Conflictos con dos sesiones, vencimiento de sesión/enlaces y conservación de cambios pendientes ante un fallo de red.
- Revisión humana de PII en notas/fotos; autorización de perito/firma; fidelidad de todos los campos frente al PDF original cuando esté disponible.
- Confirmación por RG Cars de la escala propuesta y de los dictámenes profesionales. No hay umbrales de seguridad inventados.

## Archivos del módulo

| Grupo | Archivos |
|---|---|
| Motor y catálogo | `inspections/config.mjs`, `inspections/domain.mjs` |
| Administrador | `admin/inspections.html`, `admin/inspections.mjs`, `inspections/admin.css`; enlaces en `admin/admin.js` |
| Ficha y PDF | `inspections/presentation.mjs` comparte la proyección y las etiquetas; `inspections/public.mjs` y `inspections/public.css` presentan la ficha; `inspections/pdf.mjs` genera el PDF desde el administrador; integración en `vehicle.html`, `vehicle.js` |
| Servidor | `api/inspections.php`, `api/inspections/{bootstrap,repository,evidence,domain}.php`; alternativa `supabase/functions/inspections-api/` |
| Persistencia | `scripts/inspection-cpanel-schema.sql`, plantilla `scripts/inspection-cpanel-permissions.sql`, `api/inspections/config.json`; migraciones Supabase alternativas |
| Publicación | `.cpanel.yml`, `.htaccess` |
| Pruebas | `tests/inspection-fixtures.mjs`, `tests/inspection-fixture.mjs`, `tests/inspections.test.mjs`, `tests/inspections-api.test.mjs`, `tests/inspections-database.test.mjs`, `tests/inspection-presentation.test.mjs`, `tests/inspections-admin.browser.mjs`, `tests/inspection-public-browser.mjs` |
| Guías | `docs/peritajes.md`, `docs/inspection-backend.md` |

Los cambios que ya existían en `api/job-applications.php`, `shared.js` y `tests/job-applications.test.mjs` son ajenos al módulo y se conservaron.
