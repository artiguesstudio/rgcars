import test from 'node:test';
import { inspectionFixture as fixture } from './inspection-fixture.mjs';
import assert from 'node:assert/strict';
import { CONFIG, publicReport, internalReport } from '../inspections/domain.mjs';
import { prepareInspectionReport, itemDetails, ratingLabel, buildInspectionPdf } from '../inspections/pdf.mjs';
import { fetchPublicInspection } from '../inspections/public.mjs';
import { inspectionHeaders } from '../inspections/transport.mjs';


test('PDF/public presentation strips private fields even when given an internal report', () => {
  const row = fixture();
  const report = internalReport(row, [
    { id: 'public', item_id: 'motor-motor', approved_public: true, caption: 'Falla visible', signed_url: 'https://example.test/public.jpg' },
    { id: 'private', item_id: 'motor-motor', approved_public: false, caption: 'EVIDENCIA_PRIVADA', signed_url: 'https://example.test/private.jpg' },
  ]);
  report.answers['motor-motor'].owner = 'CLIENTE_INYECTADO';
  report.vehicle.private_email = 'PII_INYECTADA';
  const publicDto = prepareInspectionReport(report);
  const serialized = JSON.stringify(publicDto);
  assert.doesNotMatch(serialized, /CLIENTE_|TELEFONO_|privado@example|NOTA_PRIVADA|FIRMA_PRIVADA|PERITO_PRIVADO|EVIDENCIA_PRIVADA|private\.jpg|PII_INYECTADA/);
  assert.match(serialized, /Falla de motor confirmada/);
  assert.equal(publicDto.signature, null);
  assert.equal(publicDto.evidence.length, 1);
  assert.equal(Object.keys(publicDto.answers).length, 83);
});

test('public signature and inspector require separate explicit authorization', () => {
  const row = fixture();
  row.document.signature.consent_public = true;
  let projected = prepareInspectionReport(publicReport(row));
  assert.equal(projected.signature.name, 'FIRMA_PRIVADA');
  assert.equal(projected.inspector_name, '');
  row.document.show_inspector = true;
  projected = prepareInspectionReport(publicReport(row));
  assert.equal(projected.inspector_name, 'PERITO_PRIVADO');
});

test('approved and archived previews require an explicit option and remain anonymous', async () => {
  for (const state of ['approved', 'archived']) {
    const row = fixture(); row.status = state; row.published_at = null;
    const report = publicReport(row, [], { preview: true });
    assert.throws(() => prepareInspectionReport(report), /publicado/);
    const pdf = await buildInspectionPdf(report, { preview: true, jsPDF: PdfRecorder, includePhotos: false });
    const output = pdf.lines.join('\n');
    assert.equal(pdf.lines.filter((line) => line === 'VISTA PREVIA - NO PUBLICADO').length, pdf.page);
    assert.doesNotMatch(output, /CLIENTE_PRIVADO|TELEFONO_PRIVADO|NOTA_PRIVADA|FIRMA_PRIVADA|PERITO_PRIVADO|privado@example/);
  }
});

test('technical details keep findings, N/A reasons, percentages and tire data', () => {
  const report = publicReport(fixture());
  const item = (id) => CONFIG.categories.flatMap((category) => category.items).find((entry) => entry.id === id);
  assert.match(itemDetails(item('exterior-parabrisas'), report.answers['exterior-parabrisas']).join(' '), /Fisuras, Impactos/);
  assert.deepEqual(itemDetails(item('exterior-pintura'), report.answers['exterior-pintura']), ['Pintura original: 75 %', 'Repintado: 25 %']);
  assert.doesNotMatch(itemDetails({ ...item('exterior-pintura'), partition: '' }, report.answers['exterior-pintura']).join(' '), /Repintado/);
  assert.match(itemDetails(item('motor-turbo'), report.answers['motor-turbo']).join(' '), /La unidad no equipa turbo/);
  assert.match(itemDetails(item('neumaticos-delantera-izquierda'), report.answers['neumaticos-delantera-izquierda']).join(' '), /Marca neumático.*205\/55 R16.*30 %.*4.5 mm/);
  assert.deepEqual(itemDetails(item('neumaticos-delantera-izquierda'), { rating: 'B', value: {} }), [], 'New tire answers do not need empty technical fields.');
  assert.match(itemDetails(item('neumaticos-delantera-izquierda'), { rating: 'B', value: { wear_percent: 0 } }).join(' '), /desgaste: 0 %/, 'A recorded zero remains visible.');
});

