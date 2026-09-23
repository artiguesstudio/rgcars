import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('new categories filter independently from the Jeep brand and combine with other filters', async () => {
  const source = await readFile('app.js', 'utf8');
  const context = {
    currentSearchQuery: () => '',
    formatText: (value) => String(value || '').toLowerCase(),
    window: { RGShared: { hasVehiclePrice: (value) => Number(value) > 0 } },
  };
  for (const name of source.matchAll(/const (\$filter\w+) =/g)) {
    context[name[1]] = { value: '', checked: false };
  }
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function filteredVehicles('), source.indexOf('function shouldReduceSoldMotion(')), context);
  const rows = ['minibus', 'colectivo', 'maquinaria', 'jeep', 'auto'].map((category) => ({ category, brand: 'Otra', price: 100 }));
  rows.push({ category: 'suv', brand: 'Jeep', price: 200 });
  for (const category of ['minibus', 'colectivo', 'maquinaria', 'jeep']) {
    context.$filterCategory.value = category;
    assert.deepEqual(context.filteredVehicles(rows).map((row) => row.category), [category]);
  }
  context.$filterBrand.value = 'Jeep';
  assert.equal(context.filteredVehicles(rows).length, 0);
  context.$filterCategory.value = '';
  assert.equal(context.filteredVehicles(rows)[0].category, 'suv');
  context.$filterBrand.value = '';
  assert.equal(context.filteredVehicles(rows).length, rows.length);
});
