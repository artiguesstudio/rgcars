import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG, createDocument, scoreInspection, validateConfig, validateAnswer, validateDocument, createSnapshot, publicReport, internalReport, authorize, canTransition, usesPercentageScore } from '../inspections/domain.mjs';
import { completeDocument, publishedRow, legacyConfig } from './inspection-fixtures.mjs';

const php = process.env.PHP_BIN || 'php';
let phpAvailable = false;
try { execFileSync(php, ['-v'], { stdio: 'ignore' }); phpAvailable = true; } catch { /* PHP is optional for browser-only contributors. */ }
const requiresPhp = { skip: !phpAvailable && 'Set PHP_BIN to a PHP 8.1+ CLI to run PHP/JS parity.' };
const items = CONFIG.categories.flatMap((category) => category.items);
const brakeItems = items.filter(usesPercentageScore);
const runner = fileURLToPath(new URL('./inspection-php-runner.php', import.meta.url));
const batch = (commands) => JSON.parse(execFileSync(php, [runner], { input: JSON.stringify(commands), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
function equivalent(actual, expected, path = 'result') {
  if (typeof expected === 'number') { assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-10, `${path}: ${actual} != ${expected}`); return; }
  if (expected === null || typeof expected !== 'object') { assert.deepEqual(actual, expected, path); return; }
  assert.equal(Array.isArray(actual), Array.isArray(expected), `${path} array/object shape`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`);
  for (const key of Object.keys(expected)) equivalent(actual[key], expected[key], `${path}.${key}`);
}

test('PHP seed is generated exactly from the sole 83-item JS configuration', () => {
  const seed = JSON.parse(readFileSync(new URL('../api/inspections/config.json', import.meta.url), 'utf8'));
  assert.deepEqual(seed, CONFIG);
  assert.equal(seed.categories.length, 8);
  assert.equal(seed.categories.flatMap((category) => category.items).length, 83);
});

test('PHP scoring matches JS for all required mathematical examples and pending/N/A', requiresPhp, () => {
  const documents = ['B','R','M'].map((rating) => completeDocument(rating));
  const motorBad = completeDocument(); motorBad.answers['motor-motor'].rating = 'M'; documents.push(motorBad);
  const noTurbo = completeDocument(); Object.assign(noTurbo.answers['motor-turbo'], { rating: 'NA', na_reason: 'No equipa turbo' }); documents.push(noTurbo);
  for (const answer of [null, { rating: null, value: {} }, { rating: 'NA', na_reason: '', value: {} }]) { const doc = completeDocument(); doc.answers['motor-turbo'] = answer; documents.push(doc); }
  const allNa = completeDocument(); for (const item of CONFIG.categories[7].items) allNa.answers[item.id] = { rating: 'NA', na_reason: 'No instalado', value: {} }; documents.push(allNa);
  const results = batch(documents.map((doc) => ({ op: 'score', value: doc.answers })));
  results.forEach((result, index) => equivalent(result, scoreInspection(documents[index].answers)));
  assert.equal(results[0].nota_10, 10); assert.equal(results[1].nota_10, 5); assert.equal(results[2].nota_10, 0);
  assert.ok(Math.abs(results[3].nota_10 - 9.505) < 1e-10);
  assert.equal(results[4].categories.find((category) => category.id === 'motor').denominator, 76);
  assert.equal(results[8].nota_10, null);
});

test('PHP brake percentage scoring matches JS for zero, half, full and fractional life without ratings', requiresPhp, () => {
  const commands = [];
  for (const percent of [0, 50, 100, 12.5, 73.125]) for (const rating of [undefined, null, 'B', 'R', 'M']) {
    const document = completeDocument();
    for (const item of brakeItems) document.answers[item.id] = { ...(rating === undefined ? {} : { rating }), value: { percent } };
    commands.push({ op: 'score', value: document.answers }, { op: 'validate', value: document, options: { final: true } });
  }
  batch(commands).forEach((result, index) => {
    const command = commands[index];
    equivalent(result, command.op === 'score' ? scoreInspection(command.value) : validateDocument(command.value, command.options));
  });
});

test('PHP brake drafts, pending values, N/A permissions and validation match JS', requiresPhp, () => {
  const commands = [];
  const answers = [null, {}, { rating: null, value: {} }, { value: { percent: 0 } }, { value: { percent: null } },
    ...[-1, 101, '50', false, true, ''].map(percent => ({ value: { percent } })),
    { rating: 'Excelente', value: { percent: 100 } }, { rating: 'NA', value: {} },
    { rating: 'NA', na_reason: 'No corresponde', value: {} }];
  for (const item of brakeItems) for (const value of answers) for (const final of [false, true]) for (const allowNA of [false, true]) {
    commands.push({ op: 'answer', value, item, options: { final, allowNA } });
  }
  batch(commands).forEach((result, index) => equivalent(result, validateAnswer(commands[index].value, commands[index].item, commands[index].options)));
  const document = completeDocument();
  document.answers[brakeItems[0].id] = { value: {} };
  equivalent(batch([{ op: 'score', value: document.answers }])[0], scoreInspection(document.answers));
});

test('PHP v2 tire ratings need no technical details while legacy details remain validated', requiresPhp, () => {
  const commands = [];
  for (const item of items.filter(entry => entry.type === 'tire')) {
    const oldItem = legacyConfig().categories.flatMap(category => category.items).find(entry => entry.id === item.id);
    for (const value of [{ rating: 'B' }, { rating: 'R', value: {} }, { rating: 'M', value: { wear_percent: 40 } },
      { rating: 'B', value: { wear_percent: '40' } }, { rating: 'B', value: { depth_mm: -1 } }]) {
      for (const configItem of [item, oldItem]) commands.push({ op: 'answer', value, item: configItem, options: { final: true } });
    }
  }
  batch(commands).forEach((result, index) => equivalent(result, validateAnswer(commands[index].value, commands[index].item, commands[index].options)));
});

test('PHP config validation accepts legacy rules and rejects invalid scoring or detail metadata', requiresPhp, () => {
  const configs = [CONFIG, legacyConfig()];
  for (const scoring of [null, 'rating', true, 50]) {
    const config = structuredClone(CONFIG); config.categories[4].items[9].scoring = scoring; configs.push(config);
  }
  const nonPercentage = structuredClone(CONFIG); nonPercentage.categories[0].items[0].scoring = 'percentage'; configs.push(nonPercentage);
  for (const details of [null, 'false', 0]) {
    const config = structuredClone(CONFIG); config.categories[5].items[0].details_required = details; configs.push(config);
  }
  const results = batch(configs.map(value => ({ op: 'validate_config', value })));
  results.forEach((result, index) => {
    let expected;
    try { expected = validateConfig(configs[index]); } catch (error) { expected = { error: error.message, details: [] }; }
    equivalent(result, expected);
  });
});

test('PHP approved v1 snapshot reports retain rating-based brakes after the v2 update', requiresPhp, () => {
  const document = completeDocument('R'), config = legacyConfig();
  for (const item of brakeItems) document.answers[item.id].value.percent = 0;
  const snapshot = createSnapshot(document, config), row = { ...publishedRow(document), scoring_snapshot: snapshot };
  const results = batch([{ op: 'snapshot', value: document, config }, { op: 'public', value: row }, { op: 'internal', value: row }]);
  equivalent(results[0], snapshot); equivalent(results[1], publicReport(row)); equivalent(results[2], internalReport(row));
  assert.equal(results[1].score.total_100, 50);
  assert.ok(scoreInspection(document.answers).total_100 < 50);
});

test('PHP validation rejects invalid inputs with the same field errors as JS', requiresPhp, () => {
  const cases = [
    ['exterior-pintura',{rating:'B',value:{percent:-1}}], ['exterior-pintura',{rating:'B',value:{percent:101}}],
    ['exterior-pintura',{rating:'B',value:{percent:'90'}}], ['exterior-pintura',{rating:'B',value:{percent:true}}],
    ['exterior-parabrisas',{rating:'B',value:{findings:['Sin daños','Fisuras']}}], ['exterior-parabrisas',{rating:'B',value:{findings:['Impactos','Impactos']}}],
    ['exterior-parabrisas',{rating:'B',value:{findings:null}}], ['exterior-parabrisas',{rating:'R',value:{findings:['Fisuras','Impactos']}}],
    ['neumaticos-auxilio',{rating:'B',value:{brand:'Marca',size:'205/55 R16',wear_percent:30,depth_mm:-1}}],
    ['exterior-golpes',{rating:'B',value:{detail:'Daño',zone:''}}], ['motor-motor',{rating:'Bueno',value:{}}],
    ['motor-motor',{rating:'B',value:{injected:true}}], ['motor-motor',{rating:'B',value:{},notes:'á'.repeat(2001)}],
    ['motor-motor',{rating:'B',value:{},notes:'🚗'.repeat(1001)}], ['motor-motor',{rating:'B',value:{},notes:'texto\u0001'}],
    ['motor-turbo',{rating:'NA',na_reason:'No equipa',value:{}}], ['motor-motor',{rating:null,value:42}],
    ['motor-motor','invalid'], ['motor-motor',[{rating:'B'}]], ['motor-motor',{}], ['motor-motor',[]], ['motor-motor',{rating:'B',value:[]}],
  ];
  const commands = cases.flatMap(([id,value]) => [true,false].map((final) => ({ op:'answer',value,item:items.find((item)=>item.id===id),options:{final,allowNA:false} })));
  const results = batch(commands);
  results.forEach((result,index) => equivalent(result,validateAnswer(commands[index].value,commands[index].item,commands[index].options)));
});

test('PHP transport preserves empty value objects and never coerces booleans or null measurements', requiresPhp, () => {
  const document=completeDocument();document.answers['exterior-pintura'].value.percent=null;
  const malformed=structuredClone(document);malformed.answers['exterior-pintura'].value.percent=false;
  const [created,emptyScore,nullScore,falseScore,missingDocument,arrayScore] = batch([
    {op:'create',value:{}}, {op:'score',value:{}}, {op:'score',value:document.answers},
    {op:'score',value:malformed.answers}, {op:'validate',value:null}, {op:'score',value:[]},
  ]);
  equivalent(created,createDocument({}));equivalent(emptyScore,scoreInspection({}));
  equivalent(nullScore,scoreInspection(document.answers));equivalent(falseScore,scoreInspection(malformed.answers));
  equivalent(missingDocument,validateDocument(null));
  equivalent(arrayScore,scoreInspection([]));
  assert.deepEqual(created.answers['motor-motor'].value,{});
  assert.equal(falseScore.nota_10,null);
});

test('PHP full-document validation and snapshot checks match browser rules', requiresPhp, () => {
  const documents = [completeDocument(), createDocument()];
  const invalid = [
    (doc)=>{doc.inspection_date='2026-02-30';}, (doc)=>{doc.owner.email='invalid';},
    (doc)=>{doc.vehicle.km='30000';}, (doc)=>{doc.vehicle.year=1700;},
    (doc)=>{doc.signature.image_data_url='data:image/svg+xml;base64,xxx';},
    (doc)=>{doc.signature.signed_at='invalid-date';}, (doc)=>{doc.signature.consent_public='true';},
    (doc)=>{doc.signature.signed_at='tomorrow';},
    (doc)=>{doc.show_inspector=null;}, (doc)=>{doc.fitness=null;}, (doc)=>{doc.risk='Seguro';},
    (doc)=>{doc.verdict_reason='';}, (doc)=>{doc.extra='not allowed';}, (doc)=>{doc.owner.secret='forbidden';},
    (doc)=>{doc.answers.unknown={rating:'B'};}, (doc)=>{doc.answers=null;}, (doc)=>{doc.owner=[];}, (doc)=>{doc.signature=[];}, (doc)=>{doc.answers=[];},
  ];
  for(const mutate of invalid){const document=completeDocument();mutate(document);documents.push(document);}
  const commands=documents.flatMap((value)=>[true,false].map((final)=>({op:'validate',value,options:{final}})));
  batch(commands).forEach((result,index)=>equivalent(result,validateDocument(commands[index].value,commands[index].options)));
  const [snapshot,rejected] = batch([{op:'snapshot',value:documents[0]},{op:'snapshot',value:documents[1]}]);
  equivalent(snapshot,createSnapshot(documents[0]));
  assert.equal(rejected.error,'El peritaje está incompleto o es inválido.');
  equivalent(rejected.details,validateDocument(documents[1],{final:true}));
});

test('PHP public projection strips PII, preserves adverse findings and withholds unpublished reports', requiresPhp, () => {
  const doc = completeDocument(); doc.owner={name:'PRIVATE_OWNER',phone:'PRIVATE_PHONE',email:'private@example.test'};
  doc.internal_notes='PRIVATE_INTERNAL';doc.inspector_name='PRIVATE_INSPECTOR';doc.signature.name='PRIVATE_SIGNATURE';
  doc.answers['motor-motor'].rating='M';doc.answers['motor-motor'].notes='Pérdida de aceite observada';
  const row=publishedRow(doc);
  const evidence=[{id:'1',item_id:'motor-motor',approved_public:false,signed_url:'https://example.test/PRIVATE_PHOTO',caption:'PRIVATE_CAPTION'},
    {id:'2',item_id:'motor-motor',approved_public:true,signed_url:'https://example.test/photo',caption:'Pérdida',storage_path:'PRIVATE_STORAGE'}];
  const commands=[{op:'public',value:row,evidence},{op:'internal',value:row,evidence}];
  for(const status of ['draft','in_review','approved','archived']) commands.push({op:'public',value:{...row,status},evidence});
  commands.push({op:'public',value:{...row,status:'approved'},options:{preview:true},evidence});
  const results=batch(commands);
  results.forEach((result,index)=>equivalent(result,commands[index].op==='internal'?internalReport(commands[index].value,evidence):publicReport(commands[index].value,evidence,commands[index].options)));
  assert.doesNotMatch(JSON.stringify(results[0]),/PRIVATE_|private@example/);
  assert.match(JSON.stringify(results[0]),/Pérdida de aceite observada/);
  assert.equal(Object.keys(results[0].answers).length,83);
  doc.show_inspector=true;doc.signature.consent_public=true;
  equivalent(batch([{op:'public',value:publishedRow(doc)}])[0],publicReport(publishedRow(doc)));
});

test('PHP historical snapshots use their own scale and prefill preserves the catalog copy', requiresPhp, () => {
  const vehicle={brand:'A',model:'B',version:'V',plate:'ABC123',km:'10000',year:2020};
  equivalent(batch([{op:'create',value:vehicle}])[0],createDocument(vehicle));
  const document=completeDocument('R');const config=legacyConfig();config.version='old-criterion';config.factors.R=0.7;
  const row=publishedRow(document);row.scoring_snapshot=createSnapshot(document,config);
  row.document.answers['motor-motor'].rating='M';
  const report=batch([{op:'public',value:row}])[0];
  equivalent(report,publicReport(row));assert.ok(Math.abs(report.score.nota_10-7)<1e-10);
});

test('PHP and JS require real absolute ISO conformity dates, never normalized or relative dates', requiresPhp, () => {
  const dates = ['2026-10-14', '2026-10-14T12:30', '2026-10-14T12:30:45.123Z', '2026-10-14T12:30:45-03:00', '2024-02-29T00:00:00Z',
    '2026-02-31', '2026-02-31T12:00:00Z', '2026-02-29T12:00:00Z', '0000-01-01', 'tomorrow', 'now', 'next Monday', '10/14/2026', '2026-10-14T24:00:00Z'];
  const commands = dates.map((date) => { const value = completeDocument(); value.signature.signed_at = date; return { op:'validate',value,options:{final:true} }; });
  const results = batch(commands);
  results.forEach((result,index) => {
    equivalent(result,validateDocument(commands[index].value,{final:true}));
    assert.equal(result.some((error)=>error.path==='signature.signed_at'), index>=5, dates[index]);
  });
});

test('PHP authorization and lifecycle parity denies unauthorized transitions', requiresPhp, () => {
  const caps=[{}, {can_edit:true,can_approve:false,can_na:false},{can_edit:true,can_approve:true,can_na:true},{can_edit:1,can_approve:1,can_na:1}];
  const commands=[];
  for(const value of caps){
    for(const action of ['public','get','save','publish','approve','archive','na','unknown'])commands.push({op:'authorize',value,action});
    for(const from of ['draft','in_review','approved','published','archived']) for(const to of ['draft','in_review','approved','published','archived'])commands.push({op:'transition',value,from,to});
  }
  batch(commands).forEach((result,index)=>{const command=commands[index];assert.equal(result,command.op==='authorize'?authorize(command.value,command.action):canTransition(command.from,command.to,command.value));});
});

test('PHP scoring deterministic parity across mixed valuations and N/A configurations', requiresPhp, () => {
  let seed=20261014;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  const commands=[];
  for(let iteration=0;iteration<64;iteration++){
    const document=completeDocument();
    for(const item of items){const answer=document.answers[item.id];answer.rating=['B','R','M','NA'][Math.floor(random()*4)];if(answer.rating==='NA')answer.na_reason='No equipado';}
    commands.push({op:'score',value:document.answers});
  }
  batch(commands).forEach((result,index)=>equivalent(result,scoreInspection(commands[index].value)));
});
