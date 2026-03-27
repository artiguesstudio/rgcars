const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const $grid = document.getElementById('grid');
const $q = document.getElementById('q');
const $status = document.getElementById('status');
const $sort = document.getElementById('sort');
const $category = document.getElementById('category');
const $resultsMeta = document.getElementById('resultsMeta');
const $catalogSearch = document.getElementById('catalogSearch');
const $clearFilters = document.getElementById('clearFilters');
const $applyFilters = document.getElementById('applyFilters');
const $filterButton = document.getElementById('filterButton');
const $filterDialog = document.getElementById('filterDialog');
const $filterBackdrop = document.getElementById('filterBackdrop');
const $filterClose = document.getElementById('filterClose');
const $filterAvailable = document.getElementById('filterAvailable');
const $filterFeatured = document.getElementById('filterFeatured');
const $filterZeroKm = document.getElementById('filterZeroKm');
const $filterUsed = document.getElementById('filterUsed');

let vehiclesCache = [];

function imagesHTML(vehicle) {
  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const primary = images[0];
  if (!primary) {
    return `<div class="media-placeholder">Sin foto principal</div>`;
  }
  return `<img src="${primary}" alt="${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}" class="is-active">`;
}

function extraBadgesHTML(vehicle) {
  const tags = [];
  if (vehicle.featured) tags.push('<span class="featured-pill">Destacado</span>');
  if (vehicle.outlet) tags.push('<span class="featured-pill is-outlet">Outlet</span>');
  if (vehicle.is_recent && !vehicle.featured && !vehicle.outlet) tags.push('<span class="featured-pill is-neutral">Recién ingresado</span>');
  return tags.join('');
}

function cardHTML(vehicle) {
  return `
    <article class="vehicle-card vehicle-card--catalog">
      <a class="vehicle-card-link" href="./vehicle.html?id=${vehicle.id}" aria-label="Ver detalle de ${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}">
        <div class="vehicle-media">
          ${imagesHTML(vehicle)}
          <span class="status-pill ${window.RGShared.statusClass(vehicle.status)}">${window.RGShared.statusLabel(vehicle.status)}</span>
          <div class="card-overlay-pills">${extraBadgesHTML(vehicle)}</div>
        </div>

        <div class="vehicle-body">
          <h3>${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}</h3>
          <p class="vehicle-price">${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</p>
        </div>
      </a>
    </article>
  `;
}

function initCarousels() {
  document.querySelectorAll('[data-carousel]').forEach((carousel) => {
    const images = Array.from(carousel.querySelectorAll('img'));
    const dots = Array.from(carousel.querySelectorAll('[data-dot]'));
    if (images.length <= 1) return;
    if (carousel.dataset.carouselReady === 'true') return;
    carousel.dataset.carouselReady = 'true';

    let index = images.findIndex((img) => img.classList.contains('is-active'));
    if (index < 0) index = 0;
    let touchStartX = 0;
    let touchStartY = 0;

    const show = (nextIndex) => {
      index = (nextIndex + images.length) % images.length;
      images.forEach((img, i) => img.classList.toggle('is-active', i === index));
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    };

    carousel.querySelector('[data-nav="prev"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      show(index - 1);
    });

    carousel.querySelector('[data-nav="next"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      show(index + 1);
    });

    dots.forEach((dot) => {
      dot.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        show(Number(dot.getAttribute('data-dot') || 0));
      });
    });

    carousel.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { passive: true });

    carousel.addEventListener('touchend', (event) => {
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.abs(deltaX) < 36 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      if (deltaX < 0) show(index + 1);
      else show(index - 1);
    }, { passive: true });
  });
}


function activeFilterCount() {
  let count = 0;
  if ($filterAvailable?.checked) count += 1;
  if ($filterFeatured?.checked) count += 1;
  if ($filterZeroKm?.checked) count += 1;
  if ($filterUsed?.checked) count += 1;
  if (($sort?.value || 'newest') !== 'newest') count += 1;
  return count;
}

function updateFilterButton() {
  if (!$filterButton) return;
  const count = activeFilterCount();
  $filterButton.textContent = count ? `Filtros (${count})` : 'Filtros';
}

