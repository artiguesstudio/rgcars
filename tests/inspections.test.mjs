import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, scoreInspection, validateConfig, validateDocument, validateAnswer, createDocument, createSnapshot, publicReport, internalReport, authorize, canTransition, usesPercentageScore, isAnswerComplete } from '../inspections/domain.mjs';
import { completeDocument, publishedRow, legacyConfig } from './inspection-fixtures.mjs';

const items = CONFIG.categories.flatMap(category => category.items);
const brakeItems = items.filter(usesPercentageScore);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('exact catalog: 8 categories, 83 stable unique items, original weights and maximums', () => {
  assert.equal(CONFIG.categories.length, 8);
  assert.equal(items.length, 83);
  assert.equal(new Set(items.map(item => item.id)).size, 83);
  assert.deepEqual(CONFIG.categories.map(category => category.items.length), [29, 11, 5, 11, 12, 6, 6, 3]);
  assert.deepEqual(CONFIG.categories.map(category => category.max), [17.5, 12.5, 4, 12.5, 16.5, 16.5, 16.5, 4]);
  assert.deepEqual(CONFIG.categories.map(category => category.items.map(item => item.weight)), [
    [1,10,1,3,7,1,5,10,1,1,2,2,2,2,2,10,10,1,5,1,2,2,2,1,5,10,1,10,10],
    [15,8,20,2,16,15,2,2,8,2,10], [20,20,20,20,20], [4,4,2,10,15,20,20,5,10,5,5],
    [1,20,5,5,5,15,5,10,2,5,5,5], [4,4,4,4,4,2], [3,3,20,20,30,24], [30,10,10],
  ]);
  assert.deepEqual(CONFIG.categories.map(category => category.items.reduce((sum, item) => sum + item.weight, 0)), [120,100,100,100,83,22,100,50]);
  assert.equal(items.find(item => item.id === 'chasis-tasas').label, 'Tasas');
  assert.equal(items.find(item => item.id === 'exterior-pintura').partition, 'original_paint');
  assert.equal(CONFIG.version, 'rgcars-83-v2');
  assert.equal(CONFIG.scale_version, 'propuesta-interna-v2');
  assert.deepEqual(brakeItems.map(item => item.id), ['chasis-frenos-delantero', 'chasis-frenos-trasero']);
});

test('percentage scoring metadata is explicit and valid only on percentage measurements', () => {
  assert.equal(validateConfig(legacyConfig()).version, 'rgcars-83-v1');
  for (const scoring of [null, 'rating', true, 50]) {
    const config = structuredClone(CONFIG); config.categories[4].items[9].scoring = scoring;
    assert.throws(() => validateConfig(config), /Criterio de puntuación inválido/);
  }
  const config = structuredClone(CONFIG); config.categories[0].items[0].scoring = 'percentage';
  assert.throws(() => validateConfig(config), /Criterio de puntuación inválido/);
});

test('brake life percentages 0, 50, 100 and fractions contribute their weighted value without a rating', () => {
  for (const percent of [0, 50, 100, 12.5, 73.125]) {
    const document = completeDocument();
    for (const item of brakeItems) document.answers[item.id] = { value: { percent } };
    const score = scoreInspection(document.answers), category = score.categories.find(entry => entry.id === 'chasis');
    assert.equal(score.complete, true); assert.equal(category.denominator, 83);
    near(category.numerator, 73 + 10 * percent / 100);
    near(category.points, 16.5 * (73 + 10 * percent / 100) / 83);
    near(score.total_100, 83.5 + category.points);
    assert.deepEqual(validateDocument(document, { final: true }), []);
    for (const item of brakeItems) assert.equal(isAnswerComplete(document.answers[item.id], item), true);
  }
});

test('a saved brake rating does not alter its new percentage contribution', () => {
  const results = [];
  for (const rating of [null, 'B', 'R', 'M']) {
    const document = completeDocument();
    for (const item of brakeItems) document.answers[item.id] = { rating, value: { percent: 35 } };
    results.push(scoreInspection(document.answers));
  }
  for (const score of results) assert.deepEqual(score, results[0]);
});

