const sb = window.RGShared?.publicSupabaseClient?.()
  || window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const $grid = document.getElementById('grid');
const $q = document.getElementById('q');
const $clearFilters = document.getElementById('clearFilters');
const $applyFilters = document.getElementById('applyFilters');
const $filterButton = document.getElementById('filterButton');
const $filterDialog = document.getElementById('filterDialog');
const $filterBackdrop = document.getElementById('filterBackdrop');
const $filterClose = document.getElementById('filterClose');
const $filterDismiss = document.getElementById('filterDismiss');
const $sort = document.getElementById('sort');
const $filterFeatured = document.getElementById('filterFeatured');
const $filterZeroKm = document.getElementById('filterZeroKm');
const $filterUsed = document.getElementById('filterUsed');
const $filterBrand = document.getElementById('filterBrand');
const $filterFuel = document.getElementById('filterFuel');
const $filterTransmission = document.getElementById('filterTransmission');
const $filterDrivetrain = document.getElementById('filterDrivetrain');
const $filterColor = document.getElementById('filterColor');
const $filterYearMin = document.getElementById('filterYearMin');
const $filterYearMax = document.getElementById('filterYearMax');
const $filterPriceMin = document.getElementById('filterPriceMin');
const $filterPriceMax = document.getElementById('filterPriceMax');
const $soldSection = document.getElementById('soldVehiclesSection');
const $soldCarousel = document.getElementById('soldVehiclesCarousel');
const $soldPrev = document.getElementById('soldVehiclesPrev');
const $soldNext = document.getElementById('soldVehiclesNext');

let vehiclesCache = [];
let soldVehiclesCache = [];
let stockExpanded = false;
let soldAutoplayTimer = null;
let soldAutoplayResumeTimer = null;
let soldCarouselBound = false;
let searchTrackingTimer = null;
let lastSearchTrackingSignature = '';
const soldReducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function escape(value) {
  return window.RGShared.escapeHTML(value || '');
}

function formatText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeVehicleStatus(vehicleOrStatus) {
  const value = typeof vehicleOrStatus === 'object' ? vehicleOrStatus?.status : vehicleOrStatus;
  const helper = window.RGShared?.normalizeStatus;
  if (typeof helper === 'function') return helper(value);

  const normalized = formatText(value);
  if (normalized.includes('proximo') || normalized.includes('incoming')) return 'incoming';
  if (normalized.includes('reserv')) return 'reserved';
  if (normalized.includes('vend') || normalized.includes('sold')) return 'sold';
  if (normalized.includes('oculto') || normalized.includes('hidden')) return 'hidden';
  return 'available';
}

function isSoldVehicle(vehicle) {
  return normalizeVehicleStatus(vehicle) === 'sold';
}

function isPublicStockVehicle(vehicle) {
  const status = normalizeVehicleStatus(vehicle);
  return status !== 'hidden' && status !== 'sold';
}

function imagesHTML(vehicle) {
  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const primary = images[0];
  if (!primary) return '<div class="media-placeholder">Sin foto principal</div>';
  return `<img src="${primary}" alt="${escape(vehicle.title || 'Vehículo')}" class="is-active">`;
}

function extraBadgesHTML(vehicle) {
  const tags = [];
  if (vehicle.featured) tags.push('<span class="featured-pill">Oportunidad</span>');
  if (vehicle.outlet) tags.push('<span class="featured-pill is-outlet">Oferta</span>');
  if (vehicle.is_recent && !vehicle.featured && !vehicle.outlet) tags.push('<span class="featured-pill is-neutral">Recién ingresado</span>');
  return tags.join('');
}

function statusPillHTML(vehicle) {
  const status = normalizeVehicleStatus(vehicle);
  if (status === 'hidden') return '';
  return `<span class="status-pill ${escape(window.RGShared.statusClass(status))}">${escape(window.RGShared.statusLabel(status))}</span>`;
}

