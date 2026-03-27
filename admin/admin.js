const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const state = {
  currentView: 'overview',
  currentLeadTab: 'consignment',
  vehicleSearch: '',
  vehicleStatusFilter: 'all',
  leadSearch: '',
  vehicles: [],
  leads: {
    consignments: [],
    scouting: [],
    financing: [],
    insurance: [],
    peritaje: [],
    feedback: [],
    matches: [],
  },
  rateProfiles: [],
};

let supportsPlate = true;
let lastSavedVehicle = null;

function escape(value) {
  return window.RGShared.escapeHTML(value ?? '');
}

function boolValue(id) {
  return $(id)?.value === 'true';
}

function listValue(id) {
  const value = $(id)?.value || '';
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function multilineListValue(id) {
  const value = $(id)?.value || '';
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim().replace(/^[-•·]\s*/, ''))
    .filter(Boolean);
}

function showMsg(message, ok = true) {
  const msg = $('msg');
  if (!msg) return;
  msg.textContent = message || '';
  msg.classList.toggle('is-ok', !!ok);
  msg.classList.toggle('is-error', !ok);
}

function hideMsg() {
  const msg = $('msg');
  if (!msg) return;
  msg.textContent = '';
  msg.classList.remove('is-ok', 'is-error');
}

function setView(view) {
  const titles = {
    overview: ['Resumen', 'Visual general de stock, leads y configuración comercial.'],
    vehicles: ['Vehículos', 'Publicá, editá y administrá el stock en una única vista operativa.'],
    leads: ['Leads', 'Gestioná consignación, búsquedas, financiación, seguros, peritajes y sugerencias.'],
    insurance: ['Seguros', 'Seguimiento dedicado de pre-cotizaciones y contacto comercial.'],
    financing: ['Financiación', 'Configurá líneas y tasas del simulador sin mezclarlo con el stock.'],
    settings: ['Configuración', 'Seguridad del panel y estructura general del sistema.'],
  };

  state.currentView = titles[view] ? view : 'overview';
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.viewPanel === state.currentView));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === state.currentView));
  const [title, copy] = titles[state.currentView];
  if ($('adminViewTitle')) $('adminViewTitle').textContent = title;
  if ($('adminViewCopy')) $('adminViewCopy').textContent = copy;
  window.location.hash = state.currentView;
}

function setLeadTab(tab) {
  state.currentLeadTab = ['consignment', 'scouting', 'financing', 'insurance', 'peritaje', 'feedback'].includes(tab) ? tab : 'consignment';
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === state.currentLeadTab));
  ['consignment', 'scouting', 'financing', 'insurance', 'peritaje', 'feedback'].forEach((key) => {
    $(`${key}Panel`)?.classList.toggle('is-active', key === state.currentLeadTab);
  });
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
  return state.leads.matches.filter((item) => item.scouting_request_id === requestId).length;
}

function statusOptions(type, current) {
  return window.RGShared.leadStatusOptions(type, current);
}


