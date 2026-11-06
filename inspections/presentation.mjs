// Shared report presentation and public-data allowlist. No PDF generation or private table reads.
const text = (value) => value == null ? '' : String(value);
const number = (value) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export const cleanText = (value) => text(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const pickText = (source, keys) => Object.fromEntries(keys.map((key) => [key, cleanText(source?.[key])]));
const safeUrl = (value) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
const safeSignature = (value, internal) => {
  if (!value || (!internal && value.consent_public !== true)) return null;
  const signature = { ...pickText(value, ['name', 'signed_at']), consent_public: value.consent_public === true };
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.image_data_url || '') && value.image_data_url.length <= 210000) signature.image_data_url = value.image_data_url;
  return signature;
};

/** An explicit second allowlist, even if an internal report is accidentally passed. */
export function prepareInspectionReport(source, { internal = false, preview = false } = {}) {
  if (!source?.config?.categories || !source?.score) throw new Error('El informe no contiene una configuración y un resultado verificables.');
  if (!internal && ((preview ? !['approved', 'published', 'archived'].includes(source.status) || !source.approved_at : source.status !== 'published' || !source.published_at) || source.score.complete !== true)) throw new Error('Solo se puede consultar el informe público publicado y completo, o una vista previa aprobada.');
  if (!internal && (source.config.categories.length !== 8 || source.config.categories.flatMap((category) => category.items || []).length !== 83 || number(source.score.nota_10) === null || number(source.score.total_100) === null || source.score.nota_10 < 0 || source.score.nota_10 > 10 || !['Apto', 'No apto'].includes(source.fitness) || !['Bajo', 'Medio', 'Alto'].includes(source.risk))) throw new Error('El informe publicado está incompleto.');
  const categories = source.config.categories.map((category) => ({
    id: text(category.id), label: cleanText(category.label), max: number(category.max), order: number(category.order),
    items: category.items.map((item) => ({ ...pickText(item, ['id', 'label', 'type', 'unit', 'partition']), ...(item.scoring === 'percentage' ? { scoring: 'percentage' } : {}), weight: number(item.weight), order: number(item.order) })),
  }));
  const answers = {};
  for (const category of categories) for (const item of category.items) {
    const answer = source.answers?.[item.id] || {};
    const value = answer.value || {};
    let details = {};
    if (item.type === 'windshield') details = { findings: (Array.isArray(value.findings) ? value.findings : []).filter((finding) => ['Sin daños', 'Fisuras', 'Impactos'].includes(finding)) };
    if (item.type === 'percentage') details = { percent: number(value.percent) };
    if (item.type === 'damage') details = pickText(value, ['detail', 'zone']);
    if (item.type === 'tire') details = { ...pickText(value, ['brand', 'size']), wear_percent: number(value.wear_percent), depth_mm: number(value.depth_mm) };
    answers[item.id] = { rating: ['B', 'R', 'M', 'NA'].includes(answer.rating) ? answer.rating : null, ...pickText(answer, ['na_reason', 'notes']), value: details };
  }
  const report = {
    ...pickText(source, ['id', 'vehicle_id', 'status', 'version', 'revision', 'inspection_date', 'locality', 'observations', 'fitness', 'risk', 'verdict_reason', 'approved_at', 'published_at']),
    vehicle: { ...pickText(source.vehicle, ['brand', 'model', 'version', 'plate', 'year']), km: number(source.vehicle?.km) },
    inspector_name: internal || source.show_inspector === true ? cleanText(source.inspector_name) : '',
    show_inspector: source.show_inspector === true,
    signature: safeSignature(source.signature, internal),
    config: { ...pickText(source.config, ['version', 'scale_version']), factors: { B: number(source.config.factors?.B), R: number(source.config.factors?.R), M: number(source.config.factors?.M) }, categories }, answers,
    score: {
      complete: source.score.complete === true,
      total_100: source.score.complete === true ? number(source.score.total_100) : null,
      nota_10: source.score.complete === true ? number(source.score.nota_10) : null,
      categories: (source.score.categories || []).map((category) => ({
        ...pickText(category, ['id', 'label']), max: number(category.max), points: category.complete === true ? number(category.points) : null,
        denominator: number(category.denominator), numerator: number(category.numerator), complete: category.complete === true,
        pending: number(category.pending), non_evaluable: category.non_evaluable === true,
      })),
    },
    evidence: (source.evidence || []).filter((entry) => internal || entry.approved_public === true).map((entry) => ({
      ...pickText(entry, ['id', 'item_id', 'caption']), url: safeUrl(entry.url || entry.signed_url), approved_public: entry.approved_public === true,
    })),
  };
  if (internal) {
    report.owner = pickText(source.owner, ['name', 'phone', 'email']);
    report.internal_notes = cleanText(source.internal_notes);
  }
  if (!internal && categories.some((category) => {
    const result = report.score.categories.find((entry) => entry.id === category.id);
    return !result?.complete || result.points === null || category.max === null || result.points < 0 || result.points > category.max;
  })) throw new Error('Hay áreas pendientes en el informe.');
  return report;
}

export function formatInspectionDate(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Sin fecha registrada';
}
export function ratingLabel(rating, item = {}, value = {}) {
  if (rating === 'NA') return 'No aplica';
  if (item.scoring === 'percentage') {
    const percent = number(value?.percent);
    return percent !== null && percent >= 0 && percent <= 100 ? `${percent} %` : 'Pendiente';
  }
  return ({ B: 'Bueno', R: 'Regular', M: 'Malo' })[rating] || 'Pendiente';
}
export function itemDetails(item, answer = {}) {
  if (answer.rating === 'NA') return [`Motivo N/A: ${answer.na_reason || 'Sin motivo registrado'}`];
  const value = answer.value || {};
  const detail = [];
  if (item.type === 'windshield') detail.push(`Parabrisas: ${(value.findings || []).join(', ') || 'Sin detalle registrado'}`);
  if (item.type === 'percentage' && item.scoring !== 'percentage') {
    const percent = number(value.percent);
    if (item.partition === 'original_paint') {
      detail.push(`Pintura original: ${percent ?? '-'} %`);
      if (percent !== null && percent >= 0 && percent <= 100) detail.push(`Repintado: ${100 - percent} %`);
    } else detail.push(`${(item.unit || item.label).replace(/^%\s*/, '')}: ${percent ?? '-'} % (estimación del perito)`);
  }
  if (item.type === 'damage') {
    detail.push(`Detalle: ${value.detail || 'Sin detalle registrado'}`);
    if (value.zone) detail.push(`Zona: ${value.zone}`);
  }
  if (item.type === 'tire' && (value.brand || value.size || number(value.wear_percent) !== null || number(value.depth_mm) !== null)) detail.push(`Marca: ${value.brand || '-'}; medida: ${value.size || '-'}; desgaste: ${number(value.wear_percent) ?? '-'} %; profundidad: ${number(value.depth_mm) ?? '-'} mm`);
  return detail;
}