function cardHTML(vehicle, position = 0) {
  const year = String(vehicle.year || '').trim();
  const minimumDownPayment = window.RGShared.minimumDownPaymentLabel(vehicle);
  return `
    <article class="vehicle-card vehicle-card--catalog" data-catalog-vehicle-id="${escape(vehicle.id)}" data-catalog-position="${position + 1}">
      <a class="vehicle-card-link" href="./vehicle.html?id=${encodeURIComponent(vehicle.id)}" aria-label="Ver detalle de ${escape(vehicle.title || 'Vehículo')}">
        <div class="vehicle-media">
          ${imagesHTML(vehicle)}
          ${statusPillHTML(vehicle)}
          <div class="card-overlay-pills">${extraBadgesHTML(vehicle)}</div>
        </div>
        <div class="vehicle-body">
          ${year ? `<p class="vehicle-year">${escape(year)}</p>` : ''}
          <h3>${escape(vehicle.title || 'Vehículo')}</h3>
          <p class="vehicle-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>
          ${minimumDownPayment ? `<p class="vehicle-down-payment">${escape(minimumDownPayment)}</p>` : ''}
        </div>
      </a>
    </article>
  `;
}

function soldCardHTML(vehicle) {
  const year = String(vehicle.year || '').trim();
  return `
    <article class="sold-vehicle-card" role="listitem">
      <a class="sold-vehicle-card__link" href="./vehicle.html?id=${encodeURIComponent(vehicle.id)}" aria-label="Ver detalle vendido de ${escape(vehicle.title || 'Vehículo')}">
        <div class="sold-vehicle-card__media">
          ${imagesHTML({ ...vehicle, status: 'sold' })}
          ${statusPillHTML({ ...vehicle, status: 'sold' })}
        </div>
        <div class="sold-vehicle-card__body">
          ${year ? `<p class="vehicle-year">${escape(year)}</p>` : ''}
          <h3>${escape(vehicle.title || 'Vehículo')}</h3>
          <p class="vehicle-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>
          <p class="sold-vehicle-card__note">Unidad vendida</p>
        </div>
      </a>
    </article>
  `;
}

function visibleCatalogLimit() {
  if (window.innerWidth <= 760) return 8;
  return 10;
}

function activeFilterCount() {
  const controls = [
    $filterFeatured?.checked,
    $filterZeroKm?.checked,
    $filterUsed?.checked,
    !!$filterBrand?.value,
    !!$filterFuel?.value,
    !!$filterTransmission?.value,
    !!$filterDrivetrain?.value,
    !!$filterColor?.value?.trim(),
    !!$filterYearMin?.value,
    !!$filterYearMax?.value,
    !!$filterPriceMin?.value,
    !!$filterPriceMax?.value,
    ($sort?.value || 'newest') !== 'newest',
  ];
  return controls.filter(Boolean).length;
}

function updateFilterButton() {
  if (!$filterButton) return;
  const count = activeFilterCount();
  $filterButton.textContent = count ? `Filtros (${count})` : 'Filtros';
}

function updateApplyButton(count) {
  if (!$applyFilters) return;
  $applyFilters.textContent = count === 1 ? 'Mostrar 1 vehículo' : `Mostrar ${count} vehículos`;
}

function updateBrandOptions(rows) {
  if (!$filterBrand) return;
  const current = $filterBrand.value;
  const brandsMap = new Map();
  (rows || []).forEach((vehicle) => {
    const brand = String(vehicle.brand || '').trim();
    if (!brand) return;
    const key = formatText(brand);
    if (!brandsMap.has(key)) brandsMap.set(key, brand);
  });
  const brands = [...brandsMap.values()].sort((a, b) => a.localeCompare(b, 'es'));
  $filterBrand.innerHTML = '<option value="">Todas</option>' + brands.map((brand) => `<option value="${escape(brand)}">${escape(brand)}</option>`).join('');
  const currentKey = formatText(current);
  if (currentKey && brandsMap.has(currentKey)) $filterBrand.value = brandsMap.get(currentKey);
}

function openFilterDialog() {
  if (!$filterDialog || !$filterBackdrop) return;
  $filterDialog.hidden = false;
  $filterBackdrop.hidden = false;
  document.body.classList.add('filter-dialog-open');
  $filterButton?.setAttribute('aria-expanded', 'true');
}

function closeFilterDialog() {
  if (!$filterDialog || !$filterBackdrop) return;
  $filterDialog.hidden = true;
  $filterBackdrop.hidden = true;
  document.body.classList.remove('filter-dialog-open');
  $filterButton?.setAttribute('aria-expanded', 'false');
}

