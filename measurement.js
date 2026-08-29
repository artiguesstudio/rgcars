(function () {
  'use strict';

  const CONSENT_KEY = 'rgcars:measurement-consent:v1';
  const SESSION_KEY = 'rgcars:session-key';
  const VISITOR_KEY = 'rgcars:visitor-key';
  const SESSION_FIRST_TOUCH_KEY = 'rgcars:attribution:first:session';
  const VISITOR_FIRST_TOUCH_KEY = 'rgcars:attribution:first:visitor';
  const LAST_TOUCH_KEY = 'rgcars:attribution:last';
  const PENDING_SUBMISSION_PREFIX = 'rgcars:pending-submission:';
  const ATTRIBUTION_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'fbclid', 'gclid', 'qr_code', 'campaign_code', 'ad_code',
  ];
  const FORBIDDEN_ANALYTICS_KEYS = /(?:^|_)(?:email|phone|telephone|whatsapp|message|comment|notes?|cuil|dni|document|plate|address)(?:$|_)/i;
  const PERSON_NAME_KEYS = new Set(['name', 'full_name', 'first_name', 'last_name', 'customer_name', 'owner_name', 'visitor_name', 'contact_name']);
  const META_EVENT_MAP = {
    page_view: 'PageView',
    view_item: 'ViewContent',
    search: 'Search',
    click_whatsapp: 'Contact',
    click_financing: 'Contact',
    generate_lead: 'Lead',
    schedule_test_drive: 'Schedule',
  };
  const sentEventIds = new Set();
  const pendingExternalEvents = [];
  const state = {
    initialized: false,
    googleLoaded: false,
    metaLoaded: false,
    gtmLoaded: false,
    consent: readConsent(),
  };

  window.dataLayer = window.dataLayer || [];

  function googleConsent(command = 'default') {
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('consent', command, {
      analytics_storage: hasAnalyticsConsent() ? 'granted' : 'denied',
      ad_storage: hasMarketingConsent() ? 'granted' : 'denied',
      ad_user_data: hasMarketingConsent() ? 'granted' : 'denied',
      ad_personalization: hasMarketingConsent() ? 'granted' : 'denied',
      wait_for_update: command === 'default' ? 500 : undefined,
    });
    window.dataLayer.push({
      event: command === 'default' ? 'rg_consent_default' : 'rg_consent_update',
      rg_analytics_consent: hasAnalyticsConsent() ? 'granted' : 'denied',
      rg_marketing_consent: hasMarketingConsent() ? 'granted' : 'denied',
    });
  }

  googleConsent('default');

  function randomId(prefix = '') {
    const value = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}${value}`;
  }

  function storageGet(storage, key) {
    try { return storage.getItem(key) || ''; } catch { return ''; }
  }

  function storageSet(storage, key, value) {
    try { storage.setItem(key, value); return true; } catch { return false; }
  }

  function storageRemove(storage, key) {
    try { storage.removeItem(key); } catch {}
  }

  function getOrCreateKey(storage, key, prefix) {
    const current = storageGet(storage, key);
    if (current) return current;
    const next = randomId(prefix);
    storageSet(storage, key, next);
    return next;
  }

  function readConsent() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        analytics: parsed.analytics === true,
        marketing: parsed.marketing === true,
        updated_at: String(parsed.updated_at || ''),
      };
    } catch {
      return null;
    }
  }

  function consentState() {
    return state.consent ? { ...state.consent } : { analytics: false, marketing: false, updated_at: '' };
  }

  function hasAnalyticsConsent() {
    return state.consent?.analytics === true;
  }

  function hasMarketingConsent() {
    return state.consent?.marketing === true;
  }

  function validConfigId(value, pattern) {
    const normalized = String(value || '').trim();
    return pattern.test(normalized) ? normalized : '';
  }

  function safeAnalyticsText(value, max = 500) {
    const normalized = String(value ?? '').trim().slice(0, max);
    if (/\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/i.test(normalized)) return '[redacted]';
    if (/(?:\+?\d[\s().-]*){7,}/.test(normalized.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ''))) return '[redacted]';
    return normalized;
  }

  function gtmId() {
    return validConfigId(window.RG?.GTM_ID, /^GTM-[A-Z0-9]+$/i);
  }

  function ga4Id() {
    return validConfigId(window.RG?.GA4_MEASUREMENT_ID, /^G-[A-Z0-9]+$/i);
  }

  function metaPixelId() {
    return validConfigId(window.RG?.META_PIXEL_ID, /^\d{5,20}$/);
  }

  function loadScript(src, id) {
    if (!src || (id && document.getElementById(id))) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      if (id) script.id = id;
      script.async = true;
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadGtm() {
    const id = gtmId();
    if (!id || state.gtmLoaded || (!hasAnalyticsConsent() && !hasMarketingConsent())) return;
    state.gtmLoaded = true;
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`, 'rgcars-gtm')
      .catch(() => { state.gtmLoaded = false; });
  }

  function loadGoogleTag() {
    const id = ga4Id();
    if (!id || gtmId() || state.googleLoaded || !hasAnalyticsConsent()) return;
    state.googleLoaded = true;
    googleConsent('update');
    window.gtag('js', new Date());
    window.gtag('config', id, { send_page_view: false, allow_google_signals: hasMarketingConsent() });
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`, 'rgcars-google-tag')
      .then(flushExternalEvents)
      .catch(() => { state.googleLoaded = false; });
  }

  function loadMetaPixel() {
    const id = metaPixelId();
    if (!id || gtmId() || state.metaLoaded || !hasMarketingConsent()) return;
    state.metaLoaded = true;
    if (!window.fbq) {
      const fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
      window.fbq = fbq;
      window._fbq = fbq;
    }
    window.fbq('consent', 'grant');
    window.fbq('init', id);
    loadScript('https://connect.facebook.net/en_US/fbevents.js', 'rgcars-meta-pixel')
      .then(flushExternalEvents)
      .catch(() => { state.metaLoaded = false; });
  }

  function configureTags() {
    if (gtmId()) loadGtm();
    else {
      loadGoogleTag();
      loadMetaPixel();
    }
  }

  function setConsent(next) {
    const previousConsent = consentState();
    state.consent = {
      analytics: next?.analytics === true,
      marketing: next?.marketing === true,
      updated_at: new Date().toISOString(),
    };
    storageSet(localStorage, CONSENT_KEY, JSON.stringify(state.consent));
    if (state.consent.analytics) persistVisitorAttribution();

    googleConsent('update');
    if (typeof window.fbq === 'function') window.fbq('consent', state.consent.marketing ? 'grant' : 'revoke');

    configureTags();
    flushExternalEvents();
    if ((!previousConsent.analytics && state.consent.analytics) || (!previousConsent.marketing && state.consent.marketing)) {
      track('page_view', {
        page_key: currentPageKey(),
        page_path: safePagePath(),
        page_title: document.title || null,
        vehicle_id: new URLSearchParams(window.location.search || '').get('id') || null,
      }, { internal: false });
    }
    document.querySelector('[data-rg-consent-banner]')?.remove();
    document.body?.classList?.remove?.('rg-consent-open');
    window.dispatchEvent(new CustomEvent('rg:consent-updated', { detail: consentState() }));
  }

  function injectConsentBanner(force = false) {
    if ((!force && state.consent) || document.querySelector('[data-rg-consent-banner]') || !document.body?.classList.contains('public-theme')) return;
    const banner = document.createElement('section');
    banner.className = 'rg-consent-banner';
    banner.dataset.rgConsentBanner = 'true';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Preferencias de privacidad');
    banner.innerHTML = `
      <div class="rg-consent-banner__copy">
        <strong>Privacidad y medición</strong>
        <p>La web funciona sin medición opcional. Si aceptás, nos ayudás a entender qué contenidos funcionan mejor. <a href="./politica-de-privacidad.html">Más información</a>.</p>
      </div>
      <div class="rg-consent-banner__actions">
        <button type="button" class="btn btn-ghost" data-rg-consent-reject>Continuar sin extras</button>
        <button type="button" class="btn btn-soft" data-rg-consent-analytics>Sólo analítica</button>
        <button type="button" class="btn btn-primary" data-rg-consent-accept>Aceptar</button>
      </div>`;
    banner.querySelector('[data-rg-consent-reject]')?.addEventListener('click', () => setConsent({ analytics: false, marketing: false }));
    banner.querySelector('[data-rg-consent-analytics]')?.addEventListener('click', () => setConsent({ analytics: true, marketing: false }));
    banner.querySelector('[data-rg-consent-accept]')?.addEventListener('click', () => setConsent({ analytics: true, marketing: true }));
    document.body.classList.add('rg-consent-open');
    document.body.appendChild(banner);
  }

  function currentPageKey() {
    const pathname = String(window.location.pathname || '').toLowerCase();
    if (pathname.includes('/admin/')) return '';
    if (pathname.endsWith('/index.html') || pathname === '/' || pathname.endsWith('/')) return 'home';
    if (pathname.endsWith('/vehicle.html')) return 'vehicle';
    if (pathname.endsWith('/consignacion.html')) return 'consignment';
    if (pathname.endsWith('/scouting.html')) return 'scouting';
    if (pathname.endsWith('/financiacion.html')) return 'financing';
    if (pathname.endsWith('/seguros.html')) return 'insurance';
    if (pathname.endsWith('/peritaje.html')) return 'peritaje';
    return 'other';
  }

  function safeUrl(value, includeQuery = true) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      if (!/^https?:$/i.test(url.protocol)) return '';
      if (!includeQuery) {
        url.search = '';
      } else {
        const safeParams = new URLSearchParams();
        [...ATTRIBUTION_KEYS, 'id', 'vehicle_id', 'mode'].forEach((key) => {
          const item = safeAnalyticsText(url.searchParams.get(key), 300);
          if (item) safeParams.set(key, item.slice(0, 300));
        });
        url.search = safeParams.toString();
      }
      url.hash = '';
      return url.toString().slice(0, 1200);
    } catch {
      return '';
    }
  }

  function safePagePath() {
    try {
      const url = new URL(safeUrl(window.location.href));
      return `${url.pathname}${url.search}`.slice(0, 1200);
    } catch {
      return String(window.location.pathname || '/').slice(0, 1200);
    }
  }

  function attributionFromLocation() {
    const params = new URLSearchParams(window.location.search || '');
    const values = {};
    ATTRIBUTION_KEYS.forEach((key) => {
      const value = safeAnalyticsText(params.get(key), 300);
      if (value) values[key] = value;
    });
    const vehicleId = String(params.get('id') || params.get('vehicle_id') || '').trim().slice(0, 120);
    if (vehicleId) values.vehicle_id = vehicleId;
    return {
      ...values,
      page_key: currentPageKey(),
      url: safeUrl(window.location.href),
      referrer: safeUrl(document.referrer),
      touched_at: new Date().toISOString(),
    };
  }

  function isMeaningfulTouch(touch) {
    return ATTRIBUTION_KEYS.some((key) => touch?.[key]) || !!touch?.referrer;
  }

  function readJsonStorage(storage, key) {
    try {
      const parsed = JSON.parse(storage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
  }

  function captureAttribution() {
    const current = attributionFromLocation();
    const sessionFirst = readJsonStorage(sessionStorage, SESSION_FIRST_TOUCH_KEY);
    if (!sessionFirst) storageSet(sessionStorage, SESSION_FIRST_TOUCH_KEY, JSON.stringify(current));

    const previousLast = readJsonStorage(sessionStorage, LAST_TOUCH_KEY);
    const last = isMeaningfulTouch(current) ? current : (previousLast || current);
    storageSet(sessionStorage, LAST_TOUCH_KEY, JSON.stringify(last));

    if (hasAnalyticsConsent()) persistVisitorAttribution();
    return current;
  }

  function persistVisitorAttribution() {
    const sessionFirst = readJsonStorage(sessionStorage, SESSION_FIRST_TOUCH_KEY) || attributionFromLocation();
    if (!readJsonStorage(localStorage, VISITOR_FIRST_TOUCH_KEY)) {
      storageSet(localStorage, VISITOR_FIRST_TOUCH_KEY, JSON.stringify(sessionFirst));
    }
    const last = readJsonStorage(sessionStorage, LAST_TOUCH_KEY) || attributionFromLocation();
    storageSet(localStorage, LAST_TOUCH_KEY, JSON.stringify(last));
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    return String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
  }

  function gaClientId() {
    const value = readCookie('_ga');
    const match = value.match(/GA\d+\.\d+\.(\d+\.\d+)$/i);
    return match?.[1] || '';
  }

  function gaSessionId() {
    const id = ga4Id();
    if (!id) return '';
    const value = readCookie(`_ga_${id.replace(/^G-/i, '')}`);
    const gs2 = value.match(/(?:^|\.)s(\d+)(?:\.|$)/i);
    if (gs2?.[1]) return gs2[1];
    const parts = value.split('.');
    return /^\d+$/.test(parts[2] || '') ? parts[2] : '';
  }

  function attributionSnapshot() {
    captureAttribution();
    const firstTouch = (hasAnalyticsConsent() && readJsonStorage(localStorage, VISITOR_FIRST_TOUCH_KEY))
      || readJsonStorage(sessionStorage, SESSION_FIRST_TOUCH_KEY)
      || attributionFromLocation();
    const lastTouch = readJsonStorage(sessionStorage, LAST_TOUCH_KEY)
      || (hasAnalyticsConsent() && readJsonStorage(localStorage, LAST_TOUCH_KEY))
      || attributionFromLocation();
    const sessionKey = getOrCreateKey(sessionStorage, SESSION_KEY, 's_');
    const visitorKey = hasAnalyticsConsent() ? getOrCreateKey(localStorage, VISITOR_KEY, 'v_') : '';
    const snapshot = {
      first_touch: firstTouch,
      last_touch: lastTouch,
      visitor_key: visitorKey || null,
      session_key: sessionKey || null,
      landing_url: firstTouch?.url || null,
      conversion_url: safeUrl(window.location.href) || null,
      referrer: firstTouch?.referrer || document.referrer || null,
      first_visit_at: firstTouch?.touched_at || null,
      conversion_at: new Date().toISOString(),
      vehicle_id: lastTouch?.vehicle_id || firstTouch?.vehicle_id || null,
      consent: consentState(),
    };
    if (hasMarketingConsent()) {
      snapshot.fbp = readCookie('_fbp') || null;
      snapshot.fbc = readCookie('_fbc') || null;
    }
    if (hasAnalyticsConsent()) {
      snapshot.ga_client_id = gaClientId() || null;
      snapshot.ga_session_id = gaSessionId() || null;
    }
    return snapshot;
  }

  function isForbiddenAnalyticsKey(key) {
    const normalized = String(key || '').toLowerCase();
    return PERSON_NAME_KEYS.has(normalized) || FORBIDDEN_ANALYTICS_KEYS.test(normalized);
  }

  function sanitizeValue(value, depth = 0) {
    if (depth > 4 || value == null) return value == null ? null : undefined;
    if (typeof value === 'string') return safeAnalyticsText(value, 500);
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
    if (typeof value === 'object') {
      const result = {};
      Object.entries(value).forEach(([key, item]) => {
        if (isForbiddenAnalyticsKey(key)) return;
        const safe = sanitizeValue(item, depth + 1);
        if (safe !== undefined) result[key] = safe;
      });
      return result;
    }
    return undefined;
  }

  function sanitizePayload(payload) {
    return sanitizeValue(payload && typeof payload === 'object' ? payload : {}) || {};
  }

  function externalItem(eventName, payload, eventId) {
    const direct = !gtmId();
    return {
      eventName,
      payload,
      eventId,
      googleDone: !direct || !ga4Id() || !hasAnalyticsConsent(),
      metaDone: !direct || !META_EVENT_MAP[eventName] || !metaPixelId() || !hasMarketingConsent(),
    };
  }

  function deliverExternal(item) {
    if (!item.googleDone && hasAnalyticsConsent() && typeof window.gtag === 'function' && state.googleLoaded) {
      window.gtag('event', item.eventName, { ...item.payload, event_id: item.eventId });
      item.googleDone = true;
    }
    const metaEvent = META_EVENT_MAP[item.eventName];
    if (!item.metaDone && metaEvent && hasMarketingConsent() && typeof window.fbq === 'function' && state.metaLoaded) {
      window.fbq('track', metaEvent, item.payload, { eventID: item.eventId });
      item.metaDone = true;
    }
    if (!hasAnalyticsConsent()) item.googleDone = true;
    if (!hasMarketingConsent()) item.metaDone = true;
    return item.googleDone && item.metaDone;
  }

  function flushExternalEvents() {
    if (!pendingExternalEvents.length) return;
    const pending = pendingExternalEvents.splice(0, pendingExternalEvents.length);
    pending.forEach((item) => { if (!deliverExternal(item)) pendingExternalEvents.push(item); });
  }

  function internalEndpoint() {
    const base = String(window.RG?.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    return base ? `${base}/functions/v1/track-event` : '';
  }

  function recordInternal(eventName, payload, eventId) {
    const endpoint = internalEndpoint();
    const anonKey = String(window.RG?.SUPABASE_ANON_KEY || '').trim();
    if (!endpoint || !anonKey || !currentPageKey()) return Promise.resolve(false);
    const body = JSON.stringify({
      event_name: eventName,
      event_id: eventId,
      page_key: currentPageKey(),
      page_path: safePagePath(),
      page_title: String(document.title || '').slice(0, 300),
      payload,
      attribution: attributionSnapshot(),
    });
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body,
      keepalive: true,
    }).then((response) => response.ok).catch(() => false);
  }

  function track(eventName, payload = {}, options = {}) {
    const normalizedName = String(eventName || '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(normalizedName)) return null;
    const safePayload = sanitizePayload(payload);
    const eventId = String(options.eventId || safePayload.event_id || randomId('evt_')).slice(0, 120);
    delete safePayload.event_id;
    if (sentEventIds.has(eventId)) return { event_id: eventId, duplicate: true, internal: Promise.resolve(false) };
    sentEventIds.add(eventId);

    if (hasAnalyticsConsent() || hasMarketingConsent()) {
      window.dataLayer.push({
        event: normalizedName,
        ...safePayload,
        event_id: eventId,
        rg_analytics_consent: hasAnalyticsConsent() ? 'granted' : 'denied',
        rg_marketing_consent: hasMarketingConsent() ? 'granted' : 'denied',
      });
    }
    try {
      window.dispatchEvent(new CustomEvent('rg:track', { detail: { event: normalizedName, payload: safePayload, event_id: eventId } }));
    } catch {}

    const external = externalItem(normalizedName, safePayload, eventId);
    if (!deliverExternal(external)) pendingExternalEvents.push(external);

    return {
      event_id: eventId,
      duplicate: false,
      internal: options.internal === false ? Promise.resolve(false) : recordInternal(normalizedName, safePayload, eventId),
    };
  }

  function trackPageView() {
    const pageKey = currentPageKey();
    if (!pageKey) return null;
    const dedupeKey = `rgcars:pageview:${window.location.pathname}${window.location.search}`;
    const lastHit = Number(storageGet(sessionStorage, dedupeKey) || 0);
    const now = Date.now();
    if (lastHit && now - lastHit < 15000) return null;
    storageSet(sessionStorage, dedupeKey, String(now));
    const params = new URLSearchParams(window.location.search || '');
    return track('page_view', {
      page_key: pageKey,
      page_path: safePagePath(),
      page_title: document.title || null,
      vehicle_id: params.get('id') || params.get('vehicle_id') || null,
    });
  }

  function pendingSubmissionKey(serviceType) {
    const service = String(serviceType || 'lead').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'lead';
    const key = `${PENDING_SUBMISSION_PREFIX}${service}`;
    const existing = storageGet(sessionStorage, key);
    if (existing) return existing;
    const next = randomId('sub_');
    storageSet(sessionStorage, key, next);
    return next;
  }

  function clearPendingSubmissionKey(serviceType, expectedKey = '') {
    const service = String(serviceType || 'lead').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'lead';
    const key = `${PENDING_SUBMISSION_PREFIX}${service}`;
    if (!expectedKey || storageGet(sessionStorage, key) === expectedKey) storageRemove(sessionStorage, key);
  }

  function leadSubmissionContext(payload = {}) {
    return {
      eventId: randomId('lead_'),
      submissionKey: pendingSubmissionKey(payload.serviceType || payload.service_type),
      attribution: attributionSnapshot(),
    };
  }

  function trackLeadSaved(result = {}, payload = {}, context = {}) {
    const serviceType = String(result.serviceType || payload.serviceType || payload.service_type || 'lead').slice(0, 80);
    const leadId = String(result.leadId || '').slice(0, 120);
    const eventId = String(result.eventId || context.eventId || randomId('lead_'));
    clearPendingSubmissionKey(serviceType, context.submissionKey);
    return track('generate_lead', {
      lead_id: leadId || null,
      service_type: serviceType,
      vehicle_id: payload.vehicleId || payload.vehicle_id || context.attribution?.vehicle_id || null,
      source: payload.source || context.attribution?.last_touch?.utm_source || 'website',
    }, { eventId });
  }

  function whatsappReference() {
    return `RGC-${randomId('').replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase()}`;
  }

  function clickLocation(anchor) {
    if (anchor.classList.contains('whatsapp-fab')) return 'floating_button';
    if (anchor.closest('.site-header, .header-actions, .header-social-links')) return 'header';
    if (anchor.closest('.site-footer')) return 'footer';
    if (anchor.closest('.detail-actions')) return 'vehicle_detail';
    if (anchor.closest('.financing-modal')) return 'financing_modal';
    return 'content';
  }

  function bindWhatsAppTracking() {
    document.addEventListener('click', (event) => {
      const anchor = event.target.closest?.('a[href*="wa.me/"], a[href*="api.whatsapp.com/"]');
      if (!anchor || !document.body?.classList.contains('public-theme')) return;
      const reference = whatsappReference();
      const params = new URLSearchParams(window.location.search || '');
      track('click_whatsapp', {
        page_key: currentPageKey(),
        service_type: currentPageKey(),
        vehicle_id: anchor.dataset.vehicleId || params.get('id') || params.get('vehicle_id') || null,
        click_location: clickLocation(anchor),
        campaign_reference: reference,
      });
    }, true);
  }

  function bindPreferenceControls() {
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest?.('[data-rg-open-consent]');
      if (!trigger) return;
      event.preventDefault();
      openPreferences();
    });
  }

  function openPreferences() {
    injectConsentBanner(true);
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    captureAttribution();
    bindWhatsAppTracking();
    bindPreferenceControls();
    configureTags();
    injectConsentBanner();
  }

  window.RGMeasurement = {
    init,
    track,
    trackPageView,
    attributionSnapshot,
    leadSubmissionContext,
    trackLeadSaved,
    consentState,
    setConsent,
    openPreferences,
    sanitizePayload,
    currentPageKey,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
