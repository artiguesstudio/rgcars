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
  access: null,
  session: null,
  openLeadKeys: {},
  leadHistory: {},
  historyMissing: false,
  crmStageMissing: false,
  assignees: [],
  vehicleMaintenance: {},
  selectedVehiclePhoto: '',
  vehicleAlerts: [],
  vehicleAlertsMissing: false,
  analyticsViews: [],
  analyticsMissing: false,
  analyticsError: '',
  analyticsStatus: 'idle',
};

let supportsPlate = true;
let lastSavedVehicle = null;

const ACCESS_DEFAULTS = {
  key: 'full_admin',
  label: 'Administrador',
  allowedViews: ['overview', 'vehicles', 'leads', 'insurance', 'financing', 'metrics', 'settings'],
  landingView: 'overview',
  canChangePassword: true,
  restricted: false,
  note: '',
};

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveAccessProfile(sessionOrUser = null) {
  const user = sessionOrUser?.user || sessionOrUser || null;
  const email = normalizeEmail(user?.email);
  const registry = window.RGAdminAccess || {};
  const defaultProfile = {
    ...ACCESS_DEFAULTS,
    ...(registry.defaultProfile || {}),
  };
  const customProfile = email && registry.users ? registry.users[email] : null;
  const profile = {
    ...defaultProfile,
    ...(customProfile || {}),
  };

  const allowedViews = Array.isArray(profile.allowedViews) && profile.allowedViews.length
    ? profile.allowedViews.filter(Boolean)
    : [...defaultProfile.allowedViews];

  profile.allowedViews = Array.from(new Set(allowedViews));
  if (!profile.allowedViews.includes(profile.landingView)) {
    profile.landingView = profile.allowedViews[0] || defaultProfile.landingView;
  }
  profile.email = email;
  return profile;
}

function hasViewAccess(view) {
  const allowed = state.access?.allowedViews || ACCESS_DEFAULTS.allowedViews;
  return allowed.includes(view);
}

function firstAllowedView() {
  return state.access?.landingView || state.access?.allowedViews?.[0] || ACCESS_DEFAULTS.landingView;
}

function cleanupNavGroups() {
  document.querySelectorAll('.admin-nav-group').forEach((group) => {
    const visibleItems = Array.from(group.querySelectorAll('[data-view]')).filter((button) => !button.hidden);
    group.hidden = visibleItems.length === 0;
  });
}

function applyAccessControl() {
  const access = state.access || ACCESS_DEFAULTS;

  document.querySelectorAll('[data-view]').forEach((button) => {
    const allowed = hasViewAccess(button.dataset.view);
    button.hidden = !allowed;
    button.disabled = !allowed;
  });

  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.hidden = !hasViewAccess(panel.dataset.viewPanel);
  });

  document.querySelectorAll('[data-quick-view]').forEach((button) => {
    const allowed = hasViewAccess(button.dataset.quickView);
    button.hidden = !allowed;
    button.disabled = !allowed;
  });

  const changePass = $('changePass');
  if (changePass) {
    changePass.hidden = access.canChangePassword === false;
    changePass.disabled = access.canChangePassword === false;
  }
  const newPass = $('newpass');
  if (newPass) {
    const wrap = newPass.closest('.field');
    if (wrap) wrap.hidden = access.canChangePassword === false;
    newPass.disabled = access.canChangePassword === false;
  }

  cleanupNavGroups();

  document.body.classList.toggle('admin-has-restricted-access', !!access.restricted);

  const topbarEyebrow = document.querySelector('.admin-topbar__eyebrow');
  if (topbarEyebrow && access.restricted) {
    topbarEyebrow.textContent = `${topbarEyebrow.textContent} · ${access.label}`;
  }
}

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
    overview: ['Resumen', 'Visual general de stock, leads y pendientes del día.'],
    vehicles: ['Vehículos', 'Publicá, editá y administrá el stock en una única vista operativa.'],
    leads: ['Leads', 'Gestioná consignación, búsquedas, financiación, seguros, peritajes y sugerencias.'],
    insurance: ['Seguros', 'Seguimiento dedicado de pre-cotizaciones y contacto comercial.'],
    financing: ['Financiación', 'Configurá líneas y tasas del simulador sin mezclarlo con el stock.'],
    metrics: ['Métricas', 'Dashboard con tráfico web, mix comercial, embudo CRM y alertas operativas.'],
    settings: ['Configuración', 'Seguridad del panel y estructura general del sistema.'],
  };

  const fallbackView = firstAllowedView();
  const nextView = titles[view] ? view : fallbackView;
  state.currentView = hasViewAccess(nextView) ? nextView : fallbackView;
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-active', !panel.hidden && panel.dataset.viewPanel === state.currentView));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('is-active', !button.hidden && button.dataset.view === state.currentView));
  const [title, baseCopy] = titles[state.currentView] || titles[fallbackView];
  const restrictedNote = state.access?.restricted && state.access?.note ? ` ${state.access.note}` : '';
  if ($('adminViewTitle')) $('adminViewTitle').textContent = title;
  if ($('adminViewCopy')) $('adminViewCopy').textContent = `${baseCopy}${restrictedNote}`.trim();
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

function scoutingServiceLabel(item) {
  const labels = {
    comprar_auto: 'Comprar un auto',
    busqueda_personalizada: 'Búsqueda personalizada',
  };
  return labels[item?.use_case] || 'Búsqueda personalizada';
}

function statusOptions(type, current) {
  return window.RGShared.leadStatusOptions(type, current);
}


function defaultLeadStatus(type) {
  const defaults = {
    consignment: 'new',
    scouting: 'active',
    financing: 'new',
    insurance: 'new',
    peritaje: 'new',
    feedback: 'new',
  };
  return defaults[type] || 'new';
}

function normalizeLeadStage(value = 'lead') {
  const current = String(value || '').trim().toLowerCase();
  const allowed = new Set(['lead', 'opportunity', 'proposal', 'negotiation', 'won', 'lost']);
  return allowed.has(current) ? current : 'lead';
}

function leadTableName(type) {
  const map = {
    consignment: 'consignment_leads',
    scouting: 'scouting_requests',
    financing: 'financing_leads',
    insurance: 'insurance_leads',
    peritaje: 'peritaje_leads',
    feedback: 'feedback_submissions',
  };
  return map[type] || '';
}

function leadKey(type, id) {
  return `${type}:${id}`;
}

function leadCollectionKey(type) {
  const map = {
    consignment: 'consignments',
    scouting: 'scouting',
    financing: 'financing',
    insurance: 'insurance',
    peritaje: 'peritaje',
    feedback: 'feedback',
  };
  return map[type] || '';
}

function findLeadByType(type, id) {
  const list = state.leads?.[leadCollectionKey(type)] || [];
  return list.find((item) => String(item.id) === String(id)) || null;
}

function isSchemaMissingError(error, keyword = '') {
  const message = String(error?.message || '').toLowerCase();
  return (
    (message.includes('does not exist') || message.includes('schema cache') || message.includes('relation'))
    && (!keyword || message.includes(String(keyword).toLowerCase()))
  ) || (keyword && message.includes('column') && message.includes(String(keyword).toLowerCase()));
}

function currentUserDisplayName() {
  const user = state.session?.user || null;
  const meta = user?.user_metadata || {};
  return String(meta.full_name || meta.name || meta.display_name || user?.email || 'Usuario RG Cars');
}

function personNameFromEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return 'Sin asignar';
  const local = email.split('@')[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function assigneeDisplayName(email, fallback = '') {
  return String(fallback || personNameFromEmail(email) || 'Sin asignar');
}

function leadPriorityLabel(value = 'normal') {
  const map = {
    low: 'Baja',
    normal: 'Media',
    high: 'Alta',
    urgent: 'Urgente',
  };
  return map[value] || 'Media';
}

function leadPriorityOptions(current = 'normal') {
  return [
    ['low', 'Baja'],
    ['normal', 'Media'],
    ['high', 'Alta'],
    ['urgent', 'Urgente'],
  ].map(([value, label]) => `<option value="${escape(value)}" ${value === current ? 'selected' : ''}>${escape(label)}</option>`).join('');
}

function leadAssigneeOptions(currentEmail = '', currentName = '') {
  const options = ['<option value="">Sin asignar</option>'];
  const seen = new Set();
  const normalizedCurrent = normalizeEmail(currentEmail);
  const list = Array.isArray(state.assignees) ? state.assignees : [];
  list.forEach((item) => {
    const email = normalizeEmail(item.email);
    if (!email || seen.has(email)) return;
    seen.add(email);
    const label = assigneeDisplayName(email, item.label || item.name || item.display_name || item.role_key || 'Usuario RG Cars');
    options.push(`<option value="${escape(email)}" ${email === normalizedCurrent ? 'selected' : ''}>${escape(label)} · ${escape(email)}</option>`);
  });
  if (normalizedCurrent && !seen.has(normalizedCurrent)) {
    options.push(`<option value="${escape(normalizedCurrent)}" selected>${escape(assigneeDisplayName(normalizedCurrent, currentName))} · ${escape(normalizedCurrent)}</option>`);
  }
  return options.join('');
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  } catch {
    return '';
  }
}

function formatAdminDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return String(value);
  }
}

function leadTypeLabel(type) {
  const map = {
    consignment: 'Consignación',
    scouting: 'Búsqueda personalizada',
    financing: 'Financiación',
    insurance: 'Seguros',
    peritaje: 'Peritaje',
    feedback: 'Sugerencia',
  };
  return map[type] || 'Lead';
}