function initFilterMenu() {
  closeFilterDialog();
  updateFilterButton();
  $filterButton?.addEventListener('click', () => ($filterDialog?.hidden ? openFilterDialog() : closeFilterDialog()));
  $filterClose?.addEventListener('click', closeFilterDialog);
  $filterDismiss?.addEventListener('click', closeFilterDialog);
  $filterBackdrop?.addEventListener('click', closeFilterDialog);
  $applyFilters?.addEventListener('click', closeFilterDialog);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$filterDialog?.hidden) closeFilterDialog();
  });
}

function currentSearchQuery() {
  return formatText($q?.value || '');
}

function isZeroKm(vehicle) {
  const km = Number(vehicle.km);
  return Number.isFinite(km) && km <= 100;
}

function vehicleFinancingAvailable(vehicle) {
  const helper = window.RGShared?.vehicleFinancingAvailable;
  return typeof helper === 'function' ? helper(vehicle) : true;
}

function vehiclePriority(vehicle) {
  let score = 0;
  const status = normalizeVehicleStatus(vehicle);
  if (status === 'available') score += 25;
  if (status === 'incoming') score += 16;
  if (status === 'reserved') score += 8;
  if (vehicle.featured || vehicle.outlet) score += 20;
  if (vehicle.is_recent) score += 14;
  if (vehicleFinancingAvailable(vehicle)) score += 6;
  return score;
}