test('percentage states use the measured percentage, including zero, without a qualitative rating', () => {
  const item = { type: 'percentage', scoring: 'percentage' };
  for (const percent of [0, 50, 100]) {
    for (const rating of [null, 'B', 'R', 'M']) {
      assert.equal(ratingLabel(rating, item, { percent }), `${percent} %`);
      assert.deepEqual(itemDetails(item, { rating, value: { percent } }), [], 'The state already displays the percentage.');
    }
  }
  for (const percent of [null, undefined, '', -1, 101, Number.NaN]) {
    assert.equal(ratingLabel('B', item, { percent }), 'Pendiente', 'An old rating cannot hide a missing or invalid percentage.');
  }
  assert.equal(ratingLabel('NA', item), 'No aplica');
  assert.deepEqual(itemDetails(item, { rating: 'NA', na_reason: 'Sistema no equipado' }), ['Motivo N/A: Sistema no equipado']);
  assert.equal(ratingLabel('B', { type: 'tire' }), 'Bueno');
  assert.equal(ratingLabel('B', { type: 'rating' }), 'Bueno');
});

test('PDF sanitization retains percentage scoring and displays numeric brake states', async () => {
  for (const percent of [0, 50, 100]) {
    const source = publicReport(fixture());
    const item = source.config.categories.flatMap((category) => category.items).find((entry) => entry.id === 'chasis-frenos-delantero');
    item.scoring = 'percentage';
    source.answers[item.id] = { rating: null, value: { percent }, notes: 'Medición conservada', na_reason: '' };
    const report = prepareInspectionReport(prepareInspectionReport(source));
    const projected = report.config.categories.flatMap((category) => category.items).find((entry) => entry.id === item.id);
    assert.equal(projected.scoring, 'percentage', 'Repeated sanitization must not restore qualitative brake states.');
    const pdf = await buildInspectionPdf(report, { jsPDF: PdfRecorder, includePhotos: false });
    const line = pdf.lines.find((value) => value.includes(`${item.label} - `));
    assert.ok(line.includes(`- ${percent} % (peso`));
    assert.doesNotMatch(line, /Bueno|Regular|Malo|Pendiente/);
    assert.match(pdf.lines.join('\n'), /Medición conservada/);
    assert.doesNotMatch(pdf.lines.join('\n'), /Excelente/);
  }
});

test('incomplete brake percentages stay pending in internal PDFs', async () => {
  const source = internalReport(fixture());
  const item = source.config.categories.flatMap((category) => category.items).find((entry) => entry.id === 'chasis-frenos-delantero');
  item.scoring = 'percentage';
  source.answers[item.id] = { rating: 'B', value: {}, notes: '', na_reason: '' };
  source.score.complete = false;
  const pdf = await buildInspectionPdf(source, { internal: true, jsPDF: PdfRecorder, includePhotos: false });
  const line = pdf.lines.find((value) => value.includes(`${item.label} - `));
  assert.ok(line.includes('- Pendiente (peso'));
  assert.match(pdf.lines.join('\n'), /INFORME INCOMPLETO/);
});

test('historical snapshots keep their qualitative brake state and measurement', async () => {
  const source = publicReport(fixture());
  for (const item of source.config.categories.flatMap((category) => category.items)) delete item.scoring;
  const item = source.config.categories.flatMap((category) => category.items).find((entry) => entry.id === 'chasis-frenos-delantero');
  source.answers[item.id] = { rating: 'R', value: { percent: 80 }, notes: 'Observación histórica', na_reason: '' };
  const report = prepareInspectionReport(source);
  const projected = report.config.categories.flatMap((category) => category.items).find((entry) => entry.id === item.id);
  assert.equal(projected.scoring, undefined);
  assert.equal(ratingLabel('R', projected, { percent: 80 }), 'Regular');
  assert.match(itemDetails(projected, report.answers[item.id]).join(' '), /80 %/);
  const pdf = await buildInspectionPdf(report, { jsPDF: PdfRecorder, includePhotos: false });
  const line = pdf.lines.find((value) => value.includes(`${item.label} - `));
  assert.ok(line.includes('- Regular (peso'));
  assert.match(pdf.lines.join('\n'), /80 % \(estimación del perito\)/);
  assert.match(pdf.lines.join('\n'), /Observación histórica/);
  assert.doesNotMatch(pdf.lines.join('\n'), /Vida útil de frenos: porcentaje/);
});

