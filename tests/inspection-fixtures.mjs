import { CONFIG, createDocument, createSnapshot, usesPercentageScore } from '../inspections/domain.mjs';

export const SIGNATURE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';

/** Approved v1 reports retain ratings for every item, including brake measurements. */
export function legacyConfig() {
  const config = structuredClone(CONFIG);
  config.version = 'rgcars-83-v1';
  config.scale_version = 'propuesta-interna-v1';
  config.scale_notice = 'Criterio interno propuesto, sujeto a validación del cliente: Bueno / Excelente = 1; Regular = 0,5; Malo = 0. No determina aptitud ni riesgo.';
  for (const item of config.categories.flatMap(category => category.items)) {
    delete item.scoring;
    delete item.details_required;
  }
  return config;
}

export function completeDocument(rating = 'B') {
  const document = createDocument({ brand: 'Marca prueba', model: 'Modelo prueba', version: 'Versión prueba', plate: 'AB123CD', km: 42000, year: 2022 });
  Object.assign(document, { inspection_date: '2026-10-14', inspector_name: 'Perito de prueba', fitness: 'Apto', risk: 'Bajo', verdict_reason: 'Dictamen confirmado tras inspección presencial.', signature: { name: 'Perito de prueba', signed_at: '2026-10-14T12:00:00Z', consent_public: false, image_data_url: SIGNATURE_PNG } });
  for (const item of CONFIG.categories.flatMap(category => category.items)) {
    const value = item.type === 'windshield' ? { findings: ['Sin daños'] }
      : item.type === 'percentage' ? { percent: usesPercentageScore(item) ? CONFIG.factors[rating] * 100 : 75 }
      : item.type === 'damage' ? { detail: 'Sin daños visibles', zone: 'Inspección general' }
      : item.type === 'tire' ? { brand: 'Marca neumático', size: '205/55 R16', wear_percent: 30, depth_mm: 5.4 } : {};
    document.answers[item.id] = { rating, notes: '', na_reason: '', value };
  }
  return document;
}

export function publishedRow(document = completeDocument()) {
  return { id: '11111111-1111-4111-8111-111111111111', vehicle_id: '22222222-2222-4222-8222-222222222222', revision: 4, status: 'published', document, scoring_snapshot: createSnapshot(document), approved_at: '2026-10-14T13:00:00Z', published_at: '2026-10-14T14:00:00Z' };
}