function updateApplyButton(count) {
  if (!$applyFilters) return;
  const label = count === 1 ? 'Mostrar 1 vehículo' : `Mostrar ${count} vehículos`;
  $applyFilters.textContent = label;
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

function toggleFilterDialog() {
  if (!$filterDialog) return;
  if ($filterDialog.hidden) openFilterDialog();
  else closeFilterDialog();
}

function initFilterMenu() {
  closeFilterDialog();
  updateFilterButton();

  $filterButton?.addEventListener('click', toggleFilterDialog);
  $filterClose?.addEventListener('click', closeFilterDialog);
  $filterBackdrop?.addEventListener('click', closeFilterDialog);
  $applyFilters?.addEventListener('click', closeFilterDialog);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$filterDialog?.hidden) closeFilterDialog();
  });
}

function currentSearchQuery() {
  return ($catalogSearch?.value || $q?.value || '').trim().toLowerCase();
}

function syncSearchInputs(source) {
  const value = source?.value || '';
  if (source !== $q && $q && $q.value !== value) $q.value = value;
  if (source !== $catalogSearch && $catalogSearch && $catalogSearch.value !== value) $catalogSearch.value = value;
}

function isZeroKm(vehicle) {
  const km = Number(vehicle.km);
  if (!Number.isFinite(km)) return false;
  return km <= 100;
}

function applySearch(rows) {
  const query = currentSearchQuery();
  if (!query) return rows;

  return rows.filter((vehicle) => {
    const haystack = [
      vehicle.title,
      vehicle.brand,
      vehicle.model,
      vehicle.year,
      vehicle.category,
      vehicle.description,
    ].join(' ').toLowerCase();

    return haystack.includes(query);
  });
}

function applyQuickFilters(rows) {
  return rows.filter((vehicle) => {
    if ($filterAvailable?.checked && vehicle.status !== 'available') return false;
    if ($filterFeatured?.checked && !vehicle.featured) return false;

    const wantsZeroKm = !!$filterZeroKm?.checked;
    const wantsUsed = !!$filterUsed?.checked;

    if (wantsZeroKm && !wantsUsed && !isZeroKm(vehicle)) return false;
    if (wantsUsed && !wantsZeroKm && isZeroKm(vehicle)) return false;

    return true;
  });
}

function filteredVehicles(rows) {
  return applyQuickFilters(applySearch(rows));
}

function updateResultsMeta(count) {
  if ($resultsMeta) {
    $resultsMeta.textContent = `${count} ${count === 1 ? 'unidad en catálogo' : 'unidades en catálogo'}`;
  }
  updateFilterButton();
  updateApplyButton(count);
}

function vehiclePriority(vehicle) {
  let score = 0;
  if (vehicle.status === 'available') score += 25;
  if (vehicle.featured) score += 20;
  if (vehicle.is_recent) score += 14;
  if (vehicle.financing_enabled) score += 4;
  return score;
}

