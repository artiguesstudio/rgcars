import { CONFIG, createDocument, createSnapshot } from '../inspections/domain.mjs';

export function inspectionFixture() {
  const document = createDocument({ brand: 'Marca', model: 'Modelo', version: 'Versión', plate: 'AA000AA', km: 35000, year: 2020 });
  Object.assign(document, { inspection_date: '2026-10-14', inspector_name: 'PERITO_PRIVADO', locality: 'Río Grande', fitness: 'No apto', risk: 'Alto', verdict_reason: 'Falla de motor confirmada', observations: 'Hallazgo desfavorable conservado', owner: { name: 'CLIENTE_PRIVADO', phone: 'TELEFONO_PRIVADO', email: 'privado@example.test' }, internal_notes: 'NOTA_PRIVADA' });
  document.signature = { name: 'FIRMA_PRIVADA', signed_at: '2026-10-14', consent_public: false, image_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH3sAAAAASUVORK5CYII=' };
  for (const category of CONFIG.categories) for (const item of category.items) {
    const answer = document.answers[item.id]; answer.rating = 'B';
    if (item.type === 'windshield') answer.value = { findings: ['Fisuras', 'Impactos'] };
    if (item.type === 'percentage') answer.value = { percent: 75 };
    if (item.type === 'damage') answer.value = { detail: 'Rayón observado', zone: 'Sector izquierdo' };
    if (item.type === 'tire') answer.value = { brand: 'Marca neumático', size: '205/55 R16', wear_percent: 30, depth_mm: 4.5 };
  }
  document.answers['motor-motor'].rating = 'M';
  document.answers['motor-motor'].notes = 'Falla de motor confirmada';
  document.answers['motor-turbo'] = { rating: 'NA', na_reason: 'La unidad no equipa turbo', notes: '', value: {} };
  return { id: '11111111-1111-4111-8111-111111111111', vehicle_id: '2', status: 'published', revision: 4, document, scoring_snapshot: createSnapshot(document), approved_at: '2026-10-14T12:00:00Z', published_at: '2026-10-14T13:00:00Z' };
}
