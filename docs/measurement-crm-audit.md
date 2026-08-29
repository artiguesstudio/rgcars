# Auditoría e implementación de medición y CRM — RG Cars TDF

Fecha de cierre técnico: 2026-08-21. Alcance: repositorio local. No se desplegó código, no se aplicaron migraciones remotas y no se configuraron identificadores reales.

## 1. Resumen ejecutivo

El sitio ya tenía una base comercial útil: catálogo y fichas conectados a Supabase, cinco flujos de formularios centralizados en `create-lead`, panel de leads, estados comerciales y una llamada común a `RGShared.trackPageView()`/`trackEvent()`. Esa base se conservó.

La medición externa no estaba operativa: no había IDs válidos de GA4, GTM o Meta, `trackEvent()` dependía de interfaces que no se inicializaban, no existía consentimiento, la atribución no llegaba de extremo a extremo al lead, los clics de WhatsApp no tenían referencia, y el dashboard no calculaba el embudo solicitado. También faltaba en el repositorio la migración que materializa varias columnas/tablas ya esperadas por el panel.

La implementación deja preparada una sola capa de medición, atribución first/last touch, deduplicación de leads y conversiones, tracking propio sin PII, Pixel/GA4 directos o GTM —nunca ambos caminos a la vez—, CAPI server-side, sincronización de resultados CRM, gestión comercial ampliada y dashboard con fórmulas y cantidades absolutas.

## 2. Auditoría del estado encontrado

### Funcionaba

- Las páginas públicas cargaban `config.js`, `shared.js` y los scripts específicos del catálogo, ficha y servicios.
- Catálogo y ficha leían vehículos publicados desde Supabase.
- Consignación, financiación, búsqueda personalizada, seguros y peritaje enviaban la información mediante `RGShared.submitServiceLead()` a `create-lead`.
- `create-lead` validaba los datos, persistía el lead y conservaba el envío de emails existente.
- El backoffice reunía las tablas de leads, permitía cambiar estado/etapa y mostraba historial si la tabla correspondiente existía.
- `RGShared.trackPageView()` tenía deduplicación temporal básica y `trackEvent()` contemplaba `gtag`, `dataLayer` y `rg:track`.

### Estaba incompleto o suponía riesgo

- No había inicialización de Google tag, GA4, GTM ni Meta Pixel; las referencias a esas interfaces no producían medición externa confiable.
- No había una taxonomía única ni cobertura completa de catálogo, ficha, búsqueda, financiación, WhatsApp y conversión confirmada.
- El fallback anterior podía guardar la query completa, referrer y user-agent; una query accidental con datos personales podía terminar en analítica propia.
- Varias páginas públicas creaban clientes Supabase distintos, origen del aviso de múltiples clientes de autenticación observado en la web publicada.
- El formulario no llevaba una clave idempotente ni un `event_id` compartido de navegador/servidor.
- No se preservaban UTMs, `fbclid`, `gclid`, sesión, visitante, QR, anuncio y vehículo como first y last touch ligados al lead.
- Los WhatsApp abrían sin registrar primero el clic ni incluir una referencia segura.
- No había CAPI, Measurement Protocol para resultados CRM, reintentos ni registro técnico de entregas.
- El panel no tenía una vista unificada con filtros completos, calidad del lead, primera respuesta, visita, pérdida obligatoria, exportación y recorrido de atribución.
- El dashboard existente era descriptivo y no implementaba el conjunto de KPI solicitado ni gasto publicitario real.
- No había gestión de consentimiento ni explicación suficiente en la política de privacidad.

### No se pudo confirmar

- Esquema, RLS, políticas y datos efectivos del proyecto remoto: el intento de inspección read-only con la configuración pública respondió `401`. La migración nueva protege sus propias tablas, pero las políticas históricas de `vehicles`, las tablas de leads, storage y funciones deben revisarse en el proyecto Supabase autenticado.
- GA4 DebugView/Realtime, Tag Assistant y Meta Test Events: faltan IDs reales, secretos y despliegue.
- Configuración actual de Business Manager, dataset/pixel, catálogo automotor, dominio, permisos y calidad de coincidencia en Meta.
- Existencia/configuración de un contenedor GTM: el valor recibido era un marcador, no un ID.
- Costo histórico, margen y resultados de comunidad: no existían datos verificables y no se inventaron.

