import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const php = process.env.PHP_BIN || 'php';
let available = false;
try { execFileSync(php, ['-v'], { stdio: 'ignore', windowsHide: true }); available = true; } catch { /* Optional local runtime. */ }

test('cPanel PHP HTTP boundary rejects invalid input and missing auth without configured storage', {
  skip: !available && 'Set PHP_BIN to a PHP 8.1+ CLI to run HTTP integration.',
  timeout: 20000,
}, async (t) => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^RGC_INSPECTION|^RGC_SUPABASE/.test(name)));
  environment.RGC_INSPECTIONS_SECRETS_FILE = join(tmpdir(), `rgcars-no-http-settings-${process.pid}-${port}.php`);
  const server = spawn(php, ['-n', '-d', 'display_errors=0', '-S', `127.0.0.1:${port}`, '-t', fileURLToPath(new URL('../', import.meta.url))], {
    env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  server.stderr.on('data', (chunk) => { log = (log + chunk).slice(-10000); });
  let startupError;
  server.on('error', (error) => { startupError = error; });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const finished = once(server, 'exit');
      server.kill();
      await finished;
    }
  });
  const endpoint = `http://127.0.0.1:${port}/api/inspections.php`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError;
    if (server.exitCode !== null) throw new Error(`PHP server exited: ${log}`);
    try { ready = (await fetch(endpoint, { method: 'OPTIONS' })).status === 204; } catch { /* Wait for the server to bind. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(ready, `PHP server did not become ready: ${log}`);

  async function request(body, options = {}) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers }, body, ...options });
    const data = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(typeof data.error, 'string');
    assert.equal(data.data, undefined);
    assert.doesNotMatch(JSON.stringify(data), /SQLSTATE|PDOException|DB_PASSWORD|rgcars-no-http-settings|stack trace|supabase\.co/i);
    return response.status;
  }

  await t.test('unsupported methods return 405 and OPTIONS returns 204', async () => {
    assert.equal((await fetch(endpoint)).status, 405);
    assert.equal((await fetch(endpoint, { method: 'PUT' })).status, 405);
    assert.equal((await fetch(endpoint, { method: 'OPTIONS' })).status, 204);
  });

  await t.test('malformed JSON and arrays in document object fields return 400', async () => {
    const malformed = ['', '{', '[]', 'null', 'true', '{}', '{"action":3}',
      ...['document', 'owner', 'vehicle', 'signature', 'answers', 'answer', 'value'].map((field) => {
        const body = { action: 'save', document: {} };
        if (field === 'document') body.document = [];
        else if (field === 'answer') body.document.answers = { 'motor-motor': [] };
        else if (field === 'value') body.document.answers = { 'motor-motor': { value: [] } };
        else body.document[field] = [];
        return JSON.stringify(body);
      }),
    ];
    for (const body of malformed) assert.equal(await request(body), 400, body);
  });

  await t.test('every private action rejects absent or malformed Bearer before DB access', async () => {
    for (const action of ['capabilities', 'list', 'create', 'get', 'save', 'transition', 'upload_evidence', 'update_evidence', 'delete_evidence']) {
      assert.equal(await request(JSON.stringify({ action })), 401, action);
    }
    for (const authorization of ['Basic abc', 'Bearer', 'Bearer abc def']) {
      assert.equal(await request('{"action":"capabilities"}', { headers: { Authorization: authorization } }), 401, authorization);
    }
  });

  await t.test('oversize JSON and invalid multipart flags are rejected before auth', async () => {
    assert.equal(await request(JSON.stringify({ action: 'save', text: 'x'.repeat(1048576) })), 413);
    const form = new FormData();
    form.set('action', 'upload_evidence');
    form.set('approved_public', 'yes');
    assert.equal(await request(form, { headers: {} }), 400);
    form.set('approved_public', 'false');
    assert.equal(await request(form, { headers: {} }), 401);
  });

  await t.test('valid public and authenticated-shaped requests fail closed with generic storage error', async () => {
    assert.equal(await request('{"action":"public","vehicle_id":"example"}'), 503);
    assert.equal(await request('{"action":"capabilities"}', { headers: { Authorization: 'Bearer test.invalid.token' } }), 503);
  });
});
