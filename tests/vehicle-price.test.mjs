import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