### Riesgos que permanecen hasta activar el sistema

- Aplicar frontend/funciones antes que la migración provocará errores de columnas o tablas inexistentes.
- Un contenedor GTM mal configurado podría duplicar eventos o ignorar consentimiento; seguir exactamente la matriz de este documento.
- CAPI y GA4 server-side quedarán en `skipped` mientras falten secretos, consentimiento o `ga_client_id`; es deliberado.
- Los datos históricos no adquieren automáticamente atribución ni fechas comerciales que nunca fueron registradas.
- La definición comercial de “calificado” continúa siendo una decisión humana del backoffice; no se fijaron umbrales de presupuesto o plazo.
- `track-event` y `create-lead` son endpoints públicos por necesidad funcional. Antes de escalar campañas conviene sumar límites de frecuencia en el gateway/WAF y monitoreo de abuso, sin persistir IP ni otros identificadores innecesarios.

## 3. Arquitectura implementada

`measurement.js` es la única capa pública. `RGShared.trackEvent()` y `trackPageView()` delegan en ella. La capa:

- mantiene `dataLayer` preparado;
- carga GTM si hay un `GTM_ID` válido, o carga directamente GA4/Pixel si no lo hay;
- no carga tags de terceros antes del consentimiento;
- no reenvía a GTM actividad ocurrida antes del consentimiento;
- emite estados de Consent Mode y variables `rg_analytics_consent`/`rg_marketing_consent`;
- guarda first/last touch, sesión y —sólo con consentimiento analítico— visitante persistente;
- elimina campos de PII de todo payload analítico;
- escribe medición propia a través de `track-event`, nunca directamente desde el navegador a tablas;
- genera `event_id` y deduplica eventos repetidos en la página;
- usa el mismo ID para `generate_lead`/`Lead` del navegador y la entrega server-side de Meta;
- falla de forma silenciosa para el negocio si Analytics, Meta o la función de tracking no responden.

La medición propia no incluye nombre, email, teléfono, mensaje, matrícula, dirección, IP ni user-agent. El contacto permanece exclusivamente en las tablas CRM.

## 4. Taxonomía

| Acción | Evento interno / GA4 | Meta | Parámetros públicos principales | Momento |
|---|---|---|---|---|
| Página pública | `page_view` | `PageView` | `page_key`, ruta saneada, título, `vehicle_id` | una vez por navegación; dedupe 15 s |
| Lista de stock | `view_item_list` | — | `item_list_id`, `item_list_name`, `item_count`, `items` | al renderizar catálogo |
| Selección de unidad | `select_item` | — | `vehicle_id`, marca, modelo, año, categoría, posición | clic en tarjeta |
| Ficha | `view_item` | `ViewContent` | ID, título, marca, modelo, año, precio, moneda, estado, `content_type=product`, `content_ids` | ficha válida renderizada |
| Búsqueda/filtros | `search` | `Search` | término agrupado y filtros no personales | búsqueda/filtro con debounce |
| WhatsApp | `click_whatsapp` | `Contact` | página, servicio, vehículo, ubicación, referencia | antes de abrir WhatsApp |
| Financiación | `click_financing` | `Contact` | vehículo, entidad/tipo, destino | clic en opción/simulador |
| Lead guardado | `generate_lead` | `Lead` | `lead_id`, `service_type`, `vehicle_id`, origen | sólo después de persistencia confirmada |
| Primera respuesta | `working_lead` | — | ID técnico, servicio, vehículo, etapa/calidad | primera apertura de WhatsApp/email desde CRM |
| Calificado | `qualify_lead` | `CRMQualifiedLead` personalizado | ID técnico, servicio, vehículo, etapa/calidad | transición válida |
| Descalificado | `disqualify_lead` | `CRMDisqualifiedLead` personalizado | sin motivo textual en analítica | transición con motivo obligatorio |
| Visita/prueba agendada | `schedule_test_drive` personalizado | `Schedule` | ID técnico, servicio, vehículo | al guardar fecha de visita |
| Ganado | `close_convert_lead` | `Purchase` sin valor | ID técnico, servicio, vehículo, etapa | cierre ganado |
| Perdido | `close_unconvert_lead` | `CRMUnconvertedLead` personalizado | sin motivo textual en analítica | cierre perdido con motivo |

