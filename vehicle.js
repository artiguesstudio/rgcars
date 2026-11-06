const sb = window.RGShared?.publicSupabaseClient?.()
  || window.supabase.createClient(window.RG.SUPABASE_URL, window.RG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const $detail = document.getElementById('detail');
const $relatedGrid = document.getElementById('relatedGrid');

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function ensureMeta(selector, attrs = {}) {
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    const attrKey = Object.keys(attrs)[0];
    if (attrKey) tag.setAttribute(attrKey, attrs[attrKey]);
    document.head.appendChild(tag);
  }
  return tag;
}

function updateSeo(vehicle) {
  const title = [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' ') || vehicle.title || 'Vehículo';
  const description = `${title} en RG Cars TDF. ${window.RGShared.formatKm(vehicle.km)} · ${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}. Consultá disponibilidad, financiación y formas de pago.`;
  const url = window.RGShared.vehicleUrl(vehicle.id);
  const image = firstVehicleImage(vehicle);

  document.title = `${title} · RG Cars TDF`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
  ensureMeta('meta[property="og:title"]', { property: 'og:title' }).setAttribute('content', `${title} · RG Cars TDF`);
  ensureMeta('meta[property="og:description"]', { property: 'og:description' }).setAttribute('content', description);
  ensureMeta('meta[property="og:url"]', { property: 'og:url' }).setAttribute('content', url);
  if (image) ensureMeta('meta[property="og:image"]', { property: 'og:image' }).setAttribute('content', image);

  let ldJson = document.getElementById('vehicleSchema');
  if (!ldJson) {
    ldJson = document.createElement('script');
    ldJson.type = 'application/ld+json';
    ldJson.id = 'vehicleSchema';
    document.head.appendChild(ldJson);
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    image: image ? [image] : [],
    description,
    brand: vehicle.brand || undefined,
    model: vehicle.model || undefined,
  };
  if (window.RGShared.hasVehiclePrice(vehicle.price)) {
    structuredData.offers = {
      '@type': 'Offer',
      priceCurrency: vehicle.currency || 'ARS',
      price: Number(vehicle.price),
      availability: vehicle.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      url,
    };
  }
  ldJson.textContent = JSON.stringify(structuredData);
}

function commercialPills(vehicle) {
  const pills = [];
  if (vehicle.featured) pills.push('<span class="featured-pill is-inline">Destacado</span>');
  if (vehicle.is_recent) pills.push('<span class="featured-pill is-inline is-neutral">Recién ingresado</span>');
  if (vehicle.outlet) pills.push('<span class="featured-pill is-inline is-outlet">Outlet</span>');
  return pills.join('');
}

function sharedVehicleAvailability(helperName, vehicle) {
  const helper = window.RGShared?.[helperName];
  return typeof helper === 'function' ? helper(vehicle) : true;
}

function vehicleFinancingAvailable(vehicle) {
  return sharedVehicleAvailability('vehicleFinancingAvailable', vehicle);
}

function vehicleInsuranceAvailable(vehicle) {
  return sharedVehicleAvailability('vehicleInsuranceAvailable', vehicle);
}

