import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';

const root = process.cwd();

test('vehicles can be published with Consultar instead of a numeric price', async () => {
  const [shared, admin, html, migration] = await Promise.all([
    readFile(join(root, 'shared.js'), 'utf8'),
    readFile(join(root, 'admin', 'admin.js'), 'utf8'),
    readFile(join(root, 'admin', 'admin.html'), 'utf8'),
    readFile(join(root, 'supabase', 'migrations', '20260829_vehicle_price_optional.sql'), 'utf8'),
  ]);

  assert.match(shared, /if \(!hasVehiclePrice\(value\)\) return 'Consultar'/);
  assert.match(admin, /allowConsult: id === 'price'/);
  assert.match(admin, /payload\.price != null && !Number\.isFinite\(payload\.price\)/);
  assert.match(admin, /isOptionalPriceSchemaError/);
  assert.doesNotMatch(admin, /El precio es obligatorio/);
  assert.match(html, /15\.900\.000 o Consultar/);
  assert.match(migration, /alter column price drop not null/i);
});

test('catalog price sorting and structured data handle unpriced vehicles explicitly', async () => {
  const [app, vehicle] = await Promise.all([
    readFile(join(root, 'app.js'), 'utf8'),
    readFile(join(root, 'vehicle.js'), 'utf8'),
  ]);

  assert.match(app, /if \(aHasPrice !== bHasPrice\) return aHasPrice \? -1 : 1/);
  assert.match(app, /if \(hasPriceFilter && !hasPrice\) return false/);
  assert.match(vehicle, /if \(window\.RGShared\.hasVehiclePrice\(vehicle\.price\)\)/);
  assert.doesNotMatch(vehicle, /price: Number\(vehicle\.price \|\| 0\)/);
});

test('admin vehicle writes tolerate lifecycle columns missing from the deployed schema', async () => {
  const [admin, adminHtml, loginHtml] = await Promise.all([
    readFile(join(root, 'admin', 'admin.js'), 'utf8'),
    readFile(join(root, 'admin', 'admin.html'), 'utf8'),
    readFile(join(root, 'admin', 'login.html'), 'utf8'),
  ]);

  assert.match(admin, /function isVehicleLifecycleSchemaError\(error\)/);
  assert.match(admin, /async function writeVehicleWithSchemaFallback\(initialPayload, write\)/);
  assert.match(admin, /supportsVehicleLifecycle = Object\.prototype\.hasOwnProperty\.call\(state\.vehicles\[0\], 'published_at'\)/);
  assert.match(admin, /const \{ published_at, sold_at, \.\.\.payloadWithoutLifecycle \} = payload/);
  assert.match(admin, /\(insertPayload\) => sb\.from\('vehicles'\)\.insert\(insertPayload\)/);
  assert.match(admin, /\(updatePayload\) => sb\.from\('vehicles'\)\.update\(updatePayload\)/);
  assert.match(admin, /\(nextStatusPayload\) => sb\.from\('vehicles'\)\.update\(nextStatusPayload\)/);
  assert.match(adminHtml, /admin\.js\?v=20260901-vehicle-schema-compat-v1/);
  assert.match(loginHtml, /admin\.js\?v=20260901-vehicle-schema-compat-v1/);

  const helpers = admin.slice(
    admin.indexOf('function isPlateSchemaError'),
    admin.indexOf('function fillForm')
  );
  const context = { console };
  vm.runInNewContext(`let supportsPlate = true; let supportsVehicleLifecycle = true; ${helpers}`, context);

  const attempts = [];
  const result = await context.writeVehicleWithSchemaFallback({
    title: 'Unidad de prueba',
    price: null,
    minimum_down_payment: 100,
    published_at: '2026-09-01T00:00:00.000Z',
    sold_at: null,
  }, async (payload) => {
    attempts.push({ ...payload });
    if ('published_at' in payload) return { error: { message: "Could not find the 'published_at' column in the schema cache" } };
    if ('minimum_down_payment' in payload) return { error: { message: "Could not find the 'minimum_down_payment' column" } };
    if (payload.price == null) return { error: { message: 'null value in column price violates not-null constraint' } };
    return { data: { id: 'vehicle-1' }, error: null };
  });

  assert.equal(attempts.length, 4);
  assert.equal(result.error, null);
  assert.equal(result.data.id, 'vehicle-1');
  assert.equal(result.payload.published_at, undefined);
  assert.equal(result.payload.sold_at, undefined);
  assert.equal(result.payload.minimum_down_payment, undefined);
  assert.equal(result.payload.price, 0);
  assert.equal(result.compatibility.lifecycle, true);
  assert.equal(result.compatibility.minimumDownPayment, true);
  assert.equal(result.compatibility.price, true);
});
