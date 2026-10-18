import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

// The catalog only needs basic controls and generated buttons here. Its data
// source is stubbed to exercise inventory and failure states deterministically.
class Element {
  constructor(id, type = '') {
    Object.assign(this, { id, type, value: '', checked: false, hidden: false, disabled: false, tabIndex: 0, isConnected: true, dataset: {}, attributes: {}, events: {}, buttons: [], children: [] });
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
  }

  set innerHTML(html) {
    this.html = html;
    this.buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((match) => {
      const button = new Element('');
      for (const [, name, value] of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
        button.setAttribute(name, value);
        if (name === 'data-category') button.dataset.category = value;
        if (name === 'data-clear-filter') button.dataset.clearFilter = value;
      }
      return button;
    });
    if (this.type === 'select' && !this.options.some((option) => option.value === this.value)) this.value = '';
  }

  get innerHTML() { return this.html || ''; }
  get options() {
    return [...this.innerHTML.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(([, value, textContent]) => ({ value, textContent }));
  }
  get selectedOptions() { return this.options.filter((option) => option.value === this.value); }
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === 'tabindex') this.tabIndex = Number(value);
  }
  addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
  dispatch(name, target = this) { for (const handler of this.events[name] || []) handler({ target }); }
  querySelectorAll(selector) {
    if (selector.includes('button,')) return this.children;
    return this.buttons.filter((button) => selector === '[data-category]' ? 'category' in button.dataset : 'clearFilter' in button.dataset);
  }
  getClientRects() { return this.hidden ? [] : [{}]; }
  contains(element) { return element === this || this.children.includes(element); }
  closest() { return this; }
  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
}

const controlIds = [
  'grid', 'q', 'clearFilters', 'applyFilters', 'filterButton', 'filterDialog', 'filterBackdrop', 'filterClose', 'filterDismiss',
  'sort', 'filterFeatured', 'filterZeroKm', 'filterUsed', 'filterCategory', 'filterBrand', 'filterFuel', 'filterTransmission',
  'filterDrivetrain', 'filterColor', 'filterYearMin', 'filterYearMax', 'filterPriceMin', 'filterPriceMax',
  'catalogCount', 'catalogCategories', 'catalogActiveFilters',
];

async function loadCatalog(rows, { error = null, width = 1440 } = {}) {
  const elements = Object.fromEntries(controlIds.map((id) => [id, new Element(id)]));
  for (const id of ['filterFeatured', 'filterZeroKm', 'filterUsed']) elements[id].type = 'checkbox';
  for (const id of ['sort', 'filterCategory', 'filterBrand', 'filterFuel', 'filterTransmission', 'filterDrivetrain']) elements[id].type = 'select';
  elements.sort.value = 'newest';
  elements.filterDialog.hidden = true;
  elements.filterBackdrop.hidden = true;
  elements.filterDialog.children = ['filterClose', 'filterFeatured', 'filterZeroKm', 'filterUsed', 'filterCategory', 'filterBrand', 'filterFuel', 'filterTransmission', 'filterDrivetrain', 'filterColor', 'filterYearMin', 'filterYearMax', 'filterPriceMin', 'filterPriceMax', 'filterDismiss', 'clearFilters', 'applyFilters'].map((id) => elements[id]);
  const reportedErrors = [];
  const document = {
    getElementById: (id) => elements[id] || null,
    events: {},
    addEventListener(name, handler) { (this.events[name] ||= []).push(handler); },
    keydown(key, { shiftKey = false } = {}) {
      const event = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const handler of this.events.keydown || []) handler(event);
      return event;
    },
    body: new Element('body'),
  };
  document.activeElement = document.body;
  for (const element of Object.values(elements)) element.ownerDocument = document;
  const shared = {
    publicSupabaseClient: () => ({ from: () => ({ select: () => ({ neq: async () => ({ data: rows, error }) }) }) }),
    escapeHTML: (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    categoryLabel: (value) => ({ auto: 'Auto', suv: 'SUV', moto: 'Moto', camion: 'Camión' }[value] || value),
    hasVehiclePrice: (value) => Number(value) > 0,
    formatPrice: (value) => Number(value) > 0 ? `$ ${value}` : 'Consultar',
    minimumDownPaymentLabel: () => '',
    statusClass: (status) => status,
    statusLabel: (status) => status,
  };
  const context = vm.createContext({
    document,
    window: { RGShared: shared, innerWidth: width, matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ visibility: 'visible' }), addEventListener() {} },
    console: { error: (failure) => reportedErrors.push(failure) },
    setTimeout: () => 1,
    clearTimeout() {},
  });
  // The final expression is the existing async fetchVehicles() bootstrap.
  await vm.runInContext(source, context, { filename: 'app.js' });
  const visibleIds = () => [...elements.grid.innerHTML.matchAll(/data-catalog-vehicle-id="([^"]+)"/g)].map((match) => match[1]);
  const categoryButton = (value) => elements.catalogCategories.querySelectorAll('[data-category]').find((button) => button.dataset.category === value);
  const removeChip = (id) => {
    const chip = elements.catalogActiveFilters.querySelectorAll('[data-clear-filter]').find((button) => button.dataset.clearFilter === id);
    assert.ok(chip, `Expected a removable chip for ${id}`);
    elements.catalogActiveFilters.dispatch('click', chip);
  };
  return { elements, document, context, visibleIds, categoryButton, removeChip, reportedErrors };
}