function noteActionsHTML(type, item) {
  const id = item.id;
  const currentStatus = item.status || defaultLeadStatus(type);
  const currentStage = item.crm_stage || 'lead';
  const notes = item.admin_notes || '';
  const assigneeEmail = normalizeEmail(item.assigned_to_email || '');
  const assigneeName = item.assigned_to_name || '';
  const priority = item.lead_priority || 'normal';
  const nextAction = item.next_action || '';
  const followUpAt = item.follow_up_at || '';
  return `
    <div class="lead-admin-box">
      <div class="lead-admin-grid lead-admin-grid--triple">
        <label class="field">
          <span>Etapa comercial</span>
          <select class="select lead-inline-select" data-lead-stage-type="${type}" data-id="${id}">
            ${window.RGShared.leadStageOptions(currentStage)}
          </select>
        </label>
        <label class="field">
          <span>Estado operativo</span>
          <select class="select lead-inline-select" data-lead-status-type="${type}" data-id="${id}">
            ${statusOptions(type, currentStatus)}
          </select>
        </label>
        <label class="field">
          <span>Vendedor asignado</span>
          <select class="select lead-inline-select" data-lead-assignee="${type}" data-id="${id}">
            ${leadAssigneeOptions(assigneeEmail, assigneeName)}
          </select>
        </label>
        <label class="field">
          <span>Prioridad</span>
          <select class="select lead-inline-select" data-lead-priority="${type}" data-id="${id}">
            ${leadPriorityOptions(priority)}
          </select>
        </label>
        <label class="field">
          <span>Próxima acción</span>
          <input class="input lead-inline-input" data-lead-next-action="${type}" data-id="${id}" value="${escape(nextAction)}" placeholder="Ej: llamar, enviar propuesta, pedir documentación" />
        </label>
        <label class="field">
          <span>Fecha de seguimiento</span>
          <input class="input lead-inline-input" type="datetime-local" data-lead-follow-up="${type}" data-id="${id}" value="${escape(toDateTimeLocalValue(followUpAt))}" />
        </label>
      </div>
      <textarea class="textarea lead-inline-notes" rows="4" data-lead-notes="${type}" data-id="${id}" placeholder="Notas internas y próximos pasos">${escape(notes)}</textarea>
      <div class="lead-admin-row lead-admin-row--split">
        <div class="lead-admin-row__main-actions">
          <button type="button" class="btn btn-soft" data-lead-save="${type}" data-id="${id}">Guardar cambios</button>
          <button type="button" class="btn btn-ghost" data-lead-download="${type}" data-id="${id}">Ficha imprimible</button>
        </div>
        <button type="button" class="btn btn-danger" data-lead-delete="${type}" data-id="${id}">Eliminar lead</button>
      </div>
    </div>
  `;
}

function historyItemTitle(entry) {
  const stageChanged = (entry.previous_stage || 'lead') !== (entry.next_stage || 'lead');
  const statusChanged = (entry.previous_status || '') !== (entry.next_status || '');
  const notesChanged = (entry.previous_notes || '') !== (entry.next_notes || '');
  const assigneeChanged = normalizeEmail(entry.previous_assignee_email || '') !== normalizeEmail(entry.next_assignee_email || '');
  const priorityChanged = (entry.previous_priority || 'normal') !== (entry.next_priority || 'normal');
  const nextActionChanged = (entry.previous_next_action || '') !== (entry.next_next_action || '');
  const followUpChanged = (entry.previous_follow_up_at || '') !== (entry.next_follow_up_at || '');
  if (entry.action_type === 'opened') return 'Abrió el lead';
  if (entry.action_type === 'created') return 'Lead recibido';
  if (entry.action_type === 'deleted') return 'Eliminó el lead';
  if (assigneeChanged && !stageChanged && !statusChanged && !notesChanged && !priorityChanged && !nextActionChanged && !followUpChanged) {
    return `Asignó a ${assigneeDisplayName(entry.next_assignee_email, entry.next_assignee_name)}`;
  }
  if (priorityChanged && !stageChanged && !statusChanged && !notesChanged && !assigneeChanged && !nextActionChanged && !followUpChanged) {
    return `Cambió prioridad a ${leadPriorityLabel(entry.next_priority || 'normal')}`;
  }
  if (stageChanged && !statusChanged && !notesChanged && !assigneeChanged && !priorityChanged && !nextActionChanged && !followUpChanged) return `Cambió etapa a ${window.RGShared.leadStageLabel(entry.next_stage || 'lead')}`;
  if (statusChanged && !stageChanged && !notesChanged && !assigneeChanged && !priorityChanged && !nextActionChanged && !followUpChanged) return `Cambió estado a ${window.RGShared.leadStatusLabel(entry.lead_type, entry.next_status || defaultLeadStatus(entry.lead_type))}`;
  if (nextActionChanged && !stageChanged && !statusChanged && !notesChanged && !assigneeChanged && !priorityChanged && !followUpChanged) return 'Actualizó la próxima acción';
  if (followUpChanged && !stageChanged && !statusChanged && !notesChanged && !assigneeChanged && !priorityChanged && !nextActionChanged) return 'Actualizó la fecha de seguimiento';
  if (notesChanged && !stageChanged && !statusChanged && !assigneeChanged && !priorityChanged && !nextActionChanged && !followUpChanged) return 'Actualizó notas internas';
  return 'Actualizó el lead';
}

function historyItemDetails(entry) {
  const rows = [];
  const prevStage = entry.previous_stage || 'lead';
  const nextStage = entry.next_stage || 'lead';
  const prevStatus = entry.previous_status || '';
  const nextStatus = entry.next_status || '';
  const prevNotes = entry.previous_notes || '';
  const nextNotes = entry.next_notes || '';
  const prevAssignee = normalizeEmail(entry.previous_assignee_email || '');
  const nextAssignee = normalizeEmail(entry.next_assignee_email || '');
  const prevPriority = entry.previous_priority || 'normal';
  const nextPriority = entry.next_priority || 'normal';
  const prevNextAction = entry.previous_next_action || '';
  const nextNextAction = entry.next_next_action || '';
  const prevFollowUp = entry.previous_follow_up_at || '';
  const nextFollowUp = entry.next_follow_up_at || '';

  if (prevStage !== nextStage) {
    rows.push(`<div><strong>Etapa</strong><span>${escape(window.RGShared.leadStageLabel(prevStage))} → ${escape(window.RGShared.leadStageLabel(nextStage))}</span></div>`);
  }
  if (prevStatus !== nextStatus) {
    rows.push(`<div><strong>Estado</strong><span>${escape(window.RGShared.leadStatusLabel(entry.lead_type, prevStatus || defaultLeadStatus(entry.lead_type)))} → ${escape(window.RGShared.leadStatusLabel(entry.lead_type, nextStatus || defaultLeadStatus(entry.lead_type)))}</span></div>`);
  }
  if (prevAssignee !== nextAssignee) {
    rows.push(`<div><strong>Asignación</strong><span>${escape(assigneeDisplayName(prevAssignee, entry.previous_assignee_name))} → ${escape(assigneeDisplayName(nextAssignee, entry.next_assignee_name))}</span></div>`);
  }
  if (prevPriority !== nextPriority) {
    rows.push(`<div><strong>Prioridad</strong><span>${escape(leadPriorityLabel(prevPriority))} → ${escape(leadPriorityLabel(nextPriority))}</span></div>`);
  }
  if (prevNextAction !== nextNextAction) {
    rows.push(`<div><strong>Próxima acción</strong><span>${escape(nextNextAction || 'Sin próxima acción')}</span></div>`);
  }
  if (prevFollowUp !== nextFollowUp) {
    rows.push(`<div><strong>Seguimiento</strong><span>${escape(nextFollowUp ? formatAdminDateTime(nextFollowUp) : 'Sin fecha')}</span></div>`);
  }
  if (prevNotes !== nextNotes) {
    rows.push(`<div><strong>Notas</strong><span>${escape(nextNotes || 'Sin notas internas')}</span></div>`);
  }
  if (entry.message) {
    rows.push(`<div><strong>Detalle</strong><span>${escape(entry.message)}</span></div>`);
  }
  return rows.length ? `<div class="lead-history-deltas">${rows.join('')}</div>` : '';
}

function leadHistoryHTML(type, id) {
  if (state.historyMissing) {
    return '<div class="lead-history-empty"><strong>Historial pendiente de SQL</strong><span>Ejecutá el patch incluido para activar trazabilidad por usuario.</span></div>';
  }

  const bucket = state.leadHistory[leadKey(type, id)];
  if (!bucket || bucket.loading) {
    return '<div class="lead-history-empty"><strong>Cargando historial…</strong><span>Consultando movimientos registrados para este lead.</span></div>';
  }
  if (bucket.error) {
    return `<div class="lead-history-empty"><strong>No se pudo cargar</strong><span>${escape(bucket.error)}</span></div>`;
  }
  const items = bucket.items || [];
  if (!items.length) {
    return '<div class="lead-history-empty"><strong>Sin actividad todavía</strong><span>Los próximos cambios de estado, etapa, notas y aperturas van a quedar registrados acá.</span></div>';
  }
  return `
    <ol class="lead-history-list">
      ${items.map((entry) => `
        <li class="lead-history-item">
          <div class="lead-history-item__head">
            <strong>${escape(historyItemTitle(entry))}</strong>
            <span>${escape(entry.actor_name || entry.actor_email || 'Usuario RG Cars')} · ${escape(formatAdminDateTime(entry.created_at))}</span>
          </div>
          ${historyItemDetails(entry)}
        </li>
      `).join('')}
    </ol>
  `;
}

async function loadLeadHistory(type, id, { force = false } = {}) {
  if (state.historyMissing) return [];
  const key = leadKey(type, id);
  const current = state.leadHistory[key];
  if (!force && current?.loaded) return current.items || [];

  state.leadHistory[key] = {
    loaded: false,
    loading: true,
    error: '',
    items: current?.items || [],
  };
  renderLeads();

  const { data, error } = await sb
    .from('lead_activity_log')
    .select('*')
    .eq('lead_type', type)
    .eq('lead_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    if (isSchemaMissingError(error, 'lead_activity_log')) {
      state.historyMissing = true;
      state.leadHistory[key] = { loaded: true, loading: false, error: '', items: [] };
      renderLeads();
      return [];
    }
    state.leadHistory[key] = { loaded: true, loading: false, error: error.message || 'No se pudo cargar el historial.', items: [] };
    renderLeads();
    return [];
  }

  state.leadHistory[key] = { loaded: true, loading: false, error: '', items: data || [] };
  renderLeads();
  return data || [];
}

async function logLeadOpened(type, id) {
  if (state.historyMissing) return;
  const user = state.session?.user || null;
  const payload = {
    lead_type: type,
    lead_id: id,
    action_type: 'opened',
    actor_user_id: user?.id || null,
    actor_email: normalizeEmail(user?.email || ''),
    actor_name: currentUserDisplayName(),
    message: 'Abrió el lead desde el backoffice.',
    metadata: {
      source_view: state.currentView,
      source_tab: state.currentLeadTab,
    },
  };
  const { error } = await sb.from('lead_activity_log').insert(payload);
  if (error) {
    if (isSchemaMissingError(error, 'lead_activity_log')) {
      state.historyMissing = true;
      renderLeads();
      return;
    }
    console.warn('No se pudo registrar la apertura del lead:', error.message || error);
  }
}

