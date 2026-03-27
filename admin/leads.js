const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const state = {
  tab: 'consignment',
  search: '',
  consignments: [],
  scouting: [],
  financing: [],
  insurance: [],
  feedback: [],
  matches: [],
};

const $ = (id) => document.getElementById(id);

function escape(value) {
  return window.RGShared.escapeHTML(value ?? '');
}

function setMeta(text) {
  const el = $('leadsMeta');
  if (el) el.textContent = text;
}

async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    window.location.href = './login.html';
    return null;
  }
  return data.session;
}

function leadMatchesCount(requestId) {
  return state.matches.filter((item) => item.scouting_request_id === requestId).length;
}

function noteActionsHTML(type, id, currentStatus, notes = '') {
  return `
    <div class="lead-admin-box">
      <div class="lead-admin-row">
        <select class="select lead-inline-select" data-lead-status-type="${type}" data-id="${id}">
          ${statusOptions(type, currentStatus)}
        </select>
        <button type="button" class="btn btn-soft" data-lead-save="${type}" data-id="${id}">Guardar</button>
      </div>
      <textarea class="textarea lead-inline-notes" rows="3" data-lead-notes="${type}" data-id="${id}" placeholder="Notas internas">${escape(notes)}</textarea>
    </div>
  `;
}

function statusOptions(type, current) {
  const sets = {
    consignment: ['new', 'review', 'approved', 'rejected'],
    scouting: ['active', 'paused', 'closed'],
    financing: ['new', 'contacted', 'prequalified', 'sent_to_entity', 'closed', 'rejected'],
    insurance: ['new', 'contacted', 'quoted', 'closed', 'rejected'],
    feedback: ['new', 'reviewed', 'planned', 'done', 'archived'],
  };
  return (sets[type] || []).map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>${value}</option>`).join('');
}

function consignmentCardHTML(item) {
  const photos = Array.isArray(item.consignment_lead_photos) ? item.consignment_lead_photos : [];
  const cover = photos.find((photo) => photo.is_cover) || photos[0];
  const priceRange = [
    item.min_acceptable_price ? `mín. ${window.RGShared.formatPrice(item.min_acceptable_price)}` : '',
    item.expected_price ? `ideal ${window.RGShared.formatPrice(item.expected_price)}` : '',
    item.max_expected_price ? `techo ${window.RGShared.formatPrice(item.max_expected_price)}` : '',
  ].filter(Boolean).join(' · ');

  return `
    <article class="lead-card">
      <div class="lead-card-media">
        ${cover ? `<img src="${cover.public_url}" alt="${escape(item.brand)} ${escape(item.model)}" loading="lazy">` : '<div class="media-placeholder">Sin fotos</div>'}
      </div>
      <div class="lead-card-body">
        <div class="lead-card-head">
          <div>
            <h3>${escape([item.brand, item.model, item.version].filter(Boolean).join(' ')) || 'Consignación'}</h3>
            <p>${escape(item.owner_name || '')} · ${escape(item.owner_phone || '')} · ${escape(item.owner_email || '')}</p>
          </div>
          <span class="status-pill is-inline ${item.status === 'approved' ? 'is-available' : item.status === 'rejected' ? 'is-sold' : 'is-hidden'}">${escape(item.status || 'new')}</span>
        </div>
        <div class="lead-meta">
          <span>${escape(item.year || '-')}</span>
          <span>${window.RGShared.formatKm(item.km)}</span>
          <span>${escape(window.RGShared.categoryLabel(item.category))}</span>
          <span>${escape(item.plate || '-')}</span>
        </div>
        <p class="lead-copy">${escape(item.condition_summary || 'Sin resumen cargado.')}</p>
        <p class="lead-copy"><strong>Precio:</strong> ${escape(priceRange || 'Sin rango económico')}</p>
        <div class="table-actions">
          <a class="btn btn-ghost" href="mailto:${escape(item.owner_email || '')}">Email</a>
          <a class="btn btn-ghost" href="https://wa.me/${String(item.owner_phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
        ${noteActionsHTML('consignment', item.id, item.status || 'new', item.admin_notes || '')}
        ${photos.length > 1 ? `<div class="lead-gallery">${photos.map((photo) => `<a href="${photo.public_url}" target="_blank" rel="noreferrer"><img src="${photo.public_url}" alt="Foto lead" loading="lazy"></a>`).join('')}</div>` : ''}
      </div>
    </article>
  `;
}

function scoutingCardHTML(item) {
  const matches = leadMatchesCount(item.id);
  return `
    <article class="lead-card lead-card-full">
      <div class="lead-card-body">
        <div class="lead-card-head">
          <div>
            <h3>${escape([item.brand, item.model, item.version].filter(Boolean).join(' ')) || 'Búsqueda personalizada'}</h3>
            <p>${escape(item.customer_name || '')} · ${escape(item.phone || '')} · ${escape(item.email || '')}</p>
          </div>
          <span class="status-pill is-inline ${item.status === 'active' ? 'is-available' : item.status === 'paused' ? 'is-reserved' : 'is-hidden'}">${escape(item.status || 'active')}</span>
        </div>
        <div class="lead-meta">
          <span>${escape(window.RGShared.categoryLabel(item.category))}</span>
          <span>${item.year_min || '-'} / ${item.year_max || '-'}</span>
          <span>${window.RGShared.formatPrice(item.price_min, item.currency)} - ${window.RGShared.formatPrice(item.price_max, item.currency)}</span>
          <span>${matches} match${matches === 1 ? '' : 'es'}</span>
        </div>
        <p class="lead-copy">${escape(item.must_have || item.notes || 'Sin observaciones adicionales.')}</p>
        <div class="table-actions">
          <a class="btn btn-ghost" href="mailto:${escape(item.email || '')}">Email</a>
          <a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
        ${noteActionsHTML('scouting', item.id, item.status || 'active', item.admin_notes || '')}
      </div>
    </article>
  `;
}

function financingCardHTML(item) {
  const emailAction = item.email ? `<a class="btn btn-ghost" href="mailto:${escape(item.email)}">Email</a>` : '';
  const phoneAction = item.phone ? `<a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>` : '';
  return `
    <article class="lead-card lead-card-full">
      <div class="lead-card-body">
        <div class="lead-card-head">
          <div>
            <h3>${escape(item.vehicle_title || 'Simulación de financiación')}</h3>
            <p>${escape(item.customer_name || '')} · ${escape(item.phone || 'Sin celular')} · ${escape(item.email || 'Sin email')} · ${escape(item.cuil || '')}</p>
          </div>
          <span class="status-pill is-inline ${item.status === 'closed' ? 'is-available' : item.status === 'rejected' ? 'is-sold' : item.status === 'prequalified' ? 'is-reserved' : 'is-hidden'}">${escape(item.status || 'new')}</span>
        </div>
        <div class="lead-meta lead-meta-grid">
          <span><strong>Origen:</strong> ${escape(item.origin || '-')}</span>
          <span><strong>Entidad:</strong> ${escape(item.entity || '-')}</span>
          <span><strong>Línea:</strong> ${escape(item.profile_code || '-')}</span>
          <span><strong>Tipo:</strong> ${escape(item.vehicle_type || '-')}</span>
          <span><strong>Año:</strong> ${escape(item.vehicle_year || '-')}</span>
          <span><strong>A financiar:</strong> ${window.RGShared.formatPrice(item.requested_amount)}</span>
          <span><strong>Cuotas:</strong> ${escape(item.installments || '-')}</span>
          <span><strong>Cuota estimada:</strong> ${window.RGShared.formatPrice(item.estimated_monthly_payment)}</span>
          <span><strong>Localidad:</strong> ${escape(item.city || '-')}</span>
        </div>
        <p class="lead-copy">${escape(item.operation_context || item.notes || 'Sin observaciones adicionales.')}</p>
        <div class="table-actions">
          ${emailAction}
          ${phoneAction}
          ${item.vehicle_id ? `<a class="btn btn-ghost" href="../vehicle.html?id=${item.vehicle_id}" target="_blank" rel="noreferrer">Ver unidad</a>` : ''}
        </div>
        ${noteActionsHTML('financing', item.id, item.status || 'new', item.admin_notes || '')}
      </div>
    </article>
  `;
}

function insuranceCardHTML(item) {
  return `
    <article class="lead-card lead-card-full">
      <div class="lead-card-body">
        <div class="lead-card-head">
          <div>
            <h3>${escape(item.vehicle_title || 'Pre-cotización de seguro')}</h3>
            <p>${escape(item.customer_name || '')} · ${escape(item.phone || '')} · ${escape(item.email || '')} · ${escape(item.cuil || '')}</p>
          </div>
          <span class="status-pill is-inline ${item.status === 'closed' ? 'is-available' : item.status === 'rejected' ? 'is-sold' : item.status === 'quoted' ? 'is-reserved' : 'is-hidden'}">${escape(item.status || 'new')}</span>
        </div>
        <div class="lead-meta lead-meta-grid">
          <span><strong>Cobertura:</strong> ${escape(item.coverage_type || '-')}</span>
          <span><strong>Uso:</strong> ${escape(item.use_type || '-')}</span>
          <span><strong>Preferencia:</strong> ${escape(item.insurer_preference || '-')}</span>
          <span><strong>Patente:</strong> ${escape(item.plate || '-')}</span>
          <span><strong>Valor a asegurar:</strong> ${window.RGShared.formatPrice(item.insured_amount)}</span>
          <span><strong>Financiación:</strong> ${item.needs_financing ? 'Sí' : 'No'}</span>
        </div>
        <p class="lead-copy">${escape(item.notes || 'Sin observaciones adicionales.')}</p>
        <div class="table-actions">
          <a class="btn btn-ghost" href="mailto:${escape(item.email || '')}">Email</a>
          <a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>
          ${item.vehicle_id ? `<a class="btn btn-ghost" href="../vehicle.html?id=${item.vehicle_id}" target="_blank" rel="noreferrer">Ver unidad</a>` : ''}
        </div>
        ${noteActionsHTML('insurance', item.id, item.status || 'new', item.admin_notes || '')}
      </div>
    </article>
  `;
}

function feedbackCardHTML(item) {
  const pageLabelMap = {
    home: 'Home',
    vehicle: 'Ficha de vehículo',
    financing: 'Financiación',
    insurance: 'Seguros',
    search: 'Búsqueda personalizada',
    consignment: 'Vendé tu auto',
  };
  const pageLabel = pageLabelMap[item.source_page] || item.source_page || '-';
  return `
    <article class="lead-card lead-card-full">
      <div class="lead-card-body">
        <div class="lead-card-head">
          <div>
            <h3>Sugerencia desde ${escape(pageLabel)}</h3>
            <p>${escape(item.visitor_name || 'Anónimo')} · ${escape(item.visitor_contact || 'Sin contacto')}</p>
          </div>
          <span class="status-pill is-inline ${item.status === 'done' ? 'is-available' : item.status === 'planned' ? 'is-reserved' : item.status === 'archived' ? 'is-hidden' : 'is-hidden'}">${escape(item.status || 'new')}</span>
        </div>
        <div class="lead-meta lead-meta-grid">
          <span><strong>Página:</strong> ${escape(pageLabel)}</span>
          <span><strong>Fecha:</strong> ${new Date(item.created_at).toLocaleString('es-AR')}</span>
          <span><strong>Título:</strong> ${escape(item.source_title || '-')}</span>
        </div>
        <p class="lead-copy">${escape(item.message || 'Sin mensaje.')}</p>
        <div class="table-actions">
          ${item.source_url ? `<a class="btn btn-ghost" href="${escape(item.source_url)}" target="_blank" rel="noreferrer">Abrir página</a>` : ''}
          ${item.visitor_contact && String(item.visitor_contact).includes('@') ? `<a class="btn btn-ghost" href="mailto:${escape(item.visitor_contact)}">Email</a>` : ''}
        </div>
        ${noteActionsHTML('feedback', item.id, item.status || 'new', item.admin_notes || '')}
      </div>
    </article>
  `;
}

function filterItems(items, fields) {
  if (!state.search) return items;
  return items.filter((item) => fields.some((field) => String(item[field] || '').toLowerCase().includes(state.search)));
}

function renderPanel(panelId, items, renderer, emptyTitle, emptyCopy) {
  const panel = $(panelId);
  if (!panel) return;
  panel.innerHTML = items.length
    ? items.map(renderer).join('')
    : `<div class="empty-state"><strong>${emptyTitle}</strong><span>${emptyCopy}</span></div>`;
}

function render() {
  ['consignment','scouting','financing','insurance','feedback'].forEach((tab) => {
    $(`${tab}Panel`)?.classList.toggle('is-active', state.tab === tab);
  });
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === state.tab));

  const consignmentRows = filterItems(state.consignments, ['owner_name', 'owner_phone', 'owner_email', 'brand', 'model', 'plate']);
  const scoutingRows = filterItems(state.scouting, ['customer_name', 'phone', 'email', 'brand', 'model', 'version']);
  const financingRows = filterItems(state.financing, ['customer_name', 'phone', 'email', 'cuil', 'vehicle_title', 'vehicle_brand', 'vehicle_model']);
  const insuranceRows = filterItems(state.insurance, ['customer_name', 'phone', 'email', 'cuil', 'vehicle_title', 'vehicle_brand', 'vehicle_model', 'plate']);
  const feedbackRows = filterItems(state.feedback, ['visitor_name', 'visitor_contact', 'message', 'source_page', 'source_title']);

  renderPanel('consignmentPanel', consignmentRows, consignmentCardHTML, 'Sin leads de consignación.', 'Aún no hay fichas cargadas o no coinciden con la búsqueda actual.');
  renderPanel('scoutingPanel', scoutingRows, scoutingCardHTML, 'Sin búsquedas personalizadas.', 'Aún no hay búsquedas cargadas o no coinciden con la búsqueda actual.');
  renderPanel('financingPanel', financingRows, financingCardHTML, 'Sin leads de financiación.', 'Todavía no ingresaron simulaciones o no coinciden con la búsqueda actual.');
  renderPanel('insurancePanel', insuranceRows, insuranceCardHTML, 'Sin leads de seguros.', 'Todavía no ingresaron pre-cotizaciones o no coinciden con la búsqueda actual.');
  renderPanel('feedbackPanel', feedbackRows, feedbackCardHTML, 'Sin sugerencias.', 'Todavía no ingresaron comentarios desde el sitio o no coinciden con la búsqueda actual.');

  $('statConsignment').textContent = state.consignments.length;
  $('statScouting').textContent = state.scouting.length;
  $('statFinancing').textContent = state.financing.length;
  $('statInsurance').textContent = state.insurance.length;
  $('statMatches').textContent = state.matches.length;
  $('statFeedback').textContent = state.feedback.length;
  setMeta(`${state.consignments.length} consignaciones · ${state.scouting.length} búsquedas · ${state.financing.length} financiaciones · ${state.insurance.length} seguros · ${state.feedback.length} sugerencias.`);
}

async function safeSelect(table, query) {
  const { data, error } = await query;
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('relation')) return [];
    throw error;
  }
  return data || [];
}

async function loadData() {
  setMeta('Cargando leads…');

  const [consignments, scouting, matches, financing, insurance, feedback] = await Promise.all([
    safeSelect('consignment_leads', sb.from('consignment_leads').select('*, consignment_lead_photos(*)').order('created_at', { ascending: false })),
    safeSelect('scouting_requests', sb.from('scouting_requests').select('*').order('created_at', { ascending: false })),
    safeSelect('scouting_matches', sb.from('scouting_matches').select('*').order('matched_at', { ascending: false })),
    safeSelect('financing_leads', sb.from('financing_leads').select('*').order('created_at', { ascending: false })),
    safeSelect('insurance_leads', sb.from('insurance_leads').select('*').order('created_at', { ascending: false })),
    safeSelect('feedback_submissions', sb.from('feedback_submissions').select('*').order('created_at', { ascending: false })),
  ]);

  state.consignments = consignments;
  state.scouting = scouting;
  state.matches = matches;
  state.financing = financing;
  state.insurance = insurance;
  state.feedback = feedback;
  render();
}

async function updateLead(type, id) {
  const tableMap = {
    consignment: 'consignment_leads',
    scouting: 'scouting_requests',
    financing: 'financing_leads',
    insurance: 'insurance_leads',
    feedback: 'feedback_submissions',
  };
  const table = tableMap[type];
  if (!table) return;

  const status = document.querySelector(`[data-lead-status-type="${type}"][data-id="${id}"]`)?.value || null;
  const notes = document.querySelector(`[data-lead-notes="${type}"][data-id="${id}"]`)?.value?.trim() || null;
  const payload = { admin_notes: notes };
  if (status) payload.status = status;

  const { error } = await sb.from(table).update(payload).eq('id', id);
  if (error) throw error;
  await loadData();
}

async function init() {
  try {
    await requireSession();
    await loadData();
  } catch (error) {
    console.error(error);
    setMeta(error.message || 'No se pudieron cargar los leads.');
  }
}

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    render();
  });
});

$('leadSearch')?.addEventListener('input', (event) => {
  state.search = event.target.value.trim().toLowerCase();
  render();
});

$('logout')?.addEventListener('click', async (event) => {
  event.preventDefault();
  await sb.auth.signOut();
  window.location.href = './login.html';
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-lead-save]');
  if (!button) return;
  try {
    await updateLead(button.dataset.leadSave, button.dataset.id);
    setMeta('Lead actualizado correctamente.');
  } catch (error) {
    console.error(error);
    setMeta(error.message || 'No se pudo actualizar el lead.');
  }
});

init();
