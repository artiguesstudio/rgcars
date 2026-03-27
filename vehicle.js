const sb = window.supabase.createClient(window.RG.SUPABASE_URL, window.RG.SUPABASE_ANON_KEY);

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
  const image = window.RGShared.firstImage(vehicle);

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

  ldJson.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    image: image ? [image] : [],
    description,
    brand: vehicle.brand || undefined,
    model: vehicle.model || undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: vehicle.currency || 'ARS',
      price: Number(vehicle.price || 0),
      availability: vehicle.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      url,
    },
  });
}

function commercialPills(vehicle) {
  const pills = [];
  if (vehicle.featured) pills.push('<span class="featured-pill is-inline">Destacado</span>');
  if (vehicle.is_recent) pills.push('<span class="featured-pill is-inline is-neutral">Recién ingresado</span>');
  if (vehicle.outlet) pills.push('<span class="featured-pill is-inline is-outlet">Outlet</span>');
  return pills.join('');
}

function commercialBlocks(vehicle) {
  const financeEntities = window.RGShared.arrayFromUnknown(vehicle.finance_entities);
  const blocks = [];

  if (vehicle.financing_enabled || vehicle.private_financing_enabled) {
    blocks.push(`
      <div class="commercial-panel">
        <h3>Financiación</h3>
        <ul class="feature-list compact-list">
          ${vehicle.min_down_payment ? `<li>Entrega estimada desde ${window.RGShared.formatPrice(vehicle.min_down_payment, vehicle.currency || 'ARS')}</li>` : '<li>Entrega mínima a confirmar con un asesor</li>'}
          ${vehicle.finance_max_months ? `<li>Plazo de trabajo hasta ${vehicle.finance_max_months} cuotas</li>` : '<li>Plazo sujeto a perfil y convenio</li>'}
          ${financeEntities.length ? `<li>Operable con ${window.RGShared.escapeHTML(financeEntities.join(', '))}</li>` : '<li>Consultá alternativas disponibles para esta unidad</li>'}
        </ul>
        ${vehicle.finance_note ? `<p class="commercial-note">${window.RGShared.escapeHTML(vehicle.finance_note)}</p>` : '<p class="commercial-note">La aprobación final depende del análisis de la entidad y la documentación presentada.</p>'}
        <div class="detail-actions detail-actions-tight">
          <a class="btn btn-soft" href="${window.RGShared.financingUrl(vehicle, 'agency')}">Simular financiación</a>
          <a class="btn btn-ghost" href="${window.RGShared.financingUrl(vehicle, 'private')}">Compra entre particulares</a>
        </div>
      </div>
    `);
  }

  if (vehicle.insurance_available) {
    blocks.push(`
      <div class="commercial-panel">
        <h3>Seguros, peritaje y servicios</h3>
        <p class="commercial-note">Podés pedir una pre-cotización de seguro, coordinar un peritaje y sumar gestoría, inspección o guarda según la operación.</p>
        <div class="detail-actions detail-actions-tight">
          <a class="btn btn-ghost" href="${window.RGShared.insuranceUrl(vehicle)}">Pre-cotizar seguro</a>
        </div>
      </div>
    `);
  }

  return blocks.join('');
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
    <div class="commercial-panel">
      <h3>Equipamiento destacado</h3>
      <ul class="feature-list compact-list">
        ${equipment.map((item) => `<li>${window.RGShared.escapeHTML(item)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function detailMarkup(vehicle) {
  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const mainMedia = images.length
    ? `<img id="mainVehicleImage" src="${images[0]}" alt="${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}">`
    : `<div class="media-placeholder large">Sin foto principal</div>`;

  return `
    <article class="detail-grid">
      <section class="detail-gallery-card">
        <div class="detail-main-media">
          ${mainMedia}
          <span class="status-pill ${window.RGShared.statusClass(vehicle.status)} is-large">${window.RGShared.statusLabel(vehicle.status)}</span>
          <div class="detail-top-pills">${commercialPills(vehicle)}</div>
        </div>
        <div class="detail-thumbs">
          ${images.length ? images.map((src, index) => `
            <button class="thumb-button ${index === 0 ? 'is-active' : ''}" type="button" data-thumb-src="${src}" aria-label="Ver imagen ${index + 1}">
              <img src="${src}" alt="Miniatura ${index + 1}">
            </button>
          `).join('') : '<div class="empty-inline">Todavía no hay miniaturas cargadas.</div>'}
        </div>
      </section>

      <aside class="detail-info-card">
        <div class="detail-info-top">
          <span class="vehicle-category">${window.RGShared.categoryLabel(vehicle.category)}</span>
          ${commercialPills(vehicle)}
        </div>

        <h1>${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}</h1>
        <p class="detail-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>

        <div class="detail-specs-grid">
          ${detailSpecItems(vehicle)}
        </div>

        <div class="detail-actions">
          <a class="btn btn-primary" href="${window.RGShared.waLink(vehicle)}" target="_blank" rel="noreferrer">Consultar por WhatsApp</a>
          ${vehicle.financing_enabled ? `<a class="btn btn-soft" href="${window.RGShared.financingUrl(vehicle, 'agency')}">Financiación</a>` : ''}
          ${vehicle.insurance_available ? `<a class="btn btn-ghost" href="${window.RGShared.insuranceUrl(vehicle)}">Seguro</a>` : ''}
        </div>

        ${equipmentMarkup(vehicle)}

        <div class="detail-copy">
          <h2>Descripción</h2>
          <p>${window.RGShared.escapeHTML(vehicle.description || 'Esta unidad está publicada por RG Cars TDF. Consultá disponibilidad actualizada, financiación y formas de pago.').replace(/\n/g, '<br>')}</p>
        </div>

        ${commercialBlocks(vehicle)}
      </aside>
    </article>
  `;
}

function cardHTML(vehicle) {
  const image = window.RGShared.firstImage(vehicle);
  return `
    <article class="vehicle-card compact-card">
      <a class="vehicle-card-link" href="./vehicle.html?id=${vehicle.id}" aria-label="Ver detalle de ${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}">
        <div class="vehicle-media compact-media">
          ${image ? `<img src="${image}" alt="${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}" class="is-active">` : '<div class="media-placeholder">Sin foto</div>'}
          <span class="status-pill ${window.RGShared.statusClass(vehicle.status)}">${window.RGShared.statusLabel(vehicle.status)}</span>
        </div>
        <div class="vehicle-body compact-body">
          <h3>${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}</h3>
          <p class="vehicle-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>
        </div>
      </a>
    </article>
  `;
}

function bindDetailEvents() {
  const mainImage = document.getElementById('mainVehicleImage');
  if (!mainImage) return;

  document.querySelectorAll('[data-thumb-src]').forEach((button) => {
    button.addEventListener('click', () => {
      const src = button.getAttribute('data-thumb-src');
      if (!src) return;
      mainImage.src = src;
      document.querySelectorAll('[data-thumb-src]').forEach((item) => item.classList.toggle('is-active', item === button));
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
  if (candidate.financing_enabled && baseVehicle.financing_enabled) score += 1;
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
    await loadRelated(data);
  } catch (error) {
    console.error(error);
    $detail.innerHTML = `<div class="empty-state"><strong>No se pudo cargar el detalle.</strong><span>${window.RGShared.escapeHTML(error.message || 'Error inesperado.')}</span></div>`;
    $relatedGrid.innerHTML = '';
  }
}

load();