function parseMoneyLike(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const normalized = String(value)
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function vehicleMinimumDownPayment(vehicle) {
  const helper = window.RGShared?.minimumDownPayment;
  if (typeof helper === 'function') {
    const value = helper(vehicle);
    if (value) return value;
  }
  return parseMoneyLike(
    vehicle?.minimum_down_payment
      ?? vehicle?.min_down_payment
      ?? vehicle?.entrega_minima
      ?? vehicle?.minimumDownPayment
  );
}

function vehicleMinimumDownPaymentLabel(vehicle) {
  const helper = window.RGShared?.minimumDownPaymentLabel;
  if (typeof helper === 'function') {
    const label = helper(vehicle);
    if (label) return label;
  }
  const value = vehicleMinimumDownPayment(vehicle);
  return value ? `Entrega mínima desde ${window.RGShared.formatPrice(value, vehicle?.currency || 'ARS')}` : '';
}

function imageValuesFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(imageValuesFrom);
  if (typeof value === 'object') {
    const preferred = value.url ?? value.src ?? value.image_url ?? value.public_url ?? value.path;
    return preferred ? imageValuesFrom(preferred) : Object.values(value).flatMap(imageValuesFrom);
  }
  const raw = String(value).trim();
  if (!raw) return [];
  if (/^[\[{]/.test(raw)) {
    try {
      return imageValuesFrom(JSON.parse(raw));
    } catch {
      return [raw];
    }
  }
  return /[\n,]/.test(raw)
    ? raw.split(/\r?\n|,/g).map((item) => item.trim()).filter(Boolean)
    : [raw];
}

function vehicleImages(vehicle) {
  return [
    ...imageValuesFrom(vehicle?.images),
    ...imageValuesFrom(vehicle?.photos),
    ...imageValuesFrom(vehicle?.main_image),
    ...imageValuesFrom(vehicle?.featured_image),
    ...imageValuesFrom(vehicle?.image_url),
  ].filter((src, index, list) => /^https?:\/\//i.test(src) && list.indexOf(src) === index);
}

function firstVehicleImage(vehicle) {
  return vehicleImages(vehicle)[0] || window.RGShared.firstImage?.(vehicle) || '';
}

function commercialBlocks(vehicle) {
  return `
    <aside class="vehicle-services" aria-labelledby="vehicleServicesTitle">
      <p class="vehicle-eyebrow">Te acompañamos</p>
      <h2 id="vehicleServicesTitle">También, en lo que viene.</h2>
      <p>Consultanos por los servicios que podés sumar a tu próxima compra.</p>
      <div class="vehicle-service-links">
        ${vehicleInsuranceAvailable(vehicle) ? `
          <a class="vehicle-service-link" href="${window.RGShared.insuranceUrl(vehicle)}"><span><strong>Seguro para tu vehículo</strong><small>Pedí una pre-cotización.</small></span><span aria-hidden="true">↗</span></a>
          <a class="vehicle-service-link" href="${window.RGShared.peritajeUrl(vehicle)}"><span><strong>Peritaje pre-compra</strong><small>Conocé la unidad de cerca.</small></span><span aria-hidden="true">↗</span></a>
        ` : ''}
        <a class="vehicle-service-link" href="./peritaje.html#gestoria"><span><strong>Gestoría</strong><small>Orientación para los próximos pasos.</small></span><span aria-hidden="true">↗</span></a>
      </div>
      <div class="vehicle-visit"><p class="vehicle-eyebrow">Encontranos en Río Grande</p><h3>RG Cars TDF</h3><p>Sarmiento 2760<br>Río Grande, Tierra del Fuego</p></div>
    </aside>
  `;
}


function detailSpecItems(vehicle) {
  const items = [
    ['Año de fabricación', window.RGShared.textOrDash(vehicle.year)],
    ['Kilometraje', window.RGShared.formatKm(vehicle.km)],
    ['Patente', window.RGShared.textOrDash(vehicle.plate)],
    ['Motor', window.RGShared.textOrDash(vehicle.engine)],
    ['Transmisión', window.RGShared.textOrDash(vehicle.transmission)],
    ['Tracción', window.RGShared.textOrDash(vehicle.drivetrain)],
    ['Color', window.RGShared.textOrDash(vehicle.color)],
    ['Puertas', window.RGShared.textOrDash(vehicle.doors)],
    ['Combustible', window.RGShared.textOrDash(vehicle.fuel_type)],
    ['Estado', window.RGShared.textOrDash(vehicle.vehicle_condition || window.RGShared.statusLabel(vehicle.status))],
  ];

  return items
    .filter(([, value]) => value && value !== '-')
    .map(([label, value]) => `<div class="spec-card"><span>${label}</span><strong>${window.RGShared.escapeHTML(String(value))}</strong></div>`)
    .join('');
}

function equipmentMarkup(vehicle) {
  const equipment = window.RGShared.arrayFromUnknown(vehicle.featured_equipment);
  if (!equipment.length) return '';
  return `
    <section id="equipamiento" class="vehicle-equipment" aria-labelledby="equipmentTitle">
      <h2 id="equipmentTitle">Equipamiento destacado</h2>
      <ul class="feature-list compact-list">
        ${equipment.map((item) => `<li>${window.RGShared.escapeHTML(item)}</li>`).join('')}
      </ul>
    </section>
  `;
}

function detailMarkup(vehicle) {
  const images = vehicleImages(vehicle);
  const financingAvailable = vehicleFinancingAvailable(vehicle);
  const insuranceAvailable = vehicleInsuranceAvailable(vehicle);
  const minimumDownPayment = vehicleMinimumDownPaymentLabel(vehicle);
  const equipment = equipmentMarkup(vehicle);
  const quickSpecs = [vehicle.year, vehicle.km != null ? window.RGShared.formatKm(vehicle.km) : '', vehicle.transmission]
    .filter((value) => value !== undefined && value !== null && value !== '' && value !== '-')
    .map((value) => `<span>${window.RGShared.escapeHTML(String(value))}</span>`).join('');
  const dotsMarkup = images.length > 1
    ? `
          <div class="detail-main-dots" aria-label="Fotos del vehículo">
            ${images.map((_, index) => `<button class="detail-main-dot ${index === 0 ? 'is-active' : ''}" type="button" data-detail-dot="${index}" aria-label="Ver foto ${index + 1}" aria-pressed="${index === 0}"></button>`).join('')}
          </div>
      `
    : '';
  const mainMedia = images.length
    ? `<img id="mainVehicleImage" src="${window.RGShared.escapeHTML(images[0])}" alt="${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}, foto 1 de ${images.length}" tabindex="0" role="button" aria-label="Ampliar foto del vehículo" aria-haspopup="dialog" fetchpriority="high" decoding="async">`
    : `<div class="media-placeholder large vehicle-gallery-placeholder"><img src="./imagenes/isotipo.png" alt=""><span>Imagen próximamente</span></div>`;

  return `
    <article class="detail-grid">
      <section class="detail-gallery-card" aria-label="Fotos del vehículo">
        <div class="detail-main-media">
          ${mainMedia}
          ${images.length > 1 ? `
            <button class="detail-gallery-nav is-prev" type="button" data-gallery-prev aria-label="Foto anterior">‹</button>
            <button class="detail-gallery-nav is-next" type="button" data-gallery-next aria-label="Foto siguiente">›</button>
          ` : ''}
          ${images.length ? '<button class="detail-gallery-expand" type="button" data-gallery-expand aria-label="Ampliar foto">↗</button>' : ''}
          ${dotsMarkup}
          <div class="detail-top-pills">${commercialPills(vehicle)}</div>
        </div>
        <div class="vehicle-gallery-caption"><span>${images.length ? 'Explorá cada detalle' : 'Las fotos estarán disponibles próximamente'}</span>${images.length ? `<span data-gallery-counter aria-live="polite">1 / ${images.length}</span>` : ''}</div>
        <div class="detail-thumbs" aria-label="Miniaturas del vehículo" ${images.length < 2 ? 'hidden' : ''}>
          ${images.length ? images.map((src, index) => `
            <button class="thumb-button ${index === 0 ? 'is-active' : ''}" type="button" data-thumb-src="${window.RGShared.escapeHTML(src)}" data-thumb-index="${index}" aria-label="Ver imagen ${index + 1}" aria-pressed="${index === 0}">
              <img src="${window.RGShared.escapeHTML(src)}" alt="" loading="lazy" decoding="async">
            </button>
          `).join('') : '<div class="empty-inline">Todavía no hay miniaturas cargadas.</div>'}
        </div>
      </section>

      <div class="vehicle-identity">
        <div class="vehicle-heading-meta">
          <span class="vehicle-category">${window.RGShared.escapeHTML(window.RGShared.categoryLabel(vehicle.category))}</span>
          <span class="vehicle-availability ${window.RGShared.statusClass(vehicle.status)}">${window.RGShared.statusLabel(vehicle.status)}</span>
        </div>
        <h1>${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}</h1>
        <div class="vehicle-quick-specs">${quickSpecs}</div>
      </div>
      <aside class="detail-info-card" aria-label="Precio y consultas">
        <div class="vehicle-price-block">
          <p class="vehicle-eyebrow">Precio de publicación</p>
          <p class="detail-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>
          ${minimumDownPayment ? `<p class="detail-down-payment">${window.RGShared.escapeHTML(minimumDownPayment)}</p>` : ''}
        </div>

        <div class="detail-actions">
          <a class="btn btn-primary" href="${window.RGShared.waLink(vehicle)}" data-vehicle-id="${window.RGShared.escapeHTML(vehicle.id || '')}" target="_blank" rel="noreferrer">Consultar por WhatsApp</a>
          ${financingAvailable ? `<a class="btn btn-soft vehicle-financing-link" href="${window.RGShared.financingUrl(vehicle)}" data-vehicle-financing-link>Financiación</a>` : ''}
          ${insuranceAvailable ? `<a class="btn btn-ghost" href="${window.RGShared.insuranceUrl(vehicle)}">Seguro</a>` : ''}
          <a class="btn btn-soft" href="#vehicleInspection" data-inspection-link aria-controls="vehicleInspection" hidden>Ver peritaje</a>
        </div>

        <p class="vehicle-contact-note">Consultanos por disponibilidad y formas de pago.</p>
        ${financingAvailable ? '<div class="vehicle-finance-note"><p class="vehicle-eyebrow">Tu próximo paso</p><h2>Conocé tus opciones de financiación.</h2><p>Consultá alternativas y condiciones para esta unidad.</p></div>' : ''}
      </aside>
    </article>
    <nav class="vehicle-section-nav" aria-label="Información del vehículo">
      <a href="#caracteristicas">Características</a><a href="#descripcion">Descripción</a>${equipment ? '<a href="#equipamiento">Equipamiento</a>' : ''}
    </nav>
    <div class="vehicle-details">
      <div class="vehicle-details-main">
        <section id="caracteristicas" class="vehicle-specifications" aria-labelledby="specificationsTitle"><p class="vehicle-eyebrow">Conocé la unidad</p><h2 id="specificationsTitle">Los datos, a simple vista.</h2><div class="detail-specs-grid">${detailSpecItems(vehicle)}</div></section>
        <section id="descripcion" class="detail-copy" aria-labelledby="descriptionTitle"><h2 id="descriptionTitle">Sobre este vehículo</h2><p>${window.RGShared.escapeHTML(vehicle.description || 'Esta unidad está publicada por RG Cars TDF. Consultá disponibilidad actualizada, financiación y formas de pago.').replace(/\n/g, '<br>')}</p></section>
        ${equipment}
      </div>
      ${commercialBlocks(vehicle)}
    </div>
  `;
}

function cardHTML(vehicle) {
  const image = firstVehicleImage(vehicle);
  const minimumDownPayment = vehicleMinimumDownPaymentLabel(vehicle);
  return `
    <article class="vehicle-card compact-card">
      <a class="vehicle-card-link" href="./vehicle.html?id=${vehicle.id}" aria-label="Ver detalle de ${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}">
        <div class="vehicle-media compact-media">
          ${image ? `<img src="${window.RGShared.escapeHTML(image)}" alt="${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}" class="is-active" loading="lazy" decoding="async">` : '<div class="media-placeholder">Sin foto</div>'}
          <span class="status-pill ${window.RGShared.statusClass(vehicle.status)}">${window.RGShared.statusLabel(vehicle.status)}</span>
        </div>
        <div class="vehicle-body compact-body">
          <h3>${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}</h3>
          <p class="vehicle-specs">${[vehicle.year, vehicle.km != null ? window.RGShared.formatKm(vehicle.km) : '', vehicle.transmission].filter(Boolean).map((value) => window.RGShared.escapeHTML(String(value))).join(' · ')}</p>
          <p class="vehicle-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>
          ${minimumDownPayment ? `<p class="vehicle-down-payment">${window.RGShared.escapeHTML(minimumDownPayment)}</p>` : ''}
        </div>
      </a>
    </article>
  `;
}

function bindDetailEvents() {
  const mainImage = document.getElementById('mainVehicleImage');
  if (!mainImage) return;

  const mainMedia = mainImage.closest('.detail-main-media');
  const thumbButtons = [...document.querySelectorAll('[data-thumb-src]')];
  const dotButtons = [...document.querySelectorAll('[data-detail-dot]')];
  const imageSources = thumbButtons
    .map((button) => button.getAttribute('data-thumb-src'))
    .filter(Boolean);

  if (!imageSources.length) return;

  let currentIndex = Math.max(0, imageSources.indexOf(mainImage.getAttribute('src') || imageSources[0]));
  let touchStartX = 0;
  let touchStartY = 0;
  let lightbox = null;
  let focusBeforeLightbox = null;
  const failedImages = new Set();

  function syncGallery(index) {
    const total = imageSources.length;
    if (!total) return;
    currentIndex = (index + total) % total;
    mainImage.src = imageSources[currentIndex];
    mainImage.alt = `${mainImage.alt.split(', foto')[0]}, foto ${currentIndex + 1} de ${total}`;
    thumbButtons.forEach((item) => {
      const itemIndex = Number(item.getAttribute('data-thumb-index') || '0');
      item.classList.toggle('is-active', itemIndex === currentIndex);
      item.setAttribute('aria-pressed', String(itemIndex === currentIndex));
    });
    dotButtons.forEach((item) => {
      const itemIndex = Number(item.getAttribute('data-detail-dot') || '0');
      item.classList.toggle('is-active', itemIndex === currentIndex);
      item.setAttribute('aria-pressed', String(itemIndex === currentIndex));
    });
    const counter = document.querySelector('[data-gallery-counter]');
    if (counter) counter.textContent = `${currentIndex + 1} / ${total}`;
  }

  thumbButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextIndex = Number(button.getAttribute('data-thumb-index') || '0');
      syncGallery(nextIndex);
    });
  });

  document.querySelector('[data-gallery-prev]')?.addEventListener('click', () => syncGallery(currentIndex - 1));
  document.querySelector('[data-gallery-next]')?.addEventListener('click', () => syncGallery(currentIndex + 1));

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.remove();
    lightbox = null;
    document.body.classList.remove('vehicle-lightbox-open');
    focusBeforeLightbox?.focus?.();
  }

  function renderLightboxImage() {
    if (!lightbox) return;
    const image = lightbox.querySelector('[data-lightbox-image]');
    image.src = imageSources[currentIndex];
    image.alt = `${mainImage.alt.split(', foto')[0]}, ampliada, foto ${currentIndex + 1} de ${imageSources.length}`;
    lightbox.querySelector('[data-lightbox-counter]').textContent = `${currentIndex + 1} / ${imageSources.length}`;
  }

  function openLightbox() {
    if (lightbox) return;
    focusBeforeLightbox = document.activeElement;
    lightbox = document.createElement('div');
    lightbox.className = 'vehicle-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Galería ampliada del vehículo');
    lightbox.innerHTML = `
      <button class="vehicle-lightbox__backdrop" type="button" data-lightbox-close tabindex="-1" aria-label="Cerrar galería"></button>
      <div class="vehicle-lightbox__stage">
        <img data-lightbox-image src="" alt="">
        <span class="vehicle-lightbox__counter" data-lightbox-counter></span>
        <button class="vehicle-lightbox__close" type="button" data-lightbox-close aria-label="Cerrar galería">×</button>
        ${imageSources.length > 1 ? '<button class="vehicle-lightbox__nav is-prev" type="button" data-lightbox-prev aria-label="Foto anterior">‹</button><button class="vehicle-lightbox__nav is-next" type="button" data-lightbox-next aria-label="Foto siguiente">›</button>' : ''}
      </div>`;
    document.body.appendChild(lightbox);
    document.body.classList.add('vehicle-lightbox-open');
    renderLightboxImage();
    lightbox.querySelectorAll('[data-lightbox-close]').forEach((button) => button.addEventListener('click', closeLightbox));
    lightbox.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => { syncGallery(currentIndex - 1); renderLightboxImage(); });
    lightbox.querySelector('[data-lightbox-next]')?.addEventListener('click', () => { syncGallery(currentIndex + 1); renderLightboxImage(); });
    lightbox.querySelector('.vehicle-lightbox__close')?.focus();
  }

  document.querySelector('[data-gallery-expand]')?.addEventListener('click', openLightbox);
  mainImage.addEventListener('click', openLightbox);
  mainImage.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLightbox(); }
  });
  mainImage.addEventListener('error', () => {
    const failed = imageSources[currentIndex];
    failedImages.add(failed);
    const next = imageSources.findIndex((src) => !failedImages.has(src));
    if (next >= 0) syncGallery(next);
    else {
      mainMedia.innerHTML = '<div class="media-placeholder large vehicle-gallery-placeholder"><img src="./imagenes/isotipo.png" alt=""><span>Imagen no disponible</span></div>';
      document.querySelector('.detail-thumbs')?.setAttribute('hidden', '');
      const caption = document.querySelector('.vehicle-gallery-caption');
      if (caption) caption.textContent = 'Consultanos para conocer más sobre esta unidad.';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && lightbox) return closeLightbox();
    if (event.key === 'Tab' && lightbox) {
      const controls = [...lightbox.querySelectorAll('button:not([tabindex="-1"])')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'ArrowLeft') { syncGallery(currentIndex - 1); renderLightboxImage(); }
    if (event.key === 'ArrowRight') { syncGallery(currentIndex + 1); renderLightboxImage(); }
  });

  dotButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextIndex = Number(button.getAttribute('data-detail-dot') || '0');
      syncGallery(nextIndex);
    });
  });

  mainMedia?.addEventListener('touchstart', (event) => {
    if (!window.matchMedia('(max-width: 760px)').matches || imageSources.length < 2) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });

  mainMedia?.addEventListener('touchend', (event) => {
    if (!window.matchMedia('(max-width: 760px)').matches || imageSources.length < 2) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    if (Math.abs(deltaX) < 36 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    syncGallery(deltaX < 0 ? currentIndex + 1 : currentIndex - 1);
  }, { passive: true });

  syncGallery(currentIndex);
}