function prioritizedRows(rows) {
  return [...rows].sort((a, b) => {
    const diff = vehiclePriority(b) - vehiclePriority(a);
    if (diff) return diff;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

function chunkRows(rows, size = 4) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

function stockPageSize() {
  if (window.innerWidth <= 680) return 1;
  if (window.innerWidth <= 980) return 2;
  return 4;
}

function renderStockCarousel(rows) {
  const pages = chunkRows(prioritizedRows(rows), stockPageSize());
  let page = 0;
  $grid.innerHTML = `
    <div class="stock-carousel" data-stock-carousel>
      <button class="stock-carousel-nav is-prev" type="button" data-stock-nav="prev" aria-label="Ver unidades anteriores">‹</button>
      <div class="stock-carousel-track"></div>
      <button class="stock-carousel-nav is-next" type="button" data-stock-nav="next" aria-label="Ver más unidades">›</button>
    </div>
  `;
  const track = $grid.querySelector('.stock-carousel-track');
  const prev = $grid.querySelector('[data-stock-nav="prev"]');
  const next = $grid.querySelector('[data-stock-nav="next"]');

  const paint = () => {
    track.innerHTML = `<div class="stock-carousel-page">${(pages[page] || []).map(cardHTML).join('')}</div>`;
    const hasMultiplePages = pages.length > 1;
    if (prev) {
      prev.disabled = page <= 0;
      prev.hidden = !hasMultiplePages;
    }
    if (next) {
      next.disabled = page >= pages.length - 1;
      next.hidden = !hasMultiplePages;
    }
    initCarousels();
  };

  prev?.addEventListener('click', () => {
    if (page <= 0) return;
    page -= 1;
    paint();
  });
  next?.addEventListener('click', () => {
    if (page >= pages.length - 1) return;
    page += 1;
    paint();
  });

  paint();
}

function renderRows(rows, emptyTitle, emptyCopy) {
  if (!$grid) return;
  if (!rows.length) {
    $grid.innerHTML = `<div class="empty-state"><strong>${emptyTitle}</strong><span>${emptyCopy}</span></div>`;
    return;
  }

  $grid.innerHTML = prioritizedRows(rows).map(cardHTML).join('');
}

async function fetchVehicles() {
  if (!$grid) return;
  $grid.innerHTML = '<div class="empty-state"><strong>Cargando publicaciones…</strong><span>Esperá un momento.</span></div>';

  try {
    let query = sb
      .from('vehicles')
      .select('*')
      .neq('status', 'hidden');

    const status = ($status?.value || 'all').trim();
    if (status !== 'all') query = query.eq('status', status);

    const category = ($category?.value || 'all').trim();
    if (category !== 'all') query = query.eq('category', category);

    const sort = $sort?.value || 'newest';
    if (sort === 'price_asc') query = query.order('price', { ascending: true });
    if (sort === 'price_desc') query = query.order('price', { ascending: false });
    if (sort === 'newest') query = query.order('is_recent', { ascending: false }).order('created_at', { ascending: false });
    if (sort === 'featured') query = query.order('featured', { ascending: false }).order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    vehiclesCache = data || [];

    const filtered = filteredVehicles(vehiclesCache);
    updateResultsMeta(filtered.length);

    renderRows(filtered, 'No encontramos vehículos con esos filtros.', 'Probá quitando algún filtro o usando otra búsqueda.');
  } catch (error) {
    console.error(error);
    $grid.innerHTML = `<div class="empty-state"><strong>No se pudo cargar el catálogo.</strong><span>${window.RGShared.escapeHTML(error.message || 'Error inesperado.')}</span></div>`;
    if ($resultsMeta) $resultsMeta.textContent = 'Error cargando publicaciones.';
  }
}

function renderSearchResults(messageTitle = 'No encontramos vehículos con esa búsqueda.', messageCopy = 'Probá con otra palabra clave o quitando filtros.') {
  const filtered = filteredVehicles(vehiclesCache);
  updateResultsMeta(filtered.length);
  renderRows(filtered, messageTitle, messageCopy);
}

function handleSearchInput(event) {
  syncSearchInputs(event.currentTarget);
  renderSearchResults();
}

$q?.addEventListener('input', handleSearchInput);
$catalogSearch?.addEventListener('input', handleSearchInput);

$status?.addEventListener('change', fetchVehicles);
$category?.addEventListener('change', fetchVehicles);
$sort?.addEventListener('change', () => renderSearchResults('No encontramos vehículos con esos filtros.', 'Probá quitando algún filtro.'));
[$filterAvailable, $filterFeatured, $filterZeroKm, $filterUsed].forEach((control) => {
  control?.addEventListener('change', () => renderSearchResults('No encontramos vehículos con esos filtros.', 'Probá quitando algún filtro.'));
});

$clearFilters?.addEventListener('click', () => {
  if ($q) $q.value = '';
  if ($catalogSearch) $catalogSearch.value = '';
  if ($category) $category.value = 'all';
  if ($status) $status.value = 'all';
  if ($sort) $sort.value = 'newest';
  if ($filterAvailable) $filterAvailable.checked = false;
  if ($filterFeatured) $filterFeatured.checked = false;
  if ($filterZeroKm) $filterZeroKm.checked = false;
  if ($filterUsed) $filterUsed.checked = false;
  renderSearchResults('No encontramos vehículos con esos filtros.', 'Probá quitando algún filtro.');
});

initFilterMenu();
fetchVehicles();

let __rgResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(__rgResizeTimer);
  __rgResizeTimer = setTimeout(() => {
    renderSearchResults('No encontramos vehículos con esos filtros.', 'Probá cambiando la búsqueda, categoría o estado.');
  }, 120);
});