async function toggleLead(type, id) {
  const key = leadKey(type, id);
  if (state.openLeadKeys[key]) {
    delete state.openLeadKeys[key];
    renderLeads();
    return;
  }

  state.openLeadKeys[key] = true;
  renderLeads();
  await logLeadOpened(type, id);
  await loadLeadHistory(type, id, { force: true });
}

function leadCardShell({ type, item, title, subtitle, statusLabel, statusClass, previewHtml = '', mainHtml = '', mediaHtml = '' }) {
  const id = item.id;
  const key = leadKey(type, id);
  const isOpen = !!state.openLeadKeys[key];
  const stage = item.crm_stage || 'lead';
  const assigneeEmail = normalizeEmail(item.assigned_to_email || '');
  const crmMetaHtml = `
    <div class="lead-meta lead-meta--crm">
      <span>Prioridad: ${escape(leadPriorityLabel(item.lead_priority || 'normal'))}</span>
      <span>${escape(assigneeEmail ? `Asignado a ${assigneeDisplayName(assigneeEmail, item.assigned_to_name)}` : 'Sin asignar')}</span>
      <span>${escape(item.follow_up_at ? `Seguimiento ${formatAdminDateTime(item.follow_up_at)}` : 'Sin seguimiento')}</span>
    </div>
  `;

  return `
    <article class="lead-card lead-card-full ${isOpen ? 'is-open' : ''}">
      ${mediaHtml ? `<div class="lead-card-media">${mediaHtml}</div>` : ''}
      <div class="lead-card-body">
        <div class="lead-card-head lead-card-head--crm">
          <div>
            <div class="lead-pill-row">
              <span class="status-pill is-inline ${window.RGShared.leadStageClass(stage)}">${escape(window.RGShared.leadStageLabel(stage))}</span>
              <span class="status-pill is-inline ${statusClass}">${escape(statusLabel)}</span>
            </div>
            <h3>${title}</h3>
            <p>${subtitle}</p>
            ${crmMetaHtml}
          </div>
          <button type="button" class="btn btn-soft lead-toggle-btn" data-lead-toggle="${type}" data-id="${id}" aria-expanded="${isOpen ? 'true' : 'false'}">${isOpen ? 'Cerrar lead' : 'Abrir lead'}</button>
        </div>
        ${isOpen ? `
          <div class="lead-detail-grid">
            <div class="lead-detail-main">
              ${previewHtml}
              ${mainHtml}
            </div>
            <aside class="lead-history-card">
              <div class="lead-history-head">
                <span class="eyebrow">Timeline</span>
                <strong>Actividad del lead</strong>
              </div>
              ${leadHistoryHTML(type, id)}
            </aside>
          </div>
        ` : `<div class="lead-preview-wrap">${previewHtml}</div>`}
      </div>
    </article>
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
  const previewHtml = `
    <div class="lead-meta">
      <span>${escape(item.year || '-')}</span>
      <span>${window.RGShared.formatKm(item.km)}</span>
      <span>${escape(window.RGShared.categoryLabel(item.category))}</span>
      <span>${escape(item.plate || '-')}</span>
    </div>
    <p class="lead-copy lead-copy--preview"><strong>Precio:</strong> ${escape(priceRange || 'Sin rango económico')}</p>
  `;
  const mainHtml = `
    <p class="lead-copy">${escape(item.condition_summary || 'Sin resumen cargado.')}</p>
    <div class="table-actions">
      <a class="btn btn-ghost" href="mailto:${escape(item.owner_email || '')}">Email</a>
      <a class="btn btn-ghost" href="https://wa.me/${String(item.owner_phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>
    </div>
    ${noteActionsHTML('consignment', item)}
    ${photos.length > 1 ? `<div class="lead-gallery">${photos.map((photo) => `<a href="${photo.public_url}" target="_blank" rel="noreferrer"><img src="${photo.public_url}" alt="Foto lead" loading="lazy"></a>`).join('')}</div>` : ''}
  `;
  const mediaHtml = cover ? `<img src="${cover.public_url}" alt="${escape(item.brand)} ${escape(item.model)}" loading="lazy">` : '<div class="media-placeholder">Sin fotos</div>';
  return leadCardShell({
    type: 'consignment',
    item,
    title: escape([item.brand, item.model, item.version].filter(Boolean).join(' ')) || 'Consignación',
    subtitle: `${escape(item.owner_name || '')} · ${escape(item.owner_phone || '')} · ${escape(item.owner_email || '')}`,
    statusLabel: window.RGShared.leadStatusLabel('consignment', item.status || 'new'),
    statusClass: window.RGShared.leadStatusClass('consignment', item.status || 'new'),
    previewHtml,
    mainHtml,
    mediaHtml,
  });
}

function scoutingCardHTML(item) {
  const matches = leadMatchesCount(item.id);
  const serviceLabel = scoutingServiceLabel(item);
  const previewHtml = `
    <div class="lead-meta">
      <span>${escape(serviceLabel)}</span>
      <span>${escape(window.RGShared.categoryLabel(item.category))}</span>
      <span>${item.year_min || '-'} / ${item.year_max || '-'}</span>
      <span>${window.RGShared.formatPrice(item.price_min, item.currency)} - ${window.RGShared.formatPrice(item.price_max, item.currency)}</span>
      <span>${matches} match${matches === 1 ? '' : 'es'}</span>
    </div>
  `;
  const mainHtml = `
    <p class="lead-copy">${escape(item.must_have || item.notes || 'Sin observaciones adicionales.')}</p>
    <div class="table-actions">
      <a class="btn btn-ghost" href="mailto:${escape(item.email || '')}">Email</a>
      <a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>
    </div>
    ${noteActionsHTML('scouting', item)}
  `;
  return leadCardShell({
    type: 'scouting',
    item,
    title: escape([item.brand, item.model, item.version].filter(Boolean).join(' ')) || serviceLabel,
    subtitle: `${escape(item.customer_name || '')} · ${escape(item.phone || '')} · ${escape(item.email || '')}`,
    statusLabel: window.RGShared.leadStatusLabel('scouting', item.status || 'active'),
    statusClass: window.RGShared.leadStatusClass('scouting', item.status || 'active'),
    previewHtml,
    mainHtml,
  });
}

function financingCardHTML(item) {
  const previewHtml = `
    <div class="lead-meta lead-meta-grid">
      <span><strong>Entidad:</strong> ${escape(item.entity || '-')}</span>
      <span><strong>Línea:</strong> ${escape(item.profile_code || '-')}</span>
      <span><strong>A financiar:</strong> ${window.RGShared.formatPrice(item.requested_amount)}</span>
      <span><strong>Cuotas:</strong> ${escape(item.installments || '-')}</span>
      <span><strong>Cuota estimada:</strong> ${window.RGShared.formatPrice(item.estimated_monthly_payment)}</span>
      <span><strong>Localidad:</strong> ${escape(item.city || '-')}</span>
    </div>
  `;
  const mainHtml = `
    <p class="lead-copy">${escape(item.operation_context || item.notes || 'Sin observaciones adicionales.')}</p>
    <div class="table-actions">
      ${item.email ? `<a class="btn btn-ghost" href="mailto:${escape(item.email)}">Email</a>` : ''}
      ${item.phone ? `<a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''}
      ${item.vehicle_id ? `<a class="btn btn-ghost" href="../vehicle.html?id=${item.vehicle_id}" target="_blank" rel="noreferrer">Ver unidad</a>` : ''}
    </div>
    ${noteActionsHTML('financing', item)}
  `;
  return leadCardShell({
    type: 'financing',
    item,
    title: escape(item.vehicle_title || 'Simulación de financiación'),
    subtitle: `${escape(item.customer_name || '')} · ${escape(item.phone || 'Sin celular')} · ${escape(item.email || 'Sin email')} · ${escape(item.cuil || '')}`,
    statusLabel: window.RGShared.leadStatusLabel('financing', item.status || 'new'),
    statusClass: window.RGShared.leadStatusClass('financing', item.status || 'new'),
    previewHtml,
    mainHtml,
  });
}

function insuranceCardHTML(item) {
  const previewHtml = `
    <div class="lead-meta lead-meta-grid">
      <span><strong>Cobertura:</strong> ${escape(item.coverage_type || '-')}</span>
      <span><strong>Uso:</strong> ${escape(item.use_type || '-')}</span>
      <span><strong>Preferencia:</strong> ${escape(item.insurer_preference || '-')}</span>
      <span><strong>Patente:</strong> ${escape(item.plate || '-')}</span>
      <span><strong>Valor a asegurar:</strong> ${window.RGShared.formatPrice(item.insured_amount)}</span>
      <span><strong>Financiación:</strong> ${item.needs_financing ? 'Sí' : 'No'}</span>
    </div>
  `;
  const mainHtml = `
    <p class="lead-copy">${escape(item.notes || 'Sin observaciones adicionales.')}</p>
    <div class="table-actions">
      <a class="btn btn-ghost" href="mailto:${escape(item.email || '')}">Email</a>
      <a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>
      ${item.vehicle_id ? `<a class="btn btn-ghost" href="../vehicle.html?id=${item.vehicle_id}" target="_blank" rel="noreferrer">Ver unidad</a>` : ''}
    </div>
    ${noteActionsHTML('insurance', item)}
  `;
  return leadCardShell({
    type: 'insurance',
    item,
    title: escape(item.vehicle_title || 'Pre-cotización de seguro'),
    subtitle: `${escape(item.customer_name || '')} · ${escape(item.phone || '')} · ${escape(item.email || '')} · ${escape(item.cuil || '')}`,
    statusLabel: window.RGShared.leadStatusLabel('insurance', item.status || 'new'),
    statusClass: window.RGShared.leadStatusClass('insurance', item.status || 'new'),
    previewHtml,
    mainHtml,
  });
}

function peritajeCardHTML(item) {
  const previewHtml = `
    <div class="lead-meta lead-meta-grid">
      <span><strong>Fecha:</strong> ${escape(item.appointment_date || '-')}</span>
      <span><strong>Horario:</strong> ${escape(item.appointment_time || '-')}</span>
      <span><strong>Ciudad:</strong> ${escape(item.city || '-')}</span>
      <span><strong>Patente:</strong> ${escape(item.plate || '-')}</span>
      <span><strong>Km:</strong> ${item.km ? window.RGShared.formatKm(item.km) : '-'}</span>
      <span><strong>Motivo:</strong> ${escape(item.inspection_reason || '-')}</span>
    </div>
  `;
  const mainHtml = `
    <p class="lead-copy">${escape(item.notes || 'Sin observaciones adicionales.')}</p>
    <div class="table-actions">
      ${item.email ? `<a class="btn btn-ghost" href="mailto:${escape(item.email)}">Email</a>` : ''}
      ${item.phone ? `<a class="btn btn-ghost" href="https://wa.me/${String(item.phone || '').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''}
      ${item.vehicle_id ? `<a class="btn btn-ghost" href="../vehicle.html?id=${item.vehicle_id}" target="_blank" rel="noreferrer">Ver unidad</a>` : ''}
    </div>
    ${noteActionsHTML('peritaje', item)}
  `;
  return leadCardShell({
    type: 'peritaje',
    item,
    title: escape([item.vehicle_brand, item.vehicle_model, item.vehicle_year].filter(Boolean).join(' ') || 'Solicitud de peritaje'),
    subtitle: `${escape(item.customer_name || '')} · ${escape(item.phone || 'Sin celular')} · ${escape(item.email || 'Sin email')}`,
    statusLabel: window.RGShared.leadStatusLabel('peritaje', item.status || 'new'),
    statusClass: window.RGShared.leadStatusClass('peritaje', item.status || 'new'),
    previewHtml,
    mainHtml,
  });
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
  const previewHtml = `
    <div class="lead-meta lead-meta-grid">
      <span><strong>Página:</strong> ${escape(pageLabel)}</span>
      <span><strong>Fecha:</strong> ${item.created_at ? formatAdminDateTime(item.created_at) : '-'}</span>
      <span><strong>Título:</strong> ${escape(item.source_title || '-')}</span>
    </div>
  `;
  const mainHtml = `
    <p class="lead-copy">${escape(item.message || 'Sin mensaje.')}</p>
    <div class="table-actions">
      ${item.source_url ? `<a class="btn btn-ghost" href="${escape(item.source_url)}" target="_blank" rel="noreferrer">Abrir página</a>` : ''}
    </div>
    ${noteActionsHTML('feedback', item)}
  `;
  return leadCardShell({
    type: 'feedback',
    item,
    title: `Sugerencia desde ${escape(pageLabel)}`,
    subtitle: `${escape(item.visitor_name || 'Anónimo')} · ${escape(item.visitor_contact || 'Sin contacto')}`,
    statusLabel: window.RGShared.leadStatusLabel('feedback', item.status || 'new'),
    statusClass: window.RGShared.leadStatusClass('feedback', item.status || 'new'),
    previewHtml,
    mainHtml,
  });
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

function allLeadRows() {
  return [
    ...state.leads.consignments,
    ...state.leads.scouting,
    ...state.leads.financing,
    ...state.leads.insurance,
    ...state.leads.peritaje,
    ...state.leads.feedback,
  ];
}

function leadStageCounts() {
  return allLeadRows().reduce((acc, item) => {
    const key = item.crm_stage || 'lead';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function renderLeadStats() {
  const wrap = $('leadStats');
  if (!wrap) return;
  const all = allLeadRows();
  const items = [
    ['Total', all.length],
    ['Oportunidades', all.filter((item) => item.crm_stage === 'opportunity').length],
    ['Ganados', all.filter((item) => item.crm_stage === 'won').length],
    ['Seguimientos', all.filter((item) => item.follow_up_at).length],
    ['Sin asignar', all.filter((item) => !normalizeEmail(item.assigned_to_email || '')).length],
    ['Urgentes', all.filter((item) => item.lead_priority === 'urgent').length],
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
    const baseMeta = `${state.leads.consignments.length} consignaciones · ${state.leads.scouting.length} búsquedas · ${state.leads.financing.length} financiaciones · ${state.leads.insurance.length} seguros · ${state.leads.peritaje.length} peritajes · ${state.leads.feedback.length} sugerencias.`;
    const warnings = [];
    if (state.historyMissing) warnings.push('Ejecutá el SQL de historial para activar la timeline por usuario.');
    if (state.crmStageMissing) warnings.push('La etapa comercial necesita el SQL CRM para guardarse.');
    $('leadsMeta').textContent = warnings.length ? `${baseMeta} ${warnings.join(' ')}` : baseMeta;
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

async function loadAssignees() {
  try {
    const rows = await safeSelect(
      sb.from('admin_access_profiles')
        .select('email, role_key, restricted, is_active')
        .eq('is_active', true)
        .order('restricted', { ascending: true })
        .order('email', { ascending: true })
    );
    const mapped = (rows || []).map((item) => ({
      email: normalizeEmail(item.email),
      role_key: item.role_key || '',
      restricted: !!item.restricted,
      label: assigneeDisplayName(item.email),
    })).filter((item) => item.email);
    const currentEmail = normalizeEmail(state.session?.user?.email || '');
    if (currentEmail && !mapped.some((item) => item.email === currentEmail)) {
      mapped.unshift({ email: currentEmail, role_key: 'session_user', restricted: false, label: assigneeDisplayName(currentEmail) });
    }
    state.assignees = mapped;
  } catch (error) {
    const currentEmail = normalizeEmail(state.session?.user?.email || '');
    state.assignees = currentEmail ? [{ email: currentEmail, role_key: 'session_user', restricted: false, label: assigneeDisplayName(currentEmail) }] : [];
  }
  if ($('consignmentPanel')) renderLeads();
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

  state.leads.consignments = Array.isArray(consignments) ? consignments : [];
  state.leads.scouting = Array.isArray(scouting) ? scouting : [];
  state.leads.matches = Array.isArray(matches) ? matches : [];
  state.leads.financing = Array.isArray(financing) ? financing : [];
  state.leads.insurance = Array.isArray(insurance) ? insurance : [];
  state.leads.peritaje = Array.isArray(peritaje) ? peritaje : [];
  state.leads.feedback = Array.isArray(feedback) ? feedback : [];

  renderLeads();
}

async function updateLead(type, id) {
  const table = leadTableName(type);
  if (!table) return;

  const status = document.querySelector(`[data-lead-status-type="${type}"][data-id="${id}"]`)?.value || defaultLeadStatus(type);
  const stage = normalizeLeadStage(document.querySelector(`[data-lead-stage-type="${type}"][data-id="${id}"]`)?.value || 'lead');
  const assignedEmail = normalizeEmail(document.querySelector(`[data-lead-assignee="${type}"][data-id="${id}"]`)?.value || '');
  const assignedName = assignedEmail ? assigneeDisplayName(assignedEmail) : null;
  const priority = document.querySelector(`[data-lead-priority="${type}"][data-id="${id}"]`)?.value || 'normal';
  const nextAction = document.querySelector(`[data-lead-next-action="${type}"][data-id="${id}"]`)?.value?.trim() || null;
  const followUpRaw = document.querySelector(`[data-lead-follow-up="${type}"][data-id="${id}"]`)?.value || '';
  const notes = document.querySelector(`[data-lead-notes="${type}"][data-id="${id}"]`)?.value?.trim() || null;

  const payload = {
    status,
    crm_stage: stage,
    assigned_to_email: assignedEmail || null,
    assigned_to_name: assignedName,
    lead_priority: priority,
    next_action: nextAction,
    follow_up_at: followUpRaw ? new Date(followUpRaw).toISOString() : null,
    admin_notes: notes,
    last_touched_at: new Date().toISOString(),
  };

  const { data, error } = await sb.from(table).update(payload).eq('id', id).select('*').single();
  if (error) throw error;

  const collection = leadCollectionKey(type);
  if (collection && state.leads[collection]) {
    state.leads[collection] = state.leads[collection].map((item) => (String(item.id) === String(id) ? { ...item, ...data } : item));
  }

  await loadLeadHistory(type, id, { force: true });
  renderLeads();

  if (data && type !== 'feedback' && window.RGShared?.sendLeadNotification) {
    await window.RGShared.sendLeadNotification(type, status || data.status || defaultLeadStatus(type), data, { event: 'status_update' }).catch((err) => console.warn('No se pudo enviar el email de actualización:', err.message || err));
  }
}

async function deleteLead(type, id) {
  const table = leadTableName(type);
  const collection = leadCollectionKey(type);
  if (!table || !collection) return;
  const confirmed = window.confirm('¿Eliminar este lead? Esta acción no se puede deshacer.');
  if (!confirmed) return;

  const current = findLeadByType(type, id);
  if (current) {
    const { error: logError } = await sb.from('lead_activity_log').insert({
      lead_type: type,
      lead_id: id,
      action_type: 'deleted',
      actor_user_id: state.session?.user?.id || null,
      actor_email: normalizeEmail(state.session?.user?.email || ''),
      actor_name: currentUserDisplayName(),
      message: 'Eliminó el lead desde el backoffice.',
      previous_stage: current.crm_stage || 'lead',
      next_stage: current.crm_stage || 'lead',
      previous_status: current.status || defaultLeadStatus(type),
      next_status: current.status || defaultLeadStatus(type),
      previous_notes: current.admin_notes || null,
      next_notes: current.admin_notes || null,
      previous_assignee_email: normalizeEmail(current.assigned_to_email || ''),
      next_assignee_email: normalizeEmail(current.assigned_to_email || ''),
      previous_assignee_name: current.assigned_to_name || null,
      next_assignee_name: current.assigned_to_name || null,
      previous_priority: current.lead_priority || 'normal',
      next_priority: current.lead_priority || 'normal',
      previous_next_action: current.next_action || null,
      next_next_action: current.next_action || null,
      previous_follow_up_at: current.follow_up_at || null,
      next_follow_up_at: current.follow_up_at || null,
    });
    if (logError && !isSchemaMissingError(logError, 'lead_activity_log')) {
      console.warn('No se pudo registrar la eliminación del lead:', logError.message || logError);
    }
  }

  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;

  state.leads[collection] = (state.leads[collection] || []).filter((item) => String(item.id) !== String(id));
  delete state.openLeadKeys[leadKey(type, id)];
  delete state.leadHistory[leadKey(type, id)];
  renderLeads();
}

function leadSheetTitle(type, item) {
  if (type === 'consignment') return [item.brand, item.model, item.version].filter(Boolean).join(' ') || 'Lead de consignación';
  if (type === 'scouting') return [item.brand, item.model, item.version].filter(Boolean).join(' ') || 'Búsqueda personalizada';
  if (type === 'financing') return item.vehicle_title || 'Lead de financiación';
  if (type === 'insurance') return item.vehicle_title || [item.vehicle_brand, item.vehicle_model].filter(Boolean).join(' ') || 'Lead de seguros';
  if (type === 'peritaje') return [item.vehicle_brand, item.vehicle_model].filter(Boolean).join(' ') || 'Lead de peritaje';
  return item.source_title || 'Sugerencia web';
}

async function downloadLeadSheet(type, id) {
  const item = findLeadByType(type, id);
  if (!item) throw new Error('No encontramos ese lead.');
  const bucket = state.leadHistory[leadKey(type, id)];
  const history = bucket?.loaded ? bucket.items || [] : await loadLeadHistory(type, id, { force: false });
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 16;

  const stripHtml = (value = '') => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const pushBlock = (label, value) => {
    if (y > 274) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(String(label || '').toUpperCase(), 16, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(String(value || '—'), 178);
    doc.text(lines, 16, y);
    y += Math.max(7, lines.length * 5 + 3);
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text('Ficha de lead', 16, y);
  y += 8;
  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.text(`${leadTypeLabel(type)} · ${leadSheetTitle(type, item)}`, 16, y);
  y += 10;

  pushBlock('Etapa comercial', window.RGShared.leadStageLabel(item.crm_stage || 'lead'));
  pushBlock('Estado operativo', window.RGShared.leadStatusLabel(type, item.status || defaultLeadStatus(type)));
  pushBlock('Prioridad', leadPriorityLabel(item.lead_priority || 'normal'));
  pushBlock('Asignado a', item.assigned_to_email ? `${assigneeDisplayName(item.assigned_to_email, item.assigned_to_name)} · ${item.assigned_to_email}` : 'Sin asignar');
  pushBlock('Próxima acción', item.next_action || 'Sin próxima acción');
  pushBlock('Fecha de seguimiento', item.follow_up_at ? formatAdminDateTime(item.follow_up_at) : 'Sin fecha');

  const contactLines = [];
  if (item.owner_name || item.customer_name || item.visitor_name) contactLines.push(item.owner_name || item.customer_name || item.visitor_name);
  if (item.owner_phone || item.phone || item.visitor_contact) contactLines.push(item.owner_phone || item.phone || item.visitor_contact);
  if (item.owner_email || item.email) contactLines.push(item.owner_email || item.email);
  if (item.cuil) contactLines.push(`CUIL: ${item.cuil}`);
  pushBlock('Contacto', contactLines.join(' · ') || 'Sin datos de contacto');

  const detailCandidates = [item.condition_summary, item.must_have, item.operation_context, item.notes, item.message, item.admin_notes].filter(Boolean);
  pushBlock('Detalle / notas', detailCandidates.join('\n\n') || 'Sin notas internas.');

  if (Array.isArray(history) && history.length) {
    if (y > 250) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Historial', 16, y);
    y += 8;
    history.slice(0, 12).forEach((entry, index) => {
      if (y > 274) { doc.addPage(); y = 16; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(`${index + 1}. ${leadHistoryHeadline(entry)}`, 16, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      const meta = `${entry.actor_name || entry.actor_email || 'Usuario RG Cars'} · ${formatAdminDateTime(entry.created_at)}`;
      doc.text(doc.splitTextToSize(meta, 178), 16, y);
      y += 5;
      const detail = stripHtml(leadHistoryDetail(entry) || entry.message || 'Sin detalle adicional.');
      const lines = doc.splitTextToSize(detail, 178).slice(0, 3);
      doc.text(lines, 16, y);
      y += lines.length * 4.6 + 5;
    });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(107, 114, 128);
  doc.text('Documento generado automáticamente desde el backoffice de RG Cars TDF.', 16, 286);
  doc.save(`lead-${type}-${String(id).slice(0, 8)}.pdf`);
}

function currentVehicleId() {
  return $('id')?.value || '';
}

function vehicleMaintenanceBucket(vehicleId) {
  return state.vehicleMaintenance[String(vehicleId)] || { items: [], loaded: false, loading: false, error: '' };
}

async function loadVehicleMaintenance(vehicleId, { force = false } = {}) {
  if (!vehicleId) {
    renderVehicleMaintenance();
    return [];
  }
  const key = String(vehicleId);
  const current = state.vehicleMaintenance[key];
  if (!force && current?.loaded) {
    renderVehicleMaintenance();
    return current.items || [];
  }
  state.vehicleMaintenance[key] = { loaded: false, loading: true, error: '', items: current?.items || [] };
  renderVehicleMaintenance();
  const { data, error } = await sb
    .from('vehicle_maintenance_log')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    state.vehicleMaintenance[key] = { loaded: true, loading: false, error: error.message || 'No se pudo cargar el historial.', items: [] };
    renderVehicleMaintenance();
    return [];
  }
  state.vehicleMaintenance[key] = { loaded: true, loading: false, error: '', items: data || [] };
  renderVehicleMaintenance();
  return data || [];
}

function maintenanceTypeLabel(value = '') {
  const map = {
    revision: 'Revisión',
    service: 'Service',
    reparacion: 'Reparación',
    estetica: 'Estética',
    documentacion: 'Documentación',
    movimiento: 'Movimiento comercial',
    otro: 'Otro',
  };
  return map[value] || value || 'Movimiento';
}

function renderVehicleMaintenance() {
  const list = $('vehicleMaintenanceList');
  const meta = $('vehicleMaintenanceMeta');
  const downloadButton = $('downloadMaintenanceSheet');
  const vehicleId = currentVehicleId();
  if (!list || !meta || !downloadButton) return;
  if (!vehicleId) {
    meta.textContent = 'Guardá el vehículo primero para habilitar historial, ficha imprimible y monitoreo.';
    list.innerHTML = '<div class="empty-state compact-empty"><strong>Sin vehículo seleccionado.</strong><span>Primero guardá o editá una unidad existente.</span></div>';
    downloadButton.disabled = true;
    return;
  }
  const bucket = vehicleMaintenanceBucket(vehicleId);
  downloadButton.disabled = bucket.loading || !!bucket.error || !(bucket.items || []).length;
  if (bucket.loading) {
    meta.textContent = 'Cargando movimientos del vehículo…';
    list.innerHTML = '<div class="empty-state compact-empty"><strong>Cargando historial…</strong><span>Consultando movimientos registrados.</span></div>';
    return;
  }
  if (bucket.error) {
    meta.textContent = 'El historial de mantenimiento requiere ejecutar el SQL incluido en el proyecto.';
    list.innerHTML = `<div class="empty-state compact-empty"><strong>Historial pendiente de SQL</strong><span>${escape(bucket.error)}</span></div>`;
    return;
  }
  const items = bucket.items || [];
  meta.textContent = `${items.length} movimiento${items.length === 1 ? '' : 's'} registrado${items.length === 1 ? '' : 's'} para esta unidad.`;
  if (!items.length) {
    list.innerHTML = '<div class="empty-state compact-empty"><strong>Sin movimientos cargados.</strong><span>Registrá services, reparaciones o controles para activar la ficha y el monitoreo.</span></div>';
    return;
  }
  list.innerHTML = items.map((entry) => `
    <div class="admin-summary-item admin-summary-item--maintenance">
      <div>
        <strong>${escape(entry.title || maintenanceTypeLabel(entry.entry_type))}</strong>
        <span>${escape(maintenanceTypeLabel(entry.entry_type))} · ${escape(formatAdminDateTime(entry.event_date || entry.created_at))} · ${escape(entry.km ? window.RGShared.formatKm(entry.km) : 'Sin km')}</span>
      </div>
      <div class="admin-summary-item__aside">
        <span>${escape(entry.cost_ars ? window.RGShared.formatPrice(entry.cost_ars) : 'Sin costo cargado')}</span>
        ${entry.next_due_date ? `<span>Próximo control: ${escape(formatAdminDateTime(entry.next_due_date))}</span>` : ''}
        ${entry.notes ? `<span>${escape(entry.notes)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

async function saveVehicleMaintenanceEntry() {
  const vehicleId = currentVehicleId();
  if (!vehicleId) return alert('Guardá el vehículo primero para registrar mantenimiento.');
  const payload = {
    vehicle_id: vehicleId,
    event_date: $('maintenanceDate')?.value || new Date().toISOString().slice(0, 10),
    entry_type: $('maintenanceType')?.value || 'revision',
    title: $('maintenanceTitle')?.value?.trim() || null,
    km: Number($('maintenanceKm')?.value || 0) || null,
    cost_ars: Number($('maintenanceCost')?.value || 0) || null,
    next_due_date: $('maintenanceNextDue')?.value || null,
    notes: $('maintenanceNotes')?.value?.trim() || null,
    actor_user_id: state.session?.user?.id || null,
    actor_email: normalizeEmail(state.session?.user?.email || ''),
    actor_name: currentUserDisplayName(),
  };
  const { error } = await sb.from('vehicle_maintenance_log').insert(payload);
  if (error) return alert(error.message || 'No se pudo guardar el movimiento.');
  ['maintenanceTitle', 'maintenanceKm', 'maintenanceCost', 'maintenanceNextDue', 'maintenanceNotes'].forEach((id) => { if ($(id)) $(id).value = ''; });
  if ($('maintenanceType')) $('maintenanceType').value = 'revision';
  if ($('maintenanceDate')) $('maintenanceDate').value = new Date().toISOString().slice(0, 10);
  await loadVehicleMaintenance(vehicleId, { force: true });
  await loadVehicleAlerts();
}

async function downloadVehicleMaintenanceSheet(vehicle, entries = []) {
  if (!window.jspdf?.jsPDF) throw new Error('La librería de PDF no está disponible.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setFillColor(255,255,255); doc.rect(0,0,210,297,'F');
  doc.setFillColor(200,16,46); doc.rect(0,0,210,7,'F');
  doc.setFillColor(15,23,42); doc.roundedRect(14,14,182,24,8,8,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(255,255,255); doc.text('Historial de mantenimiento', 18, 24);
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(214,220,231); doc.text('RG Cars TDF · seguimiento interno de stock', 18, 31);
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(15,23,42); doc.text(doc.splitTextToSize(vehicle.title || 'Vehículo', 170), 16, 50);
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(71,85,105);
  doc.text(`Patente: ${window.RGShared.textOrDash(vehicle.plate)} · Año: ${window.RGShared.textOrDash(vehicle.year)} · Km: ${window.RGShared.formatKm(vehicle.km)}`, 16, 59);
  doc.text(`Alerta por inactividad: ${vehicle.stock_alert_days || 30} días`, 16, 65);
  let y = 78;
  if (!entries.length) {
    doc.setFont('helvetica','normal'); doc.text('Sin movimientos cargados todavía.', 16, y);
  } else {
    entries.forEach((entry, index) => {
      if (y > 264) { doc.addPage(); y = 22; }
      doc.setFillColor(248,250,252); doc.roundedRect(16, y - 5, 178, 13, 3, 3, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(15,23,42);
      doc.text(`${index + 1}. ${entry.title || maintenanceTypeLabel(entry.entry_type)}`, 20, y);
      doc.setFont('helvetica','normal'); doc.setFontSize(9.3); doc.setTextColor(71,85,105);
      const meta = [maintenanceTypeLabel(entry.entry_type), formatAdminDateTime(entry.event_date || entry.created_at), entry.km ? window.RGShared.formatKm(entry.km) : '', entry.cost_ars ? window.RGShared.formatPrice(entry.cost_ars) : ''].filter(Boolean).join(' · ');
      doc.text(doc.splitTextToSize(meta, 168)[0], 20, y + 5);
      y += 11;
      const notes = entry.notes || 'Sin detalle adicional.';
      const lines = doc.splitTextToSize(notes, 168);
      doc.text(lines.slice(0, 3), 20, y + 3);
      y += lines.slice(0, 3).length * 4.6 + 7;
      if (entry.next_due_date) {
        doc.setTextColor(100,116,139);
        doc.text(`Próximo control: ${formatAdminDateTime(entry.next_due_date)}`, 20, y);
        y += 7;
      }
    });
  }
  doc.setTextColor(107,114,128); doc.setFontSize(8.5); doc.text('Documento generado automáticamente desde el backoffice de RG Cars TDF.', 16, 286);
  doc.save(`mantenimiento-${String(vehicle.id || 'vehiculo').slice(0,8)}.pdf`);
}

async function loadVehicleAlerts() {
  state.vehicleAlertsMissing = false;

  const candidates = [
    {
      table: 'vehicle_stock_monitoring',
      normalize: (row) => ({
        ...row,
        updated_at: row.updated_at || row.last_activity_at || null,
        stock_alert_days: row.stock_alert_days || row.alert_after_days || 30,
      }),
      orderColumns: [
        ['is_stale', { ascending: false }],
        ['last_activity_at', { ascending: true }],
      ],
    },
    {
      table: 'vehicle_alert_status',
      normalize: (row) => row,
      orderColumns: [
        ['is_stale', { ascending: false }],
        ['updated_at', { ascending: true }],
      ],
    },
  ];

  let lastSchemaError = null;

  for (const candidate of candidates) {
    let query = sb.from(candidate.table).select('*');
    candidate.orderColumns.forEach(([column, options]) => {
      query = query.order(column, options);
    });
    const { data, error } = await query.limit(12);

    if (!error) {
      state.vehicleAlerts = Array.isArray(data) ? data.map(candidate.normalize) : [];
      renderOverview();
      return;
    }

    if (isSchemaMissingError(error, candidate.table)) {
      lastSchemaError = error;
      continue;
    }

    throw error;
  }

  state.vehicleAlertsMissing = true;
  state.vehicleAlerts = [];
  if (lastSchemaError) console.warn('No se encontró la vista de monitoreo de stock.', lastSchemaError);
  renderOverview();
}

function analyticsPageLabel(key = '') {
  const map = {
    home: 'Home',
    vehicle: 'Ficha vehículo',
    financing: 'Financiación',
    consignment: 'Consignación',
    scouting: 'Búsqueda',
    insurance: 'Seguros',
    peritaje: 'Peritaje',
    other: 'Otras',
  };
  return map[key] || key || 'Otras';
}

function rangeDayKeys(days = 14) {
  const items = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    items.push(date.toISOString().slice(0, 10));
  }
  return items;
}

async function loadAnalyticsViews() {
  state.analyticsMissing = false;
  state.analyticsError = '';
  state.analyticsStatus = 'loading';

  const probe = await sb
    .from('web_page_views')
    .select('id', { head: true, count: 'exact' })
    .limit(1);

  if (probe.error) {
    if (isSchemaMissingError(probe.error, 'web_page_views')) {
      state.analyticsMissing = true;
      state.analyticsStatus = 'missing';
      state.analyticsViews = [];
      renderOverview();
      renderMetricsDashboard();
      return;
    }
    state.analyticsViews = [];
    state.analyticsStatus = 'error';
    state.analyticsError = String(probe.error.message || 'No pudimos consultar la analítica web.');
    renderOverview();
    renderMetricsDashboard();
    return;
  }

  const since = new Date(Date.now() - (1000 * 60 * 60 * 24 * 29)).toISOString();
  const { data, error } = await sb
    .from('web_page_views')
    .select('created_at, page_key, page_path')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error) {
    state.analyticsViews = [];
    state.analyticsStatus = 'error';
    state.analyticsError = String(error.message || 'No pudimos cargar las visitas registradas.');
    renderOverview();
    renderMetricsDashboard();
    return;
  }

  state.analyticsViews = Array.isArray(data) ? data : [];
  state.analyticsStatus = 'ready';
  renderOverview();
  renderMetricsDashboard();
}

function renderBarsChartHTML(items = [], emptyCopy = 'Todavía no hay datos para mostrar.') {
  if (!items.length) {
    return `<div class="admin-chart-empty">${escape(emptyCopy)}</div>`;
  }
  const max = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  return `
    <div class="admin-chart-bars">
      ${items.map((item) => {
        const value = Number(item.value) || 0;
        const height = Math.max(10, Math.round((value / max) * 100));
        return `
          <div class="admin-chart-bar">
            <span class="admin-chart-bar__value">${value}</span>
            <div class="admin-chart-bar__track"><div class="admin-chart-bar__fill" style="height:${height}%"></div></div>
            <span class="admin-chart-bar__label">${escape(item.label)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderRowsChartHTML(items = [], emptyCopy = 'Todavía no hay datos para mostrar.') {
  if (!items.length) {
    return `<div class="admin-chart-empty">${escape(emptyCopy)}</div>`;
  }
  const max = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  return `<div class="admin-chart-rows">${items.map((item) => {
    const value = Number(item.value) || 0;
    const width = `${Math.max(4, Math.round((value / max) * 100))}%`;
    return `
      <div class="admin-chart-row">
        <span class="admin-chart-row__label">${escape(item.label)}</span>
        <div class="admin-chart-row__bar"><span class="admin-chart-row__fill" style="--bar-width:${width}"></span></div>
        <strong class="admin-chart-row__value">${value}</strong>
      </div>
    `;
  }).join('')}</div>`;
}

function renderTrafficCharts() {
  const trafficMeta = $('trafficMeta');
  const trafficSummary = $('trafficSummary');
  const trafficDailyChart = $('trafficDailyChart');
  const trafficPagesChart = $('trafficPagesChart');
  const leadMixChart = $('leadMixChart');
  if (!trafficSummary || !trafficDailyChart || !trafficPagesChart || !leadMixChart) return;

  if (state.analyticsStatus === 'missing') {
    if (trafficMeta) trafficMeta.textContent = 'La tabla de analítica web todavía no existe en este proyecto.';
    trafficSummary.innerHTML = '<div class="admin-chart-empty">Ejecutá el SQL incluido en <strong>admin/SQL_CRM_STOCK_ALERTAS.sql</strong>. Cuando la tabla <strong>web_page_views</strong> exista y el sitio esté desplegado, las visitas nuevas empezarán a registrarse acá.</div>';
    trafficDailyChart.innerHTML = '';
    trafficPagesChart.innerHTML = '';
    leadMixChart.innerHTML = renderRowsChartHTML([
      { label: 'Consignación', value: state.leads.consignments.length },
      { label: 'Búsquedas', value: state.leads.scouting.length },
      { label: 'Financiación', value: state.leads.financing.length },
      { label: 'Seguros', value: state.leads.insurance.length },
      { label: 'Peritaje', value: state.leads.peritaje.length },
      { label: 'Sugerencias', value: state.leads.feedback.length },
    ], 'Sin mix comercial todavía.');
    return;
  }

  if (state.analyticsStatus === 'error') {
    if (trafficMeta) trafficMeta.textContent = 'No se pudo leer la analítica web desde el panel.';
    trafficSummary.innerHTML = `<div class="admin-chart-empty">${escape(state.analyticsError || 'No pudimos consultar la tabla de analítica web.')}</div>`;
    trafficDailyChart.innerHTML = '';
    trafficPagesChart.innerHTML = '';
    leadMixChart.innerHTML = renderRowsChartHTML([
      { label: 'Consignación', value: state.leads.consignments.length },
      { label: 'Búsquedas', value: state.leads.scouting.length },
      { label: 'Financiación', value: state.leads.financing.length },
      { label: 'Seguros', value: state.leads.insurance.length },
      { label: 'Peritaje', value: state.leads.peritaje.length },
      { label: 'Sugerencias', value: state.leads.feedback.length },
    ], 'Sin mix comercial todavía.');
    return;
  }

  const rows = Array.isArray(state.analyticsViews) ? state.analyticsViews : [];
  const dayKeys = rangeDayKeys(14);
  const countsByDay = Object.fromEntries(dayKeys.map((key) => [key, 0]));
  const countsByPage = {};
  rows.forEach((row) => {
    const key = String(row.created_at || '').slice(0, 10);
    if (countsByDay[key] != null) countsByDay[key] += 1;
    const page = row.page_key || 'other';
    countsByPage[page] = (countsByPage[page] || 0) + 1;
  });

  const dailyItems = dayKeys.map((key) => ({ label: formatShortDate(key), value: countsByDay[key] || 0 }));
  const total14 = dailyItems.reduce((acc, item) => acc + item.value, 0);
  const today = dailyItems[dailyItems.length - 1]?.value || 0;
  const avg = total14 ? Math.round((total14 / dailyItems.length) * 10) / 10 : 0;
  const vehicleViews = countsByPage.vehicle || 0;
  const pageItems = Object.entries(countsByPage)
    .map(([key, value]) => ({ label: analyticsPageLabel(key), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  if (trafficMeta) {
    trafficMeta.textContent = total14
      ? `${total14} visitas registradas en los últimos 14 días.`
      : 'La analítica ya está habilitada. Todavía no hay visitas registradas en la ventana de 14 días.';
  }

  trafficSummary.innerHTML = [
    ['Visitas 14 días', total14],
    ['Hoy', today],
    ['Promedio diario', avg],
    ['Fichas de vehículo', vehicleViews],
  ].map(([label, value]) => `<div class="admin-summary-item"><strong>${value}</strong><span>${label}</span></div>`).join('');

  trafficDailyChart.innerHTML = renderBarsChartHTML(dailyItems, 'La analítica ya está activa. Cuando ingresen visitas nuevas, este gráfico se va a poblar automáticamente.');
  trafficPagesChart.innerHTML = renderRowsChartHTML(pageItems, 'Todavía no hay visitas registradas por página.');

  const leadMixItems = [
    { label: 'Consignación', value: state.leads.consignments.length },
    { label: 'Búsquedas', value: state.leads.scouting.length },
    { label: 'Financiación', value: state.leads.financing.length },
    { label: 'Seguros', value: state.leads.insurance.length },
    { label: 'Peritaje', value: state.leads.peritaje.length },
    { label: 'Sugerencias', value: state.leads.feedback.length },
  ];
  leadMixChart.innerHTML = renderRowsChartHTML(leadMixItems, 'Sin mix comercial todavía.');
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
    $('overviewMeta').textContent = `${state.vehicles.length} vehículos · ${allLeadRows().length} leads · ${state.rateProfiles.length} líneas comerciales.`;
  }

  if ($('overviewActionsToday')) {
    const all = allLeadRows();
    const stale = (state.vehicleAlerts || []).filter((item) => item.is_stale).length;
    const withoutAssignee = all.filter((item) => !normalizeEmail(item.assigned_to_email || '')).length;
    const withFollowUp = all.filter((item) => item.follow_up_at).length;
    const won = all.filter((item) => normalizeLeadStage(item.crm_stage) === 'won').length;
    const lost = all.filter((item) => normalizeLeadStage(item.crm_stage) === 'lost').length;
    const notes = [
      `<strong>${withoutAssignee}</strong> lead${withoutAssignee === 1 ? '' : 's'} sin asignar.`,
      `<strong>${withFollowUp}</strong> seguimiento${withFollowUp === 1 ? '' : 's'} con fecha cargada.`,
      `<strong>${stale}</strong> vehículo${stale === 1 ? '' : 's'} pide revisión por falta de movimiento.`,
      `Pipeline cerrado: <strong>${won}</strong> ganado${won === 1 ? '' : 's'} y <strong>${lost}</strong> perdido${lost === 1 ? '' : 's'}.`,
    ];
    $('overviewActionsToday').innerHTML = notes.map((item) => `<div class="admin-summary-item"><span>${item}</span></div>`).join('');
  }

  renderVehicleAlertsLists();
  renderMetricsDashboard();
}

function renderMetricsDashboard() {
  const all = allLeadRows();
  const assigned = all.filter((item) => normalizeEmail(item.assigned_to_email || '')).length;
  const followUps = all.filter((item) => item.follow_up_at).length;
  const stale = (state.vehicleAlerts || []).filter((item) => item.is_stale).length;
  const total14 = (Array.isArray(state.analyticsViews) ? state.analyticsViews : []).filter((row) => String(row.created_at || '').slice(0, 10) >= rangeDayKeys(14)[0]).length;

  const metricsMeta = $('metricsMeta');
  if (metricsMeta) {
    metricsMeta.textContent = `${all.length} leads · ${state.vehicles.length} vehículos · ${total14} visitas en 14 días.`;
  }

  const metricsAreas = $('metricsAreas');
  if (metricsAreas) {
    const cards = [
      ['Stock publicado', state.vehicles.length],
      ['Leads totales', all.length],
      ['Leads asignados', assigned],
      ['Seguimientos cargados', followUps],
      ['Financiaciones', state.leads.financing.length],
      ['Seguros', state.leads.insurance.length],
      ['Peritajes', state.leads.peritaje.length],
      ['Alertas de stock', stale],
    ];
    metricsAreas.innerHTML = cards.map(([label, value]) => `<div class="admin-summary-item"><strong>${value}</strong><span>${label}</span></div>`).join('');
  }

  const metricsFunnel = $('metricsFunnel');
  if (metricsFunnel) {
    const stages = leadStageCounts();
    const funnel = [
      ['Lead', stages.lead || 0],
      ['Oportunidad', stages.opportunity || 0],
      ['Propuesta', stages.proposal || 0],
      ['Negociación', stages.negotiation || 0],
      ['Ganado', stages.won || 0],
      ['Perdido', stages.lost || 0],
    ];
    metricsFunnel.innerHTML = funnel.map(([label, value]) => `<div class="admin-summary-item"><strong>${value}</strong><span>${label}</span></div>`).join('');
  }

  renderTrafficCharts();
}

function renderVehicleAlertsLists() {
  const wrappers = [
    ['vehicleAlertsMeta', 'vehicleAlertsList'],
    ['vehicleAlertsMetaMetrics', 'vehicleAlertsListMetrics'],
  ];
  wrappers.forEach(([metaId, listId]) => {
    const list = $(listId);
    const meta = $(metaId);
    if (!list) return;
    if (state.vehicleAlertsMissing) {
      if (meta) meta.textContent = 'Falta ejecutar el SQL de monitoreo.';
      list.innerHTML = '<div class="admin-summary-item"><span>Ejecutá <strong>admin/SQL_CRM_STOCK_ALERTAS.sql</strong> para habilitar el monitoreo automático de stock.</span></div>';
      return;
    }
    const rows = (state.vehicleAlerts || []).slice(0, 8);
    if (meta) meta.textContent = `${rows.filter((item) => item.is_stale).length} unidad${rows.filter((item) => item.is_stale).length === 1 ? '' : 'es'} en alerta.`;
    list.innerHTML = rows.length
      ? rows.map((item) => {
          const status = item.is_stale ? 'En revisión' : 'Dentro del plazo';
          const updatedLabel = item.updated_at ? formatDateTime(item.updated_at) : 'Sin actualización';
          return `<div class="admin-summary-item admin-summary-item--alert"><strong>${escape(item.title || item.brand || 'Vehículo')}</strong><span>${escape(status)} · Último movimiento: ${escape(updatedLabel)} · Umbral: ${escape(String(item.stock_alert_days || 30))} días.</span></div>`;
        }).join('')
      : '<div class="admin-summary-item"><span>No hay alertas activas por falta de movimiento.</span></div>';
  });
}


function formatDateTime(value) {
  return formatAdminDateTime(value);
}

function formatShortDate(value) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' }).format(date);
}

function formatNumberWithDots(value) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseFormattedNumber(value) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  return digits ? Number(digits) : null;
}

function setupPriceInputFormatting() {
  const input = $('price');
  if (!input || input.dataset.priceFormattingReady === 'true') return;
  input.dataset.priceFormattingReady = 'true';

  const applyFormat = () => {
    input.value = formatNumberWithDots(input.value);
  };

  input.addEventListener('input', applyFormat);
  input.addEventListener('blur', applyFormat);
  input.addEventListener('paste', () => requestAnimationFrame(applyFormat));
  applyFormat();
}

function isPlateSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('column') && message.includes('plate');
}

function warnPlateCompatibility() {
  showMsg('La tabla vehicles no tiene la columna patente. Se guardará sin ese campo hasta que actualices el esquema.', false);
}

function fillForm(vehicle) {
  if (!vehicle) return;
  if ($('id')) $('id').value = vehicle.id || '';
  if ($('title')) $('title').value = vehicle.title || '';
  if ($('brand')) $('brand').value = vehicle.brand || '';
  if ($('model')) $('model').value = vehicle.model || '';
  if ($('year')) $('year').value = vehicle.year ?? '';
  if ($('plate')) $('plate').value = vehicle.plate || '';
  if ($('km')) $('km').value = vehicle.km ?? '';
  if ($('price')) $('price').value = formatNumberWithDots(vehicle.price ?? '');
  if ($('currency')) $('currency').value = vehicle.currency || 'ARS';
  if ($('category')) $('category').value = vehicle.category || 'auto';
  if ($('status')) $('status').value = vehicle.status || 'available';
  if ($('featured')) $('featured').value = String(!!vehicle.featured);
  if ($('description')) $('description').value = vehicle.description || '';
  if ($('engine')) $('engine').value = vehicle.engine || '';
  if ($('transmission')) $('transmission').value = vehicle.transmission || '';
  if ($('drivetrain')) $('drivetrain').value = vehicle.drivetrain || '';
  if ($('color')) $('color').value = vehicle.color || '';
  if ($('doors')) $('doors').value = vehicle.doors ?? '';
  if ($('fuel_type')) $('fuel_type').value = vehicle.fuel_type || '';
  if ($('vehicle_condition')) $('vehicle_condition').value = vehicle.vehicle_condition || '';
  if ($('featured_equipment')) $('featured_equipment').value = window.RGShared.arrayFromUnknown(vehicle.featured_equipment).join('\n');
  if ($('is_recent')) $('is_recent').value = String(!!vehicle.is_recent);
  if ($('outlet')) $('outlet').value = String(!!vehicle.outlet);
  if ($('insurance_available')) $('insurance_available').value = String(!!vehicle.insurance_available);
  if ($('financing_enabled')) $('financing_enabled').value = String(!!vehicle.financing_enabled);
  if ($('private_financing_enabled')) $('private_financing_enabled').value = String(!!vehicle.private_financing_enabled);
  if ($('finance_max_months')) $('finance_max_months').value = vehicle.finance_max_months ?? '';
  if ($('min_down_payment')) $('min_down_payment').value = vehicle.min_down_payment ?? '';
  if ($('finance_entities')) $('finance_entities').value = window.RGShared.arrayFromUnknown(vehicle.finance_entities).join(', ');
  if ($('finance_note')) $('finance_note').value = vehicle.finance_note || '';
  if ($('stock_alert_days')) $('stock_alert_days').value = vehicle.stock_alert_days ?? '';
  if ($('photos')) $('photos').value = '';
  state.selectedVehiclePhoto = '';
  renderPhotoList(vehicle);
  renderPostSaveActions(vehicle, false);
  if ($('vehicleFormTitle')) $('vehicleFormTitle').textContent = 'Editar vehículo';
  if ($('maintenanceDate')) $('maintenanceDate').value = new Date().toISOString().slice(0, 10);
  loadVehicleMaintenance(vehicle.id).catch((error) => console.warn('No se pudo cargar mantenimiento:', error.message || error));
}

function clearForm() {
  [
    'id','title','brand','model','year','plate','km','price','description','engine','transmission','drivetrain','color','doors','fuel_type','vehicle_condition','featured_equipment','finance_max_months','min_down_payment','finance_entities','finance_note','stock_alert_days','maintenanceTitle','maintenanceKm','maintenanceCost','maintenanceNextDue','maintenanceNotes'
  ].forEach((id) => { if ($(id)) $(id).value = ''; });
  if ($('currency')) $('currency').value = 'ARS';
  if ($('category')) $('category').value = 'auto';
  if ($('status')) $('status').value = 'available';
  if ($('featured')) $('featured').value = 'false';
  if ($('is_recent')) $('is_recent').value = 'false';
  if ($('outlet')) $('outlet').value = 'false';
  if ($('insurance_available')) $('insurance_available').value = 'false';
  if ($('financing_enabled')) $('financing_enabled').value = 'false';
  if ($('private_financing_enabled')) $('private_financing_enabled').value = 'false';
  if ($('photos')) $('photos').value = '';
  state.selectedVehiclePhoto = '';
  if ($('photoList')) $('photoList').innerHTML = '<div class="empty-inline">Las fotos cargadas aparecerán acá.</div>';
  if ($('postSaveActions')) $('postSaveActions').hidden = true;
  if ($('vehicleMaintenanceList')) $('vehicleMaintenanceList').innerHTML = '<div class="empty-state compact-empty"><strong>Sin vehículo seleccionado.</strong><span>Primero guardá o editá una unidad existente.</span></div>';
  if ($('vehicleMaintenanceMeta')) $('vehicleMaintenanceMeta').textContent = 'Guardá el vehículo primero para habilitar historial, ficha imprimible y monitoreo.';
  const plateField = $('plate');
  if (plateField) plateField.disabled = !supportsPlate;
  if ($('vehicleFormTitle')) $('vehicleFormTitle').textContent = 'Publicar vehículo';
}

function renderSelectedFilesPreview(files) {
  const wrap = $('photoList');
  if (!wrap) return;
  const vehicleId = currentVehicleId();
  const currentVehicle = vehicleId ? (state.vehicles.find((item) => String(item.id) === String(vehicleId)) || lastSavedVehicle || { id: vehicleId, images: [] }) : null;

  if (!files?.length) {
    if (currentVehicle) return renderPhotoList(currentVehicle);
    wrap.innerHTML = '<div class="empty-inline">Las fotos cargadas aparecerán acá.</div>';
    return;
  }

  const tags = `
    <div class="selected-files-preview">
      <strong>Listas para subir:</strong>
      ${Array.from(files).map((file) => `<span class="inline-tag">${escape(file.name)}</span>`).join('')}
    </div>
  `;

  if (currentVehicle) {
    renderPhotoList(currentVehicle);
    wrap.innerHTML = tags + wrap.innerHTML;
    return;
  }

  wrap.innerHTML = tags;
}

function updateSelectedPhotoActions(vehicle = null) {
  const images = Array.isArray(vehicle?.images) ? vehicle.images : [];
  const selected = state.selectedVehiclePhoto || '';
  const index = images.findIndex((item) => item === selected);
  const moveLeft = $('photoMoveLeft');
  const moveRight = $('photoMoveRight');
  const del = $('photoDeleteSelected');
  if (moveLeft) moveLeft.disabled = index <= 0;
  if (moveRight) moveRight.disabled = index === -1 || index >= images.length - 1;
  if (del) del.disabled = index === -1;
}

function renderPhotoList(vehicle) {
  const wrap = $('photoList');
  if (!wrap) return;
  const images = Array.isArray(vehicle?.images) ? vehicle.images : [];
  if (!images.length) {
    state.selectedVehiclePhoto = '';
    wrap.innerHTML = '<div class="empty-inline">Sin fotos cargadas.</div>';
    updateSelectedPhotoActions(vehicle);
    return;
  }
  if (!images.includes(state.selectedVehiclePhoto)) state.selectedVehiclePhoto = images[0] || '';

  wrap.innerHTML = images.map((url, index) => {
    const selected = url === state.selectedVehiclePhoto;
    return `
      <div class="photo-item ${selected ? 'is-selected' : ''}" data-photo-select="${escape(url)}" tabindex="0" role="button" aria-pressed="${selected ? 'true' : 'false'}">
        <img src="${url}" alt="Foto ${index + 1} del vehículo" loading="lazy" />
        <div class="photo-item__footer">
          <span>${selected ? 'Seleccionada' : `Foto ${index + 1}`}</span>
          <button class="btn btn-danger" type="button" data-delphoto="${vehicle.id}" data-url="${url}">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');
  updateSelectedPhotoActions(vehicle);
}

async function movePhoto(vehicleId, url, direction = 'right') {
  const { data, error } = await sb.from('vehicles').select('images').eq('id', vehicleId).single();
  if (error) return showMsg(error.message, false);
  const images = Array.isArray(data?.images) ? [...data.images] : [];
  const index = images.findIndex((item) => item === url);
  if (index === -1) return;
  const target = direction === 'left' ? index - 1 : index + 1;
  if (target < 0 || target >= images.length) return;
  const temp = images[target];
  images[target] = images[index];
  images[index] = temp;
  const { error: updateError } = await sb.from('vehicles').update({ images }).eq('id', vehicleId);
  if (updateError) return showMsg(updateError.message, false);
  state.selectedVehiclePhoto = url;
  showMsg('Orden de fotos actualizado.', true);
  renderPhotoList({ id: vehicleId, images });
  await loadRows();
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

  if (state.selectedVehiclePhoto === url) state.selectedVehiclePhoto = nextImages[0] || '';
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
    price: parseFormattedNumber($('price').value),
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
    stock_alert_days: $('stock_alert_days')?.value ? Number($('stock_alert_days').value) : null,
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
    fillForm(lastSavedVehicle);
    await loadRows();
    await loadVehicleAlerts();
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
  if (state.access?.canChangePassword === false) return alert('Tu perfil no tiene permiso para cambiar la contraseña desde este panel.');
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
  setupPriceInputFormatting();
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
  $('saveMaintenance')?.addEventListener('click', saveVehicleMaintenanceEntry);
  $('downloadMaintenanceSheet')?.addEventListener('click', async () => {
    try {
      const vehicle = currentVehicleId() ? await getVehicleById(currentVehicleId()) : null;
      if (!vehicle) return alert('Seleccioná un vehículo primero.');
      const bucket = vehicleMaintenanceBucket(vehicle.id);
      const items = bucket.loaded ? bucket.items : await loadVehicleMaintenance(vehicle.id, { force: false });
      await downloadVehicleMaintenanceSheet(vehicle, items || []);
    } catch (error) {
      alert(error.message || 'No se pudo generar la ficha de mantenimiento.');
    }
  });
  $('photoMoveLeft')?.addEventListener('click', async () => {
    const vehicleId = currentVehicleId();
    if (!vehicleId || !state.selectedVehiclePhoto) return;
    await movePhoto(vehicleId, state.selectedVehiclePhoto, 'left');
  });
  $('photoMoveRight')?.addEventListener('click', async () => {
    const vehicleId = currentVehicleId();
    if (!vehicleId || !state.selectedVehiclePhoto) return;
    await movePhoto(vehicleId, state.selectedVehiclePhoto, 'right');
  });
  $('photoDeleteSelected')?.addEventListener('click', async () => {
    const vehicleId = currentVehicleId();
    if (!vehicleId || !state.selectedVehiclePhoto) return;
    await deletePhoto(vehicleId, state.selectedVehiclePhoto);
  });
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
    const leadDeleteButton = event.target.closest('[data-lead-delete]');
    const leadDownloadButton = event.target.closest('[data-lead-download]');
    const leadToggleButton = event.target.closest('[data-lead-toggle]');
    const photoSelectButton = event.target.closest('[data-photo-select]');

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


    if (photoSelectButton) {
      state.selectedVehiclePhoto = photoSelectButton.getAttribute('data-photo-select') || '';
      const vehicle = currentVehicleId() ? await getVehicleById(currentVehicleId()) : { images: [] };
      renderPhotoList(vehicle);
      return;
    }

    if (rateSaveButton) {
      try {
        await saveRateProfile(rateSaveButton.getAttribute('data-rate-save'));
        alert('Tasa actualizada correctamente.');
      } catch (error) {
        alert(error.message || 'No se pudo guardar la tasa.');
      }
      return;
    }

    if (leadToggleButton) {
      try {
        await toggleLead(leadToggleButton.dataset.leadToggle, leadToggleButton.dataset.id);
      } catch (error) {
        alert(error.message || 'No se pudo abrir el lead.');
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

    if (leadDeleteButton) {
      try {
        await deleteLead(leadDeleteButton.dataset.leadDelete, leadDeleteButton.dataset.id);
        alert('Lead eliminado correctamente.');
      } catch (error) {
        alert(error.message || 'No se pudo eliminar el lead.');
      }
      return;
    }

    if (leadDownloadButton) {
      const button = leadDownloadButton;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Generando…';
      try {
        await downloadLeadSheet(leadDownloadButton.dataset.leadDownload, leadDownloadButton.dataset.id);
      } catch (error) {
        alert(error.message || 'No se pudo generar la ficha del lead.');
      } finally {
        button.disabled = false;
        button.textContent = original;
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
    if (data?.session) {
      const access = resolveAccessProfile(data.user || data.session);
      window.location.href = `./admin.html#${encodeURIComponent(access.landingView || 'overview')}`;
    }
  });
}

async function initAdmin() {
  if (!$('adminViewTitle')) return;
  const session = await requireSession();
  if (!session) return;
  state.session = session;
  state.access = resolveAccessProfile(session);
  applyAccessControl();
  bindEvents();
  clearForm();
  setupPriceInputFormatting();
  if ($('leadSearch')) {
    $('leadSearch').value = '';
    $('leadSearch').setAttribute('autocomplete', 'off');
  }
  state.leadSearch = '';
  const hash = (window.location.hash || '').replace('#', '').trim();
  if (hash) setView(hash);
  else setView(firstAllowedView());

  if ($('maintenanceDate')) $('maintenanceDate').value = new Date().toISOString().slice(0, 10);
  const tasks = [loadRows(), loadLeads(), loadAssignees()];
  if (hasViewAccess('overview') || hasViewAccess('financing') || hasViewAccess('metrics') || hasViewAccess('settings')) {
    tasks.push(loadRates(), loadVehicleAlerts(), loadAnalyticsViews());
  }
  const results = await Promise.allSettled(tasks);
  const firstError = results.find((item) => item.status === 'rejected');
  if (firstError) {
    console.error(firstError.reason);
    showMsg(firstError.reason?.message || 'Algunas secciones del panel no se pudieron cargar por completo.', false);
  }
  renderVehicleMaintenance();
}

document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  initAdmin().catch((error) => {
    console.error(error);
    alert(error.message || 'No se pudo iniciar el panel.');
  });
});
