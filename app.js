const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const $grid = document.getElementById('grid');
const $q = document.getElementById('q');
const $clearFilters = document.getElementById('clearFilters');
const $applyFilters = document.getElementById('applyFilters');
const $filterButton = document.getElementById('filterButton');
const $filterDialog = document.getElementById('filterDialog');
const $filterBackdrop = document.getElementById('filterBackdrop');
const $filterClose = document.getElementById('filterClose');
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

let vehiclesCache = [];
let stockExpanded = false;

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

function cardHTML(vehicle) {
  const year = String(vehicle.year || '').trim();
  return `
    <article class="vehicle-card vehicle-card--catalog">
      <a class="vehicle-card-link" href="./vehicle.html?id=${encodeURIComponent(vehicle.id)}" aria-label="Ver detalle de ${escape(vehicle.title || 'Vehículo')}">
        <div class="vehicle-media">
          ${imagesHTML(vehicle)}
          <div class="card-overlay-pills">${extraBadgesHTML(vehicle)}</div>
        </div>
        <div class="vehicle-body">
          ${year ? `<p class="vehicle-year">${escape(year)}</p>` : ''}
          <h3>${escape(vehicle.title || 'Vehículo')}</h3>
          <p class="vehicle-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>
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

function vehiclePriority(vehicle) {
  let score = 0;
  if (vehicle.status === 'available') score += 25;
  if (vehicle.featured || vehicle.outlet) score += 20;
  if (vehicle.is_recent) score += 14;
  if (vehicle.financing_enabled || vehicle.private_financing_enabled) score += 6;
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
    ${visibleRows.map(cardHTML).join('')}
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

    vehiclesCache = Array.isArray(data) ? data : [];
    updateBrandOptions(vehiclesCache);
    renderSearchResults();
  } catch (error) {
    console.error(error);
    $grid.innerHTML = `<div class="empty-state"><strong>No se pudo cargar el catálogo.</strong><span>${escape(error.message || 'Error inesperado.')}</span></div>`;
  }
}

function bindFilterEvents() {
  const rerender = () => {
    stockExpanded = false;
    renderSearchResults();
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
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderSearchResults(), 140);
  });
}

initFilterMenu();
bindFilterEvents();
fetchVehicles();