function bindVehicleFinancingAction(vehicle) {
  const button = document.querySelector('[data-vehicle-financing-link]');
  if (!button) return;

  button.addEventListener('click', () => {
    window.RGShared.trackEvent?.('click_financing', {
      vehicle_id: vehicle.id || null,
      vehicle_title: vehicle.title || [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' ') || 'Vehículo',
      financing_type: 'vehicle_financing',
      source: 'vehicle_detail',
      destination: 'financing_page',
    });
  });
}

function relatedScore(baseVehicle, candidate) {
  let score = 0;
  if (candidate.category && candidate.category === baseVehicle.category) score += 4;
  if (candidate.brand && candidate.brand === baseVehicle.brand) score += 3;
  if (candidate.model && candidate.model === baseVehicle.model) score += 2;
  if (candidate.year && baseVehicle.year) {
    const diff = Math.abs(Number(candidate.year) - Number(baseVehicle.year));
    if (diff <= 1) score += 2;
    else if (diff <= 3) score += 1;
  }
  if (candidate.price && baseVehicle.price) {
    const base = Number(baseVehicle.price) || 1;
    const diff = Math.abs(Number(candidate.price) - Number(baseVehicle.price)) / base;
    if (diff <= 0.2) score += 2;
    else if (diff <= 0.35) score += 1;
  }
  if (candidate.featured) score += 1;
  if (vehicleFinancingAvailable(candidate) && vehicleFinancingAvailable(baseVehicle)) score += 1;
  return score;
}