Meta documenta `PageView`, `ViewContent`, `Search`, `Contact`, `Lead`, `Schedule` y `Purchase` como eventos estándar del Pixel. La referencia estándar consultada no enumera un evento estándar inequívoco de lead calificado ni eventos negativos; por eso se usan nombres personalizados y explícitos para esos tres resultados. No se envía precio, valor ni margen en `Purchase` hasta que el negocio defina qué representa el valor.

Para `ViewContent`, la referencia oficial admite `content_type=product` o `product_group`; se usa `product` y `content_ids=[vehicle_id]`. Ese ID debe coincidir exactamente con el ID del inventario en el catálogo de Meta cuando se conecte uno.

La guía de Meta para CRM/Conversion Leads consultada está orientada especialmente a leads de formularios instantáneos y exige conservar el Meta Lead ID para ese caso. Los leads de este sitio son web; la implementación usa Website CAPI y no simula un Meta Lead ID inexistente. Si se incorporan Instant Forms se deberá agregar una integración específica.

## 5. Atribución y WhatsApp

Se capturan `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `qr_code`, `campaign_code`, `ad_code`, URL saneada, referrer saneado, `visitor_key`, `session_key`, `vehicle_id`, fecha de primera visita y fecha de conversión.

- First touch de sesión nunca se reemplaza dentro de la sesión.
- First touch de visitante sólo se persiste con consentimiento analítico y no se reemplaza en retornos.
- Last touch se actualiza cuando aparece una fuente/referrer significativo.
- Sólo se conservan parámetros permitidos; parámetros arbitrarios como `email`, `phone` o `plate` se eliminan de las URLs analíticas.
- `lead_attribution` separa la atribución de las tablas con PII y se relaciona por tipo/ID de lead.

Todo enlace público de WhatsApp queda cubierto mediante delegación. Antes de la navegación se genera internamente `RGC-XXXXXXXXXX` y se registra su relación con página/sesión/campaña/vehículo, sin alterar el texto visible que recibe el cliente. Para QR físicos usar, por ejemplo:

```text
https://rgcars.com.ar/vehicle.html?id=<VEHICLE_ID>&utm_source=qr&utm_medium=offline&utm_campaign=stock_salon&qr_code=<CODIGO_NO_SENSIBLE>
```

## 6. Base de datos y seguridad

La migración `20260821_measurement_crm.sql` agrega:

- `web_page_views`, `web_events`, `whatsapp_clicks`;
- `lead_attribution`;
- `ad_spend_monthly`;
- `conversion_delivery_log`, sin payloads, hashes ni contacto;
- `lead_activity_log` y trigger de historial;
- columnas CRM comunes en las seis tablas existentes de solicitudes;
- claves únicas para `submission_key` y `lead_event_id`;
- fechas `published_at`/`sold_at` en vehículos.

Las tablas nuevas tienen RLS. La escritura pública directa está revocada; `track-event`, `create-lead` y la entrega de conversiones escriben con service role dentro de Edge Functions. Usuarios autenticados sólo leen/gestionan según `is_rg_admin()`, que valida un perfil activo.

Antes de migrar, ejecutar en el SQL Editor autenticado y revisar los resultados:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
order by table_name, grantee, privilege_type;
```

Confirmar especialmente que `anon` no puede seleccionar tablas de leads, atribución, actividad, entregas, perfiles administrativos ni gasto. `vehicles` puede mantener lectura pública limitada si es el diseño vigente; las mutaciones deben quedar restringidas.

## 7. Meta CAPI y GA4 server-side

`conversion-delivery.ts` entrega conversiones sin exponer secretos al cliente:

- normaliza email/teléfono y aplica SHA-256 sólo en el servidor;
- genera `external_id` hasheado desde tipo/ID interno;
- usa `fbp`, `fbc` o construye `fbc` desde `fbclid` cuando existe;
- envía `event_id`, hora del hito, `action_source`, `event_source_url` y parámetros no personales;
- conserva el mismo `event_id` en reintentos y no reenvía una entrega ya marcada `sent`;
- realiza hasta tres intentos ante red, `429` o `5xx`;
- registra únicamente proveedor, ID, evento, estado, cantidad de intentos, HTTP y código técnico;
- acepta `META_TEST_EVENT_CODE` sólo como secreto server-side;
- respeta el consentimiento guardado en el momento de la conversión.

`sync-crm-event` vuelve a consultar el lead y valida el estado real antes de entregar resultados. No confía en la etapa enviada por el navegador. El endpoint requiere un usuario autenticado con perfil admin activo.

## 8. Gestión comercial implementada

El panel central conserva los tabs por servicio y suma:

- búsqueda y filtros por fecha, responsable, etapa, fuente/campaña, vehículo y servicio (tabs);
- responsable, prioridad, etapa, estado, calidad (`pending`, válido, calificado, descalificado), próxima acción, seguimiento y notas;
- primera respuesta al iniciar contacto desde la acción rápida del panel;
- visita agendada/realizada, propuesta y fechas de cierre;
- motivo obligatorio para descalificar, perder o archivar como perdido;
- historial automático de cambios principales;
- recorrido first touch → last touch → conversión;
- acciones vencidas;
- exportación CSV del conjunto filtrado, con mitigación de fórmulas de Excel;
- idempotencia por `submission_key` para evitar leads repetidos por reintentos.

“Lead válido” queda como registro real con contacto utilizable. “Calificado” es una marca comercial decidida por RG Cars; no se codificaron presupuestos o plazos arbitrarios.

## 9. Dashboard y fórmulas

El período se puede seleccionar en 7, 30 o 90 días y se compara contra el bloque anterior de igual duración. Cada tarjeta muestra valor, numerador/denominador o cálculo, período y diferencia absoluta. El P90 de respuesta se muestra con al menos 10 observaciones.

| KPI | Fórmula |
|---|---|
| Conversión web | leads válidos / sesiones × 100 |
| Ficha a contacto | leads o WhatsApp desde ficha / vistas de ficha × 100 |
| CPL válido | inversión / leads válidos |
| Calificación | calificados / válidos × 100 |
| CPL calificado | inversión / calificados |
| Primera respuesta | `first_response_at - created_at`; mediana y P90 |
| Agenda | visitas agendadas / calificados × 100 |
| Asistencia | visitas realizadas / agendadas × 100 |
| Cierre | ganados / calificados × 100 |
| Costo por venta | inversión / ventas atribuidas |
| Eficiencia sobre margen | margen atribuido / inversión; sólo con `SHOW_MARGIN_KPI=true` y datos reales |
| Leads por vehículo | válidos agrupados por `vehicle_id` |
| Conversión por vehículo | ganados / calificados del vehículo × 100 |
| Rotación | `sold_at - published_at` |
| Fuente/campaña | sesiones, leads, calificados, citas y ventas agrupados |

La inversión se carga manualmente por mes/fuente/campaña/anuncio o se importa CSV con `spend_month,source,campaign,ad_code,amount,currency,notes`. Para ventanas parciales, el dashboard prorratea el importe mensual por días solapados. Sin gasto real los KPI de costo muestran “Sin inversión cargada”. Si el período mezcla monedas, no se suman importes incompatibles.

### KPI de comunidad documentados, no activados

Requieren permisos válidos de Instagram/Meta Graph API o una importación verificable: alcance, alcance no seguidores, porcentaje no seguidores, reproducción promedio, porcentaje visto, compartidos/alcance, guardados/alcance, visitas al perfil/alcance, nuevos seguidores/visitas, crecimiento neto/seguidores iniciales, inversión de perfil/seguidores incrementales y leads orgánicos atribuidos. No se generaron valores ni una conexión sin credenciales.

## 10. Configuración pendiente

### Orden de activación

1. Revisar backup, RLS histórica y ejecutar `supabase/migrations/20260821_measurement_crm.sql` en staging.
2. Cargar los secretos de `supabase/functions/.env.example` en Supabase. No usar ese archivo para valores reales versionados.
3. Desplegar `track-event`, `create-lead` y `sync-crm-event` en staging.
4. Ejecutar los casos de prueba de la sección 12.
5. Elegir **GTM** o **instalación directa** y completar IDs públicos en `config.js`.
6. Publicar frontend sólo después de validar staging y solicitar autorización.

