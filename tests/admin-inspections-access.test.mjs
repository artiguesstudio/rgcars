import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [sharedSource, accessSource, adminSource] = await Promise.all([
  readFile(new URL('../shared.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin-access.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
]);

function element(dataset = {}) {
  return { dataset, hidden: false, disabled: false, innerHTML: '', classList: { toggle() {} } };
}

// Run the production scripts without starting authentication or making network
// requests. Only the DOM surfaces used by access control and post-save rendering
// are substituted; profile resolution and all three action renderers are real.
function adminFor(email) {
  const postSaveActions = element();
  const nav = ['vehicles', 'leads', 'settings'].map((view) => element({ view }));
  const panels = nav.map(({ dataset }) => element({ viewPanel: dataset.view }));
  const document = {
    readyState: 'loading',
    body: element(),
    getElementById: (id) => id === 'postSaveActions' ? postSaveActions : null,
    querySelector: () => null,
    querySelectorAll: (selector) => ({ '[data-view]': nav, '[data-view-panel]': panels })[selector] || [],
    addEventListener() {},
  };
  const context = vm.createContext({
    window: {
      supabase: { createClient: () => ({}) },
      location: new URL('https://rgcars.com.ar/admin/admin.html'),
      addEventListener() {},
    },
    RG: { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'fixture' },
    document,
    URL,
    console,
  });
  for (const [filename, source] of [['shared.js', sharedSource], ['admin-access.js', accessSource], ['admin.js', adminSource]]) {
    vm.runInContext(source, context, { filename });
  }
  context.fixtureEmail = email;
  vm.runInContext('state.access = resolveAccessProfile({ email: fixtureEmail }); applyAccessControl();', context);
  return { context, postSaveActions, nav, panels };
}

function assertInspectionLink(html, vehicleId, surface) {
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter(([, , label]) => label.trim() === 'Peritaje');
  assert.equal(links.length, 1, `${surface} exposes exactly one Peritaje action`);
  const attributes = links[0][1];
  const href = attributes.match(/\bhref="([^"]+)"/)?.[1];
  assert.ok(href, `${surface} has a navigable inspection URL`);
  const url = new URL(href, 'https://rgcars.com.ar/admin/admin.html');
  assert.equal(url.pathname, '/admin/inspections.html');
  assert.equal(url.searchParams.get('vehicle_id'), vehicleId, `${surface} opens the selected vehicle`);
  assert.equal([...url.searchParams].length, 1, `${surface} encodes vehicle IDs without adding parameters`);
  assert.doesNotMatch(attributes, /\b(?:hidden|disabled)\b|aria-hidden="true"/);
}

for (const [email, key, restricted] of [
  ['rgcarstdf@gmail.com', 'full_admin', false],
  ['ventas@rgcars.com.ar', 'ventas', true],
]) {
  test(`${key} can reach Peritaje from stock, prices and saved vehicle actions`, () => {
    const { context, postSaveActions, nav, panels } = adminFor(email);
    assert.equal(vm.runInContext('state.access.key', context), key);
    assert.equal(vm.runInContext('state.access.restricted', context), restricted);
    assert.equal(nav[0].hidden, false, 'The vehicle navigation remains visible');
    assert.equal(nav[0].disabled, false, 'The vehicle navigation remains enabled');
    assert.equal(panels[0].hidden, false, 'The vehicle panel is available');
    assert.equal(nav[2].hidden, restricted, 'Restoring access does not expand the sales profile');

    for (const id of ['22222222-2222-4222-8222-222222222222', 'vehicle with spaces & extra=value']) {
      context.fixtureVehicle = { id, title: 'Toyota Corolla', brand: 'Toyota', model: 'Corolla', year: 2022, status: 'available', km: 42000, price: 15000000, currency: 'ARS' };
      assertInspectionLink(vm.runInContext('adminCardHTML(fixtureVehicle)', context), id, 'Stock card');
      assertInspectionLink(vm.runInContext('quickPriceRowHTML(fixtureVehicle)', context), id, 'Price list');
      vm.runInContext('renderPostSaveActions(fixtureVehicle)', context);
      assert.equal(postSaveActions.hidden, false);
      assertInspectionLink(postSaveActions.innerHTML, id, 'Saved vehicle actions');
    }
  });
}