const inventory = [
  { id: 'older', title: 'Auto anterior', brand: 'Ford', category: 'auto', status: 'available', created_at: '2026-09-01', featured: true, price: 100, images: ['older.jpg'] },
  { id: 'latest', title: 'SUV nuevo', brand: 'Toyota', category: 'suv', status: 'available', created_at: '2026-10-18', year: 2024, km: 15000, transmission: 'Automática', price: null, images: ['latest.jpg', 'latest-side.jpg'] },
  { id: 'reserved', title: 'Auto reservado', brand: 'Ford', category: 'auto', status: 'reserved', created_at: '2026-10-19', images: ['reserved.jpg'] },
  { id: 'sold', title: 'Moto vendida', category: 'moto', status: 'sold', created_at: '2026-10-20', images: ['sold.jpg'] },
  { id: 'hidden', title: 'Camión oculto', category: 'camion', status: 'hidden', created_at: '2026-10-21', images: ['hidden.jpg'] },
];

test('stock categories exclude sold/hidden units and stay synchronized with the category selector', async () => {
  const { elements, categoryButton, visibleIds, reportedErrors } = await loadCatalog(inventory);
  assert.deepEqual(reportedErrors, []);
  assert.deepEqual(elements.filterCategory.options.map((option) => option.value), ['', 'auto', 'suv']);
  assert.equal(categoryButton('moto'), undefined);
  assert.equal(categoryButton('camion'), undefined);
  assert.match(elements.catalogCategories.innerHTML, /data-category="auto"[^>]*>Auto<span class="catalog-category__count">2</);

  const suv = categoryButton('suv');
  elements.catalogCategories.dispatch('click', suv);
  assert.equal(elements.filterCategory.value, 'suv');
  assert.equal(suv.attributes['aria-pressed'], 'true');
  assert.deepEqual(visibleIds(), ['latest']);
  assert.equal(elements.catalogCount.textContent, '1 vehículo');

  elements.filterCategory.value = 'auto';
  elements.filterCategory.dispatch('change');
  assert.equal(categoryButton('auto').attributes['aria-pressed'], 'true');
  assert.equal(suv.attributes['aria-pressed'], 'false');
  assert.deepEqual(visibleIds(), ['reserved', 'older']);
  assert.equal(elements.catalogCount.textContent, '2 vehículos');
  assert.equal(elements.catalogCategories.querySelectorAll('[data-category]').length, 3);
});

test('removing a category chip preserves search and brand; removing search preserves brand', async () => {
  const { elements, categoryButton, removeChip, visibleIds } = await loadCatalog(inventory);
  elements.q.value = 'anterior';
  elements.q.dispatch('input');
  elements.filterBrand.value = 'Ford';
  elements.filterBrand.dispatch('change');
  elements.catalogCategories.dispatch('click', categoryButton('auto'));
  assert.deepEqual(visibleIds(), ['older']);

  removeChip('filterCategory');
  assert.equal(elements.filterCategory.value, '');
  assert.equal(elements.q.value, 'anterior');
  assert.equal(elements.filterBrand.value, 'Ford');
  assert.deepEqual(visibleIds(), ['older']);
  assert.equal(categoryButton('').attributes['aria-pressed'], 'true');

  removeChip('q');
  assert.equal(elements.q.value, '');
  assert.equal(elements.filterBrand.value, 'Ford');
  assert.deepEqual(visibleIds(), ['reserved', 'older']);
  removeChip('filterBrand');
  assert.equal(elements.catalogActiveFilters.hidden, true);
  assert.deepEqual(visibleIds(), ['reserved', 'latest', 'older']);
});

