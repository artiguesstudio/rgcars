import { CONFIG, deepFreeze } from './config.mjs';
export { CONFIG };

const RATINGS = ['B', 'R', 'M', 'NA'];
const TYPES = ['state', 'windshield', 'percentage', 'damage', 'tire'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasValue = value => value !== null && value !== undefined && value !== '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => JSON.parse(JSON.stringify(value));
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const itemsOf = config => config.categories.flatMap(category => category.items);

/** Missing scoring metadata preserves the rating scale stored by legacy snapshots. */
export const usesPercentageScore = item => item?.scoring === 'percentage';

export function validateConfig(config) {
  if (!isObject(config) || !Array.isArray(config.categories) || config.categories.length !== 8) throw new Error('La configuración requiere ocho categorías.');
  if (!clean(config.version) || !clean(config.scale_version)) throw new Error('Falta la versión de configuración.');
  if (!isObject(config.factors) || ['B', 'R', 'M'].some(key => !finite(config.factors[key]) || config.factors[key] < 0 || config.factors[key] > 1)) throw new Error('Escala inválida.');
  const items = itemsOf(config);
  if (items.length !== 83 || new Set(items.map(item => item.id)).size !== 83) throw new Error('La configuración requiere 83 identificadores únicos.');
  if (new Set(config.categories.map(category => category.id)).size !== 8 || config.categories.some(category => !finite(category.max) || category.max <= 0) || Math.abs(config.categories.reduce((sum, category) => sum + category.max, 0) - 100) > 1e-10) throw new Error('Los ocho topes deben sumar 100.');
  if (items.some(item => !finite(item.weight) || item.weight <= 0 || !TYPES.includes(item.type) || !clean(item.label))) throw new Error('Ítem o ponderación inválidos.');
  if (items.some(item => item.scoring !== undefined && (item.scoring !== 'percentage' || item.type !== 'percentage'))) throw new Error('Criterio de puntuación inválido.');
  if (items.some(item => item.details_required !== undefined && (typeof item.details_required !== 'boolean' || item.type !== 'tire'))) throw new Error('Requisito de detalles inválido.');
  return config;
}

function textField(errors, value, path, { required = false, max = 2000 } = {}) {
  if (value !== undefined && value !== null && typeof value !== 'string') errors.push({ path, message: 'Debe ser texto.' });
  else if (typeof value === 'string' && (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) errors.push({ path, message: `Texto inválido o mayor a ${max} caracteres.` });
  if (required && !clean(value)) errors.push({ path, message: 'Completá este campo.' });
}

function numericField(errors, value, path, { required = false, min = 0, max = Infinity } = {}) {
  if (hasValue(value) && (!finite(value) || value < min || value > max)) errors.push({ path, message: `Ingresá un número entre ${min} y ${max === Infinity ? 'un valor válido' : max}.` });
  if (required && !hasValue(value)) errors.push({ path, message: 'Completá la medición.' });
}

function knownKeys(errors, object, keys, path) {
  if (!isObject(object)) { errors.push({ path, message: 'Formato inválido.' }); return false; }
  for (const key of Object.keys(object)) if (!keys.includes(key)) errors.push({ path: `${path}.${key}`, message: 'Campo no reconocido.' });
  return true;
}

export function validateAnswer(answer, item, { final = false, allowNA = true } = {}) {
  const errors = [];
  const path = `answers.${item.id}`;
  if (!isObject(answer)) return final ? [{ path, message: 'Ítem pendiente.' }] : (answer == null ? [] : [{ path, message: 'Formato de respuesta inválido.' }]);
  knownKeys(errors, answer, ['rating', 'na_reason', 'notes', 'value'], path);
  const rating = answer.rating ?? null;
  if (rating !== null && !RATINGS.includes(rating)) errors.push({ path: `${path}.rating`, message: 'Valoración inválida.' });
  if (final && rating === null && !usesPercentageScore(item)) errors.push({ path: `${path}.rating`, message: 'Valoración pendiente.' });
  textField(errors, answer.notes, `${path}.notes`);
  textField(errors, answer.na_reason, `${path}.na_reason`, { required: final && rating === 'NA', max: 1000 });
  if (rating === 'NA' && !allowNA) errors.push({ path: `${path}.rating`, message: 'No tenés permiso para usar No aplica.' });
  const required = final && rating !== 'NA';
  const value = answer.value ?? {};
  const fields = { state: [], windshield: ['findings'], percentage: ['percent'], damage: ['detail', 'zone'], tire: ['brand', 'size', 'wear_percent', 'depth_mm'] };
  if (!knownKeys(errors, value, fields[item.type] || [], `${path}.value`)) return errors;
  if (item.type === 'windshield') {
    const findings = value.findings;
    if (findings !== undefined && (!Array.isArray(findings) || findings.some(entry => !['Sin daños', 'Fisuras', 'Impactos'].includes(entry)) || new Set(findings).size !== findings.length || (findings.includes('Sin daños') && findings.length > 1))) errors.push({ path: `${path}.value.findings`, message: 'Elegí Sin daños o uno o varios hallazgos, sin combinarlos con Sin daños.' });
    if (required && (!Array.isArray(findings) || !findings.length)) errors.push({ path: `${path}.value.findings`, message: 'Indicá el estado del parabrisas.' });
  }
  if (item.type === 'percentage') numericField(errors, value.percent, `${path}.value.percent`, { required, max: 100 });
  if (item.type === 'damage') {
    textField(errors, value.detail, `${path}.value.detail`, { required });
    textField(errors, value.zone, `${path}.value.zone`, { required: required && item.id === 'exterior-golpes', max: 300 });
  }
  if (item.type === 'tire') {
    const detailsRequired = required && item.details_required !== false;
    textField(errors, value.brand, `${path}.value.brand`, { required: detailsRequired, max: 100 });
    textField(errors, value.size, `${path}.value.size`, { required: detailsRequired, max: 100 });
    numericField(errors, value.wear_percent, `${path}.value.wear_percent`, { required: detailsRequired, max: 100 });
    numericField(errors, value.depth_mm, `${path}.value.depth_mm`, { required: detailsRequired });
  }
  return errors;
}

export function isAnswerComplete(answer, item, { allowNA = true } = {}) {
  return validateAnswer(answer, item, { final: true, allowNA }).length === 0;
}

/** No rounding occurs here. Pending and invalid responses never produce a final score. */
export function scoreInspection(answers = {}, config = CONFIG) {
  validateConfig(config);
  const errors = [];
  if (!isObject(answers)) { errors.push({ path: 'answers', message: 'Formato de respuestas inválido.' }); answers = {}; }
  const known = new Set(itemsOf(config).map(item => item.id));
  for (const id of Object.keys(answers)) if (!known.has(id)) errors.push({ path: `answers.${id}`, message: 'Ítem no reconocido.' });
  const categories = config.categories.map(category => {
    let denominator = 0, numerator = 0, pending = 0;
    for (const item of category.items) {
      const answer = answers[item.id];
      const issues = validateAnswer(answer, item, { final: true, allowNA: config.allow_na !== false });
      errors.push(...issues);
      const excluded = answer?.rating === 'NA' && issues.length === 0;
      if (!excluded) denominator += item.weight;
      if (issues.length) pending++;
      else if (!excluded) numerator += item.weight * (usesPercentageScore(item) ? answer.value.percent / 100 : config.factors[answer.rating]);
    }
    const non_evaluable = denominator === 0;
    const complete = pending === 0 && !non_evaluable;
    return { id: category.id, label: category.label, max: category.max, denominator, numerator,
      points: complete ? category.max * numerator / denominator : null,
      complete, pending, non_evaluable, evaluated: category.items.length - pending, count: category.items.length };
  });
  const complete = !errors.length && categories.every(category => category.complete);
  const total_100 = complete ? Math.min(100, Math.max(0, categories.reduce((sum, category) => sum + category.points, 0))) : null;
  return { complete, total_100, nota_10: total_100 === null ? null : total_100 / 10, categories, errors };
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

function validSignedAt(value) {
  return typeof value === 'string' && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(value)
    && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

export function validateDocument(document, { final = false, allowNA = true, config = CONFIG } = {}) {
  const errors = [];
  if (!knownKeys(errors, document, ['inspection_date', 'locality', 'owner', 'vehicle', 'inspector_name', 'show_inspector', 'observations', 'internal_notes', 'fitness', 'risk', 'verdict_reason', 'signature', 'answers'], 'document')) return errors;
  textField(errors, document.locality, 'locality', { required: final, max: 200 });
  if ((hasValue(document.inspection_date) && !validDate(document.inspection_date)) || (final && !hasValue(document.inspection_date))) errors.push({ path: 'inspection_date', message: 'Ingresá una fecha de inspección válida.' });
  if (knownKeys(errors, document.owner ?? {}, ['name', 'phone', 'email'], 'owner')) {
    for (const key of ['name', 'phone', 'email']) textField(errors, document.owner?.[key], `owner.${key}`, { max: 200 });
    if (clean(document.owner?.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.owner.email)) errors.push({ path: 'owner.email', message: 'Email inválido.' });
  }
  if (knownKeys(errors, document.vehicle ?? {}, ['brand', 'model', 'version', 'plate', 'km', 'year'], 'vehicle')) {
    for (const key of ['brand', 'model', 'version', 'plate']) textField(errors, document.vehicle?.[key], `vehicle.${key}`, { required: final && ['brand', 'version', 'plate'].includes(key), max: 200 });
    numericField(errors, document.vehicle?.km, 'vehicle.km', { required: final });
    numericField(errors, document.vehicle?.year, 'vehicle.year', { min: 1886, max: 2200 });
  }
  textField(errors, document.inspector_name, 'inspector_name', { required: final, max: 200 });
  textField(errors, document.observations, 'observations', { max: 8000 });
  textField(errors, document.internal_notes, 'internal_notes', { max: 8000 });
  textField(errors, document.verdict_reason, 'verdict_reason', { required: final, max: 4000 });
  for (const [key, values] of [['fitness', ['Apto', 'No apto']], ['risk', ['Bajo', 'Medio', 'Alto']]]) {
    if ((hasValue(document[key]) && !values.includes(document[key])) || (final && !values.includes(document[key]))) errors.push({ path: key, message: 'El perito debe emitir este dictamen explícitamente.' });
  }
  if (document.show_inspector !== undefined && typeof document.show_inspector !== 'boolean') errors.push({ path: 'show_inspector', message: 'Autorización inválida.' });
  const signature = document.signature ?? {};
  if (knownKeys(errors, signature, ['name', 'signed_at', 'consent_public', 'image_data_url'], 'signature')) {
    textField(errors, signature.name, 'signature.name', { required: final, max: 200 });
    if (hasValue(signature.signed_at) && !validSignedAt(signature.signed_at)) errors.push({ path: 'signature.signed_at', message: 'Fecha de conformidad inválida.' });
    else if (final && !hasValue(signature.signed_at)) errors.push({ path: 'signature.signed_at', message: 'Falta fecha de conformidad.' });
    if (signature.consent_public !== undefined && typeof signature.consent_public !== 'boolean') errors.push({ path: 'signature.consent_public', message: 'Consentimiento inválido.' });
    const png = signature.image_data_url;
    if (hasValue(png) && (typeof png !== 'string' || png.length > 200000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png))) errors.push({ path: 'signature.image_data_url', message: 'La firma debe ser una imagen PNG de hasta 150 KB.' });
    else if (final && !hasValue(png)) errors.push({ path: 'signature.image_data_url', message: 'Capturá la firma electrónica del perito.' });
  }
  if (!isObject(document.answers)) errors.push({ path: 'answers', message: 'Formato de respuestas inválido.' });
  else {
    const items = itemsOf(config);
    const known = new Set(items.map(item => item.id));
    for (const key of Object.keys(document.answers)) if (!known.has(key)) errors.push({ path: `answers.${key}`, message: 'Ítem no reconocido.' });
    for (const item of items) errors.push(...validateAnswer(document.answers[item.id], item, { final, allowNA: allowNA && config.allow_na !== false }));
    if (final) for (const category of scoreInspection(document.answers, config).categories) if (category.non_evaluable) errors.push({ path: `categories.${category.id}`, message: 'Categoría no evaluable: requiere revisión manual. No se redistribuyen sus puntos.' });
  }
  return errors;
}

export function createDocument(vehicle = {}) {
  const optionalNumber = value => hasValue(value) && Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    inspection_date: '', locality: 'Río Grande, Tierra del Fuego',
    owner: { name: '', phone: '', email: '' },
    vehicle: { brand: clean(vehicle.brand), model: clean(vehicle.model), version: clean(vehicle.version || vehicle.model || vehicle.title), plate: clean(vehicle.plate), km: optionalNumber(vehicle.km), year: optionalNumber(vehicle.year) },
    inspector_name: '', show_inspector: false, observations: '', internal_notes: '',
    fitness: null, risk: null, verdict_reason: '',
    signature: { name: '', signed_at: '', consent_public: false, image_data_url: '' },
    answers: Object.fromEntries(itemsOf(CONFIG).map(item => [item.id, { rating: null, na_reason: '', notes: '', value: {} }])),
  };
}

export function createSnapshot(document, config = CONFIG) {
  const errors = validateDocument(document, { final: true, config });
  if (errors.length) { const error = new Error('El peritaje está incompleto o es inválido.'); error.details = errors; throw error; }
  return deepFreeze(clone({ version: config.version, config, answers: document.answers, score: scoreInspection(document.answers, config) }));
}

export function authorize(capabilities = {}, action) {
  if (action === 'public') return true;
  if (['approve', 'publish', 'archive'].includes(action)) return capabilities.can_approve === true;
  if (['create', 'save', 'upload_evidence', 'delete_evidence', 'update_evidence', 'review', 'return_draft'].includes(action)) return capabilities.can_edit === true;
  if (['capabilities', 'get', 'list'].includes(action)) return capabilities.can_edit === true || capabilities.can_approve === true;
  if (action === 'na') return capabilities.can_edit === true && capabilities.can_na === true;
  return false;
}

export function canTransition(from, to, capabilities = {}) {
  if (to === 'archived') return ['draft', 'in_review', 'approved', 'published'].includes(from) && authorize(capabilities, 'archive');
  const action = { 'draft:in_review': 'review', 'in_review:draft': 'return_draft', 'in_review:approved': 'approve', 'approved:published': 'publish' }[`${from}:${to}`];
  return Boolean(action && authorize(capabilities, action));
}

function answerProjection(answer, item) {
  const value = answer?.value ?? {};
  const projected = {};
  if (item.type === 'windshield') projected.findings = Array.isArray(value.findings) ? value.findings.filter(entry => ['Sin daños', 'Fisuras', 'Impactos'].includes(entry)) : [];
  if (item.type === 'percentage') projected.percent = finite(value.percent) ? value.percent : null;
  if (item.type === 'damage') { projected.detail = clean(value.detail); projected.zone = clean(value.zone); }
  if (item.type === 'tire') { projected.brand = clean(value.brand); projected.size = clean(value.size); projected.wear_percent = finite(value.wear_percent) ? value.wear_percent : null; projected.depth_mm = finite(value.depth_mm) ? value.depth_mm : null; }
  return { rating: RATINGS.includes(answer?.rating) ? answer.rating : null, na_reason: clean(answer?.na_reason), notes: clean(answer?.notes), value: projected };
}

function projectReport(row, evidence, internal) {
  const doc = row.document;
  if (!isObject(doc)) return null;
  const snapshot = row.scoring_snapshot;
  const config = snapshot?.config || CONFIG;
  const answers = snapshot?.answers || doc.answers;
  const score = scoreInspection(answers, config);
  const vehicle = doc.vehicle || {};
  const report = {
    id: String(row.id), vehicle_id: String(row.vehicle_id), revision: row.revision,
    status: row.status, version: snapshot?.version || config.version,
    approved_at: row.approved_at || null, published_at: row.published_at || null,
    inspection_date: clean(doc.inspection_date), locality: clean(doc.locality),
    vehicle: { brand: clean(vehicle.brand), model: clean(vehicle.model), version: clean(vehicle.version), plate: clean(vehicle.plate), km: finite(vehicle.km) ? vehicle.km : null, year: finite(vehicle.year) ? vehicle.year : null },
    observations: clean(doc.observations), fitness: doc.fitness ?? null, risk: doc.risk ?? null, verdict_reason: clean(doc.verdict_reason),
    config: clone(config), answers: Object.fromEntries(itemsOf(config).map(item => [item.id, answerProjection(answers?.[item.id], item)])), score,
    evidence: evidence.filter(entry => internal || entry.approved_public === true).map(entry => ({
      id: String(entry.id), item_id: clean(entry.item_id), caption: clean(entry.caption),
      url: clean(entry.signed_url || entry.url), approved_public: entry.approved_public === true,
    })),
  };
  if (internal || doc.show_inspector === true) { report.inspector_name = clean(doc.inspector_name); report.show_inspector = doc.show_inspector === true; }
  if (internal || doc.signature?.consent_public === true) report.signature = {
    name: clean(doc.signature?.name), signed_at: clean(doc.signature?.signed_at),
    image_data_url: clean(doc.signature?.image_data_url), consent_public: doc.signature?.consent_public === true,
  };
  if (internal) { report.owner = clone(doc.owner || {}); report.internal_notes = clean(doc.internal_notes); }
  return report;
}

/** This is the only public DTO boundary. Never spread a database row into a response. */
export function publicReport(row, evidence = [], { preview = false } = {}) {
  if (!row || !(preview ? ['approved', 'published', 'archived'] : ['published']).includes(row.status) || !row.scoring_snapshot || !row.approved_at) return null;
  const report = projectReport(row, evidence, false);
  if (!report?.score.complete || !['Apto', 'No apto'].includes(report.fitness) || !['Bajo', 'Medio', 'Alto'].includes(report.risk)) return null;
  return report;
}

export function internalReport(row, evidence = []) { return row ? projectReport(row, evidence, true) : null; }