test('brake percentage validation accepts zero, preserves incomplete drafts and rejects malformed values', () => {
  for (const item of brakeItems) {
    for (const percent of [-1, 101, '50', false, true, NaN, Infinity, -Infinity]) {
      const answer = { value: { percent } };
      for (const final of [false, true]) assert.ok(validateAnswer(answer, item, { final }).some(error => error.path.endsWith('.value.percent')));
      assert.equal(isAnswerComplete(answer, item), false);
    }
    for (const answer of [undefined, {}, { rating: null, value: {} }, { value: { percent: null } }, { value: { percent: '' } }]) {
      assert.deepEqual(validateAnswer(answer, item), []);
      assert.equal(isAnswerComplete(answer, item), false);
      const document = completeDocument(); document.answers[item.id] = answer;
      const score = scoreInspection(document.answers);
      assert.equal(score.complete, false); assert.equal(score.total_100, null);
      assert.equal(score.categories.find(category => category.id === 'chasis').pending, 1);
    }
    assert.deepEqual(validateAnswer({ value: { percent: 0 } }, item, { final: true }), []);
    assert.ok(validateAnswer({ rating: 'Excelente', value: { percent: 100 } }, item, { final: true }).length);
  }
});

test('brakes retain justified, permitted N/A with the original category maximum', () => {
  const document = completeDocument();
  for (const item of brakeItems) {
    const answer = { rating: 'NA', na_reason: 'No corresponde a esta unidad', value: {} };
    document.answers[item.id] = answer;
    assert.equal(isAnswerComplete(answer, item), true);
    assert.equal(isAnswerComplete(answer, item, { allowNA: false }), false);
    assert.equal(isAnswerComplete({ ...answer, na_reason: '' }, item), false);
  }
  const score = scoreInspection(document.answers), category = score.categories.find(entry => entry.id === 'chasis');
  assert.equal(category.denominator, 73); assert.equal(category.points, 16.5); assert.equal(score.total_100, 100);
});

test('v1 approved snapshots preserve brake ratings and their historical scores', () => {
  const document = completeDocument('R');
  for (const item of brakeItems) document.answers[item.id].value.percent = 0;
  const config = legacyConfig(), snapshot = createSnapshot(document, config);
  assert.equal(snapshot.score.total_100, 50);
  assert.ok(scoreInspection(document.answers).total_100 < 50);
  const row = { ...publishedRow(document), scoring_snapshot: snapshot };
  assert.equal(publicReport(row).score.total_100, 50);
  assert.equal(internalReport(row).score.total_100, 50);
  const oldItem = config.categories[4].items[9];
  assert.equal(usesPercentageScore(oldItem), false);
  assert.ok(validateAnswer({ value: { percent: 50 } }, oldItem, { final: true }).some(error => error.path.endsWith('.rating')));
});

for (const [rating, total, note] of [['B', 100, 10], ['R', 50, 5], ['M', 0, 0]]) {
  test(`all ${rating}: ${total}/100 and ${note}/10`, () => {
    const document = completeDocument(rating);
    assert.deepEqual(validateDocument(document, { final: true }), []);
    const score = scoreInspection(document.answers);
    assert.equal(score.complete, true); assert.equal(score.total_100, total); assert.equal(score.nota_10, note);
  });
}

test('only Motor bad: 11.55 category, 95.05 total, exact 9.505 before display rounding', () => {
  const document = completeDocument(); document.answers['motor-motor'].rating = 'M';
  const score = scoreInspection(document.answers);
  near(score.categories.find(category => category.id === 'motor').points, 11.55);
  near(score.total_100, 95.05); near(score.nota_10, 9.505);
  assert.equal(document.fitness, 'Apto'); // A decision, never a score-derived mutation.
});

test('justified Turbo N/A excludes only its section denominator, preserving 16.5', () => {
  const document = completeDocument(); Object.assign(document.answers['motor-turbo'], { rating: 'NA', na_reason: 'La unidad no equipa turbo.' });
  const score = scoreInspection(document.answers), motor = score.categories.find(category => category.id === 'motor');
  assert.equal(motor.denominator, 76); assert.equal(motor.points, 16.5); assert.equal(score.total_100, 100);
  assert.equal(score.categories[0].denominator, 120);
});

test('pending, missing and unjustified N/A never produce a final score', () => {
  for (const answer of [null, undefined, { rating: null, value: {} }, { rating: 'NA', na_reason: '', value: {} }]) {
    const document = completeDocument(); document.answers['motor-turbo'] = answer;
    const score = scoreInspection(document.answers);
    assert.equal(score.complete, false); assert.equal(score.total_100, null); assert.equal(score.nota_10, null);
    assert.equal(score.categories.find(category => category.id === 'motor').denominator, 100);
  }
  assert.equal(scoreInspection(createDocument().answers).nota_10, null);
});