async function loadRelated(vehicle) {
  if (!$relatedGrid) return;

  try {
    const { data, error } = await sb
      .from('vehicles')
      .select('*')
      .neq('status', 'hidden')
      .neq('id', vehicle.id)
      .order('created_at', { ascending: false })
      .limit(18);

    if (error) throw error;

    const related = (data || [])
      .map((item) => ({ ...item, _score: relatedScore(vehicle, item) }))
      .sort((a, b) => (b._score - a._score) || ((b.featured ? 1 : 0) - (a.featured ? 1 : 0)))
      .slice(0, 3);

    if (!related.length) {
      $relatedGrid.innerHTML = '<div class="empty-state"><strong>No hay más publicaciones relacionadas por el momento.</strong><span>Volvé al catálogo para ver todo el stock disponible.</span></div>';
      return;
    }

    $relatedGrid.innerHTML = related.map(cardHTML).join('');
  } catch (error) {
    console.error(error);
    $relatedGrid.innerHTML = '<div class="empty-state"><strong>No se pudieron cargar vehículos relacionados.</strong><span>Probá nuevamente en unos instantes.</span></div>';
  }
}

async function load() {
  const id = qs('id');
  if (!id) {
    $detail.innerHTML = '<div class="empty-state"><strong>Falta el ID del vehículo.</strong><span>Volvé al catálogo y abrí la publicación desde allí.</span></div>';
    $relatedGrid.innerHTML = '';
    return;
  }

  $detail.innerHTML = '<div class="empty-state"><strong>Cargando vehículo…</strong><span>Esperá un momento.</span></div>';

  try {
    const { data, error } = await sb
      .from('vehicles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      $detail.innerHTML = '<div class="empty-state"><strong>No encontramos el vehículo solicitado.</strong><span>Puede haber sido eliminado o cambiado de estado.</span></div>';
      $relatedGrid.innerHTML = '';
      return;
    }

    updateSeo(data);
    $detail.innerHTML = detailMarkup(data);
    bindDetailEvents();
    bindVehicleFinancingAction(data);
    import('./inspections/public.mjs?v=20261106-public-layout').then(({ mountPublicInspection }) => mountPublicInspection(data.id)).catch(() => {});
    window.RGShared.trackEvent?.('view_item', {
      vehicle_id: data.id,
      item_id: String(data.id),
      item_name: data.title || [data.brand, data.model, data.year].filter(Boolean).join(' '),
      title: data.title || null,
      brand: data.brand || null,
      model: data.model || null,
      year: data.year || null,
      category: data.category || null,
      price: Number(data.price) || null,
      currency: data.currency || 'ARS',
      vehicle_status: data.status || null,
      content_name: data.title || [data.brand, data.model, data.year].filter(Boolean).join(' '),
      content_type: 'product',
      content_ids: [String(data.id)],
      items: [{
        item_id: String(data.id),
        item_name: data.title || [data.brand, data.model, data.year].filter(Boolean).join(' '),
        item_brand: data.brand || null,
        item_category: data.category || null,
        price: Number(data.price) || null,
        currency: data.currency || 'ARS',
      }],
    });
    await loadRelated(data);
  } catch (error) {
    console.error(error);
    $detail.innerHTML = `<div class="empty-state"><strong>No se pudo cargar el detalle.</strong><span>${window.RGShared.escapeHTML(error.message || 'Error inesperado.')}</span></div>`;
    $relatedGrid.innerHTML = '';
  }
}

load();