function noteActionsHTML(type, id, currentStatus, notes = '') {
  return `
    <div class="lead-admin-box">
      <div class="lead-admin-row">
        <select class="select lead-inline-select" data-lead-status-type="${type}" data-id="${id}">
          ${statusOptions(type, currentStatus)}
        </select>
        <button type="button" class="btn btn-soft" data-lead-save="${type}" data-id="${id}">Guardar cambios</button>
      </div>
      <textarea class="textarea lead-inline-notes" rows="3" data-lead-notes="${type}" data-id="${id}" placeholder="Notas internas">${escape(notes)}</textarea>
    </div>
  `;
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
          <span class="status-pill is-inline ${window.RGShared.leadStatusClass('consignment', item.status || 'new')}">${escape(window.RGShared.leadStatusLabel('consignment', item.status || 'new'))}</span>
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
          <span class="status-pill is-inline ${window.RGShared.leadStatusClass('scouting', item.status || 'active')}">${escape(window.RGShared.leadStatusLabel('scouting', item.status || 'active'))}</span>
        </div>
        <div class="lead-meta">
          <span>${escape(window.RGShared.categoryLabel(item.category))}</span>
          <span>${item.year_min || '-'} / ${item.year_max || '-'}</span>
          <span>${window.RGShared.formatPrice(item.budget_estimate ?? item.price_max ?? item.price_min, item.currency)}</span>
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
          <span class="status-pill is-inline ${window.RGShared.leadStatusClass('financing', item.status || 'new')}">${escape(window.RGShared.leadStatusLabel('financing', item.status || 'new'))}</span>
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
          <span class="status-pill is-inline ${window.RGShared.leadStatusClass('insurance', item.status || 'new')}">${escape(window.RGShared.leadStatusLabel('insurance', item.status || 'new'))}</span>
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

function peritajeCardHTML(item) {
  const emailAction = item.email ? `<a class="btn btn-ghost" href="mailto:${escape(item.email)}">Email</a>` : '';
  const phoneAction = item.phone ? `<a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>` : '';
  return `
    <article class="lead-card lead-card-full">
      <div class="lead-card-body">
        <div class="lead-card-head">
          <div>
            <h3>${escape([item.vehicle_brand, item.vehicle_model, item.vehicle_year].filter(Boolean).join(' ') || 'Solicitud de peritaje')}</h3>
            <p>${escape(item.customer_name || '')} · ${escape(item.phone || 'Sin celular')} · ${escape(item.email || 'Sin email')}</p>
          </div>
          <span class="status-pill is-inline ${window.RGShared.leadStatusClass('peritaje', item.status || 'new')}">${escape(window.RGShared.leadStatusLabel('peritaje', item.status || 'new'))}</span>
        </div>
        <div class="lead-meta lead-meta-grid">
          <span><strong>Fecha:</strong> ${escape(item.appointment_date || '-')}</span>
          <span><strong>Horario:</strong> ${escape(item.appointment_time || '-')}</span>
          <span><strong>Ciudad:</strong> ${escape(item.city || '-')}</span>
          <span><strong>Patente:</strong> ${escape(item.plate || '-')}</span>
          <span><strong>Km:</strong> ${item.km ? window.RGShared.formatKm(item.km) : '-'}</span>
          <span><strong>Motivo:</strong> ${escape(item.inspection_reason || '-')}</span>
        </div>
        <p class="lead-copy">${escape(item.notes || 'Sin observaciones adicionales.')}</p>
        <div class="table-actions">${emailAction}${phoneAction}${item.vehicle_id ? `<a class="btn btn-ghost" href="../vehicle.html?id=${item.vehicle_id}" target="_blank" rel="noreferrer">Ver unidad</a>` : ''}</div>
        ${noteActionsHTML('peritaje', item.id, item.status || 'new', item.admin_notes || '')}
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
          <span class="status-pill is-inline ${window.RGShared.leadStatusClass('feedback', item.status || 'new')}">${escape(window.RGShared.leadStatusLabel('feedback', item.status || 'new'))}</span>
        </div>
        <div class="lead-meta lead-meta-grid">
          <span><strong>Página:</strong> ${escape(pageLabel)}</span>
          <span><strong>Fecha:</strong> ${item.created_at ? new Date(item.created_at).toLocaleString('es-AR') : '-'}</span>
          <span><strong>Título:</strong> ${escape(item.source_title || '-')}</span>
        </div>
        <p class="lead-copy">${escape(item.message || 'Sin mensaje.')}</p>
        <div class="table-actions">
          ${item.source_url ? `<a class="btn btn-ghost" href="${escape(item.source_url)}" target="_blank" rel="noreferrer">Abrir página</a>` : ''}
        </div>
        ${noteActionsHTML('feedback', item.id, item.status || 'new', item.admin_notes || '')}
      </div>
    </article>
  `;
}

function filterItems(items, fields) {
  if (!state.leadSearch) return items;
  return items.filter((item) => fields.some((field) => String(item[field] || '').toLowerCase().includes(state.leadSearch)));
}

function renderPanel(panelId, items, renderer, emptyTitle, emptyCopy) {
  const panel = $(panelId);
  if (!panel) return;
  panel.innerHTML = items.length
    ? items.map(renderer).join('')
    : `<div class="empty-state"><strong>${emptyTitle}</strong><span>${emptyCopy}</span></div>`;
}

function renderLeadStats() {
  const wrap = $('leadStats');
  if (!wrap) return;
  const items = [
    ['Consignación', state.leads.consignments.length],
    ['Búsquedas', state.leads.scouting.length],
    ['Financiación', state.leads.financing.length],
    ['Seguros', state.leads.insurance.length],
    ['Peritaje', state.leads.peritaje.length],
    ['Sugerencias', state.leads.feedback.length],
  ];
  wrap.innerHTML = items.map(([label, value]) => `<div class="admin-kpi-card admin-kpi-card--small"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function renderLeads() {
  const consignmentRows = filterItems(state.leads.consignments, ['owner_name', 'owner_phone', 'owner_email', 'brand', 'model', 'plate']);
  const scoutingRows = filterItems(state.leads.scouting, ['customer_name', 'phone', 'email', 'brand', 'model', 'version']);
  const financingRows = filterItems(state.leads.financing, ['customer_name', 'phone', 'email', 'cuil', 'vehicle_title', 'vehicle_brand', 'vehicle_model']);
  const insuranceRows = filterItems(state.leads.insurance, ['customer_name', 'phone', 'email', 'cuil', 'vehicle_title', 'vehicle_brand', 'vehicle_model', 'plate']);
  const peritajeRows = filterItems(state.leads.peritaje, ['customer_name', 'phone', 'email', 'vehicle_brand', 'vehicle_model', 'plate']);
  const feedbackRows = filterItems(state.leads.feedback, ['visitor_name', 'visitor_contact', 'message', 'source_page', 'source_title']);

  renderPanel('consignmentPanel', consignmentRows, consignmentCardHTML, 'Sin leads de consignación.', 'Aún no hay fichas cargadas o no coinciden con la búsqueda actual.');
  renderPanel('scoutingPanel', scoutingRows, scoutingCardHTML, 'Sin búsquedas personalizadas.', 'Aún no hay búsquedas cargadas o no coinciden con la búsqueda actual.');
  renderPanel('financingPanel', financingRows, financingCardHTML, 'Sin leads de financiación.', 'Todavía no ingresaron simulaciones o no coinciden con la búsqueda actual.');
  renderPanel('insurancePanel', insuranceRows, insuranceCardHTML, 'Sin leads de seguros.', 'Todavía no ingresaron pre-cotizaciones o no coinciden con la búsqueda actual.');
  renderPanel('peritajePanel', peritajeRows, peritajeCardHTML, 'Sin leads de peritaje.', 'Todavía no ingresaron solicitudes de peritaje o no coinciden con la búsqueda actual.');
  renderPanel('feedbackPanel', feedbackRows, feedbackCardHTML, 'Sin sugerencias.', 'Todavía no ingresaron comentarios desde el sitio o no coinciden con la búsqueda actual.');

  if ($('leadsMeta')) {
    $('leadsMeta').textContent = `${state.leads.consignments.length} consignaciones · ${state.leads.scouting.length} búsquedas · ${state.leads.financing.length} financiaciones · ${state.leads.insurance.length} seguros · ${state.leads.peritaje.length} peritajes · ${state.leads.feedback.length} sugerencias.`;
  }
  renderLeadStats();
  updateLeadBadge();
  setLeadTab(state.currentLeadTab);
  renderInsuranceStandalone();
  renderOverview();
}

function updateLeadBadge() {
  const badge = $('adminLeadBadge');
  if (!badge) return;
  const fresh = state.leads.consignments.filter((item) => !item.status || item.status === 'new').length
    + state.leads.financing.filter((item) => !item.status || item.status === 'new').length
    + state.leads.insurance.filter((item) => !item.status || item.status === 'new').length
    + state.leads.peritaje.filter((item) => !item.status || item.status === 'new').length
    + state.leads.feedback.filter((item) => !item.status || item.status === 'new').length;
  badge.textContent = String(fresh);
  badge.hidden = fresh < 1;
}

function renderInsuranceStandalone() {
  const list = $('insuranceStandaloneList');
  if (!list) return;
  const rows = filterItems(state.leads.insurance, ['customer_name', 'phone', 'email', 'cuil', 'vehicle_title', 'vehicle_brand', 'vehicle_model', 'plate']);
  list.innerHTML = rows.length
    ? rows.map(insuranceCardHTML).join('')
    : '<div class="empty-state"><strong>Sin leads de seguros.</strong><span>Todavía no ingresaron pre-cotizaciones.</span></div>';

  if ($('insuranceMeta')) $('insuranceMeta').textContent = `${state.leads.insurance.length} solicitud${state.leads.insurance.length === 1 ? '' : 'es'} cargadas.`;
  if ($('insuranceSummary')) {
    const quoted = state.leads.insurance.filter((item) => item.status === 'quoted').length;
    const newItems = state.leads.insurance.filter((item) => !item.status || item.status === 'new').length;
    const closed = state.leads.insurance.filter((item) => item.status === 'closed').length;
    $('insuranceSummary').innerHTML = `
      <div class="admin-summary-item"><strong>${newItems}</strong><span>Nuevas</span></div>
      <div class="admin-summary-item"><strong>${quoted}</strong><span>Cotizadas</span></div>
      <div class="admin-summary-item"><strong>${closed}</strong><span>Cerradas</span></div>
    `;
  }
}

async function safeSelect(query) {
  const { data, error } = await query;
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('relation')) return [];
    throw error;
  }
  return data || [];
}

async function loadLeads() {
  const [consignments, scouting, matches, financing, insurance, peritaje, feedback] = await Promise.all([
    safeSelect(sb.from('consignment_leads').select('*, consignment_lead_photos(*)').order('created_at', { ascending: false })),
    safeSelect(sb.from('scouting_requests').select('*').order('created_at', { ascending: false })),
    safeSelect(sb.from('scouting_matches').select('*').order('matched_at', { ascending: false })),
    safeSelect(sb.from('financing_leads').select('*').order('created_at', { ascending: false })),
    safeSelect(sb.from('insurance_leads').select('*').order('created_at', { ascending: false })),
    safeSelect(sb.from('peritaje_leads').select('*').order('created_at', { ascending: false })),
    safeSelect(sb.from('feedback_submissions').select('*').order('created_at', { ascending: false })),
  ]);
  state.leads.consignments = consignments;
  state.leads.scouting = scouting;
  state.leads.matches = matches;
  state.leads.financing = financing;
  state.leads.insurance = insurance;
  state.leads.peritaje = peritaje;
  state.leads.feedback = feedback;
  renderLeads();
}

async function updateLead(type, id) {
  const tableMap = {
    consignment: 'consignment_leads',
    scouting: 'scouting_requests',
    financing: 'financing_leads',
    insurance: 'insurance_leads',
    peritaje: 'peritaje_leads',
    feedback: 'feedback_submissions',
  };
  const table = tableMap[type];
  if (!table) return;

  const status = document.querySelector(`[data-lead-status-type="${type}"][data-id="${id}"]`)?.value || null;
  const notes = document.querySelector(`[data-lead-notes="${type}"][data-id="${id}"]`)?.value?.trim() || null;
  const payload = { admin_notes: notes };
  if (status) payload.status = status;
  const { data, error } = await sb.from(table).update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  if (data && type !== 'feedback') {
    await window.RGShared.sendLeadNotification(type, status || data.status || 'new', data, { event: 'status_update' }).catch((err) => console.warn('No se pudo enviar el email de actualización:', err.message));
  }
  await loadLeads();
}


function isPlateSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('column') && message.includes('plate');
}

function warnPlateCompatibility() {
  showMsg('La tabla vehicles no tiene la columna patente. Se guardará sin ese campo hasta que actualices el esquema.', false);
}

function fillForm(vehicle) {
  $('id').value = vehicle.id || '';
  $('title').value = vehicle.title || '';
  $('brand').value = vehicle.brand || '';
  $('model').value = vehicle.model || '';
  $('year').value = vehicle.year ?? '';
  $('plate').value = vehicle.plate || '';
  $('km').value = vehicle.km ?? '';
  $('price').value = vehicle.price ?? '';
  $('currency').value = vehicle.currency || 'ARS';
  $('category').value = vehicle.category || 'auto';
  $('status').value = vehicle.status || 'available';
  $('featured').value = String(!!vehicle.featured);
  $('description').value = vehicle.description || '';
  $('engine').value = vehicle.engine || '';
  $('transmission').value = vehicle.transmission || '';
  $('drivetrain').value = vehicle.drivetrain || '';
  $('color').value = vehicle.color || '';
  $('doors').value = vehicle.doors ?? '';
  $('fuel_type').value = vehicle.fuel_type || '';
  $('vehicle_condition').value = vehicle.vehicle_condition || '';
  $('featured_equipment').value = window.RGShared.arrayFromUnknown(vehicle.featured_equipment).join('\n');
  $('is_recent').value = String(!!vehicle.is_recent);
  $('outlet').value = String(!!vehicle.outlet);
  $('insurance_available').value = String(!!vehicle.insurance_available);
  $('financing_enabled').value = String(!!vehicle.financing_enabled);
  $('private_financing_enabled').value = String(!!vehicle.private_financing_enabled);
  $('finance_max_months').value = vehicle.finance_max_months ?? '';
  $('min_down_payment').value = vehicle.min_down_payment ?? '';
  $('finance_entities').value = window.RGShared.arrayFromUnknown(vehicle.finance_entities).join(', ');
  $('finance_note').value = vehicle.finance_note || '';
  $('photos').value = '';
  renderPhotoList(vehicle);
  renderPostSaveActions(vehicle, false);
  if ($('vehicleFormTitle')) $('vehicleFormTitle').textContent = 'Editar vehículo';
}

function clearForm() {
  ['id','title','brand','model','year','plate','km','price','description','engine','transmission','drivetrain','color','doors','fuel_type','vehicle_condition','featured_equipment','finance_max_months','min_down_payment','finance_entities','finance_note'].forEach((id) => { if ($(id)) $(id).value = ''; });
  $('currency').value = 'ARS';
  $('category').value = 'auto';
  $('status').value = 'available';
  $('featured').value = 'false';
  $('is_recent').value = 'false';
  $('outlet').value = 'false';
  $('insurance_available').value = 'false';
  $('financing_enabled').value = 'false';
  $('private_financing_enabled').value = 'false';
  $('photos').value = '';
  $('photoList').innerHTML = '<div class="empty-inline">Las fotos cargadas aparecerán acá.</div>';
  $('postSaveActions').hidden = true;
  const plateField = $('plate');
  if (plateField) plateField.disabled = !supportsPlate;
  if ($('vehicleFormTitle')) $('vehicleFormTitle').textContent = 'Publicar vehículo';
}

function renderSelectedFilesPreview(files) {
  const wrap = $('photoList');
  if (!wrap) return;
  if (!files?.length) {
    wrap.innerHTML = '<div class="empty-inline">Las fotos cargadas aparecerán acá.</div>';
    return;
  }
  wrap.innerHTML = `
    <div class="selected-files-preview">
      ${Array.from(files).map((file) => `<span class="inline-tag">${escape(file.name)}</span>`).join('')}
    </div>
  `;
}

function renderPhotoList(vehicle) {
  const wrap = $('photoList');
  if (!wrap) return;
  const images = Array.isArray(vehicle?.images) ? vehicle.images : [];
  if (!images.length) {
    wrap.innerHTML = '<div class="empty-inline">Sin fotos cargadas.</div>';
    return;
  }

  wrap.innerHTML = images.map((url, index) => `
    <div class="photo-item">
      <img src="${url}" alt="Foto ${index + 1} del vehículo" loading="lazy" />
      <button class="btn btn-danger" type="button" data-delphoto="${vehicle.id}" data-url="${url}">Eliminar</button>
    </div>
  `).join('');
}

function storagePathFromPublicUrl(url) {
  const marker = '/storage/v1/object/public/vehicles/';
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

async function deletePhoto(vehicleId, url) {
  if (!confirm('¿Eliminar esta foto?')) return;
  const { data, error } = await sb.from('vehicles').select('images').eq('id', vehicleId).single();
  if (error) return showMsg(error.message, false);

  const nextImages = (data.images || []).filter((item) => item !== url);
  const path = storagePathFromPublicUrl(url);
  if (path) {
    const { error: storageError } = await sb.storage.from('vehicles').remove([path]);
    if (storageError) console.warn(storageError.message);
  }
  const { error: updateError } = await sb.from('vehicles').update({ images: nextImages }).eq('id', vehicleId);
  if (updateError) return showMsg(updateError.message, false);

  showMsg('Foto eliminada.', true);
  renderPhotoList({ id: vehicleId, images: nextImages });
  await loadRows();
}

async function uploadFiles(files, vehicleId) {
  if (!files?.length) return [];
  const uploaded = [];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${vehicleId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('vehicles').upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = sb.storage.from('vehicles').getPublicUrl(path);
    uploaded.push(data.publicUrl);
  }
  return uploaded;
}

async function getVehicleById(id) {
  const { data, error } = await sb.from('vehicles').select('*').eq('id', id).single();
  if (error) throw error;
  if (data && !Object.prototype.hasOwnProperty.call(data, 'plate')) supportsPlate = false;
  return { plate: null, ...data };
}

function renderPostSaveActions(vehicle, highlight = true) {
  const box = $('postSaveActions');
  if (!box || !vehicle) return;
  box.hidden = false;
  box.classList.toggle('is-highlight', !!highlight);
  box.innerHTML = `
    <div>
      <strong>${highlight ? 'Vehículo guardado correctamente.' : 'Acciones rápidas disponibles.'}</strong>
      <p>${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')} quedó listo. Podés abrir la publicación, simular financiación o descargar la ficha comercial.</p>
    </div>
    <div class="post-save-buttons">
      <a class="btn btn-ghost" href="${window.RGShared.vehicleUrl(vehicle.id)}" target="_blank" rel="noreferrer">Ver publicación</a>
      ${vehicle.financing_enabled ? `<a class="btn btn-soft" href="${window.RGShared.financingUrl(vehicle)}" target="_blank" rel="noreferrer">Financiación</a>` : ''}
      <button class="btn btn-soft" type="button" data-quick-download="${vehicle.id}">Descargar ficha</button>
    </div>
  `;
}

function adminCardHTML(vehicle) {
  const image = window.RGShared.firstImage(vehicle);
  const plate = window.RGShared.normalizePlate(vehicle.plate || '');
  const tags = [
    vehicle.featured ? '<span class="inline-tag">Destacado</span>' : '',
    vehicle.is_recent ? '<span class="inline-tag">Recién ingresado</span>' : '',
    vehicle.outlet ? '<span class="inline-tag">Outlet</span>' : '',
    vehicle.financing_enabled ? '<span class="inline-tag">Financiación</span>' : '',
    vehicle.insurance_available ? '<span class="inline-tag">Seguro</span>' : '',
  ].filter(Boolean).join('');

  return `
    <article class="admin-result-card">
      <div class="admin-result-media">
        ${image ? `<img src="${image}" alt="${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}" loading="lazy">` : '<div class="media-placeholder">Sin foto</div>'}
        <span class="status-pill ${window.RGShared.statusClass(vehicle.status)}">${window.RGShared.statusLabel(vehicle.status)}</span>
      </div>
      <div class="admin-result-body">
        <div class="admin-result-head">
          <div>
            <h3>${window.RGShared.escapeHTML(vehicle.title || 'Vehículo')}</h3>
            <p>${window.RGShared.escapeHTML([vehicle.brand, vehicle.model].filter(Boolean).join(' · ') || window.RGShared.categoryLabel(vehicle.category))}</p>
          </div>
          <div class="inline-tag-wrap">${tags}</div>
        </div>
        <div class="admin-result-meta">
          <span><strong>Patente:</strong> ${plate || '-'}</span>
          <span><strong>Año:</strong> ${window.RGShared.textOrDash(vehicle.year)}</span>
          <span><strong>Km:</strong> ${window.RGShared.formatKm(vehicle.km)}</span>
          <span><strong>Precio:</strong> ${window.RGShared.formatPrice(vehicle.price, vehicle.currency)}</span>
        </div>
        <div class="table-actions">
          <button class="btn btn-soft" type="button" data-edit="${vehicle.id}">Editar</button>
          <button class="btn btn-ghost" type="button" data-download="${vehicle.id}">Ficha</button>
          <a class="btn btn-ghost" href="${window.RGShared.vehicleUrl(vehicle.id)}" target="_blank" rel="noreferrer">Ver</a>
          <button class="btn btn-danger" type="button" data-del="${vehicle.id}">Eliminar</button>
        </div>
        <div class="table-actions compact-status-actions">
          <button class="btn btn-ghost" type="button" data-st="${vehicle.id}" data-v="available">Disponible</button>
          <button class="btn btn-ghost" type="button" data-st="${vehicle.id}" data-v="incoming">Próximo a ingresar</button>
          <button class="btn btn-ghost" type="button" data-st="${vehicle.id}" data-v="sold">Vendido</button>
          <button class="btn btn-ghost" type="button" data-st="${vehicle.id}" data-v="hidden">Ocultar</button>
        </div>
      </div>
    </article>
  `;
}

function renderVehicleStats() {
  const total = state.vehicles.length;
  const available = state.vehicles.filter((item) => item.status === 'available').length;
  const incoming = state.vehicles.filter((item) => item.status === 'incoming').length;
  const outlet = state.vehicles.filter((item) => item.outlet).length;
  return [
    ['Stock total', total],
    ['Disponibles', available],
    ['Próximo a ingresar', incoming],
    ['Outlet', outlet],
  ];
}

function renderOverview() {
  const statsWrap = $('overviewStats');
  if (statsWrap) {
    const overviewItems = [
      ...renderVehicleStats(),
      ['Leads nuevos', state.leads.consignments.filter((item) => !item.status || item.status === 'new').length + state.leads.financing.filter((item) => !item.status || item.status === 'new').length + state.leads.insurance.filter((item) => !item.status || item.status === 'new').length + state.leads.peritaje.filter((item) => !item.status || item.status === 'new').length],
      ['Sugerencias', state.leads.feedback.length],
    ];
    statsWrap.innerHTML = overviewItems.map(([label, value]) => `<div class="admin-kpi-card"><strong>${value}</strong><span>${label}</span></div>`).join('');
  }

  if ($('overviewHighlights')) {
    const items = [
      `Hay <strong>${state.vehicles.filter((item) => item.status === 'available').length}</strong> unidades disponibles para publicar y mover comercialmente.`,
      `Tenés <strong>${state.leads.financing.length}</strong> consultas de financiación, <strong>${state.leads.insurance.length}</strong> de seguros y <strong>${state.leads.peritaje.length}</strong> de peritaje para seguir desde el mismo panel.`,
      `El simulador cuenta con <strong>${state.rateProfiles.length}</strong> líneas activas editables desde backoffice.`,
      `Ingresaron <strong>${state.leads.feedback.length}</strong> sugerencias desde la web para mejorar el producto.`
    ];
    $('overviewHighlights').innerHTML = items.map((item) => `<div class="admin-summary-item"><span>${item}</span></div>`).join('');
  }

  if ($('overviewMeta')) {
    $('overviewMeta').textContent = `${state.vehicles.length} vehículos · ${state.leads.consignments.length + state.leads.scouting.length + state.leads.financing.length + state.leads.insurance.length + state.leads.peritaje.length} leads · ${state.rateProfiles.length} líneas comerciales.`;
  }
}

function filterRowsLocally() {
  const results = $('rows');
  const meta = $('adminSearchMeta');
  if (!results) return;

  let rows = [...state.vehicles];
  const status = state.vehicleStatusFilter;
  const search = state.vehicleSearch;

  if (status !== 'all') rows = rows.filter((item) => item.status === status);
  if (search) {
    rows = rows.filter((vehicle) => [vehicle.title, vehicle.brand, vehicle.model, vehicle.category, vehicle.plate].join(' ').toLowerCase().includes(search));
  }

  if (!rows.length) {
    results.innerHTML = '<div class="empty-state compact-empty"><strong>Sin resultados.</strong><span>Probá con otra búsqueda o ajustá el filtro de estado.</span></div>';
    if (meta) meta.textContent = search || status !== 'all' ? 'No encontramos coincidencias para ese filtro.' : 'Todavía no hay vehículos cargados.';
    return;
  }

  results.innerHTML = rows.map(adminCardHTML).join('');
  if (meta) meta.textContent = `${rows.length} vehículo${rows.length === 1 ? '' : 's'} listados.`;
  renderOverview();
}

async function loadRows() {
  const results = $('rows');
  if (!results) return;
  results.innerHTML = '<div class="empty-state compact-empty"><strong>Cargando stock…</strong><span>Esperá un momento.</span></div>';
  const { data, error } = await sb.from('vehicles').select('*').order('featured', { ascending: false }).order('created_at', { ascending: false });
  if (error) {
    showMsg(error.message, false);
    results.innerHTML = '<div class="empty-state compact-empty"><strong>No pudimos cargar el stock.</strong><span>Revisá la configuración de Supabase.</span></div>';
    return;
  }
  state.vehicles = (data || []).map((item) => ({ plate: null, ...item }));
  if (state.vehicles.length && !Object.prototype.hasOwnProperty.call(state.vehicles[0], 'plate')) supportsPlate = false;
  const plateField = $('plate');
  if (plateField) plateField.disabled = !supportsPlate;
  filterRowsLocally();
}

async function saveVehicle() {
  hideMsg();
  const id = $('id').value || null;
  const payload = {
    title: $('title').value.trim(),
    brand: $('brand').value.trim() || null,
    model: $('model').value.trim() || null,
    year: $('year').value ? Number($('year').value) : null,
    ...(supportsPlate ? { plate: window.RGShared.normalizePlate($('plate').value) || null } : {}),
    km: $('km').value ? Number($('km').value) : null,
    price: $('price').value ? Number($('price').value) : null,
    currency: $('currency').value || 'ARS',
    category: $('category').value || 'auto',
    status: $('status').value,
    featured: boolValue('featured'),
    description: $('description').value.trim() || null,
    engine: $('engine').value.trim() || null,
    transmission: $('transmission').value.trim() || null,
    drivetrain: $('drivetrain').value.trim() || null,
    color: $('color').value.trim() || null,
    doors: $('doors').value ? Number($('doors').value) : null,
    fuel_type: $('fuel_type').value.trim() || null,
    vehicle_condition: $('vehicle_condition').value.trim() || null,
    featured_equipment: multilineListValue('featured_equipment'),
    is_recent: boolValue('is_recent'),
    outlet: boolValue('outlet'),
    insurance_available: boolValue('insurance_available'),
    financing_enabled: boolValue('financing_enabled'),
    private_financing_enabled: boolValue('private_financing_enabled'),
    finance_max_months: $('finance_max_months').value ? Number($('finance_max_months').value) : null,
    min_down_payment: $('min_down_payment').value ? Number($('min_down_payment').value) : null,
    finance_entities: listValue('finance_entities'),
    finance_note: $('finance_note').value.trim() || null,
  };

  if (!payload.title) return showMsg('El título es obligatorio.', false);
  if (!Number.isFinite(payload.price)) return showMsg('El precio es obligatorio.', false);

  const saveButton = $('save');
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = 'Guardando…';

  try {
    let savedId = id;
    if (!id) {
      let response = await sb.from('vehicles').insert(payload).select('id').single();
      if (response.error && isPlateSchemaError(response.error)) {
        supportsPlate = false;
        warnPlateCompatibility();
        const { plate, ...payloadWithoutPlate } = payload;
        response = await sb.from('vehicles').insert(payloadWithoutPlate).select('id').single();
      }
      if (response.error) throw response.error;
      savedId = response.data.id;
    } else {
      let response = await sb.from('vehicles').update(payload).eq('id', id);
      if (response.error && isPlateSchemaError(response.error)) {
        supportsPlate = false;
        warnPlateCompatibility();
        const { plate, ...payloadWithoutPlate } = payload;
        response = await sb.from('vehicles').update(payloadWithoutPlate).eq('id', id);
      }
      if (response.error) throw response.error;
    }

    const files = $('photos')?.files;
    if (files?.length) {
      const newUrls = await uploadFiles(files, savedId);
      const currentVehicle = await getVehicleById(savedId);
      const mergedImages = [...(currentVehicle.images || []), ...newUrls];
      const { error } = await sb.from('vehicles').update({ images: mergedImages }).eq('id', savedId);
      if (error) throw error;
    }

    lastSavedVehicle = await getVehicleById(savedId);
    renderPostSaveActions(lastSavedVehicle, true);
    showMsg('Vehículo guardado correctamente.', true);
    clearForm();
    await loadRows();
    setView('vehicles');
  } catch (error) {
    console.error(error);
    const message = String(error?.message || '');
    if (message.toLowerCase().includes('column') && (message.includes('engine') || message.includes('featured_equipment') || message.includes('fuel_type'))) {
      showMsg('Faltan las nuevas columnas de ficha técnica en la tabla vehicles. Ejecutá primero la migración SQL y luego volvé a guardar.', false);
    } else {
      showMsg(error.message || 'No se pudo guardar.', false);
    }
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
}

function setRatesMeta(text) {
  if ($('ratesMeta')) $('ratesMeta').textContent = text;
}

function getRateProvider(item) {
  const raw = `${item.entity || ''} ${item.label || ''} ${item.code || ''}`.toLowerCase();
  if (raw.includes('santander')) return 'Santander';
  if (raw.includes('prendo')) return 'Prendo';
  if (raw.includes('propia') || raw.includes('propio') || raw.includes('interna')) return 'Propia';
  return 'Otras líneas';
}

function groupedRateProfiles() {
  const preferredOrder = ['Prendo', 'Santander', 'Propia'];
  const buckets = new Map(preferredOrder.map((name) => [name, []]));
  state.rateProfiles.forEach((item) => {
    const raw = String(item.entity || 'Otras líneas').trim();
    const provider = raw.toLowerCase().includes('prendo') ? 'Prendo' : raw.toLowerCase().includes('santander') ? 'Santander' : raw.toLowerCase().includes('propia') ? 'Propia' : raw;
    if (!buckets.has(provider)) buckets.set(provider, []);
    buckets.get(provider).push(item);
  });
  return Array.from(buckets.entries()).filter(([provider, items]) => preferredOrder.includes(provider) || items.length);
}


function rateRowHTML(item) {
  const installments = Array.isArray(item.installments) ? item.installments.join(',') : '';
  return `
    <tr>
      <td>
        <strong>${escape(item.label || item.code)}</strong>
      </td>
      <td><input class="input" data-rate-annual="${item.code}" value="${item.annual_rate ?? ''}" /></td>
      <td><input class="input" data-rate-year-from="${item.code}" value="${item.year_from ?? ''}" /></td>
      <td><input class="input" data-rate-year-to="${item.code}" value="${item.year_to ?? ''}" /></td>
      <td><input class="input" data-rate-installments="${item.code}" value="${installments}" placeholder="12,18,24,36" /></td>
      <td><select class="select" data-rate-active="${item.code}"><option value="true" ${item.active !== false ? 'selected' : ''}>Sí</option><option value="false" ${item.active === false ? 'selected' : ''}>No</option></select></td>
      <td><button class="btn btn-primary" type="button" data-rate-save="${item.code}">Guardar</button></td>
    </tr>
  `;
}

function financeEntityCardHTML([provider, items], index) {
  const helper = provider === 'Prendo'
    ? 'Tasas y plazos editables para las líneas comerciales de Prendo.'
    : provider === 'Santander'
      ? 'Tasas y plazos editables para las líneas comerciales de Santander.'
      : provider === 'Propia'
        ? 'Líneas internas para financiación propia, listas para actualizar.'
        : 'Otras líneas comerciales cargadas en el simulador.';

  return `
    <details class="admin-fold finance-provider-fold" ${index === 0 ? 'open' : ''}>
      <summary class="admin-fold__summary">
        <div>
          <span class="admin-fold__eyebrow">${escape(provider)}</span>
          <strong>${items.length} línea${items.length === 1 ? '' : 's'} editable${items.length === 1 ? '' : 's'}</strong>
          <p>${items.length ? helper : 'Todavía no hay líneas cargadas para este convenio.'}</p>
        </div>
      </summary>
      <div class="admin-fold__body">
        ${items.length ? `
          <div class="finance-rate-table-wrap">
            <table class="finance-rate-table">
              <thead>
                <tr>
                  <th>Línea</th>
                  <th>Tasa</th>
                  <th>Año desde</th>
                  <th>Año hasta</th>
                  <th>Cuotas</th>
                  <th>Activa</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${items.map(rateRowHTML).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state compact-empty"><strong>Sin líneas cargadas.</strong><span>Cuando agregues perfiles para este convenio, van a aparecer acá.</span></div>'}
      </div>
    </details>
  `;
}

function renderRates() {
  const wrap = $('financeEntityCards');
  if (!wrap) return;
  if (!state.rateProfiles.length) {
    wrap.innerHTML = '<div class="empty-state compact-empty"><strong>Sin perfiles de tasas.</strong><span>Corré el SQL de esta versión para crear la tabla finance_rate_profiles.</span></div>';
    return;
  }
  wrap.innerHTML = groupedRateProfiles().map(financeEntityCardHTML).join('');
  renderOverview();
}

async function loadRates() {
  try {
    const { data, error } = await sb.from('finance_rate_profiles').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    state.rateProfiles = Array.isArray(data) && data.length ? data : (window.RGFinanceDefaults || []);
    setRatesMeta(`${state.rateProfiles.length} perfiles de tasa cargados.`);
  } catch (error) {
    state.rateProfiles = window.RGFinanceDefaults || [];
    setRatesMeta('Usando perfiles fallback. Corré el SQL para administrarlos desde Supabase.');
  }
  renderRates();
}

async function saveRateProfile(code) {
  const current = state.rateProfiles.find((item) => item.code === code);
  if (!current) return;
  const payload = {
    ...current,
    annual_rate: Number(document.querySelector(`[data-rate-annual="${code}"]`)?.value || 0) || null,
    fee_pct: 0,
    year_from: Number(document.querySelector(`[data-rate-year-from="${code}"]`)?.value || 0) || null,
    year_to: Number(document.querySelector(`[data-rate-year-to="${code}"]`)?.value || 0) || null,
    installments: (document.querySelector(`[data-rate-installments="${code}"]`)?.value || '').split(',').map((n) => Number(n.trim())).filter(Boolean),
    quota_factors: current.quota_factors || {},
    notes: current.notes || null,
    active: document.querySelector(`[data-rate-active="${code}"]`)?.value !== 'false',
  };
  const { error } = await sb.from('finance_rate_profiles').upsert(payload, { onConflict: 'code' });
  if (error) throw error;
  await loadRates();
}

async function changePassword() {
  const password = $('newpass')?.value || '';
  if (password.length < 6) return alert('La contraseña debe tener al menos 6 caracteres.');
  const { error } = await sb.auth.updateUser({ password });
  if (error) return alert(error.message);
  $('newpass').value = '';
  alert('Contraseña actualizada.');
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  document.querySelectorAll('[data-quick-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.quickView;
      setView(target);
      if (target === 'vehicles') $('title')?.focus();
      if (target === 'leads') $('leadSearch')?.focus();
    });
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setLeadTab(button.dataset.tab));
  });

  $('adminSearch')?.addEventListener('input', (event) => {
    state.vehicleSearch = event.target.value.trim().toLowerCase();
    filterRowsLocally();
  });
  $('adminVehicleStatusFilter')?.addEventListener('change', (event) => {
    state.vehicleStatusFilter = event.target.value;
    filterRowsLocally();
  });
  $('leadSearch')?.addEventListener('input', (event) => {
    state.leadSearch = event.target.value.trim().toLowerCase();
    renderLeads();
  });
  $('photos')?.addEventListener('change', (event) => renderSelectedFilesPreview(event.target.files));
  $('newVehicleBtn')?.addEventListener('click', () => {
    clearForm();
    hideMsg();
    setView('vehicles');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('save')?.addEventListener('click', saveVehicle);
  $('clear')?.addEventListener('click', () => {
    clearForm();
    hideMsg();
  });
  $('changePass')?.addEventListener('click', changePassword);
  $('logout')?.addEventListener('click', async (event) => {
    event.preventDefault();
    await sb.auth.signOut();
    window.location.href = './login.html';
  });

  document.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-edit]');
    const statusButton = event.target.closest('[data-st]');
    const deleteButton = event.target.closest('[data-del]');
    const deletePhotoButton = event.target.closest('[data-delphoto]');
    const downloadButton = event.target.closest('[data-download]');
    const quickDownloadButton = event.target.closest('[data-quick-download]');
    const rateSaveButton = event.target.closest('[data-rate-save]');
    const leadSaveButton = event.target.closest('[data-lead-save]');

    if (editButton) {
      const vehicle = await getVehicleById(editButton.getAttribute('data-edit'));
      fillForm(vehicle);
      showMsg('Editando vehículo.', true);
      setView('vehicles');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (statusButton) {
      const id = statusButton.getAttribute('data-st');
      const status = statusButton.getAttribute('data-v');
      const { error } = await sb.from('vehicles').update({ status }).eq('id', id);
      if (error) return showMsg(error.message, false);
      showMsg(`Estado actualizado a ${window.RGShared.statusLabel(status)}.`, true);
      await loadRows();
      return;
    }

    if (deleteButton) {
      const id = deleteButton.getAttribute('data-del');
      if (!confirm('¿Eliminar este vehículo? Esta acción no se puede deshacer.')) return;
      const { error } = await sb.from('vehicles').delete().eq('id', id);
      if (error) return showMsg(error.message, false);
      showMsg('Vehículo eliminado.', true);
      if ($('id').value === id) clearForm();
      await loadRows();
      return;
    }

    if (deletePhotoButton) return void await deletePhoto(deletePhotoButton.getAttribute('data-delphoto'), deletePhotoButton.getAttribute('data-url'));

    if (rateSaveButton) {
      try {
        await saveRateProfile(rateSaveButton.getAttribute('data-rate-save'));
        alert('Tasa actualizada correctamente.');
      } catch (error) {
        alert(error.message || 'No se pudo guardar la tasa.');
      }
      return;
    }

    if (leadSaveButton) {
      try {
        await updateLead(leadSaveButton.dataset.leadSave, leadSaveButton.dataset.id);
        alert('Lead actualizado correctamente.');
      } catch (error) {
        alert(error.message || 'No se pudo actualizar el lead.');
      }
      return;
    }

    const downloadTarget = downloadButton?.getAttribute('data-download') || quickDownloadButton?.getAttribute('data-quick-download');
    if (downloadTarget) {
      const button = downloadButton || quickDownloadButton;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Generando…';
      try {
        const vehicle = await getVehicleById(downloadTarget);
        await window.RGFicha.download(vehicle);
      } catch (error) {
        showMsg(error.message || 'No se pudo generar la ficha.', false);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }
  });
}

function initLogin() {
  const btn = $('btn');
  const email = $('email');
  const pass = $('pass');
  if (!btn || !email || !pass) return;

  btn.addEventListener('click', async () => {
    const userEmail = email.value.trim();
    const password = pass.value;
    if (!userEmail || !password) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Ingresando…';
    const { data, error } = await sb.auth.signInWithPassword({ email: userEmail, password });
    btn.disabled = false;
    btn.textContent = original;
    if (error) return alert(error.message);
    if (data?.session) window.location.href = './admin.html';
  });
}

async function initAdmin() {
  if (!$('adminViewTitle')) return;
  const session = await requireSession();
  if (!session) return;
  bindEvents();
  clearForm();
  if ($('leadSearch')) {
    $('leadSearch').value = '';
    $('leadSearch').setAttribute('autocomplete', 'off');
  }
  state.leadSearch = '';
  const hash = (window.location.hash || '').replace('#', '').trim();
  if (hash) setView(hash);
  else setView('overview');
  await Promise.all([loadRows(), loadLeads(), loadRates()]);
}

document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  initAdmin().catch((error) => {
    console.error(error);
    alert(error.message || 'No se pudo iniciar el panel.');
  });
});