class PdfRecorder {
  constructor() { this.lines = []; this.page = 1; }
  setFillColor() {} rect() {} setTextColor() {} setFont() {} setFontSize() {} setDrawColor() {} line() {} roundedRect() {} addImage() {}
  addPage() { this.page++; }
  setPage() {}
  getNumberOfPages() { return this.page; }
  splitTextToSize(value) { return String(value).split('\n').flatMap((line) => line.match(/.{1,100}/g) || ['']); }
  text(value, x, y) { assert.ok(y < 297 && y > 0, 'text stays on the page'); this.lines.push(String(value)); }
}

test('PDF content has all 83 items, unfavorable results and no private data', async () => {
  const internal = internalReport(fixture());
  const pdf = await buildInspectionPdf(internal, { jsPDF: PdfRecorder, includePhotos: false });
  const output = pdf.lines.join('\n');
  assert.equal(pdf.lines.filter((line) => /^\d+\. /.test(line)).length, 83);
  assert.match(output, /Motor - Malo/);
  assert.match(output, /No apto.*Alto/);
  assert.match(output, /La unidad no equipa turbo/);
  assert.match(output, /205\/55 R16/);
  assert.doesNotMatch(output, /CLIENTE_PRIVADO|TELEFONO_PRIVADO|NOTA_PRIVADA|FIRMA_PRIVADA|PERITO_PRIVADO|privado@example/);
  assert.ok(pdf.page >= 3);
  const completePdf = await buildInspectionPdf(internal, { internal: true, jsPDF: PdfRecorder, includePhotos: false });
  assert.match(completePdf.lines.join('\n'), /CLIENTE_PRIVADO/);
});

test('public PHP reports work without browser Supabase credentials and default to the local endpoint', async () => {
  const report = await fetchPublicInspection('2', { config: {}, fetcher: async (url, request) => {
    assert.equal(url, '/api/inspections.php');
    assert.deepEqual(request.headers, { 'Content-Type': 'application/json' });
    assert.equal(request.cache, 'no-store');
    assert.deepEqual(JSON.parse(request.body), { action: 'public', vehicle_id: '2' });
    return { ok: true, json: async () => ({ data: publicReport(fixture()) }) };
  } });
  assert.equal(report.vehicle_id, '2');
  const uploadHeaders = inspectionHeaders({ SUPABASE_ANON_KEY: 'anonymous' }, 'session-token', true);
  assert.equal(uploadHeaders.Authorization, 'Bearer session-token');
  assert.equal(uploadHeaders['Content-Type'], undefined, 'The browser must supply the multipart boundary.');
});

test('explicit Edge public fetch uses a single public action, rejects other vehicles and drafts, and has no empty score', async () => {
  const config = { INSPECTIONS_ENDPOINT: 'https://project.supabase.co/functions/v1/inspections-api', SUPABASE_ANON_KEY: 'anonymous' };
  let calls = 0;
  const fetcher = async (url, request) => {
    calls++;
    assert.equal(url, 'https://project.supabase.co/functions/v1/inspections-api');
    assert.equal(request.headers.Authorization, 'Bearer anonymous');
    assert.equal(request.headers.apikey, 'anonymous');
    assert.deepEqual(JSON.parse(request.body), { action: 'public', vehicle_id: '2' });
    return { ok: true, json: async () => ({ data: publicReport(fixture()) }) };
  };
  assert.equal((await fetchPublicInspection('2', { config, fetcher })).vehicle_id, '2');
  assert.equal(calls, 1);
  assert.equal(await fetchPublicInspection('2', { config, fetcher: async () => ({ ok: true, json: async () => ({ data: null }) }) }), null);
  await assert.rejects(fetchPublicInspection('999', { config, fetcher: async () => ({ ok: true, json: async () => ({ data: publicReport(fixture()) }) }) }), /no corresponde/);
  const draft = publicReport(fixture()); draft.status = 'draft';
  await assert.rejects(fetchPublicInspection('2', { config, fetcher: async () => ({ ok: true, json: async () => ({ data: draft }) }) }), /publicado/);
  await assert.rejects(buildInspectionPdf(draft, { jsPDF: PdfRecorder }), /publicado/);
});