### Secretos server-side necesarios

```text
META_PIXEL_ID
META_CAPI_ACCESS_TOKEN
META_GRAPH_API_VERSION
META_TEST_EVENT_CODE       # sólo mientras se prueba; luego quitar
GA4_MEASUREMENT_ID
GA4_API_SECRET
```

Supabase provee `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` a sus funciones. Se mantienen además los secretos de email existentes. Nunca copiar access tokens, API secrets o service role a `config.js`.

### Opción A: GA4 y Meta directos

En `config.js`, completar `GA4_MEASUREMENT_ID` y `META_PIXEL_ID`; dejar `GTM_ID` vacío. `GOOGLE_ADS_ID` puede quedar vacío hasta que exista una cuenta/acción real. La capa usa `send_page_view:false`, por lo que el único `page_view` es el central.

En GA4:

- crear/verificar el web stream del dominio;
- marcar como eventos clave `generate_lead`, `qualify_lead`, `schedule_test_drive` y `close_convert_lead`;
- considerar `click_whatsapp` como evento clave secundario sólo si el negocio quiere optimizar contactos, no ventas;
- no marcar `disqualify_lead` ni `close_unconvert_lead` como conversiones positivas;
- registrar dimensiones personalizadas event-scoped para `service_type`, `vehicle_id`, `campaign_reference`, `crm_stage` y `lead_validity` si se usarán en informes.

### Opción B: GTM

Completar sólo `GTM_ID` en el frontend y mantener vacíos los IDs directos para que exista una única ruta. Dentro de GTM:

1. Crear variables de capa para todos los parámetros usados y para `event_id`, `rg_analytics_consent`, `rg_marketing_consent`.
2. Configurar Consent Mode para Analytics y Ads. La web emite `rg_consent_default` y `rg_consent_update`.
3. Crear una Google tag/GA4 Configuration con envío automático de page view desactivado.
4. Crear un GA4 Event por nombre de evento o una etiqueta reutilizable que tome el nombre del custom event.
5. Crear Meta Pixel base una sola vez y tags de evento según la tabla de taxonomía.
6. Meta sólo puede disparar cuando `rg_marketing_consent=granted`; GA4 cuando `rg_analytics_consent=granted`.
7. Pasar `eventID` a Meta desde `event_id` para deduplicar con CAPI.
8. No instalar además snippets directos, plugins automáticos o otro contenedor.

## 11. Guía de verificación externa

### Tag Assistant / GTM Preview

1. Abrir una URL con UTMs de QA no personales.
2. Antes de consentir: confirmar que no dispara GA4 ni Meta.
3. Aceptar sólo analítica: GA4 puede disparar; Meta debe permanecer bloqueado.
4. Aceptar marketing: verificar un único `page_view`/`PageView` y luego cada acción una vez.
5. Revisar que no aparezcan nombre, email, teléfono, mensaje, CUIL, matrícula ni dirección en dataLayer o hits.

### GA4 DebugView y Realtime

1. Habilitar debug con Tag Assistant/GTM Preview o modo de depuración controlado.
2. Recorrer catálogo → ficha → WhatsApp/financiación → formulario exitoso.
3. Confirmar `view_item_list`, `select_item`, `view_item`, `click_whatsapp`/`click_financing` y un único `generate_lead`.
4. Probar un formulario inválido y una respuesta de servidor fallida: no debe existir `generate_lead`.
5. Cambiar etapas en CRM y comprobar los eventos recomendados de lead.
6. Comparar `event_id`, `lead_id`, `service_type` y `vehicle_id` con Supabase sin inspeccionar PII.

### Meta Events Manager / Test Events

1. Definir temporalmente `META_TEST_EVENT_CODE` como secreto y volver a desplegar las funciones afectadas.
2. Aceptar marketing en el navegador de prueba.
3. Probar ViewContent, Contact, Lead y una transición Schedule/ganada.
4. Confirmar navegador + servidor para Lead con el mismo `event_id` y estado deduplicado, no dos conversiones.
5. Revisar `action_source=website`, URL de origen y calidad de coincidencia.
6. Confirmar que eventos custom CRM aparecen con sus nombres documentados.
7. Quitar `META_TEST_EVENT_CODE` antes de producción.

