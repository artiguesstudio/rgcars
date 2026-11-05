import { CONFIG, scoreInspection, validateDocument, publicReport, internalReport, usesPercentageScore } from '../inspections/domain.mjs';
import { downloadInspectionPdf, ratingLabel } from '../inspections/pdf.mjs';
import { inspectionEndpoint, inspectionHeaders } from '../inspections/transport.mjs';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const statusLabels = { draft: 'Borrador', in_review: 'En revisión', approved: 'Aprobado', published: 'Publicado · vigente', archived: 'Archivado' };
const state = { client: null, vehicleId: '', vehicle: null, row: null, history: [], capabilities: { can_edit: false, can_approve: false, can_na: false }, dirty: false, busy: false, evidenceEdits: new Map(), detailStates: new Map(), renderedId: null };
const configForRow = () => state.row?.scoring_snapshot?.config || CONFIG;
const editable = () => state.capabilities.can_edit && state.row?.status === 'draft' && !state.busy;
const dateLabel = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR') : 'Sin fecha';
const pretty = (value) => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });

function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('is-error', error);
  $('notice').hidden = !message;
}

function showErrors(errors) {
  const box = $('validation');
  box.hidden = !errors?.length;
  if (!errors?.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<strong>Revisá los campos antes de continuar.</strong><ul>${errors.map((error) => {
    const itemId = String(error.path || '').split('.')[1];
    const item = configForRow().categories.flatMap((category) => category.items).find((candidate) => candidate.id === itemId);
    const path = String(error.path || '');
    const input = [...$('inspectionForm').querySelectorAll('[data-path]')].find((field) => field.dataset.path === path);
    const label = input?.closest('label')?.querySelector('span')?.textContent || (path.startsWith('signature') ? 'Firma del perito' : path.startsWith('owner') ? 'Datos del propietario' : path.startsWith('categories.') ? 'Categoría' : ['fitness', 'risk', 'verdict_reason'].includes(path) ? 'Dictamen' : 'Datos generales');
    return `<li>${item ? `<a href="#item-${esc(item.id)}" data-error-item="${esc(item.id)}" data-error-path="${esc(path)}">${esc(item.label)}</a>: ` : `<a href="#field-${esc(path.replaceAll('.', '-'))}" data-error-path="${esc(path)}">${esc(label)}</a>: `}${esc(error.message)}</li>`;
  }).join('')}</ul>`;
  box.focus();
}

async function request(action, payload = {}, form = null) {
  const { data, error } = await state.client.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('La sesión venció. Volvé a iniciar sesión para continuar. Los cambios siguen en esta pantalla.');
  const headers = inspectionHeaders(window.RG, data.session.access_token, !!form);
  const response = await fetch(inspectionEndpoint(window.RG), {
    method: 'POST', headers, body: form || JSON.stringify({ action, ...payload }), cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    const failure = new Error(response.status === 409 ? 'Otro usuario modificó este informe. Tus cambios se conservan en pantalla. Abrí el mismo informe en otra pestaña para compararlos y usá “Descartar cambios y recargar” cuando hayas terminado.' : result.error || 'No se pudo completar la operación de peritajes.');
    failure.details = result.details;
    failure.status = response.status;
    throw failure;
  }
  return result.data;
}

async function operation(callback) {
  if (state.busy) return;
  state.busy = true;
  $('editor').setAttribute('aria-busy', 'true');
  $('newInspection').disabled = true;
  if ($('historySelect')) $('historySelect').disabled = true;
  $('inspectionForm').querySelectorAll('input,select,textarea,button').forEach((input) => { input.disabled = true; });
  renderActions();
  try { await callback(); }
  catch (error) {
    notify(error.message || 'No se pudo completar la operación.', true);
    if (Array.isArray(error.details)) showErrors(error.details);
  } finally {
    state.busy = false;
    $('editor').removeAttribute('aria-busy');
    $('newInspection').disabled = false;
    if ($('historySelect')) $('historySelect').disabled = !state.history.length;
    if (state.row) renderEditor();
  }
}

function getPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
function setPath(object, path, value) {
  const keys = path.split('.');
  const leaf = keys.pop();
  const parent = keys.reduce((target, key) => (target[key] ??= {}), object);
  parent[leaf] = value;
}

function field(label, path, { type = 'text', wide = false, help = '', min, max, step, options, maxLength = 200, placeholder = '', rows = 2 } = {}) {
  const rawValue = getPath(state.row.document, path) ?? '';
  const value = type === 'date' ? String(rawValue).slice(0, 10) : rawValue;
  const disabled = editable() ? '' : ' disabled';
  const attrs = `id="field-${esc(path.replaceAll('.', '-'))}" data-path="${esc(path)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${disabled}`;
  const range = `${min != null ? ` min="${min}"` : ''}${max != null ? ` max="${max}"` : ''}${step ? ` step="${step}"` : ''}`;
  const input = options ? `<select ${attrs}><option value="">Seleccionar…</option>${options.map((option) => `<option value="${esc(option)}" ${value === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`
    : type === 'textarea' ? `<textarea ${attrs} rows="${rows}" maxlength="${maxLength}">${esc(value)}</textarea>`
      : `<input ${attrs} type="${type}" value="${esc(value)}"${range} ${type === 'number' ? 'inputmode="decimal"' : `maxlength="${maxLength}"`} />`;
  return `<label class="inspection-field${wide ? ' wide' : ''}"><span>${esc(label)}</span>${input}${help ? `<small>${esc(help)}</small>` : ''}</label>`;
}

function checkField(label, path) {
  return `<label class="inspection-check"><input type="checkbox" data-path="${esc(path)}" ${getPath(state.row.document, path) ? 'checked' : ''} ${editable() ? '' : 'disabled'} /><span>${esc(label)}</span></label>`;
}

function itemFields(item, answer) {
  const path = `answers.${item.id}.value`;
  if (item.type === 'windshield') return `<div class="inspection-findings">${['Sin daños', 'Fisuras', 'Impactos'].map((finding) => `<label class="inspection-check"><input type="checkbox" data-finding="${esc(finding)}" data-item="${esc(item.id)}" ${(answer.value?.findings || []).includes(finding) ? 'checked' : ''} ${editable() ? '' : 'disabled'} /><span>${esc(finding)}</span></label>`).join('')}</div>`;
  if (item.type === 'percentage') {
    const paint = item.partition === 'original_paint';
    return `<div class="inspection-fields inspection-technical-fields">${field(paint ? 'Original (%)' : item.unit || 'Estimado (%)', `${path}.percent`, { type: 'number', min: 0, max: 100, step: 'any', placeholder: '0–100' })}${paint ? `<div class="inspection-field"><span>Repintado (%)</span><output data-paint-output="${esc(item.id)}" title="100 menos el porcentaje original">${Number.isFinite(answer.value?.percent) && answer.value.percent >= 0 && answer.value.percent <= 100 ? pretty(100 - answer.value.percent) : '—'}</output></div>` : ''}</div>`;
  }
  if (item.type === 'damage') return `<div class="inspection-fields inspection-technical-fields">${field('Daños / condición', `${path}.detail`, { type: 'textarea', rows: 1, maxLength: 2000, placeholder: 'Describir hallazgos' })}${field('Zona', `${path}.zone`, { maxLength: 300, placeholder: 'Zona afectada' })}</div>`;
  if (item.type === 'tire' && item.details_required !== false) return `<div class="inspection-fields inspection-technical-fields">${field('Marca', `${path}.brand`, { maxLength: 100 })}${field('Medida', `${path}.size`, { maxLength: 100, placeholder: 'Ej. 205/55 R16' })}${field('Desgaste (%)', `${path}.wear_percent`, { type: 'number', min: 0, max: 100, step: 'any', placeholder: '0–100' })}${field('Profundidad (mm)', `${path}.depth_mm`, { type: 'number', min: 0, step: 'any' })}</div>`;
  return '';
}

function evidenceMarkup(item) {
  const evidence = (state.row.evidence || []).filter((entry) => entry.item_id === item.id);
  const controls = evidence.map((entry) => {
    entry = { ...entry, ...state.evidenceEdits.get(entry.id) };
    const imageUrl = safeImageUrl(entry.signed_url);
    return `<div class="inspection-evidence-card">${imageUrl ? `<a href="${esc(imageUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(imageUrl)}" loading="lazy" alt="Evidencia: ${esc(item.label)}" /></a>` : '<span>Vista previa no disponible.</span>'}<label class="inspection-field"><span>Descripción de la evidencia</span><input data-evidence-caption="${esc(entry.id)}" value="${esc(entry.caption || '')}" maxlength="500" ${editable() ? '' : 'disabled'} /></label><span>${entry.approved_public ? 'Aprobada para informe público' : 'Evidencia privada'}</span>${editable() && state.capabilities.can_approve ? `<label class="inspection-check"><input type="checkbox" data-evidence-public="${esc(entry.id)}" ${entry.approved_public ? 'checked' : ''} /><span>Aprobar publicación de esta foto (sin datos privados)</span></label>` : ''}${editable() ? `<button type="button" class="btn btn-ghost" data-delete-evidence="${esc(entry.id)}">Eliminar foto</button>` : ''}</div>`;
  }).join('');
  return `<div class="inspection-evidence"><div class="inspection-evidence-list">${controls || ''}</div>${editable() ? `<div class="inspection-upload"><label class="inspection-field"><span>Agregar foto privada</span><input type="file" accept="image/jpeg,image/png,image/webp" data-upload="${esc(item.id)}" /></label><p>JPG, PNG o WebP · hasta 8 MB · sin datos personales. Publicación sujeta a aprobación.</p></div>` : !evidence.length ? '<p class="inspection-help">Sin fotografías.</p>' : ''}</div>`;
}

function safeImageUrl(value) {
  if (!value) return '';
  try { const url = new URL(value, window.location.href); return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === window.location.hostname) ? url.href : ''; }
  catch { return ''; }
}

function itemMarkup(item) {
  const answer = state.row.document.answers?.[item.id] || { rating: null, value: {} };
  const options = [['B', 'Bueno'], ['R', 'Regular'], ['M', 'Malo']];
  const allowNA = state.capabilities.can_na && configForRow().allow_na !== false;
  if (allowNA || answer.rating === 'NA') options.push(['NA', 'N/A']);
  const photoCount = (state.row.evidence || []).filter((entry) => entry.item_id === item.id).length;
  const percentage = usesPercentageScore(item);
  const disabled = editable() ? '' : 'disabled';
  const controls = percentage
    ? `<div class="inspection-percentage-control"><div data-typed-fields="${esc(item.id)}" ${answer.rating === 'NA' ? 'hidden' : ''}>${field('Vida útil (%)', `answers.${item.id}.value.percent`, { type: 'number', min: 0, max: 100, step: 'any', placeholder: '0–100' })}</div>${allowNA || answer.rating === 'NA' ? `<label class="inspection-check inspection-percentage-na" title="No aplica"><input type="checkbox" data-percentage-na="${esc(item.id)}" aria-label="No aplica: ${esc(item.label)}" ${answer.rating === 'NA' ? 'checked' : ''} ${!editable() || (!allowNA && answer.rating !== 'NA') ? 'disabled' : ''} /><span>N/A</span></label>` : ''}</div>`
    : `<div class="inspection-rating-controls"><div class="inspection-rating-options" role="radiogroup" aria-label="Estado de ${esc(item.label)}">${options.map(([value, label]) => `<label class="inspection-rating-option" title="${value === 'NA' ? 'No aplica' : label}"><input type="radio" id="state-${esc(item.id)}-${value}" name="rating-${esc(item.id)}" value="${value}" data-path="answers.${esc(item.id)}.rating" aria-label="${value === 'NA' ? 'No aplica' : label}" ${answer.rating === value ? 'checked' : ''} ${!editable() || (value === 'NA' && !allowNA) ? 'disabled' : ''} /><span>${label}</span></label>`).join('')}</div>${editable() ? `<button type="button" class="inspection-clear-rating" data-clear-rating="${esc(item.id)}" aria-label="Limpiar estado de ${esc(item.label)}" title="Dejar pendiente" ${answer.rating ? '' : 'disabled'}>×</button>` : ''}</div>`;
  const typedFields = percentage ? '' : itemFields(item, answer);
  return `<article class="inspection-item" id="item-${esc(item.id)}" data-item-container="${esc(item.id)}" data-item-type="${esc(item.type)}" data-rating="${esc(answer.rating || '')}"><div class="inspection-item-name" title="Peso relativo: ${pretty(item.weight)}"><span>${esc(item.label)}</span></div><div class="inspection-item-controls">${controls}</div><label class="inspection-field inspection-item-notes"><span class="inspection-sr-only">Observaciones públicas de ${esc(item.label)}</span><textarea id="field-answers-${esc(item.id)}-notes" data-path="answers.${esc(item.id)}.notes" rows="1" maxlength="2000" placeholder="Observaciones…" ${disabled}>${esc(answer.notes || '')}</textarea></label><details class="inspection-item-details" id="details-${esc(item.id)}"><summary aria-label="Fotos de ${esc(item.label)}">Fotos${photoCount ? ` (${photoCount})` : ''}</summary><div class="inspection-item-detail-body">${evidenceMarkup(item)}</div></details><div class="inspection-item-na" data-na-reason="${esc(item.id)}" ${answer.rating === 'NA' ? '' : 'hidden'}>${field('Motivo de N/A', `answers.${item.id}.na_reason`, { maxLength: 1000, placeholder: 'Por qué no equipa este componente' })}</div>${typedFields ? `<div class="inspection-item-fields" data-typed-fields="${esc(item.id)}" ${answer.rating === 'NA' ? 'hidden' : ''}>${typedFields}</div>` : ''}</article>`;
}

function resizeObservation(input) {
  if (!input.matches('.inspection-item-notes textarea') || !input.offsetParent) return;
  input.style.height = 'auto';
  input.style.height = `${Math.max(38, input.scrollHeight + 2)}px`;
}

function syncItemRating(itemId) {
  const rating = state.row.document.answers[itemId]?.rating;
  const container = $(`item-${itemId}`);
  if (!container) return;
  container.dataset.rating = rating || '';
  container.querySelectorAll('input[type="radio"][data-path$=".rating"]').forEach((input) => { input.checked = input.value === rating; });
  const clear = container.querySelector('[data-clear-rating]');
  if (clear) clear.disabled = !editable() || !rating;
  container.querySelector('[data-na-reason]').hidden = rating !== 'NA';
  const typedFields = container.querySelector('[data-typed-fields]');
  if (typedFields) typedFields.hidden = rating === 'NA';
  const percentageNA = container.querySelector('[data-percentage-na]');
  if (percentageNA) percentageNA.disabled = !editable() || (!(state.capabilities.can_na && configForRow().allow_na !== false) && rating !== 'NA');
}

function renderHistory() {
  const select = $('historySelect');
  if (select) {
    select.innerHTML = state.history.length ? `<option value="" ${state.row ? '' : 'selected'} disabled>Seleccionar informe…</option>${state.history.map((row) => `<option value="${esc(row.id)}" ${state.row?.id === row.id ? 'selected' : ''}>${dateLabel(row.inspection_date || row.document?.inspection_date || row.created_at)} · ${esc(statusLabels[row.status] || row.status)} · ${esc(String(row.id).slice(0, 8))}</option>`).join('')}` : '<option value="">Sin peritajes</option>';
    select.disabled = state.busy || !state.history.length;
  }
  $('historyList').textContent = state.history.length ? `${state.history.length} informe${state.history.length === 1 ? '' : 's'}${state.row ? ` · revisión ${state.row.revision}` : ''}` : 'Todavía no hay peritajes para esta unidad.';
}

function renderEditor() {
  if (!state.row) return;
  if (state.renderedId) state.detailStates.set(state.renderedId, new Map([...$('inspectionForm').querySelectorAll('details[id]')].map((element) => [element.id, element.open])));
  state.renderedId = state.row.id;
  const detailStates = state.detailStates.get(state.row.id);
  const doc = state.row.document;
  $('emptyState').hidden = true;
  $('editor').hidden = false;
  $('reportStatus').textContent = statusLabels[state.row.status] || state.row.status;
  $('reportTitle').textContent = `Peritaje · ${dateLabel(doc.inspection_date)}`;
  $('reportMeta').textContent = `Folio ${String(state.row.id).slice(0, 8)} · Revisión ${state.row.revision}`;
  $('inspectionForm').innerHTML = `<details class="inspection-section" id="generalSection" open><summary><span>Datos generales y vehículo<small>RG CARS TDF S.R.L. · Copia histórica</small></span></summary><div class="inspection-section-body"><div class="inspection-fields inspection-general-fields">${field('Fecha de inspección', 'inspection_date', { type: 'date' })}${field('Localidad', 'locality')}${field('Marca', 'vehicle.brand')}${field('Modelo', 'vehicle.model')}${field('Versión', 'vehicle.version')}${field('Dominio', 'vehicle.plate')}${field('Kilometraje', 'vehicle.km', { type: 'number', min: 0, step: '1' })}${field('Año', 'vehicle.year', { type: 'number', min: 1886, max: 2200, step: '1' })}${field('Perito', 'inspector_name')}${checkField('Autorizar nombre del perito en el informe público', 'show_inspector')}</div></div></details>
    <details class="inspection-section" id="ownerSection"><summary><span>Propietario · datos privados<small>Solo administrador autorizado y PDF interno</small></span></summary><div class="inspection-section-body"><div class="inspection-fields">${field('Nombre', 'owner.name')}${field('Teléfono', 'owner.phone', { type: 'tel' })}${field('Email', 'owner.email', { type: 'email' })}</div></div></details>
    ${configForRow().categories.map((category) => `<details class="inspection-section inspection-category" id="section-${esc(category.id)}" open><summary><span>${esc(category.label)}<small data-category-summary="${esc(category.id)}"></small></span><span><progress class="inspection-progress" max="${category.items.length}" value="0" data-category-progress="${esc(category.id)}" aria-label="Progreso de ${esc(category.label)}"></progress><small data-category-points="${esc(category.id)}"></small></span></summary><div class="inspection-section-body">${category.items.map(itemMarkup).join('')}</div></details>`).join('')}
    <details class="inspection-section" id="verdictSection"><summary><span>Dictámenes, observaciones y firma<small>Decisiones explícitas del perito</small></span></summary><div class="inspection-section-body"><div class="inspection-fields">${field('Estado general', 'fitness', { options: ['Apto', 'No apto'] })}${field('Nivel de riesgo', 'risk', { options: ['Bajo', 'Medio', 'Alto'] })}${field('Fundamento de aptitud y riesgo', 'verdict_reason', { type: 'textarea', wide: true, maxLength: 4000, help: 'Indicá los hallazgos relevantes. La nota no determina aptitud ni riesgo.' })}${field('Observaciones generales (públicas)', 'observations', { type: 'textarea', wide: true, maxLength: 8000 })}${field('Notas internas privadas', 'internal_notes', { type: 'textarea', wide: true, maxLength: 8000 })}</div><div class="inspection-signature"><h3>Firma electrónica simple del perito</h3><p class="inspection-help">Firma capturada con mouse, dedo o lápiz. No es una firma digital certificada.</p><canvas id="signatureCanvas" width="600" height="180" aria-label="Área para dibujar la firma del perito" aria-disabled="${!editable()}"></canvas>${editable() ? '<button type="button" class="btn btn-ghost" id="clearSignature">Borrar firma</button><label class="inspection-field"><span>O adjuntar imagen de la firma</span><input type="file" id="signatureFile" accept="image/png" /><small>PNG de hasta 150 KB. Alternativa al dibujo para accesibilidad.</small></label>' : ''}<div class="inspection-fields">${field('Nombre del firmante', 'signature.name')}${field('Fecha de conformidad', 'signature.signed_at', { type: 'date' })}</div><p>${checkField('El perito autoriza expresamente incluir su firma en el informe público', 'signature.consent_public')}</p><p class="inspection-help">Sin esta autorización la firma se conserva únicamente en el informe interno.</p></div></div></details>`;
  $('inspectionForm').insertAdjacentHTML('beforeend', auditMarkup());
  if (detailStates) for (const [id, open] of detailStates) { const section = $(id); if (section) section.open = open; }
  $('inspectionForm').querySelectorAll('.inspection-item-notes textarea').forEach(resizeObservation);
  initSignature();
  updateProgress();
  renderActions();
  renderHistory();
}

function updateProgress() {
  if (!state.row) return;
  const config = configForRow();
  const doc = state.row.document;
  const score = scoreInspection(doc.answers || {}, config);
  const finalErrors = validateDocument(doc, { final: true, allowNA: state.capabilities.can_na || state.row.status !== 'draft', config });
  let completeTotal = 0;
  for (const category of config.categories) {
    const complete = category.items.filter((item) => !finalErrors.some((error) => String(error.path).startsWith(`answers.${item.id}`))).length;
    completeTotal += complete;
    const subtotal = score.categories.find((entry) => entry.id === category.id);
    const summary = document.querySelector(`[data-category-summary="${category.id}"]`);
    if (summary) summary.textContent = `${complete}/${category.items.length} completos · ${category.items.length - complete} pendientes`;
    const progress = document.querySelector(`[data-category-progress="${category.id}"]`);
    if (progress) progress.value = complete;
    const points = document.querySelector(`[data-category-points="${category.id}"]`);
    if (points) points.textContent = subtotal?.non_evaluable ? 'No evaluable · revisar' : subtotal?.complete && complete === category.items.length ? `${pretty(subtotal.points)} / ${pretty(category.max)} pts` : `Máx. ${pretty(category.max)} pts`;
  }
  const count = config.categories.reduce((total, category) => total + category.items.length, 0);
  $('scoreSummary').innerHTML = score.complete && completeTotal === count ? `<div class="inspection-score">${pretty(score.nota_10)} <small>/ 10</small></div><small>${pretty(score.total_100)} / 100 puntos</small>` : `<div class="inspection-score-pending">Sin nota definitiva</div><small>${completeTotal}/${count} componentes completos</small>`;
}

function auditMarkup() {
  const labels = { create: 'Creación', save: 'Guardado', transition: 'Cambio de estado', superseded: 'Reemplazado por otro informe', add_evidence: 'Evidencia agregada', update_evidence: 'Evidencia actualizada', delete_evidence: 'Evidencia eliminada' };
  const entries = state.row.audit || [];
  return `<details class="inspection-section" id="auditSection"><summary><span>Registro de actividad<small>${entries.length} acciones · historial del servidor</small></span></summary><div class="inspection-section-body">${entries.length ? `<ol class="inspection-audit">${entries.map((entry) => `<li><strong>${esc(labels[entry.action] || entry.action)}</strong>${entry.to_status ? ` · ${esc(statusLabels[entry.to_status] || entry.to_status)}` : ''}<br><small>${esc(entry.created_at ? new Date(entry.created_at).toLocaleString('es-AR') : 'Sin fecha')} · revisión ${esc(entry.revision)}<br>Usuario: ${esc(entry.actor_id || '—')}</small></li>`).join('')}</ol>` : '<p class="inspection-help">Sin actividad disponible.</p>'}</div></details>`;
}

function renderActions() {
  if (!state.row) return;
  const moreOpen = $('inspectionMoreActions')?.open === true;
  const disabled = state.busy ? 'disabled' : '';
  const status = state.row.status;
  $('reportActions').classList.toggle('is-readonly', status !== 'draft');
  let primary = '';
  let secondary = '';
  if (status === 'draft' && state.capabilities.can_edit) primary += `<button type="button" class="btn btn-primary" data-action="save" ${disabled}>Guardar borrador</button><button type="button" class="btn btn-ghost" data-action="review" ${disabled}>Enviar a revisión</button>`;
  if (status === 'in_review' && state.capabilities.can_approve) primary += `<button type="button" class="btn btn-primary" data-action="approve" ${disabled}>Aprobar informe</button>`;
  if (status === 'approved' && state.capabilities.can_approve) primary += `<button type="button" class="btn btn-primary" data-action="publish" ${disabled}>Publicar como vigente</button>`;
  if (status === 'in_review' && state.capabilities.can_edit) secondary += `<button type="button" class="btn btn-ghost" data-action="draft" ${disabled}>Devolver a borrador</button>`;
  if (['approved', 'published'].includes(status) && state.capabilities.can_approve) secondary += `<button type="button" class="btn btn-ghost" data-action="archive" ${disabled}>Archivar informe</button>`;
  secondary += `<button type="button" class="btn btn-ghost" data-action="preview-internal" ${disabled}>Previsualizar interno</button><button type="button" class="btn btn-ghost" data-action="pdf-internal" ${disabled}>PDF interno</button><button type="button" class="btn btn-ghost" data-action="refresh" ${disabled}>Actualizar datos / fotos</button>`;
  if (['approved', 'published', 'archived'].includes(status) && state.row.scoring_snapshot) secondary += `<button type="button" class="btn btn-ghost" data-action="preview-public" ${disabled}>Previsualizar público</button><button type="button" class="btn btn-ghost" data-action="pdf-public" ${disabled}>PDF público</button>`;
  if (state.dirty) secondary += `<button type="button" class="btn btn-ghost" data-action="discard-reload" ${disabled}>Descartar cambios y recargar</button>`;
  $('reportActions').innerHTML = `<span class="inspection-save-status" aria-live="polite">${state.busy ? 'Procesando…' : state.dirty ? 'Cambios sin guardar' : 'Guardado'}</span>${primary}<details class="inspection-more-actions" id="inspectionMoreActions" ${moreOpen ? 'open' : ''}><summary>Más opciones</summary><div class="inspection-action-menu">${secondary}</div></details>`;
}

function changed() {
  state.dirty = true;
  updateProgress();
  renderActions();
}

async function loadHistory() {
  state.history = await request('list', { vehicle_id: state.vehicleId });
  if (!Array.isArray(state.history)) state.history = [];
  renderHistory();
}

async function saveDraft() {
  const errors = validateDocument(state.row.document, { final: false, allowNA: state.capabilities.can_na, config: configForRow() });
  if (errors.length) { showErrors(errors); throw new Error('El borrador contiene valores inválidos. Corregilos para guardar.'); }
  const row = await request('save', { id: state.row.id, revision: state.row.revision, document: state.row.document });
  state.row = row;
  for (const [evidenceId, edit] of state.evidenceEdits) {
    state.row = await request('update_evidence', { id: state.row.id, revision: state.row.revision, evidence_id: evidenceId, ...edit });
    state.evidenceEdits.delete(evidenceId);
  }
  state.dirty = false;
  showErrors([]);
  await loadHistory();
  notify('Borrador guardado.');
}

async function transition(status) {
  if (status === 'in_review') {
    const errors = validateDocument(state.row.document, { final: true, allowNA: state.capabilities.can_na, config: configForRow() });
    if (errors.length) { showErrors(errors); throw new Error('Completá la inspección y los dictámenes antes de enviar a revisión.'); }
    if (state.dirty) await saveDraft();
  }
  state.row = await request('transition', { id: state.row.id, revision: state.row.revision, status });
  state.dirty = false;
  showErrors([]);
  await loadHistory();
  notify(`Informe: ${statusLabels[status]}.`);
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function initSignature() {
  const canvas = $('signatureCanvas');
  const context = canvas?.getContext('2d');
  if (!context) return;
  context.strokeStyle = '#1f2937'; context.lineWidth = 2.3; context.lineCap = 'round'; context.lineJoin = 'round';
  const source = state.row.document.signature?.image_data_url;
  if (source && /^data:image\/png;base64,/.test(source)) {
    const img = new Image();
    img.onload = () => { if (canvas.isConnected && canvas.dataset.signatureTouched !== 'true' && state.row?.document.signature?.image_data_url === source) context.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.src = source;
  }
  if (!editable()) return;
  let drawing = false;
  let moved = false;
  const point = (event) => { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]; };
  canvas.addEventListener('pointerdown', (event) => { if (!editable()) return; event.preventDefault(); canvas.dataset.signatureTouched = 'true'; drawing = true; moved = false; canvas.setPointerCapture(event.pointerId); context.beginPath(); context.moveTo(...point(event)); });
  canvas.addEventListener('pointermove', (event) => { if (!drawing) return; context.lineTo(...point(event)); context.stroke(); moved = true; });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    if (!moved) return;
    state.row.document.signature ||= {};
    state.row.document.signature.image_data_url = canvas.toDataURL('image/png');
    if (!state.row.document.signature.signed_at) { state.row.document.signature.signed_at = localDate(); const date = $('field-signature-signed_at'); if (date) date.value = state.row.document.signature.signed_at; }
    changed();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}

async function uploadEvidence(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024 || !file.size) throw new Error('La foto debe ser JPG, PNG o WebP y pesar hasta 8 MB.');
  if (state.dirty) await saveDraft();
  const form = new FormData();
  form.set('action', 'upload_evidence'); form.set('id', state.row.id); form.set('revision', String(state.row.revision)); form.set('item_id', input.dataset.upload); form.set('file', file); form.set('approved_public', 'false');
  state.row = await request('upload_evidence', {}, form);
  await loadHistory();
  notify('Evidencia privada agregada. Un administrador puede aprobar su publicación.');
}

async function importSignature(file) {
  if (!file || file.type !== 'image/png' || file.size > 150 * 1024) throw new Error('La firma debe ser una imagen PNG de hasta 150 KB.');
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No se pudo leer la firma.')); reader.readAsDataURL(file); });
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = $('signatureCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  ctx.drawImage(image, (canvas.width - image.width * scale) / 2, (canvas.height - image.height * scale) / 2, image.width * scale, image.height * scale);
  state.row.document.signature ||= {};
  state.row.document.signature.image_data_url = canvas.toDataURL('image/png');
  state.row.document.signature.signed_at ||= localDate();
  changed();
}

function preview(internal) {
  const report = internal ? internalReport(state.row, state.row.evidence || []) : publicReport(state.row, state.row.evidence || [], { preview: true });
  if (!report) throw new Error('El informe público solo está disponible después de la aprobación.');
  const doc = internal ? state.row.document : report;
  const config = configForRow();
  const answers = doc.answers || report.answers || {};
  const score = report.scoring || report.score || state.row.scoring_snapshot?.score || scoreInspection(state.row.document.answers, config);
  const vehicle = doc.vehicle || {};
  $('previewTitle').textContent = internal ? 'Previsualización interna · datos privados' : 'Previsualización del informe público';
  const parts = [`<p><strong>FICHA DE PERITAJE · RG CARS TDF S.R.L.</strong><br>${esc(doc.locality)} · ${dateLabel(doc.inspection_date)}<br>Folio ${esc(state.row.id)} · ${esc(statusLabels[state.row.status])}</p><p>${esc([vehicle.brand, vehicle.model, vehicle.version, vehicle.year].filter(Boolean).join(' · '))}<br>Dominio ${esc(vehicle.plate || '—')} · ${esc(vehicle.km ?? '—')} km</p>`];
  if (internal) parts.push(`<p><strong>Propietario · privado</strong><br>${esc(doc.owner?.name)} · ${esc(doc.owner?.phone)} · ${esc(doc.owner?.email)}</p>`);
  if (doc.inspector_name) parts.push(`<p>Perito: ${esc(doc.inspector_name)}</p>`);
  parts.push(`<p><strong>${score.complete ? `${pretty(score.nota_10)} / 10` : 'Sin nota definitiva'}</strong> · Estado: ${esc(doc.fitness || 'Pendiente')} · Riesgo: ${esc(doc.risk || 'Pendiente')}</p>`);
  for (const category of config.categories) {
    const reportCategory = report.categories?.find((entry) => entry.id === category.id);
    parts.push(`<h3>${esc(category.label)}</h3><table><thead><tr><th>Componente</th><th>Estado</th><th>Hallazgos y detalle</th></tr></thead><tbody>${category.items.map((item) => {
      const answer = answers[item.id] || reportCategory?.items?.find((entry) => entry.id === item.id) || {};
      const value = answer.value || {};
      const details = [answer.na_reason, answer.notes, value.detail, value.zone, value.brand && `Marca: ${value.brand}`, value.size && `Medida: ${value.size}`, value.percent != null && `${item.unit || 'Porcentaje'}: ${value.percent}%`, value.wear_percent != null && `Desgaste: ${value.wear_percent}%`, value.depth_mm != null && `Profundidad: ${value.depth_mm} mm`, value.findings?.join(', ')].filter(Boolean);
      return `<tr><td>${esc(item.label)}</td><td>${esc(ratingLabel(answer.rating, item, answer.value))}</td><td>${details.map(esc).join('<br>') || '—'}</td></tr>`;
    }).join('')}</tbody></table>`);
  }
  parts.push(`<h3>Dictamen y observaciones</h3><p>${esc(doc.verdict_reason)}</p><p>${esc(doc.observations || 'Sin observaciones generales.')}</p>`);
  if (internal) parts.push(`<h3>Notas internas privadas</h3><p>${esc(doc.internal_notes || 'Sin notas internas.')}</p>`);
  const signature = doc.signature;
  if (signature) parts.push(`<p>Firma electrónica simple, no certificada · ${esc(signature.name || '')} · ${dateLabel(signature.signed_at)}</p>${/^data:image\/png;base64,/.test(signature.image_data_url || '') ? `<img class="inspection-preview-signature" src="${esc(signature.image_data_url)}" alt="Firma electrónica del perito" />` : ''}`);
  const evidence = internal ? state.row.evidence || [] : report.evidence || [];
  parts.push(`<h3>Evidencias ${internal ? 'internas' : 'aprobadas'}</h3><div class="inspection-preview-evidence">${evidence.map((entry) => { const url = safeImageUrl(entry.signed_url || entry.url); return url ? `<figure><img src="${esc(url)}" alt="${esc(entry.caption || 'Evidencia del componente')}" /><figcaption>${esc(entry.caption)}</figcaption></figure>` : ''; }).join('')}</div><p class="inspection-help">Peritaje realizado el ${dateLabel(doc.inspection_date)}. Describe el estado observado en esa fecha; no constituye una garantía absoluta.</p>`);
  $('previewContent').innerHTML = parts.join('');
  $('previewDialog').showModal();
}

async function refreshReportEvidence() {
  // Signed Storage URLs are temporary. Refresh them at export time without
  // replacing a locally edited document or advancing its optimistic revision.
  const fresh = await request('get', { id: state.row.id });
  if (!state.dirty) { state.row = fresh; return; }
  const freshById = new Map((fresh.evidence || []).map((entry) => [entry.id, entry]));
  state.row = {
    ...state.row,
    evidence: (state.row.evidence || []).flatMap((entry) => {
      const latest = freshById.get(entry.id);
      return latest ? [{ ...entry, ...latest, ...state.evidenceEdits.get(entry.id) }] : [];
    }),
  };
}

async function exportPdf(internal) {
  const report = internal ? internalReport(state.row, state.row.evidence || []) : publicReport(state.row, state.row.evidence || [], { preview: true });
  const result = await downloadInspectionPdf(report, { internal, preview: !internal && state.row.status !== 'published' });
  if (result?.missingEvidence > 0) notify(`PDF descargado con ${result.missingEvidence} fotografías no disponibles; reintentá para incorporarlas.`, true);
  else notify(`PDF ${internal ? 'interno' : 'público'} descargado.`);
}

async function handleAction(action) {
  if (action === 'discard-reload') {
    if (!window.confirm('Se descartarán los cambios sin guardar de esta pantalla y se abrirá la versión del servidor. ¿Continuar?')) return;
    const freshRow = await request('get', { id: state.row.id });
    state.row = freshRow;
    state.dirty = false;
    state.evidenceEdits.clear();
    showErrors([]);
    await loadHistory();
    notify('Se cargó la versión guardada en el servidor.');
    return;
  }
  if (action === 'refresh') {
    if (state.dirty) throw new Error('Guardá el borrador antes de actualizar los datos del servidor.');
    state.row = await request('get', { id: state.row.id });
    await loadHistory();
    notify('Datos y enlaces temporales de las fotos actualizados.');
    return;
  }
  if (action === 'save') return saveDraft();
  if (action === 'review') return transition('in_review');
  if (action === 'draft') return transition('draft');
  if (action === 'approve') return transition('approved');
  if (action === 'publish') return transition('published');
  if (action === 'archive') return transition('archived');
  if (['preview-internal', 'preview-public', 'pdf-internal', 'pdf-public'].includes(action)) {
    await refreshReportEvidence();
    if (action === 'preview-internal') return preview(true);
    if (action === 'preview-public') return preview(false);
    return exportPdf(action === 'pdf-internal');
  }
}

function bindEvents() {
  window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  $('inspectionForm').addEventListener('submit', (event) => event.preventDefault());
  $('inspectionForm').addEventListener('click', (event) => {
    const clear = event.target.closest('[data-clear-rating]');
    if (!clear || !editable()) return;
    const itemId = clear.dataset.clearRating;
    setPath(state.row.document, `answers.${itemId}.rating`, null);
    syncItemRating(itemId);
    changed();
    $(`item-${itemId}`).querySelector('input[type="radio"]')?.focus();
  });
  $('inspectionForm').addEventListener('toggle', (event) => {
    if (event.target.open) event.target.querySelectorAll('.inspection-item-notes textarea').forEach(resizeObservation);
  }, true);
  $('inspectionForm').addEventListener('input', (event) => {
    if (!editable()) return;
    const input = event.target;
    if (input.dataset.percentageNa) {
      const itemId = input.dataset.percentageNa;
      setPath(state.row.document, `answers.${itemId}.rating`, input.checked ? 'NA' : null);
      syncItemRating(itemId);
      changed();
      return;
    }
    if (input.dataset.path) {
      if (input.type === 'radio' && !input.checked) return;
      let value = input.type === 'checkbox' ? input.checked : input.value;
      if (input.type === 'number') value = input.value === '' ? null : input.valueAsNumber;
      if (input.dataset.path.endsWith('.rating') || ['fitness', 'risk'].includes(input.dataset.path)) value ||= null;
      setPath(state.row.document, input.dataset.path, value);
      if (input.dataset.path.endsWith('.rating')) {
        const itemId = input.dataset.path.split('.')[1];
        syncItemRating(itemId);
      }
      if (input.dataset.path.endsWith('.percent')) {
        const output = document.querySelector(`[data-paint-output="${input.dataset.path.split('.')[1]}"]`);
        if (output) output.textContent = Number.isFinite(value) && value >= 0 && value <= 100 ? pretty(100 - value) : '—';
      }
      resizeObservation(input);
      changed();
    }
    if (input.dataset.finding) {
      const itemId = input.dataset.item;
      const findings = [...document.querySelectorAll(`[data-finding][data-item="${itemId}"]:checked`)].map((checkbox) => checkbox.dataset.finding);
      setPath(state.row.document, `answers.${itemId}.value.findings`, findings);
      changed();
    }
    const evidenceId = input.dataset.evidenceCaption || input.dataset.evidencePublic;
    if (evidenceId) {
      const entry = state.row.evidence.find((candidate) => candidate.id === evidenceId);
      const prior = state.evidenceEdits.get(evidenceId) || { caption: entry?.caption || '', approved_public: !!entry?.approved_public };
      state.evidenceEdits.set(evidenceId, { ...prior, ...(input.dataset.evidenceCaption ? { caption: input.value } : { approved_public: input.checked }) });
      changed();
    }
  });
  $('inspectionForm').addEventListener('change', (event) => {
    if (!editable()) return;
    if (event.target.dataset.upload) void operation(() => uploadEvidence(event.target));
    if (event.target.id === 'signatureFile') void operation(() => importSignature(event.target.files?.[0]));
  });
  $('historySelect')?.addEventListener('change', (event) => {
    const select = event.currentTarget;
    const id = select.value;
    if (state.busy || id === state.row?.id || !state.history.some((row) => row.id === id)) { select.value = state.row?.id || ''; return; }
    if (state.dirty) { select.value = state.row?.id || ''; notify('Hay cambios sin guardar. Guardá el borrador antes de abrir otro informe.', true); return; }
    void operation(async () => {
      state.row = await request('get', { id });
      state.evidenceEdits.clear();
      showErrors([]);
      notify('');
    });
  });
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) { void operation(() => handleAction(action)); return; }
    const deleteEvidenceButton = event.target.closest('[data-delete-evidence]');
    if (deleteEvidenceButton) void operation(async () => {
      if (state.dirty) await saveDraft();
      state.row = await request('delete_evidence', { id: state.row.id, revision: state.row.revision, evidence_id: deleteEvidenceButton.dataset.deleteEvidence });
      await loadHistory(); notify('Foto eliminada del borrador.');
    });
    if (event.target.closest('#clearSignature') && editable()) {
      const canvas = $('signatureCanvas'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      state.row.document.signature ||= {}; state.row.document.signature.image_data_url = ''; changed();
    }
    const errorLink = event.target.closest('[data-error-path]');
    if (errorLink) {
      event.preventDefault();
      const path = errorLink.dataset.errorPath;
      const input = [...$('inspectionForm').querySelectorAll('[data-path]')].find((field) => field.dataset.path === path);
      const item = errorLink.dataset.errorItem ? $(`item-${errorLink.dataset.errorItem}`) : null;
      const typedFields = path.startsWith('answers.') && path.includes('.value') ? item?.querySelector('[data-typed-fields]') : null;
      const group = path.startsWith('signature') ? $('signatureCanvas') || $('verdictSection')
        : path.startsWith('owner') ? $('ownerSection')
          : path.startsWith('categories.') ? $(`section-${path.split('.')[1]}`)
            : path === 'answers' ? $(`section-${configForRow().categories[0].id}`)
              : ['fitness', 'risk', 'verdict_reason', 'observations', 'internal_notes'].includes(path) ? $('verdictSection') : $('generalSection');
      const target = input || typedFields || item || group;
      if (!target) return;
      for (let parent = target; parent && parent !== $('inspectionForm'); parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        if (parent.hasAttribute('hidden')) parent.hidden = false;
      }
      // Invalid measurements remain editable even if N/A was selected later.
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
      const focusTarget = input || (path.startsWith('signature') ? $('signatureFile') : target.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)'));
      focusTarget?.focus({ preventScroll: true });
    }
  });
  $('newInspection').addEventListener('click', () => {
    if (state.dirty) { notify('Guardá el borrador actual antes de crear otro informe.', true); return; }
    void operation(async () => { state.row = await request('create', { vehicle_id: state.vehicleId }); state.dirty = false; await loadHistory(); showErrors([]); notify('Borrador creado con los datos actuales del vehículo. Todos los componentes están pendientes de evaluación.'); });
  });
  $('closePreview').addEventListener('click', () => $('previewDialog').close());
}

async function init() {
  if (!window.supabase?.createClient || !window.RG?.SUPABASE_URL) throw new Error('No se pudo cargar la conexión al administrador. Recargá la página.');
  state.client = window.supabase.createClient(window.RG.SUPABASE_URL, window.RG.SUPABASE_ANON_KEY);
  const { data, error } = await state.client.auth.getSession();
  if (error) throw error;
  if (!data.session) { window.location.href = './login.html'; return; }
  $('sessionEmail').textContent = data.session.user?.email || 'Email no disponible';
  $('sessionIdentity').hidden = false;
  state.vehicleId = new URLSearchParams(window.location.search).get('vehicle_id') || '';
  if (!state.vehicleId) throw new Error('Abrí Peritaje desde la ficha de un vehículo del administrador.');
  state.capabilities = { ...state.capabilities, ...await request('capabilities') };
  $('sessionRole').textContent = state.capabilities.can_approve ? 'Administrador' : state.capabilities.can_edit ? 'Inspector' : 'Sin acceso a peritajes';
  if (!state.capabilities.can_edit && !state.capabilities.can_approve) throw new Error('Tu usuario no está habilitado para consultar peritajes. Solicitá acceso al administrador.');
  const vehicleResult = await state.client.from('vehicles').select('*').eq('id', state.vehicleId).single();
  if (vehicleResult.error || !vehicleResult.data) throw new Error('No se pudo cargar el vehículo vinculado.');
  state.vehicle = vehicleResult.data;
  $('vehicleTitle').textContent = state.vehicle.title || [state.vehicle.brand, state.vehicle.model].filter(Boolean).join(' ') || 'Vehículo';
  $('vehicleMeta').textContent = [state.vehicle.plate, state.vehicle.year, state.vehicle.km != null ? `${pretty(state.vehicle.km)} km` : ''].filter(Boolean).join(' · ');
  $('vehiclePublicLink').href = `../vehicle.html?id=${encodeURIComponent(state.vehicleId)}`;
  $('vehiclePublicLink').hidden = false;
  $('newInspection').hidden = !state.capabilities.can_edit;
  bindEvents();
  await loadHistory();
  const requestedId = new URLSearchParams(window.location.search).get('inspection_id');
  const selected = requestedId && state.history.find((entry) => entry.id === requestedId) || state.history.find((entry) => entry.status === 'draft') || state.history[0];
  if (selected) { state.row = await request('get', { id: selected.id }); renderEditor(); }
}

init().catch((error) => { $('historyList').textContent = 'No se pudo cargar el historial.'; $('vehicleMeta').textContent = 'Peritajes'; if ($('sessionRole').textContent === 'Verificando acceso…') $('sessionRole').textContent = 'Acceso no verificado'; notify(error.message || 'No se pudo iniciar el módulo de peritajes.', true); });