test('an entirely N/A category needs manual review; no perfect score or redistribution', () => {
  const document = completeDocument();
  for (const item of CONFIG.categories[7].items) document.answers[item.id] = { rating: 'NA', na_reason: 'Equipamiento no instalado', value: {} };
  const score = scoreInspection(document.answers), category = score.categories[7];
  assert.equal(category.non_evaluable, true); assert.equal(category.points, null); assert.equal(score.nota_10, null);
  assert.ok(validateDocument(document, { final: true }).some(error => error.path === 'categories.varios'));
});

test('input validation rejects invalid measurements, dates, ratings, conflicting windshield and excess data', () => {
  const cases = [
    ['exterior-pintura', { rating: 'B', value: { percent: 101 } }],
    ['exterior-pintura', { rating: 'B', value: { percent: -1 } }],
    ['exterior-pintura', { rating: 'B', value: { percent: '90' } }],
    ['exterior-pintura', { rating: 'B', value: { percent: Infinity } }],
    ['exterior-parabrisas', { rating: 'B', value: { findings: ['Sin daños', 'Fisuras'] } }],
    ['neumaticos-auxilio', { rating: 'B', value: { brand: 'A', size: 'R16', wear_percent: 30, depth_mm: -2 } }],
    ['motor-motor', { rating: 'Bueno', value: {} }],
    ['motor-motor', { rating: 'B', value: {}, notes: 'x'.repeat(2001) }],
    ['motor-motor', { rating: 'B', value: { injected: true } }],
  ];
  for (const [id, answer] of cases) assert.ok(validateAnswer(answer, items.find(item => item.id === id)).length, id);
  const document = completeDocument(); document.inspection_date = '2026-02-30';
  assert.ok(validateDocument(document).length);
  document.inspection_date = '2026-10-14'; document.signature.image_data_url = 'data:image/svg+xml;base64,xxx';
  assert.ok(validateDocument(document).some(error => error.path === 'signature.image_data_url'));
});

test('required technical details and explicit verdict/signature required even with every rating good', () => {
  for (const item of items.filter(item => item.type !== 'state' && item.details_required !== false)) {
    const document = completeDocument(); document.answers[item.id].value = {};
    assert.equal(scoreInspection(document.answers).complete, false, item.id);
    assert.equal(validateDocument(document).length, 0, 'partial drafts can be saved');
  }
  for (const key of ['fitness', 'risk', 'verdict_reason', 'inspector_name']) {
    const document = completeDocument(); document[key] = null;
    assert.ok(validateDocument(document, { final: true }).length, key);
    assert.throws(() => createSnapshot(document));
  }
  const withoutZone = completeDocument(); withoutZone.answers['exterior-golpes'].value.zone = '';
  assert.equal(scoreInspection(withoutZone.answers).complete, false);
  assert.ok(validateDocument(withoutZone, { final: true }).some(error => error.path === 'answers.exterior-golpes.value.zone'));
});

test('every tire accepts only its rating while retaining and validating legacy technical details', () => {
  const document = completeDocument(), config = legacyConfig();
  for (const item of items.filter(item => item.type === 'tire')) {
    assert.equal(item.details_required, false);
    for (const rating of ['B', 'R', 'M']) assert.equal(isAnswerComplete({ rating }, item), true);
    assert.equal(isAnswerComplete({}, item), false);
    document.answers[item.id] = { rating: 'B', notes: 'Sin detalles técnicos adicionales', value: {} };
    assert.deepEqual(validateAnswer(document.answers[item.id], item, { final: true }), []);
    const oldItem = config.categories.flatMap(category => category.items).find(entry => entry.id === item.id);
    assert.equal(isAnswerComplete(document.answers[item.id], oldItem), false);
    assert.ok(validateAnswer({ rating: 'B', value: { wear_percent: 101 } }, item, { final: true }).length);
    assert.ok(validateAnswer({ rating: 'B', value: { brand: 123 } }, item, { final: true }).length);
  }
  assert.equal(scoreInspection(document.answers).total_100, 100);
  assert.deepEqual(validateDocument(document, { final: true }), []);
});

