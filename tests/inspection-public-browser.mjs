// Optional real-browser smoke test. Requires Playwright and Edge/Chromium, not production dependencies.
// PLAYWRIGHT_MODULE_PATH / RG_INSPECTION_PLAYWRIGHT_PATH: module path (otherwise resolves installed 'playwright').
// RG_INSPECTION_JSPDF_PATH: local jsPDF 2.5.1 UMD (otherwise downloads the existing production CDN asset).
// PLAYWRIGHT_CHANNEL / RG_INSPECTION_BROWSER_CHANNEL: browser channel; Windows defaults to msedge.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectionFixture } from './inspection-fixture.mjs';
import { publicReport } from '../inspections/domain.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || process.env.RG_INSPECTION_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'rgcars-inspection-browser-'));
const pdfLibrary = process.env.RG_INSPECTION_JSPDF_PATH
  ? await readFile(process.env.RG_INSPECTION_JSPDF_PATH)
  : Buffer.from(await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')).arrayBuffer());
const report = publicReport(inspectionFixture());
const brakeItems = report.config.categories.flatMap((category) => category.items).filter((item) => item.scoring === 'percentage');
assert.equal(brakeItems.length, 2);
for (const [index, item] of brakeItems.entries()) report.answers[item.id] = { rating: 'M', value: { percent: index * 100 }, notes: 'Medición de frenos conservada', na_reason: '' };
const historicalReport = structuredClone(report);
for (const item of historicalReport.config.categories.flatMap((category) => category.items)) delete item.scoring;
historicalReport.answers[brakeItems[0].id] = { rating: 'R', value: { percent: 80 }, notes: 'Observación histórica', na_reason: '' };
report.owner = { name: 'CLIENTE_PRIVADO', email: 'privado@example.test' };
report.internal_notes = 'NOTA_PRIVADA';
report.answers['motor-motor'].notes = '<img src=x onerror=alert(1)> Falla de motor confirmada';
report.evidence = [{ id: 'photo', item_id: 'motor-motor', approved_public: true, caption: 'Evidencia aprobada', url: 'https://evidence.test/proof.png' }];
let mode = 'published', photosFail = true, photoRequests = 0, apiCalls = 0;
const html = `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/inspections/public.css">
  <body class="public-theme"><main class="container"><div class="detail-actions"><a class="btn btn-soft" href="#vehicleInspection" data-inspection-link aria-controls="vehicleInspection" hidden>Ver peritaje</a></div><section id="vehicleInspection" hidden></section></main>
  <script>window.RG={INSPECTIONS_ENDPOINT:'/api/inspections.php'}</script>
  <script type="module">import {mountPublicInspection} from '/inspections/public.mjs'; await mountPublicInspection('2'); window.ready=true;</script></body></html>`;
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/qa') { response.setHeader('content-type', 'text/html'); response.end(html); return; }
    const filename = resolve(root, `.${request.url.split('?')[0]}`);
    if (!filename.startsWith(root + sep)) throw new Error('path');
    response.setHeader('content-type', filename.endsWith('.css') ? 'text/css' : filename.endsWith('.mjs') ? 'text/javascript' : 'text/plain');
    response.end(await readFile(filename));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || process.env.RG_INSPECTION_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/inspections.php', async (route) => {
    apiCalls++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mode === 'none' ? null : mode === 'historical' ? historicalReport : report }) });
  });
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: pdfLibrary }));
  await page.route('https://evidence.test/proof.png', async (route) => {
    photoRequests++;
    await route.fulfill(photosFail ? { status: 404, body: '' } : {
      status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH3sAAAAASUVORK5CYII=', 'base64'),
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/qa`);
  await page.waitForFunction(() => window.ready);
  assert.equal(await page.locator('.inspection-public progress').count(), 8);
  const inspectionLink = page.getByRole('link', { name: 'Ver peritaje', exact: true });
  assert.equal(await inspectionLink.isVisible(), true);
  await inspectionLink.click();
  await page.waitForSelector('.inspection-public__item', { state: 'attached' });
  assert.equal(await page.locator('.inspection-public__details').getAttribute('open'), '');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'vehicleInspection');
  await page.locator('.inspection-public__details > summary').click();
  await page.screenshot({ path: join(output, 'public-desktop.png') });
  await page.locator('.inspection-public__details > summary').click();
  await page.waitForSelector('.inspection-public__item', { state: 'attached' });
  assert.equal(await page.locator('.inspection-public__item').count(), 83);
  await page.locator('.inspection-public__category').evaluateAll((nodes) => nodes.forEach((node) => { node.open = true; }));
  const content = await page.locator('#vehicleInspection').innerText();
  assert.match(content, /Falla de motor confirmada/); assert.match(content, /No apto/);
  assert.match(content, /205\/55 R16/); assert.match(content, /La unidad no equipa turbo/);
  assert.doesNotMatch(content, /Excelente/);
  for (const [index, item] of brakeItems.entries()) {
    const row = page.locator('.inspection-public__item').filter({ has: page.locator('.inspection-public__item-heading strong', { hasText: item.label }) });
    assert.equal(await row.locator('.inspection-public__rating').innerText(), `${index * 100} %`);
    assert.equal(await row.locator('.inspection-public__rating--percentage').count(), 1);
    assert.equal(await row.locator('.inspection-public__item-detail').count(), 0, 'The percentage should appear only once.');
    assert.match(await row.innerText(), /Medición de frenos conservada/);
  }
  assert.doesNotMatch(content, /CLIENTE_PRIVADO|NOTA_PRIVADA|privado@example|PERITO_PRIVADO|FIRMA_PRIVADA/);
  assert.equal(await page.locator('img[src=x]').count(), 0);
  const chassisCategory = page.locator('.inspection-public__category').filter({ has: page.locator('summary', { hasText: /^CHASIS/ }) });
  await chassisCategory.screenshot({ path: join(output, 'public-brakes-desktop.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: join(output, 'public-mobile.png') });
  await chassisCategory.screenshot({ path: join(output, 'public-brakes-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  async function download(name) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar informe PDF' }).click();
    const file = await pending; assert.match(file.suggestedFilename(), /^peritaje-publico-/);
    await file.saveAs(join(output, name));
    await page.waitForFunction(() => !document.querySelector('.inspection-public__actions button').disabled);
  }
  await download('missing-photo.pdf');
  assert.match(await page.locator('.inspection-public__download-status').innerText(), /1 fotografía\(s\) no disponible/);
  const beforeRetry = photoRequests;
  photosFail = false;
  await download('public-complete.pdf');
  assert.ok(photoRequests > beforeRetry, 'missing photos were not frozen in the PDF cache');
  assert.equal(await page.locator('.inspection-public__download-status').innerText(), 'Informe listo para descargar.');
  assert.ok(apiCalls >= 3, 'downloads refresh evidence URLs');
  report.answers[brakeItems[0].id].value.percent = 50;
  await page.reload(); await page.waitForFunction(() => window.ready);
  await inspectionLink.click(); await page.waitForSelector('.inspection-public__item', { state: 'attached' });
  const brakeRow = page.locator('.inspection-public__item').filter({ has: page.locator('.inspection-public__item-heading strong', { hasText: brakeItems[0].label }) });
  assert.equal(await brakeRow.locator('.inspection-public__rating').textContent(), '50 %');
  mode = 'historical';
  await page.reload(); await page.waitForFunction(() => window.ready);
  await inspectionLink.click(); await page.waitForSelector('.inspection-public__item', { state: 'attached' });
  assert.equal(await brakeRow.locator('.inspection-public__rating').textContent(), 'Regular');
  assert.match(await brakeRow.locator('.inspection-public__item-detail').textContent(), /80 %/);
  assert.match(await brakeRow.locator('.inspection-public__notes').textContent(), /Observación histórica/);
  mode = 'none'; await page.reload(); await page.waitForFunction(() => window.ready);
  assert.equal(await page.locator('#vehicleInspection').isVisible(), false);
  assert.equal(await page.locator('#vehicleInspection').innerText(), '');
  assert.equal(await inspectionLink.isVisible(), false);
  assert.deepEqual(errors, []);
  const result = { output, desktop: '1440x1100', mobile: '390x900', items: 83, bars: 8, viewInspectionLink: true, noOverflow: true, noPrivateFields: true, noReportHidden: true, pdfDownloaded: true, missingPhotoRetry: true, percentageStates: [0, 50, 100], historicalBrakeState: true, pageErrors: errors };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
