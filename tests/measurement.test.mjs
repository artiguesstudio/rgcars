import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../measurement.js', import.meta.url), 'utf8');
const sharedSource = readFileSync(new URL('../shared.js', import.meta.url), 'utf8');
const indexCssSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
}

function runtime(href = 'https://rgcars.com.ar/vehicle.html?id=veh-1&utm_source=meta&plate=AA123BB&email=test@example.com') {
  const url = new URL(href);
  const localStorage = storage();
  const sessionStorage = storage();
  const listeners = new Map();
  const document = {
    body: {
      classList: { contains: () => false },
      appendChild: () => {},
    },
    cookie: '',
    head: { appendChild: () => {} },
    readyState: 'complete',
    referrer: 'https://example.com/?utm_source=partner&phone=5492964000000',
    title: 'Ficha de prueba',
    addEventListener: (name, handler) => listeners.set(name, handler),
    createElement: () => ({
      addEventListener: () => {},
      classList: { contains: () => false },
      dataset: {},
      querySelector: () => null,
      setAttribute: () => {},
    }),
    getElementById: () => null,
    querySelector: () => null,
  };
  const context = {
    console,
    crypto: globalThis.crypto,
    CustomEvent: class CustomEvent { constructor(name, options) { this.type = name; this.detail = options?.detail; } },
    document,
    fetch: async () => ({ ok: true }),
    localStorage,
    location: {
      href: url.href,
      pathname: url.pathname,
      search: url.search,
    },
    navigator: {},
    sessionStorage,
    setTimeout,
    URL,
    URLSearchParams,
  };
  context.window = context;
  context.window.RG = {
    GA4_MEASUREMENT_ID: '',
    GTM_ID: '',
    META_PIXEL_ID: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_URL: '',
  };
  context.window.addEventListener = (name, handler) => listeners.set(name, handler);
  context.window.dispatchEvent = () => true;
  vm.runInNewContext(source, context, { filename: 'measurement.js' });
  return context;
}

function sharedRuntime(fetchResponse) {
  const savedEvents = [];
  const requests = [];
  const context = {
    console,
    CustomEvent: class CustomEvent {},
    document: { addEventListener: () => {}, readyState: 'loading' },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: fetchResponse.ok, json: async () => fetchResponse.body };
    },
    location: { href: 'https://rgcars.com.ar/financiacion.html', origin: 'https://rgcars.com.ar', pathname: '/financiacion.html', search: '' },
    URL,
    URLSearchParams,
  };
  context.window = context;
  context.window.addEventListener = () => {};
  context.window.RG = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key' };
  context.window.RGMeasurement = {
    leadSubmissionContext: () => ({ eventId: 'lead_test_123456', submissionKey: 'sub_test_123456', attribution: { first_touch: { utm_source: 'meta' } } }),
    trackLeadSaved: (...args) => savedEvents.push(args),
  };
  vm.runInNewContext(sharedSource, context, { filename: 'shared.js' });
  return { context, requests, savedEvents };
}

test('removes contact data from analytics payloads, including nested values', () => {
  const ctx = runtime();
  const safe = ctx.RGMeasurement.sanitizePayload({
    service_type: 'financing',
    email: 'test@example.com',
    phone: '5492964000000',
    nested: { customer_name: 'Ada', vehicle_id: 'veh-1', notes: 'private' },
    items: [{ item_id: 'veh-1', item_name: 'Toyota Etios', item_brand: 'Toyota' }],
    search_term: 'contact test@example.com or +54 9 2964 000000',
  });
  assert.equal(safe.email, undefined);
  assert.equal(safe.phone, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(safe.nested)), { vehicle_id: 'veh-1' });
  assert.deepEqual(JSON.parse(JSON.stringify(safe.items)), [{ item_id: 'veh-1', item_name: 'Toyota Etios', item_brand: 'Toyota' }]);
  assert.equal(safe.search_term, '[redacted]');
});

test('does not queue business events for third parties before consent', () => {
  const ctx = runtime();
  const initialLength = ctx.dataLayer.length;
  ctx.RGMeasurement.track('generate_lead', { email: 'test@example.com', service_type: 'scouting' }, { internal: false, eventId: 'lead_test_123456' });
  assert.equal(ctx.dataLayer.length, initialLength);
  assert.equal(ctx.dataLayer.some((item) => item?.event === 'generate_lead'), false);
});

test('consent creates a sanitized external page view and event ids deduplicate', () => {
  const ctx = runtime();
  ctx.RGMeasurement.setConsent({ analytics: true, marketing: false });
  const pageView = ctx.dataLayer.find((item) => item?.event === 'page_view');
  assert.ok(pageView);
  assert.match(pageView.page_path, /utm_source=meta/);
  assert.doesNotMatch(pageView.page_path, /plate|AA123BB|email|test%40example\.com/i);

  const before = ctx.dataLayer.length;
  ctx.RGMeasurement.track('search', { search_term_group: 'suv' }, { internal: false, eventId: 'evt_test_123456' });
  ctx.RGMeasurement.track('search', { search_term_group: 'suv' }, { internal: false, eventId: 'evt_test_123456' });
  assert.equal(ctx.dataLayer.length, before + 1);
});

test('consent temporarily removes competing floating actions', () => {
  assert.match(source, /classList\.add\('rg-consent-open'\)/);
  assert.match(source, /classList\?\.remove\?\.\('rg-consent-open'\)/);
  assert.match(indexCssSource, /body\.rg-consent-open \.whatsapp-fab/);
  assert.match(indexCssSource, /body\.rg-consent-open \.feedback-floating-button/);
  assert.match(indexCssSource, /body\.rg-consent-open \.recruitment-floating-button/);
  assert.match(indexCssSource, /pointer-events:\s*none\s*!important/);
});

test('WhatsApp tracking keeps technical references out of the customer message', () => {
  assert.doesNotMatch(source, /anchor\.href\s*=\s*whatsappUrlWithReference/);
  assert.doesNotMatch(source, /Ref:\s*\$\{reference\}/);
  assert.match(source, /campaign_reference:\s*reference/);
});

test('all public pages that use shared.js load the central measurement layer first', () => {
  const pages = [
    'index.html', 'vehicle.html', 'consignacion.html', 'financiacion.html',
    'peritaje.html', 'scouting.html', 'seguros.html', 'faq.html',
    'politica-de-privacidad.html', 'sitemap.html', 'terminos-y-condiciones.html',
  ];
  for (const page of pages) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(html, /measurement\.js/);
    assert.ok(html.indexOf('measurement.js') < html.indexOf('shared.js'), `${page}: measurement.js must precede shared.js`);
  }
});

test('a stored lead emits the conversion once and carries idempotency context', async () => {
  const { context, requests, savedEvents } = sharedRuntime({ ok: true, body: { ok: true, saved: true, leadId: 'lead-1', eventId: 'lead_test_123456' } });
  await context.RGShared.submitServiceLead({ serviceType: 'financiacion', name: 'Test User' });
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.eventId, 'lead_test_123456');
  assert.equal(body.submissionKey, 'sub_test_123456');
  assert.equal(body.attribution.first_touch.utm_source, 'meta');
  assert.equal(savedEvents.length, 1);
});

test('a failed lead request never emits generate_lead', async () => {
  const { context, savedEvents } = sharedRuntime({ ok: false, body: { ok: false, error: 'Persistence failed' } });
  await assert.rejects(() => context.RGShared.submitServiceLead({ serviceType: 'financiacion' }), /Persistence failed/);
  assert.equal(savedEvents.length, 0);
});