function sortRows(rows) {
  const sort = $sort?.value || 'newest';
  const sorted = [...rows];
  if (sort === 'price_asc') return sorted.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  if (sort === 'price_desc') return sorted.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  if (sort === 'featured') {
    return sorted.sort((a, b) => {
      const aScore = Number(!!a.featured || !!a.outlet);
      const bScore = Number(!!b.featured || !!b.outlet);
      if (bScore !== aScore) return bScore - aScore;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
  }
  return sorted.sort((a, b) => {
    const diff = vehiclePriority(b) - vehiclePriority(a);
    if (diff) return diff;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

function filteredVehicles(rows) {
  const query = currentSearchQuery();
  return rows.filter((vehicle) => {
    if (query) {
      const haystack = formatText([
        vehicle.title,
        vehicle.brand,
        vehicle.model,
        vehicle.year,
        vehicle.category,
        vehicle.description,
        vehicle.color,
        vehicle.fuel_type,
        vehicle.transmission,
        vehicle.drivetrain,
      ].join(' '));
      if (!haystack.includes(query)) return false;
    }

    if ($filterFeatured?.checked && !(vehicle.featured || vehicle.outlet)) return false;

    const wantsZeroKm = !!$filterZeroKm?.checked;
    const wantsUsed = !!$filterUsed?.checked;
    if (wantsZeroKm && !wantsUsed && !isZeroKm(vehicle)) return false;
    if (wantsUsed && !wantsZeroKm && isZeroKm(vehicle)) return false;

    if ($filterBrand?.value && formatText(vehicle.brand) !== formatText($filterBrand.value)) return false;
    if ($filterFuel?.value && formatText(vehicle.fuel_type) !== formatText($filterFuel.value)) return false;
    if ($filterTransmission?.value && formatText(vehicle.transmission) !== formatText($filterTransmission.value)) return false;
    if ($filterDrivetrain?.value && formatText(vehicle.drivetrain) !== formatText($filterDrivetrain.value)) return false;
    if ($filterColor?.value?.trim() && !formatText(vehicle.color).includes(formatText($filterColor.value))) return false;

    const year = Number(vehicle.year || 0);
    if ($filterYearMin?.value && year && year < Number($filterYearMin.value)) return false;
    if ($filterYearMax?.value && year && year > Number($filterYearMax.value)) return false;

    const price = Number(vehicle.price || 0);
    if ($filterPriceMin?.value && price && price < Number($filterPriceMin.value)) return false;
    if ($filterPriceMax?.value && price && price > Number($filterPriceMax.value)) return false;

    return true;
  });
}

function shouldReduceSoldMotion() {
  return !!soldReducedMotionQuery?.matches;
}

function canScrollSoldCarousel() {
  return !!$soldCarousel && $soldCarousel.scrollWidth > $soldCarousel.clientWidth + 8;
}

function soldCarouselStep() {
  const firstCard = $soldCarousel?.querySelector('.sold-vehicle-card');
  if (!firstCard || !$soldCarousel) return 280;
  const styles = window.getComputedStyle($soldCarousel);
  const gap = parseFloat(styles.columnGap || styles.gap) || 16;
  return firstCard.getBoundingClientRect().width + gap;
}

function updateSoldCarouselControls() {
  const canScroll = canScrollSoldCarousel();
  [$soldPrev, $soldNext].forEach((button) => {
    if (!button) return;
    button.disabled = !canScroll;
    button.hidden = !canScroll;
  });
}

function scrollSoldCarousel(direction = 1) {
  if (!canScrollSoldCarousel()) return;
  const maxScroll = $soldCarousel.scrollWidth - $soldCarousel.clientWidth;
  const current = $soldCarousel.scrollLeft;
  const next = current + soldCarouselStep() * direction;
  let target = next;

  if (direction > 0 && next >= maxScroll - 4) target = 0;
  if (direction < 0 && next <= 0) target = maxScroll;

  $soldCarousel.scrollTo({
    left: target,
    behavior: shouldReduceSoldMotion() ? 'auto' : 'smooth',
  });
}

function stopSoldCarouselAutoplay() {
  if (soldAutoplayTimer) window.clearInterval(soldAutoplayTimer);
  soldAutoplayTimer = null;
}

function startSoldCarouselAutoplay() {
  stopSoldCarouselAutoplay();
  if (shouldReduceSoldMotion() || document.hidden || !canScrollSoldCarousel()) return;

  soldAutoplayTimer = window.setInterval(() => {
    if (document.hidden || $soldSection?.matches(':hover')) return;
    scrollSoldCarousel(1);
  }, 3600);
}

function scheduleSoldCarouselAutoplay() {
  if (soldAutoplayResumeTimer) window.clearTimeout(soldAutoplayResumeTimer);
  if (shouldReduceSoldMotion()) return;
  soldAutoplayResumeTimer = window.setTimeout(() => {
    startSoldCarouselAutoplay();
  }, 7000);
}

function pauseSoldCarouselTemporarily() {
  stopSoldCarouselAutoplay();
  scheduleSoldCarouselAutoplay();
}

function bindSoldCarouselEvents() {
  if (soldCarouselBound || !$soldCarousel) return;
  soldCarouselBound = true;

  $soldPrev?.addEventListener('click', () => {
    pauseSoldCarouselTemporarily();
    scrollSoldCarousel(-1);
  });
  $soldNext?.addEventListener('click', () => {
    pauseSoldCarouselTemporarily();
    scrollSoldCarousel(1);
  });
  $soldCarousel.addEventListener('pointerdown', pauseSoldCarouselTemporarily);
  $soldCarousel.addEventListener('wheel', pauseSoldCarouselTemporarily, { passive: true });
  $soldCarousel.addEventListener('focusin', stopSoldCarouselAutoplay);
  $soldCarousel.addEventListener('focusout', scheduleSoldCarouselAutoplay);
  $soldCarousel.addEventListener('scroll', () => window.requestAnimationFrame(updateSoldCarouselControls), { passive: true });
  $soldSection?.addEventListener('mouseenter', stopSoldCarouselAutoplay);
  $soldSection?.addEventListener('mouseleave', startSoldCarouselAutoplay);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopSoldCarouselAutoplay();
    } else {
      startSoldCarouselAutoplay();
    }
  });
  window.addEventListener('resize', () => window.requestAnimationFrame(() => {
    updateSoldCarouselControls();
    startSoldCarouselAutoplay();
  }));
  soldReducedMotionQuery?.addEventListener?.('change', () => {
    if (shouldReduceSoldMotion()) {
      stopSoldCarouselAutoplay();
    } else {
      startSoldCarouselAutoplay();
    }
  });
}

function renderSoldVehicles(rows) {
  if (!$soldSection || !$soldCarousel) return;
  const soldRows = (rows || [])
    .filter(isSoldVehicle)
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());

  stopSoldCarouselAutoplay();

  if (!soldRows.length) {
    $soldSection.hidden = true;
    $soldCarousel.innerHTML = '';
    updateSoldCarouselControls();
    return;
  }

  $soldCarousel.innerHTML = soldRows.map(soldCardHTML).join('');
  $soldSection.hidden = false;
  bindSoldCarouselEvents();
  window.requestAnimationFrame(() => {
    updateSoldCarouselControls();
    startSoldCarouselAutoplay();
  });
}

function renderRows(rows, emptyTitle, emptyCopy) {
  if (!$grid) return;
  if (!rows.length) {
    stockExpanded = false;
    $grid.innerHTML = `<div class="empty-state"><strong>${emptyTitle}</strong><span>${emptyCopy}</span></div>`;
    return;
  }

  const sorted = sortRows(rows);
  const limit = visibleCatalogLimit();
  const shouldShowToggle = sorted.length > limit;
  const visibleRows = stockExpanded ? sorted : sorted.slice(0, limit);

  $grid.innerHTML = `
    ${visibleRows.map((vehicle, index) => cardHTML(vehicle, index)).join('')}
    ${shouldShowToggle ? `
      <div class="stock-more-wrap">
        <button type="button" class="btn btn-ghost stock-more-button" id="stockMoreButton" aria-expanded="${stockExpanded ? 'true' : 'false'}">
          ${stockExpanded ? 'Mostrar menos' : 'Ver todo el stock'}
        </button>
      </div>
    ` : ''}
  `;

  document.getElementById('stockMoreButton')?.addEventListener('click', () => {
    stockExpanded = !stockExpanded;
    renderSearchResults();
    if (!stockExpanded) {
      document.getElementById('stock')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function renderSearchResults(emptyTitle = 'No encontramos vehículos con esos filtros.', emptyCopy = 'Probá ajustando la búsqueda o quitando algún filtro.') {
  const filtered = filteredVehicles(vehiclesCache);
  updateFilterButton();
  updateApplyButton(filtered.length);
  renderRows(filtered, emptyTitle, emptyCopy);
}

function activeSearchTrackingPayload() {
  const rawSearch = String($q?.value || '').trim().toLowerCase();
  const knownTerms = new Set();
  vehiclesCache.forEach((vehicle) => {
    [vehicle.brand, vehicle.model, vehicle.category, vehicle.fuel, vehicle.transmission, vehicle.color, vehicle.year]
      .filter(Boolean)
      .forEach((value) => knownTerms.add(String(value).trim().toLowerCase()));
  });
  const searchTerm = [...knownTerms].filter((term) => term.length >= 2 && rawSearch.includes(term)).slice(0, 4).join(' ') || (rawSearch ? 'other' : '');
  const rawColor = String($filterColor?.value || '').trim().toLowerCase();
  const knownColors = new Set(vehiclesCache.map((vehicle) => String(vehicle.color || '').trim().toLowerCase()).filter(Boolean));
  return {
    search_term: searchTerm,
    filter_featured: !!$filterFeatured?.checked,
    filter_zero_km: !!$filterZeroKm?.checked,
    filter_used: !!$filterUsed?.checked,
    filter_brand: $filterBrand?.value || null,
    filter_fuel: $filterFuel?.value || null,
    filter_transmission: $filterTransmission?.value || null,
    filter_drivetrain: $filterDrivetrain?.value || null,
    filter_color: rawColor ? (knownColors.has(rawColor) ? rawColor : 'other') : null,
    filter_year_min: $filterYearMin?.value || null,
    filter_year_max: $filterYearMax?.value || null,
    filter_price_min: $filterPriceMin?.value || null,
    filter_price_max: $filterPriceMax?.value || null,
    sort: $sort?.value || 'newest',
    result_count: filteredVehicles(vehiclesCache).length,
  };
}

function scheduleSearchTracking() {
  clearTimeout(searchTrackingTimer);
  searchTrackingTimer = setTimeout(() => {
    const payload = activeSearchTrackingPayload();
    if (!payload.search_term && activeFilterCount() === 0) return;
    const signature = JSON.stringify(payload);
    if (signature === lastSearchTrackingSignature) return;
    lastSearchTrackingSignature = signature;
    window.RGShared.trackEvent?.('search', payload);
  }, 500);
}

function bindCatalogSelectionTracking() {
  $grid?.addEventListener('click', (event) => {
    const link = event.target.closest('.vehicle-card-link');
    const card = link?.closest('[data-catalog-vehicle-id]');
    if (!link || !card) return;
    const vehicle = vehiclesCache.find((item) => String(item.id) === String(card.dataset.catalogVehicleId));
    if (!vehicle) return;
    window.RGShared.trackEvent?.('select_item', {
      item_list_id: 'public_stock',
      item_list_name: 'Stock disponible',
      vehicle_id: vehicle.id,
      item_id: String(vehicle.id),
      item_name: vehicle.title || [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' '),
      brand: vehicle.brand || null,
      model: vehicle.model || null,
      year: vehicle.year || null,
      category: vehicle.category || null,
      position: Number(card.dataset.catalogPosition || 0) || null,
    });
  });
}

async function fetchVehicles() {
  if (!$grid) return;
  stockExpanded = false;
  $grid.innerHTML = '<div class="empty-state"><strong>Cargando publicaciones…</strong><span>Esperá un momento.</span></div>';

  try {
    const { data, error } = await sb
      .from('vehicles')
      .select('*')
      .neq('status', 'hidden');

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    vehiclesCache = rows.filter(isPublicStockVehicle);
    soldVehiclesCache = rows.filter(isSoldVehicle);
    updateBrandOptions(vehiclesCache);
    renderSearchResults();
    renderSoldVehicles(soldVehiclesCache);
    window.RGShared.trackEvent?.('view_item_list', {
      item_list_id: 'public_stock',
      item_list_name: 'Stock disponible',
      item_count: vehiclesCache.length,
      items: vehiclesCache.slice(0, 50).map((vehicle, index) => ({
        item_id: String(vehicle.id),
        item_name: vehicle.title || [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' '),
        item_brand: vehicle.brand || null,
        item_category: vehicle.category || null,
        index: index + 1,
      })),
    });
  } catch (error) {
    console.error(error);
    renderSoldVehicles([]);
    $grid.innerHTML = `<div class="empty-state"><strong>No se pudo cargar el catálogo.</strong><span>${escape(error.message || 'Error inesperado.')}</span></div>`;
  }
}

function bindFilterEvents() {
  const rerender = () => {
    stockExpanded = false;
    renderSearchResults();
    scheduleSearchTracking();
  };

  $q?.addEventListener('input', rerender);
  $sort?.addEventListener('change', rerender);
  [$filterFeatured, $filterZeroKm, $filterUsed, $filterBrand, $filterFuel, $filterTransmission, $filterDrivetrain, $filterColor, $filterYearMin, $filterYearMax, $filterPriceMin, $filterPriceMax]
    .forEach((control) => control?.addEventListener('input', rerender));
  [$filterFeatured, $filterZeroKm, $filterUsed, $filterBrand, $filterFuel, $filterTransmission, $filterDrivetrain]
    .forEach((control) => control?.addEventListener('change', rerender));

  $clearFilters?.addEventListener('click', () => {
    if ($q) $q.value = '';
    if ($sort) $sort.value = 'newest';
    if ($filterFeatured) $filterFeatured.checked = false;
    if ($filterZeroKm) $filterZeroKm.checked = false;
    if ($filterUsed) $filterUsed.checked = false;
    if ($filterBrand) $filterBrand.value = '';
    if ($filterFuel) $filterFuel.value = '';
    if ($filterTransmission) $filterTransmission.value = '';
    if ($filterDrivetrain) $filterDrivetrain.value = '';
    if ($filterColor) $filterColor.value = '';
    if ($filterYearMin) $filterYearMin.value = '';
    if ($filterYearMax) $filterYearMax.value = '';
    if ($filterPriceMin) $filterPriceMin.value = '';
    if ($filterPriceMax) $filterPriceMax.value = '';
    stockExpanded = false;
    renderSearchResults();
    lastSearchTrackingSignature = '';
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderSearchResults(), 140);
  });
}

initFilterMenu();
bindFilterEvents();
bindCatalogSelectionTracking();
fetchVehicles();