test('newest means creation date, without promoting an older offer above a newer unit', async () => {
  const undated = { ...inventory[0], id: 'undated', created_at: 'not-a-date' };
  const { visibleIds } = await loadCatalog([undated, ...inventory]);
  assert.deepEqual(visibleIds(), ['reserved', 'latest', 'older', 'undated']);
});

test('vehicle metadata omits absent or invalid mileage and keeps an explicitly recorded zero', async () => {
  const { context } = await loadCatalog([]);
  for (const km of [undefined, null, '', '  ', 'unknown', -1]) {
    assert.equal(context.vehicleSpecs({ year: 2022, km, transmission: 'Manual' }), '2022 · Manual');
  }
  assert.equal(context.vehicleSpecs({}), '');
  assert.equal(context.vehicleSpecs({ km: 0 }), '0 km');
  assert.equal(context.vehicleSpecs(inventory[1]), '2024 · 15.000 km · Automática');
});

test('empty stock and failed catalog requests expose an honest catalog state', async () => {
  const empty = await loadCatalog([]);
  assert.equal(empty.elements.catalogCategories.hidden, true);
  assert.equal(empty.elements.catalogCount.textContent, 'Todavía no hay vehículos publicados');
  assert.deepEqual(empty.visibleIds(), []);
  assert.match(empty.elements.grid.innerHTML, /class="empty-state"/);

  const failed = await loadCatalog(null, { error: { message: 'Network unavailable' } });
  assert.equal(failed.elements.catalogCount.textContent, 'Catálogo no disponible en este momento');
  assert.deepEqual(failed.visibleIds(), []);
  assert.match(failed.elements.grid.innerHTML, /No se pudo cargar el catálogo/);
  assert.equal(failed.reportedErrors.length, 1);
});

test('opening filters moves focus inside and Tab cycles only through enabled, visible dialog controls', async () => {
  const { elements, document } = await loadCatalog(inventory);
  assert.equal(document.activeElement, document.body, 'initialization must not move focus');
  elements.filterButton.focus();
  elements.filterButton.dispatch('click');
  assert.equal(elements.filterDialog.hidden, false);
  assert.equal(elements.filterButton.attributes['aria-expanded'], 'true');
  assert.equal(document.activeElement, elements.filterClose);

  assert.equal(document.keydown('Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(document.activeElement, elements.applyFilters);
  assert.equal(document.keydown('Tab').defaultPrevented, true);
  assert.equal(document.activeElement, elements.filterClose);

  elements.filterBrand.focus();
  assert.equal(document.keydown('Tab').defaultPrevented, false, 'interior controls keep native Tab navigation');
  elements.applyFilters.disabled = true;
  elements.clearFilters.hidden = true;
  elements.filterClose.focus();
  document.keydown('Tab', { shiftKey: true });
  assert.equal(document.activeElement, elements.filterDismiss, 'disabled and hidden controls cannot trap keyboard users');

  elements.q.focus();
  assert.equal(document.keydown('Tab').defaultPrevented, true);
  assert.equal(document.activeElement, elements.filterClose, 'an outside focus is brought back into the open dialog');
});

test('every filter closing action returns focus to its trigger and releases keyboard navigation', async () => {
  const { elements, document } = await loadCatalog(inventory);
  for (const action of ['Escape', 'filterClose', 'filterDismiss', 'filterBackdrop', 'applyFilters']) {
    elements.filterButton.focus();
    elements.filterButton.dispatch('click');
    if (action === 'Escape') {
      assert.equal(document.keydown('Escape').defaultPrevented, true);
    } else {
      elements[action].focus();
      elements[action].dispatch('click');
    }
    assert.equal(elements.filterDialog.hidden, true, action);
    assert.equal(elements.filterBackdrop.hidden, true, action);
    assert.equal(elements.filterButton.attributes['aria-expanded'], 'false', action);
    assert.equal(document.activeElement, elements.filterButton, action);
    assert.equal(document.keydown('Tab').defaultPrevented, false, action);
  }
});

test('a dialog with no enabled controls remains focusable and can still close with Escape', async () => {
  const { elements, document } = await loadCatalog([]);
  elements.filterDialog.children.forEach((control) => { control.disabled = true; });
  elements.filterButton.dispatch('click');
  assert.equal(document.activeElement, elements.filterDialog);
  assert.equal(elements.filterDialog.tabIndex, -1);
  assert.equal(document.keydown('Tab').defaultPrevented, true);
  assert.equal(document.activeElement, elements.filterDialog);
  document.keydown('Escape');
  assert.equal(elements.filterDialog.hidden, true);
  assert.equal(document.activeElement, elements.filterButton);
});