test('configuration and snapshots are immutable copies; new criteria never recalculate historical reports', () => {
  const document = completeDocument('R'), row = publishedRow(document);
  const historical = row.scoring_snapshot;
  document.answers['motor-motor'].rating = 'M';
  assert.equal(historical.answers['motor-motor'].rating, 'R');
  assert.throws(() => { historical.config.factors.R = 0.2; }, TypeError);
  assert.throws(() => { CONFIG.categories[0].max = 99; }, TypeError);
  const nextConfig = structuredClone(CONFIG); nextConfig.version = 'next'; nextConfig.factors.R = 0.75;
  assert.notEqual(scoreInspection(historical.answers, nextConfig).nota_10, historical.score.nota_10);
  assert.equal(publicReport(row).score.nota_10, 5);
});

test('public DTO excludes client PII, private notes, unapproved photos, storage keys and signatures', () => {
  const document = completeDocument();
  document.owner = { name: 'PRIVATE_OWNER', phone: 'PRIVATE_PHONE', email: 'private@example.test' };
  document.internal_notes = 'PRIVATE_INTERNAL'; document.inspector_name = 'PRIVATE_INSPECTOR';
  document.signature.name = 'PRIVATE_SIGNATURE';
  document.answers['motor-motor'].rating = 'M'; document.answers['motor-motor'].notes = 'Pérdida de aceite observada.';
  const row = publishedRow(document);
  const evidence = [
    { id: '1', item_id: 'motor-motor', approved_public: false, signed_url: 'https://example.test/PRIVATE_PHOTO', caption: 'PRIVATE_CAPTION' },
    { id: '2', item_id: 'motor-motor', approved_public: true, signed_url: 'https://example.test/approved', caption: 'Pérdida', storage_path: 'PRIVATE_STORAGE', uploaded_by: 'PRIVATE_USER' },
  ];
  const report = publicReport(row, evidence), json = JSON.stringify(report);
  assert.doesNotMatch(json, /PRIVATE_|private@example/);
  assert.equal(report.evidence.length, 1);
  assert.equal(report.answers['motor-motor'].rating, 'M'); assert.match(json, /Pérdida de aceite/);
  assert.equal(Object.keys(report.answers).length, 83);
  assert.equal(internalReport(row, evidence).owner.name, 'PRIVATE_OWNER');
  document.signature.consent_public = true; document.show_inspector = true;
  const consented = publicReport(publishedRow(document));
  assert.equal(consented.signature.consent_public, true); assert.equal(consented.inspector_name, 'PRIVATE_INSPECTOR');
});

test('unpublished, incomplete or unapproved inspections have no public projection', () => {
  const row = publishedRow();
  for (const status of ['draft', 'in_review', 'approved', 'archived']) assert.equal(publicReport({ ...row, status }), null);
  assert.equal(publicReport({ ...row, approved_at: null }), null);
  assert.equal(publicReport({ ...row, scoring_snapshot: null }), null);
  assert.ok(publicReport({ ...row, status: 'approved' }, [], { preview: true }));
  assert.equal(publicReport({ ...row, status: 'draft' }, [], { preview: true }), null);
});

test('permissions default deny, inspector cannot approve/publish, invalid status jumps rejected', () => {
  const editor = { can_edit: true, can_approve: false, can_na: false };
  const admin = { can_edit: true, can_approve: true, can_na: true };
  assert.equal(authorize({}, 'get'), false); assert.equal(authorize({}, 'save'), false);
  assert.equal(authorize(editor, 'save'), true); assert.equal(authorize(editor, 'publish'), false);
  assert.equal(authorize(editor, 'na'), false); assert.equal(authorize(admin, 'na'), true);
  assert.equal(canTransition('draft', 'in_review', editor), true);
  assert.equal(canTransition('in_review', 'approved', editor), false);
  assert.equal(canTransition('draft', 'published', admin), false);
  assert.equal(canTransition('approved', 'published', admin), true);
  assert.equal(canTransition('published', 'draft', admin), false);
  assert.equal(canTransition('archived', 'draft', admin), false);
  const document = completeDocument(); Object.assign(document.answers['motor-turbo'], { rating: 'NA', na_reason: 'Sin turbo' });
  assert.ok(validateDocument(document, { allowNA: false }).length);
});

test('vehicle prefill makes a separate historical copy and never overwrites catalog', () => {
  const vehicle = { brand: 'A', model: 'B', plate: 'ABC123', km: 10000 };
  const document = createDocument(vehicle); document.vehicle.km = 15000;
  assert.equal(vehicle.km, 10000); vehicle.plate = 'NEW123'; assert.equal(document.vehicle.plate, 'ABC123');
});
