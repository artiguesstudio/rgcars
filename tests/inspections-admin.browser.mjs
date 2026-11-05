// Optional browser smoke test. Install Playwright, or set PLAYWRIGHT_MODULE_PATH
// to an existing Playwright index.mjs; no production credentials are used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { CONFIG, createDocument, createSnapshot, validateDocument } from '../inspections/domain.mjs';
import { completeDocument, SIGNATURE_PNG } from './inspection-fixtures.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.RG_INSPECTION_OUTPUT_DIR
  ? path.resolve(process.env.RG_INSPECTION_OUTPUT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'rgcars-inspection-compact-'));
await mkdir(output, { recursive: true });
const items = CONFIG.categories.flatMap((category) => category.items);
const percentageItems = items.filter((item) => item.scoring === 'percentage');
const ratingItems = items.filter((item) => item.scoring !== 'percentage');
// Use the actual deployed PDF library; a local path keeps this verification offline.
const pdfLibrary = process.env.RG_INSPECTION_JSPDF_PATH
  ? await readFile(process.env.RG_INSPECTION_JSPDF_PATH)
  : Buffer.from(await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')).arrayBuffer());
const pdfDownloads = [];
const vehicle = { id: '22222222-2222-4222-8222-222222222222', title: 'Toyota Corolla · ejemplo', brand: 'Toyota', model: 'Corolla', version: 'XEI 2.0 CVT', year: 2022, km: 42000, plate: 'DEMO001' };
let row = { id: '11111111-1111-4111-8111-111111111111', vehicle_id: vehicle.id, revision: 1, status: 'draft', document: createDocument(vehicle), scoring_snapshot: null, evidence: [{ id: '33333333-3333-4333-8333-333333333333', item_id: CONFIG.categories[0].items[0].id, caption: 'Evidencia privada', approved_public: false, signed_url: 'https://evidence.invalid/photo.png?signature=old' }], audit: [] };
const previous = { id: '44444444-4444-4444-8444-444444444444', vehicle_id: vehicle.id, revision: 6, status: 'archived', document: completeDocument(), scoring_snapshot: createSnapshot(completeDocument()), approved_at: '2026-10-12T15:00:00Z', published_at: '2026-10-12T15:10:00Z', evidence: [], audit: [] };
const apiCalls = [];
let capabilities = { can_edit: true, can_approve: true, can_na: true };
let failNextGet = '';
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(path.resolve(root) + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await context.route('https://cdnjs.cloudflare.com/**', (route) => route.abort());
  await context.route('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', (route) => route.fulfill({ contentType: 'text/javascript', body: pdfLibrary }));
  await context.route('https://evidence.invalid/**', (route) => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from(SIGNATURE_PNG.split(',')[1], 'base64') }));
  await context.addInitScript(({ vehicle }) => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token', user: { id: 'fixture-user', email: 'perito.ejemplo@example.invalid' } } } }) }, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: vehicle }) }) }) }) }) };
  }, { vehicle });
  await context.route('**/api/inspections.php', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }); return; }
    const body = request.postDataJSON();
    apiCalls.push(body);
    if (body.action === 'get' && body.id === failNextGet) {
      failNextGet = '';
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Informe de ejemplo temporalmente no disponible.' }) });
      return;
    }
    let data;
    if (body.action === 'capabilities') data = capabilities;
    else if (body.action === 'list') data = [row, previous];
    else if (body.action === 'get') data = body.id === previous.id ? previous : row;
    else if (body.action === 'save') {
      assert.equal(body.revision, row.revision);
      assert.equal(validateDocument(body.document).length, 0);
      row = { ...row, document: body.document, revision: row.revision + 1 };
      data = row;
    } else if (body.action === 'update_evidence') {
      assert.equal(body.revision, row.revision);
      assert.ok(row.evidence.some((entry) => entry.id === body.evidence_id));
      row = { ...row, revision: row.revision + 1, evidence: row.evidence.map((entry) => entry.id === body.evidence_id ? { ...entry, caption: body.caption, approved_public: body.approved_public } : entry) };
      data = row;
    } else if (body.action === 'transition') {
      assert.equal(body.revision, row.revision);
      if (body.status !== 'draft') assert.equal(validateDocument(row.document, { final: true }).length, 0);
      row = { ...row, status: body.status, revision: row.revision + 1 };
      if (body.status === 'approved') { row.scoring_snapshot = createSnapshot(row.document); row.approved_at = '2026-10-14T15:00:00Z'; }
      if (body.status === 'published') row.published_at = '2026-10-14T15:10:00Z';
      data = row;
    } else throw new Error(`Unexpected mocked action ${body.action}`);
    await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const save = async (revisionDelta = 1) => {
    const revision = row.revision;
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => document.querySelector('.inspection-save-status')?.textContent === 'Guardado');
    assert.equal(row.revision, revision + revisionDelta);
  };
  const action = async (name) => {
    const button = page.locator(`[data-action="${name}"]`);
    if (!await button.isVisible()) await page.locator('details.inspection-more-actions > summary').click();
    await button.click();
  };
  const downloadPdf = async (name, filename, expectedPrefix) => {
    const gets = apiCalls.filter((call) => call.action === 'get').length;
    const mutations = apiCalls.filter((call) => ['save','update_evidence','transition'].includes(call.action)).length;
    const pending = page.waitForEvent('download');
    await action(name);
    const download = await pending;
    assert.ok(download.suggestedFilename().startsWith(expectedPrefix), download.suggestedFilename());
    const destination = path.join(output, filename);
    await download.saveAs(destination);
    assert.equal((await readFile(destination)).subarray(0, 5).toString('ascii'), '%PDF-');
    await page.waitForFunction(() => !document.getElementById('notice')?.textContent.includes('Procesando'));
    assert.equal(apiCalls.filter((call) => call.action === 'get').length, gets + 1, 'Every PDF renews signed evidence links');
    assert.equal(apiCalls.filter((call) => ['save','update_evidence','transition'].includes(call.action)).length, mutations, 'Downloading a PDF never saves or changes workflow state');
    pdfDownloads.push({ filename, suggested: download.suggestedFilename() });
  };
  const openDetails = async (id) => {
    const details = page.locator(`#details-${id}`);
    if (!await details.evaluate((element) => element.open)) await details.locator(':scope > summary').click();
    return details;
  };
  const ratingInput = (id, rating) => page.locator(`input[type="radio"][data-path="answers.${id}.rating"][value="${rating}"]`);
  const chooseRating = async (id, rating) => ratingInput(id, rating).check();
  const assertInlineRatings = async (viewport) => {
    const wrapped = await page.locator('[role="radiogroup"]').evaluateAll((groups) => groups.flatMap((group) => {
      const radios = [...group.querySelectorAll('input[type="radio"]')];
      const tops = radios.map((radio) => Math.round(radio.closest('label').getBoundingClientRect().top));
      return new Set(tops).size > 1 ? [group.getAttribute('aria-label')] : [];
    }));
    assert.deepEqual(wrapped, [], `Rating choices must remain on one line at ${viewport}`);
  };
  await page.goto(`${origin}/admin/inspections.html?vehicle_id=${vehicle.id}`);
  await page.locator('#editor:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-item-container]').count(), 83);
  assert.equal(await page.locator('[data-category-summary]').count(), 8);
  assert.equal(await page.locator('details.inspection-category[open]').count(), 8, 'Every category starts expanded');
  assert.equal(await page.locator('select[data-path$=".rating"]').count(), 0, 'Item ratings must not require opening a dropdown');
  assert.equal(await page.locator('input[type="radio"][data-path$=".rating"]').count(), ratingItems.length * 4);
  assert.equal(await page.locator('input[type="radio"][data-path$=".rating"]:checked').count(), 0, 'All ratings start pending');
  assert.equal(await page.locator('textarea[data-path$=".notes"]:visible').count(), items.length, 'Every observation is directly editable');
  assert.equal(await page.locator('details.inspection-item-details[open]').count(), 0, 'Only photos start collapsed');
  for (const item of items.filter((candidate) => candidate.type === 'tire')) {
    assert.equal(await page.locator(`#item-${item.id}`).getByRole('radio', { name: 'Bueno', exact: true }).count(), 1);
    assert.equal(await page.locator(`#item-${item.id}`).getByRole('radio', { name: 'Excelente', exact: true }).count(), 0);
    assert.equal(await page.locator(`#item-${item.id} [data-path^="answers.${item.id}.value."]`).count(), 0, 'Tires use only the common rating choices and observations');
  }
  for (const item of percentageItems) {
    assert.equal(await page.locator(`#item-${item.id} input[type="radio"]`).count(), 0, 'Brake lifespan uses the percentage alone');
    assert.equal(await page.locator(`[data-path="answers.${item.id}.value.percent"]`).isVisible(), true);
  }
  assert.equal(await page.locator('#historySelect option:not([value=""])').count(), 2);
  assert.equal(await page.locator('#historySelect').inputValue(), row.id);
  assert.match(await page.locator('#sessionIdentity').textContent(), /perito\.ejemplo@example\.invalid.*Administrador/);
  assert.equal(await page.locator('#reportActions button:visible').count(), 2, 'Only save and review are exposed in the draft action bar');
  assert.equal(await page.locator('[data-action="preview-internal"]').isVisible(), false);
  assert.match(await page.locator('#scoreSummary').textContent(), /Sin nota definitiva/);
  assert.equal(await page.locator('[data-action="pdf-public"]').count(), 0, 'An incomplete draft has no public PDF action');
  await downloadPdf('pdf-internal', 'draft-saved-incomplete.pdf', 'peritaje-interno-');
  // Restore the compact menu before the existing layout/keyboard checks.
  await page.locator('details.inspection-more-actions > summary').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Desktop layout must not overflow');
  await assertInlineRatings('1366px');
  const exteriorHeight = await page.locator('#section-exterior').evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(exteriorHeight < 2400, `The 29 exterior items must stay compact, got ${exteriorHeight}px`);
  const simpleIds = CONFIG.categories.flatMap((category) => category.items).filter((item) => item.type === 'state').map((item) => item.id);
  const simpleHeights = await page.evaluate((ids) => ids.map((id) => ({ id, height: document.getElementById(`item-${id}`).getBoundingClientRect().height })), simpleIds);
  assert.deepEqual(simpleHeights.filter(({ height }) => height >= 110), [], 'Simple item rows must be shorter than 110px');
  const stackedNotes = await page.evaluate((ids) => ids.filter((id) => {
    const item = document.getElementById(`item-${id}`);
    const rating = item.querySelector('[role="radiogroup"]').getBoundingClientRect();
    const notes = item.querySelector('textarea[data-path$=".notes"]').getBoundingClientRect();
    return notes.bottom <= rating.top || notes.top >= rating.bottom;
  }), simpleIds);
  assert.deepEqual(stackedNotes, [], 'Desktop observation fields must share the rating row');

  // Native radios support arrow-key editing without extra clicks or moving focus away.
  const firstItem = CONFIG.categories[0].items[0];
  const firstState = page.getByRole('radiogroup', { name: `Estado de ${firstItem.label}`, exact: true });
  await ratingInput(firstItem.id, 'B').focus();
  await ratingInput(firstItem.id, 'B').press('Space');
  assert.equal(await ratingInput(firstItem.id, 'B').isChecked(), true);
  for (const rating of ['R', 'M']) {
    await page.keyboard.press('ArrowRight');
    assert.equal(await ratingInput(firstItem.id, rating).isChecked(), true);
    assert.equal(await page.locator(`#details-${firstItem.id}`).evaluate((element) => element.open), false, 'Rating selection must not expand photos');
    assert.equal(await ratingInput(firstItem.id, rating).evaluate((element) => document.activeElement === element), true, 'Rating selection must retain native keyboard focus');
  }
  await page.locator(`[data-clear-rating="${firstItem.id}"]`).click();
  assert.equal(await firstState.locator('input:checked').count(), 0, 'Clear restores the pending state');
  await chooseRating(firstItem.id, 'B');
  const turbo = CONFIG.categories.flatMap((category) => category.items).find((item) => item.label === 'Turbo');
  await chooseRating(turbo.id, 'NA');
  await page.locator(`[data-path="answers.${turbo.id}.na_reason"]`).fill('Unidad sin turbo');
  const paint = CONFIG.categories[0].items.find((item) => item.partition === 'original_paint');
  const paintValue = page.locator(`[data-path="answers.${paint.id}.value.percent"]`);
  await paintValue.fill('73');
  await chooseRating(paint.id, 'NA');
  await page.locator(`[data-path="answers.${paint.id}.na_reason"]`).fill('Valor temporal de prueba');
  assert.equal(await paintValue.isVisible(), false);
  await chooseRating(paint.id, 'B');
  assert.equal(await paintValue.inputValue(), '73', 'Toggling N/A must preserve measurements');
  const brake = percentageItems[0];
  assert.ok(brake, 'The configuration must include percentage-scored brake lifespan');
  const brakeCategory = CONFIG.categories.find((category) => category.items.includes(brake));
  const brakeProgress = page.locator(`[data-category-progress="${brakeCategory.id}"]`);
  const progressBeforeBrake = Number(await brakeProgress.getAttribute('value'));
  const brakePercent = page.locator(`[data-path="answers.${brake.id}.value.percent"]`);
  await brakePercent.fill('0');
  assert.equal(Number(await brakeProgress.getAttribute('value')), progressBeforeBrake + 1, 'Zero percent is a completed brake assessment');
  await brakePercent.fill('');
  assert.equal(Number(await brakeProgress.getAttribute('value')), progressBeforeBrake, 'An empty percentage remains pending');
  await brakePercent.fill('60');
  await page.locator(`[data-percentage-na="${brake.id}"]`).check();
  await page.locator(`[data-path="answers.${brake.id}.na_reason"]`).fill('Excepción temporal de prueba');
  assert.equal(await brakePercent.isVisible(), false);
  await page.locator(`[data-percentage-na="${brake.id}"]`).uncheck();
  assert.equal(await brakePercent.inputValue(), '60', 'Brake N/A preserves the entered percentage');
  await page.locator(`[data-path="answers.${firstItem.id}.notes"]`).fill('Detalle de prueba conservado al guardar');
  assert.equal(await page.locator(`#details-${firstItem.id}`).evaluate((element) => element.open), false, 'Writing observations does not require opening photos');
  const firstDetails = await openDetails(firstItem.id);
  assert.equal(await page.locator('[data-save-evidence]').count(), 0, 'Evidence edits use the global save action');
  await page.locator('#section-luces > summary').click();
  await save();
  assert.equal(row.document.answers[firstItem.id].rating, 'B');
  assert.equal(row.document.answers[firstItem.id].notes, 'Detalle de prueba conservado al guardar');
  assert.equal(row.document.answers[turbo.id].rating, 'NA');
  assert.equal(row.document.answers[turbo.id].na_reason, 'Unidad sin turbo');
  assert.equal(row.document.answers[paint.id].value.percent, 73);
  assert.equal(row.document.answers[brake.id].value.percent, 60);
  assert.equal(row.document.answers[brake.id].rating, null, 'Saving brake lifespan must not invent an independent rating');
  assert.equal(await firstDetails.evaluate((element) => element.open), true, 'Saving preserves expanded item details');
  assert.equal(await page.locator('#section-luces').evaluate((element) => element.open), false, 'Saving preserves collapsed categories');
  assert.equal(await page.locator(`#details-${turbo.id}`).evaluate((element) => element.open), false, 'Saving preserves collapsed item details');
  await firstDetails.locator(':scope > summary').click();
  await page.locator('#section-luces > summary').click();
  await save();
  assert.equal(await firstDetails.evaluate((element) => element.open), false, 'Closing details remains effective after another save');

  // Capture the editable compact draft, rather than only the published/read-only state.
  // Hide the sticky footer only in full-section captures so it does not cover rows.
  const sectionScreenshot = (selector, filename) => page.locator(selector).screenshot({ path: path.join(output, filename), style: '#reportActions { visibility: hidden !important; }' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'draft-desktop.png') });
  await sectionScreenshot('#section-exterior', 'draft-desktop-exterior.png');
  await sectionScreenshot(`#section-${brakeCategory.id}`, 'draft-desktop-brakes.png');
  await sectionScreenshot('#section-neumaticos', 'draft-desktop-tires.png');
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Editable ${width}px layout must not overflow`);
    await assertInlineRatings(`${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Editable mobile layout must not overflow');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'draft-mobile.png') });
  await sectionScreenshot('#section-exterior', 'draft-mobile-exterior.png');
  await page.setViewportSize({ width: 1366, height: 900 });

  // History uses the real selector and returns to an editable draft without losing report identity.
  await page.locator('#historySelect').selectOption(previous.id);
  await page.waitForFunction((id) => document.getElementById('reportMeta')?.textContent.includes(id.slice(0, 8)), previous.id);
  assert.match(await page.locator('#reportStatus').textContent(), /Archivado/);
  assert.equal(await page.locator('input[type="radio"][data-path$=".rating"]:enabled').count(), 0);
  await downloadPdf('pdf-public', 'archived-public-preview.pdf', 'peritaje-vista-previa-');
  await page.locator('#historySelect').selectOption(row.id);
  await page.waitForFunction((id) => document.getElementById('reportMeta')?.textContent.includes(id.slice(0, 8)), row.id);
  assert.equal(await page.locator('input[type="radio"][data-path$=".rating"]:enabled').count(), ratingItems.length * 4);
  failNextGet = previous.id;
  await page.locator('#historySelect').selectOption(previous.id);
  await page.waitForFunction(() => document.getElementById('notice')?.textContent.includes('temporalmente no disponible'));
  assert.equal(await page.locator('#historySelect').inputValue(), row.id, 'Failed history requests must retain the current selection');

  await page.locator('#ownerSection').evaluate((element) => { element.open = true; });
  await page.locator('[data-path="owner.name"]').fill('PROPIETARIO_LOCAL_SIN_GUARDAR');
  const getsBeforeDirtyHistory = apiCalls.filter((call) => call.action === 'get').length;
  await page.locator('#historySelect').selectOption(previous.id);
  assert.equal(await page.locator('#historySelect').inputValue(), row.id, 'Unsaved changes must prevent switching history and restore the selector');
  assert.equal(apiCalls.filter((call) => call.action === 'get').length, getsBeforeDirtyHistory);
  await openDetails(firstItem.id);
  if (!await page.locator('details.inspection-more-actions').evaluate((element) => element.open)) await page.locator('details.inspection-more-actions > summary').click();
  await page.locator('[data-evidence-caption]').fill('DESCRIPCION_LOCAL_SIN_GUARDAR');
  assert.equal(await page.locator('details.inspection-more-actions').evaluate((element) => element.open), true, 'Editing a field must preserve the secondary action menu');
  row.evidence[0].signed_url = 'https://evidence.invalid/photo.png?signature=renewed';
  const refreshesBeforePreview = apiCalls.filter((call) => call.action === 'get').length;
  await action('preview-internal');
  await page.locator('#previewDialog[open]').waitFor();
  assert.equal(apiCalls.filter((call) => call.action === 'get').length, refreshesBeforePreview + 1);
  assert.match(await page.locator('#previewContent').textContent(), /PROPIETARIO_LOCAL_SIN_GUARDAR/);
  assert.match(await page.locator('#previewContent').textContent(), /DESCRIPCION_LOCAL_SIN_GUARDAR/);
  assert.match(await page.locator('.inspection-preview-evidence img').getAttribute('src'), /signature=renewed/);
  assert.equal(row.document.owner.name, '');
  assert.equal(row.evidence[0].caption, 'Evidencia privada');
  await page.locator('#closePreview').click();
  assert.match(await page.locator('.inspection-save-status').textContent(), /sin guardar/);
  await downloadPdf('pdf-internal', 'draft-unsaved-incomplete.pdf', 'peritaje-interno-');
  assert.equal(row.document.owner.name, '', 'The PDF must not persist local owner edits');
  assert.equal(row.evidence[0].caption, 'Evidencia privada', 'The PDF must not persist local evidence captions');
  assert.match(await page.locator('.inspection-save-status').textContent(), /sin guardar/);
  page.once('dialog', (dialog) => dialog.accept());
  await action('discard-reload');
  await page.waitForFunction(() => document.querySelector('.inspection-save-status')?.textContent === 'Guardado');
  await openDetails(firstItem.id);
  await page.locator('[data-evidence-caption]').fill('Descripción guardada desde Guardar borrador');
  await save(2);
  assert.equal(row.evidence[0].caption, 'Descripción guardada desde Guardar borrador');
  await page.locator('[data-action="review"]').click();
  await page.locator('#validation:not([hidden])').waitFor();
  assert.equal(row.status, 'draft');
  assert.equal(apiCalls.filter((call) => call.action === 'transition').length, 0);
  await page.locator('[data-error-path="signature.image_data_url"]').click();
  assert.equal(await page.locator('#verdictSection').evaluate((element) => element.open), true, 'Signature errors must open the signing section');
  assert.equal(await page.locator('#signatureCanvas').isVisible(), true);

  // A validation link reveals the category without opening unrelated photo controls.
  row.document.answers[firstItem.id].notes = 'x'.repeat(2001);
  await page.reload();
  await page.locator('#editor:not([hidden])').waitFor();
  await page.locator('#section-exterior > summary').click();
  const savesBeforeInvalid = apiCalls.filter((call) => call.action === 'save').length;
  await page.locator('[data-action="save"]').click();
  await page.locator('#validation:not([hidden])').waitFor();
  assert.equal(apiCalls.filter((call) => call.action === 'save').length, savesBeforeInvalid, 'Invalid draft must not reach the API');
  await page.locator(`[data-error-path="answers.${firstItem.id}.notes"]`).click();
  assert.equal(await page.locator('#section-exterior').evaluate((element) => element.open), true);
  assert.equal(await firstDetails.evaluate((element) => element.open), false);
  const notes = page.locator(`[data-path="answers.${firstItem.id}.notes"]`);
  assert.equal(await notes.isVisible(), true);
  await notes.fill('Observación corregida');
  await save();
  assert.equal(row.document.answers[firstItem.id].notes, 'Observación corregida');
  await paintValue.fill('120');
  await chooseRating(paint.id, 'NA');
  await page.locator('[data-action="save"]').click();
  await page.locator('#validation:not([hidden])').waitFor();
  await page.locator(`[data-error-path="answers.${paint.id}.value.percent"]`).click();
  assert.equal(await paintValue.isVisible(), true, 'Validation must reveal invalid measurements even when N/A hides them');
  assert.equal(await ratingInput(paint.id, 'NA').isChecked(), true, 'Error navigation must not change the selected rating');
  await paintValue.fill('75');
  await save();

  row.document = completeDocument();
  row.document.owner = { name: 'PROPIETARIO_SECRETO', phone: 'TELEFONO_SECRETO', email: 'propietario@example.com' };
  row.document.internal_notes = 'NOTA_INTERNA_SECRETA';
  row.document.answers[brake.id].rating = 'NA';
  row.document.answers[brake.id].na_reason = 'Excepción previamente autorizada';
  capabilities = { can_edit: true, can_approve: true, can_na: false };
  await page.reload();
  await page.locator('#editor:not([hidden])').waitFor();
  const existingBrakeNA = page.locator(`[data-percentage-na="${brake.id}"]`);
  assert.equal(await existingBrakeNA.isChecked(), true);
  assert.equal(await existingBrakeNA.isEnabled(), true, 'Losing N/A permission must still allow clearing an existing exemption');
  await existingBrakeNA.uncheck();
  assert.equal(await brakePercent.isVisible(), true);
  assert.equal(await brakePercent.inputValue(), '100', 'Clearing an old exemption restores the preserved percentage');
  assert.equal(await existingBrakeNA.isDisabled(), true, 'The exemption cannot be reapplied without N/A permission');
  await save();
  assert.equal(row.document.answers[brake.id].rating, null);
  assert.equal(row.document.answers[brake.id].value.percent, 100);
  capabilities = { can_edit: true, can_approve: true, can_na: true };
  await page.reload();
  await page.locator('#editor:not([hidden])').waitFor();
  assert.equal((await page.locator('#scoreSummary > small').textContent()).trim(), '100 / 100 puntos');
  await brakePercent.fill('50');
  const expectedWithHalfBrake = 100 - brakeCategory.max * brake.weight / brakeCategory.items.reduce((sum, item) => sum + item.weight, 0) / 2;
  assert.equal((await page.locator('#scoreSummary > small').textContent()).trim(), `${expectedWithHalfBrake.toLocaleString('es-AR', { maximumFractionDigits: 2 })} / 100 puntos`, 'The entered brake percentage contributes proportionally to the total');
  await brakePercent.fill('100');
  await save();
  await downloadPdf('pdf-internal', 'draft-complete-internal.pdf', 'peritaje-interno-');
  assert.equal(await page.locator('[data-action="pdf-public"]').count(), 0, 'Complete drafts still require approval before public PDF');
  await page.locator('[data-action="review"]').click();
  await page.locator('[data-action="approve"]').waitFor();
  assert.equal(row.status, 'in_review');
  assert.equal(await page.locator('[data-path]:enabled').count(), 0);
  await page.locator('[data-action="approve"]').click();
  await page.locator('[data-action="publish"]').waitFor();
  assert.equal(row.status, 'approved');
  await action('preview-public');
  await page.locator('#previewDialog[open]').waitFor();
  const publicText = await page.locator('#previewContent').textContent();
  assert.doesNotMatch(publicText, /PROPIETARIO_SECRETO|TELEFONO_SECRETO|propietario@example.com|NOTA_INTERNA_SECRETA/);
  assert.equal(await page.locator('#previewContent tbody tr').count(), 83);
  await page.locator('#closePreview').click();
  await downloadPdf('pdf-public', 'approved-public-preview.pdf', 'peritaje-vista-previa-');
  await page.locator('[data-action="publish"]').click();
  await page.waitForFunction(() => document.getElementById('reportStatus')?.textContent.includes('vigente'));
  assert.equal(row.status, 'published');
  assert.equal(await page.locator('[data-action="save"]').count(), 0);
  await downloadPdf('pdf-public', 'published-public.pdf', 'peritaje-publico-');
  await downloadPdf('pdf-internal', 'published-internal.pdf', 'peritaje-interno-');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile layout must not overflow');
  capabilities = { can_edit: false, can_approve: true, can_na: false };
  await page.reload();
  await page.locator('#editor:not([hidden])').waitFor();
  assert.equal(await page.locator('#newInspection').isVisible(), false);
  assert.equal(await page.locator('[data-path]:enabled').count(), 0);
  capabilities = { can_edit: false, can_approve: false, can_na: false };
  const callCount = apiCalls.length;
  await page.reload();
  await page.waitForFunction(() => document.getElementById('notice')?.textContent.includes('no está habilitado'));
  assert.equal(await page.locator('#editor').isVisible(), false);
  assert.match(await page.locator('#sessionIdentity').textContent(), /perito\.ejemplo@example\.invalid.*Sin acceso a peritajes/);
  assert.deepEqual(apiCalls.slice(callCount).map((call) => call.action), ['capabilities']);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', output, items: items.length, categories: CONFIG.categories.length, percentageItems: percentageItems.length, pdfDownloads, exteriorHeight, maxSimpleRowHeight: Math.max(...simpleHeights.map(({ height }) => height)), checks: 'Keyboard radios, pending defaults and clear, direct observations, uniform tire ratings, brake percentage completion including zero and N/A, clearing existing brake N/A after permission loss, save preserves disclosures, history selector, error navigation, limited primary actions, fresh evidence preserving unsaved document/caption, real PDF downloads for incomplete and complete drafts without saving, approved/archived preview and published internal/public PDFs, incomplete rejection, revision flow, locked history, public preview privacy, inline choices and no overflow at 1366/768/390/320px, authenticated identity and denied permissions', pageErrors: errors }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