## 12. Matriz de pruebas de aceptación

- Con/sin UTMs y en una segunda visita: first touch estable, last touch actualizado.
- URL con parámetros personales ficticios: no aparecen en ruta analítica, dataLayer o payload propio.
- Consentimiento rechazado, analítica sola y consentimiento total.
- Catálogo, filtro, selección, ficha, financiación y cada ubicación de WhatsApp.
- Formulario válido, inválido, error de red, doble clic y reintento con la misma `submission_key`.
- Transiciones contactado, calificado, descalificado, visita, ganado y perdido.
- Motivo vacío al descalificar/perder: el panel debe impedir guardar.
- RLS como `anon`, usuario autenticado sin perfil, admin activo y service role.
- Caída/bloqueo de Google, Meta o `track-event`: navegación y formularios deben seguir funcionando.
- Desktop y anchos móviles, incluyendo banner de consentimiento, filtros, ficha y formularios.

Validación local ya ejecutada:

- `node --check` sobre los JavaScript modificados: correcto.
- `deno check` sobre las cuatro funciones TypeScript afectadas: correcto.
- `node --test tests/measurement.test.mjs`: 6/6 pruebas correctas, incluyendo éxito/fallo de formularios.
- Navegador integrado local: home y stock renderizaron; banner accesible; rechazo y reapertura funcionaron; sin consentimiento no cargaron Google/Meta; con IDs vacíos tampoco se intentó cargar tags.
- Sitio publicado inspeccionado en modo read-only: conservaba stock y formularios; no tenía tags de medición instalados al momento de la auditoría.

No se ejecutaron formularios contra producción ni se alteraron datos remotos.

## 13. Archivos de la implementación

- Capa central: `measurement.js`, `config.js`, `shared.js`, `styles.css` y las once páginas públicas.
- Eventos de catálogo/ficha/financiación: `app.js`, `vehicle.js`, `financiacion.js`, `home-ui.js`.
- Consentimiento/política: `politica-de-privacidad.html` y footer público.
- CRM/dashboard: `admin/admin.html`, `admin/admin.js`.
- Migración: `supabase/migrations/20260821_measurement_crm.sql`.
- Funciones: `create-lead`, `track-event`, `sync-crm-event` y `_shared/conversion-delivery.ts`.
- Seguridad/configuración: `.gitignore`, `supabase/functions/.env.example`.
- Pruebas: `tests/measurement.test.mjs`.

## 14. Próximos pasos recomendados

1. Validar migración y RLS con acceso autenticado a un proyecto staging.
2. Entregar IDs públicos y secretos server-side por el gestor de secretos, nunca por Git.
3. Definir ruta directa o GTM y configurar el contenedor si corresponde.
4. Ejecutar la matriz completa en staging con DebugView/Test Events.
5. Definir qué significa `Purchase` y si se enviará valor; hasta entonces mantenerlo sin valor.
6. Definir criterios comerciales internos de calificación y catálogo/ID de contenido en Meta.
7. Revisar la redacción de privacidad con asesoramiento legal local; esta implementación no declara cumplimiento legal garantizado.
8. Con datos reales suficientes, revisar P90, atribución y discrepancias entre CRM, GA4 y Meta antes de optimizar campañas.

## 15. Referencias oficiales consultadas

- Google Analytics: [eventos recomendados, incluido el embudo de leads](https://support.google.com/analytics/answer/9267735).
- Google Analytics: [informe de adquisición de clientes potenciales](https://support.google.com/analytics/answer/16376749).
- Google Tag Platform: [configuración de Consent Mode en sitios web](https://developers.google.com/tag-platform/security/guides/consent).
- Meta for Developers: [referencia de eventos estándar de Meta Pixel](https://developers.facebook.com/documentation/meta-pixel/reference).
- Meta for Developers: [integración CRM para Conversion Leads](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration).
- Meta Business Help Center: [visión general de Conversions API](https://www.facebook.com/business/help/AboutConversionsAPI).
