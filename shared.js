(function () {
  const CATEGORY_LABELS = {
    auto: 'Auto',
    camioneta: 'Camioneta',
    suv: 'SUV',
    camion: 'Camión',
    moto: 'Moto',
    utilitario: 'Utilitario',
    otro: 'Otro',
  };

  function formatPrice(value, currency = 'ARS') {
    if (value == null || value === '') return '-';
    try {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(Number(value));
    } catch {
      return `${currency === 'USD' ? 'US$' : '$'} ${Number(value).toLocaleString('es-AR')}`;
    }
  }

  function formatKm(value) {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toLocaleString('es-AR')} km` : '-';
  }

  function formatPercent(value, digits = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return `${num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
  }

  function statusLabel(status) {
    if (status === 'available') return 'Disponible';
    if (status === 'incoming') return 'Próximo a ingresar';
    if (status === 'reserved') return 'Reservado';
    if (status === 'sold') return 'Vendido';
    if (status === 'hidden') return 'Oculto';
    return status || '';
  }

  function statusClass(status) {
    if (status === 'available') return 'is-available';
    if (status === 'incoming') return 'is-incoming';
    if (status === 'reserved') return 'is-reserved';
    if (status === 'sold') return 'is-sold';
    if (status === 'hidden') return 'is-hidden';
    return '';
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category || '-';
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function waLink(vehicle) {
    const lines = [
      'Hola! Me interesa este vehículo:',
      vehicle.title || '-',
      `Marca / Modelo: ${vehicle.brand || '-'} ${vehicle.model || ''}`.trim(),
      `Año: ${vehicle.year ?? '-'} | Km: ${formatKm(vehicle.km)}`,
      `Precio: ${formatPrice(vehicle.price, vehicle.currency)}`,
      '¿Sigue disponible?',
    ];
    return `https://wa.me/${window.RG.WHATSAPP}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  function siteRoot() {
    const { pathname, origin } = window.location;
    const clean = pathname.replace(/\/admin\/[^/]+$/i, '/').replace(/\/[^/]*$/i, '/');
    return `${origin}${clean}`;
  }

  function vehicleUrl(id) {
    return `${siteRoot()}vehicle.html?id=${encodeURIComponent(id)}`;
  }

  function financingUrl(vehicle = null, mode = 'agency') {
    const url = new URL(`${siteRoot()}financiacion.html`);
    url.searchParams.set('mode', mode);
    if (vehicle?.id) url.searchParams.set('vehicle_id', vehicle.id);
    if (vehicle?.title) url.searchParams.set('vehicle_title', vehicle.title);
    if (vehicle?.price != null && vehicle?.price !== '') url.searchParams.set('vehicle_price', String(vehicle.price));
    if (vehicle?.brand) url.searchParams.set('brand', vehicle.brand);
    if (vehicle?.model) url.searchParams.set('model', vehicle.model);
    if (vehicle?.year) url.searchParams.set('year', String(vehicle.year));
    return url.toString();
  }

  function insuranceUrl(vehicle = null) {
    const url = new URL(`${siteRoot()}seguros.html`);
    if (vehicle?.id) url.searchParams.set('vehicle_id', vehicle.id);
    if (vehicle?.title) url.searchParams.set('vehicle_title', vehicle.title);
    if (vehicle?.brand) url.searchParams.set('brand', vehicle.brand);
    if (vehicle?.model) url.searchParams.set('model', vehicle.model);
    if (vehicle?.year) url.searchParams.set('year', String(vehicle.year));
    return url.toString();
  }

  function peritajeUrl(vehicle = null) {
    const url = new URL(`${siteRoot()}peritaje.html`);
    if (vehicle?.id) url.searchParams.set('vehicle_id', vehicle.id);
    if (vehicle?.title) url.searchParams.set('vehicle_title', vehicle.title);
    if (vehicle?.brand) url.searchParams.set('brand', vehicle.brand);
    if (vehicle?.model) url.searchParams.set('model', vehicle.model);
    if (vehicle?.year) url.searchParams.set('year', String(vehicle.year));
    if (vehicle?.plate) url.searchParams.set('plate', vehicle.plate);
    if (vehicle?.km != null && vehicle?.km !== '') url.searchParams.set('km', String(vehicle.km));
    return url.toString();
  }

  function textOrDash(value) {
    return value == null || value === '' ? '-' : value;
  }

  function firstImage(vehicle) {
    return Array.isArray(vehicle?.images) && vehicle.images.length ? vehicle.images[0] : '';
  }

  async function loadImageAsDataUrl(url) {
    if (!url) return null;
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error('No se pudo cargar la imagen.');
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function normalizePlate(value) {
    return String(value || '').toUpperCase().replace(/\s+/g, '').trim();
  }

  async function fetchVehicleById(id) {
    const sb = window.supabase.createClient(window.RG.SUPABASE_URL, window.RG.SUPABASE_ANON_KEY);
    const { data, error } = await sb
      .from('vehicles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  function arrayFromUnknown(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }


  function populateSelect(select, options, { placeholder = 'Seleccioná una opción', allowBlank = true, current = '' } = {}) {
    if (!select) return;
    const html = [];
    if (allowBlank) html.push(`<option value="">${escapeHTML(placeholder)}</option>`);
    for (const item of options || []) {
      const value = typeof item === 'string' ? item : String(item?.value ?? '');
      const label = typeof item === 'string' ? item : String(item?.label ?? item?.value ?? '');
      html.push(`<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`);
    }
    select.innerHTML = html.join('');
    if (current && Array.from(select.options).some((option) => option.value === current)) select.value = current;
  }

  function populateYearRange(select, { start = 1990, end = new Date().getFullYear() + 1, placeholder = 'Seleccioná una opción', allowBlank = true, descending = true, current = '' } = {}) {
    if (!select) return;
    const years = [];
    if (descending) {
      for (let year = end; year >= start; year -= 1) years.push(String(year));
    } else {
      for (let year = start; year <= end; year += 1) years.push(String(year));
    }
    populateSelect(select, years, { placeholder, allowBlank, current });
  }

  function populateCitySelect(select, current = '') {
    populateSelect(select, window.RGCatalog?.cities || [], { placeholder: 'Seleccioná una ciudad', allowBlank: true, current });
  }

  function populateBrandSelect(select, category = '', current = '') {
    const options = window.RGCatalog?.brandsFor?.(category) || [];
    populateSelect(select, [...options, 'Otro'], { placeholder: 'Seleccioná una marca', allowBlank: true, current });
  }

  function populateModelSelect(select, brand = '', category = '', current = '') {
    const options = brand ? (window.RGCatalog?.modelsFor?.(brand, category) || []) : [];
    populateSelect(select, [...options, 'Otro'], { placeholder: brand ? 'Seleccioná un modelo' : 'Primero elegí la marca', allowBlank: true, current });
    select.disabled = !brand;
  }

  function kmRangeOptions(step = 20000, maxKm = 240000) {
    const items = [];
    for (let value = step; value <= maxKm; value += step) {
      items.push({ value: String(value), label: `Hasta ${Number(value).toLocaleString('es-AR')} km` });
    }
    items.push({ value: '999999', label: `Más de ${Number(maxKm).toLocaleString('es-AR')} km` });
    return items;
  }

  function feedbackSourcePage() {
    const path = (window.location.pathname || '/').split('/').pop() || 'index.html';
    const map = {
      'index.html': 'home',
      'vehicle.html': 'vehicle',
      'financiacion.html': 'financing',
      'seguros.html': 'insurance',
      'scouting.html': 'search',
      'consignacion.html': 'consignment',
    };
    return map[path] || path.replace(/\.html$/i, '') || 'site';
  }

  function getFeedbackClient() {
    if (!window.supabase?.createClient || !window.RG?.SUPABASE_URL || !window.RG?.SUPABASE_ANON_KEY) {
      throw new Error('Supabase no está configurado para guardar sugerencias.');
    }
    if (!window.__rgFeedbackClient) {
      window.__rgFeedbackClient = window.supabase.createClient(window.RG.SUPABASE_URL, window.RG.SUPABASE_ANON_KEY);
    }
    return window.__rgFeedbackClient;
  }

  function closeFeedbackModal() {
    const modal = document.querySelector('[data-feedback-modal]');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('feedback-modal-open');
  }

  function openFeedbackModal() {
    const modal = document.querySelector('[data-feedback-modal]');
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('feedback-modal-open');
    const textarea = modal.querySelector('textarea[name="message"]');
    if (textarea) window.setTimeout(() => textarea.focus(), 30);
  }

  async function submitFeedbackForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const messageEl = form.querySelector('[data-feedback-form-message]');
    const submitButton = form.querySelector('[type="submit"]');
    const message = form.message.value.trim();
    const visitorName = form.visitor_name.value.trim();
    const visitorContact = form.visitor_contact.value.trim();

    if (message.length < 8) {
      if (messageEl) {
        messageEl.textContent = 'Contanos un poco más para que la sugerencia nos sirva de verdad.';
        messageEl.classList.add('is-error');
      }
      return;
    }

    try {
      submitButton?.setAttribute('disabled', 'disabled');
      if (messageEl) {
        messageEl.textContent = 'Enviando sugerencia…';
        messageEl.classList.remove('is-error', 'is-success');
      }

      const sb = getFeedbackClient();
      const payload = {
        message,
        visitor_name: visitorName || null,
        visitor_contact: visitorContact || null,
        source_page: feedbackSourcePage(),
        source_title: document.title || null,
        source_url: window.location.href,
        user_agent: navigator.userAgent || null,
      };

      const { error } = await sb.from('feedback_submissions').insert(payload);
      if (error) throw error;

      form.reset();
      if (messageEl) {
        messageEl.textContent = 'Gracias. Tu sugerencia se envió correctamente.';
        messageEl.classList.remove('is-error');
        messageEl.classList.add('is-success');
      }
      window.setTimeout(() => {
        closeFeedbackModal();
      }, 900);
    } catch (error) {
      console.error(error);
      const text = String(error?.message || '').toLowerCase();
      const fallback = text.includes('relation') || text.includes('does not exist')
        ? 'Falta activar la tabla de sugerencias en Supabase. Corré el SQL de feedback y probá de nuevo.'
        : (error?.message || 'No se pudo enviar la sugerencia en este momento.');
      if (messageEl) {
        messageEl.textContent = fallback;
        messageEl.classList.remove('is-success');
        messageEl.classList.add('is-error');
      }
    } finally {
      submitButton?.removeAttribute('disabled');
    }
  }

  function buildFeedbackModal() {
    if (document.querySelector('[data-feedback-modal]')) return;

    const modal = document.createElement('div');
    modal.className = 'feedback-modal';
    modal.setAttribute('data-feedback-modal', 'true');
    modal.hidden = true;
    modal.innerHTML = `
      <div class="feedback-modal__backdrop" data-feedback-close="true"></div>
      <div class="feedback-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="feedbackModalTitle">
        <button type="button" class="feedback-modal__close" aria-label="Cerrar" data-feedback-close="true">×</button>
        <div class="feedback-modal__eyebrow">Ayudanos a mejorar</div>
        <h3 id="feedbackModalTitle">Dejanos tu sugerencia</h3>
        <p class="feedback-modal__copy">Tu mensaje se guarda directamente en la plataforma para que el equipo de RG Cars lo revise.</p>
        <form class="feedback-form" data-feedback-form="true">
          <label class="field">
            <span>¿Qué mejorarías o qué te gustaría sumar?</span>
            <textarea class="textarea" name="message" rows="6" maxlength="1200" placeholder="Escribí tu sugerencia acá" required></textarea>
          </label>
          <div class="feedback-form__grid">
            <label class="field">
              <span>Nombre (opcional)</span>
              <input class="input" type="text" name="visitor_name" maxlength="120" placeholder="Cómo te llamás" />
            </label>
            <label class="field">
              <span>Email o teléfono (opcional)</span>
              <input class="input" type="text" name="visitor_contact" maxlength="160" placeholder="Por si querés que te contactemos" />
            </label>
          </div>
          <p class="feedback-form__hint">No abrimos WhatsApp: la sugerencia queda guardada directamente en el sistema.</p>
          <p class="form-message feedback-form__message" data-feedback-form-message="true" aria-live="polite"></p>
          <div class="feedback-form__actions">
            <button type="button" class="btn btn-ghost" data-feedback-close="true">Cancelar</button>
            <button type="submit" class="btn btn-primary">Enviar sugerencia</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('[data-feedback-form]')?.addEventListener('submit', submitFeedbackForm);
    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-feedback-close]')) closeFeedbackModal();
    });
  }



  const LEAD_STATUS_META = {
    consignment: {
      new: { label: 'Nueva', className: 'is-hidden', subject: 'Recibimos tu solicitud de consignación', message: 'Recibimos tu solicitud de consignación y ya la estamos revisando. En breve nuestro equipo se va a poner en contacto para avanzar.' },
      review: { label: 'En revisión', className: 'is-reserved', subject: 'Tu solicitud de consignación está en revisión', message: 'Estamos revisando los datos de tu vehículo. En breve nos vamos a poner en contacto para seguir con la evaluación comercial.' },
      approved: { label: 'Aprobada para avanzar', className: 'is-available', subject: 'Tu solicitud de consignación fue aprobada para avanzar', message: 'Tu solicitud fue aprobada para avanzar. Pronto nos vamos a poner en contacto para coordinar los próximos pasos.' },
      rejected: { label: 'No podemos avanzar por ahora', className: 'is-sold', subject: 'Actualización sobre tu solicitud de consignación', message: 'Gracias por escribirnos. Por el momento no podemos avanzar con esta solicitud, pero quedamos a disposición para evaluar otras alternativas.' },
    },
    scouting: {
      active: { label: 'Activa', className: 'is-available', subject: 'Tu búsqueda personalizada quedó activa', message: 'Tu búsqueda personalizada ya quedó activa en RG Cars TDF. Te vamos a avisar cuando ingrese una unidad que encaje con lo que buscás.' },
      paused: { label: 'Pausada', className: 'is-reserved', subject: 'Tu búsqueda personalizada quedó pausada', message: 'Tu búsqueda personalizada quedó pausada por el momento. Si querés reactivarla, escribinos y la retomamos.' },
      closed: { label: 'Cerrada', className: 'is-sold', subject: 'Tu búsqueda personalizada fue cerrada', message: 'La búsqueda quedó cerrada. Si querés volver a activarla con nuevos criterios, escribinos y la armamos de nuevo.' },
    },
    financing: {
      new: { label: 'Nueva', className: 'is-hidden', subject: 'Recibimos tu solicitud de financiación', message: 'Recibimos tu solicitud de financiación y ya quedó en curso dentro de RG Cars TDF. En breve vamos a revisar el caso y ponernos en contacto.' },
      contacted: { label: 'Contactado', className: 'is-reserved', subject: 'Estamos avanzando con tu solicitud de financiación', message: 'Tu solicitud de financiación está en curso y ya estamos avanzando con la revisión comercial. En breve seguimos por el canal de contacto elegido.' },
      prequalified: { label: 'Preaprobado comercial', className: 'is-available', subject: 'Tu solicitud de financiación está preaprobada comercialmente', message: 'Tu caso quedó preaprobado a nivel comercial. El siguiente paso es avanzar con la validación y documentación correspondiente.' },
      sent_to_entity: { label: 'Enviado a entidad', className: 'is-reserved', subject: 'Tu solicitud fue enviada a la entidad', message: 'Ya enviamos tu solicitud a la entidad correspondiente para continuar la evaluación. Te mantenemos al tanto de cualquier novedad.' },
      closed: { label: 'Cerrado', className: 'is-available', subject: 'Tu solicitud de financiación fue cerrada', message: 'La gestión de financiación fue cerrada. Si necesitás una nueva simulación o querés revisar otra alternativa, escribinos.' },
      rejected: { label: 'No podemos avanzar por ahora', className: 'is-sold', subject: 'Actualización sobre tu solicitud de financiación', message: 'Gracias por tu consulta. Por el momento no podemos avanzar con esta solicitud, pero podemos revisar otras alternativas si querés.' },
    },
    insurance: {
      new: { label: 'Nueva', className: 'is-hidden', subject: 'Recibimos tu solicitud de seguro', message: 'Recibimos tu solicitud de seguro y ya quedó en curso dentro de RG Cars TDF. En breve vamos a revisar el caso y a contactarte.' },
      contacted: { label: 'Contactado', className: 'is-reserved', subject: 'Estamos avanzando con tu solicitud de seguro', message: 'Tu solicitud de seguro está en curso y ya estamos avanzando con la revisión comercial. En breve seguimos por el canal de contacto elegido.' },
      quoted: { label: 'Cotizado', className: 'is-available', subject: 'Tu solicitud de seguro ya fue cotizada', message: 'Tu solicitud ya fue cotizada y en breve te vamos a compartir la propuesta comercial para avanzar.' },
      closed: { label: 'Cerrado', className: 'is-available', subject: 'Tu solicitud de seguro fue cerrada', message: 'La gestión de seguro fue cerrada. Si querés retomar la consulta, escribinos y la reactivamos.' },
      rejected: { label: 'No podemos avanzar por ahora', className: 'is-sold', subject: 'Actualización sobre tu solicitud de seguro', message: 'Gracias por tu consulta. Por el momento no podemos avanzar con esta solicitud, pero seguimos a disposición para revisar otras opciones.' },
    },
    peritaje: {
      new: { label: 'Nueva', className: 'is-hidden', subject: 'Recibimos tu solicitud de peritaje', message: 'Recibimos tu solicitud de peritaje y ya quedó en curso dentro de RG Cars TDF. En breve vamos a confirmar fecha, horario y próximos pasos.' },
      contacted: { label: 'Contactado', className: 'is-reserved', subject: 'Estamos coordinando tu peritaje', message: 'Ya estamos coordinando tu peritaje y en breve seguimos por el canal de contacto elegido para confirmar agenda y detalles.' },
      scheduled: { label: 'Agendado', className: 'is-available', subject: 'Tu peritaje quedó agendado', message: 'Tu peritaje ya quedó agendado. Guardá la ficha y cualquier dato adicional te lo vamos a enviar por el canal elegido.' },
      completed: { label: 'Realizado', className: 'is-available', subject: 'Tu peritaje fue realizado', message: 'El peritaje ya fue realizado. Si necesitás una nueva revisión o ampliar información, escribinos.' },
      rejected: { label: 'No podemos avanzar por ahora', className: 'is-sold', subject: 'Actualización sobre tu solicitud de peritaje', message: 'Gracias por escribirnos. Por el momento no podemos avanzar con esta solicitud de peritaje, pero quedamos a disposición para evaluar otra fecha u opción.' },
    },
    feedback: {
      new: { label: 'Nueva', className: 'is-hidden' },
      reviewed: { label: 'Revisada', className: 'is-reserved' },
      planned: { label: 'Planificada', className: 'is-reserved' },
      done: { label: 'Resuelta', className: 'is-available' },
      archived: { label: 'Archivada', className: 'is-sold' },
    },
  };

  function leadStatusMeta(type, status) {
    return LEAD_STATUS_META?.[type]?.[status] || null;
  }

  function leadStatusLabel(type, status) {
    return leadStatusMeta(type, status)?.label || status || '-';
  }

  function leadStatusClass(type, status) {
    return leadStatusMeta(type, status)?.className || 'is-hidden';
  }

  function leadStatusOptions(type, current) {
    const set = LEAD_STATUS_META[type] || {};
    return Object.entries(set).map(([value, meta]) => `<option value="${escapeHTML(value)}" ${value === current ? 'selected' : ''}>${escapeHTML(meta.label)}</option>`).join('');
  }

  function notificationChannel(contactPreference, email, phone) {
    if (contactPreference === 'email' && email) return 'email';
    if (contactPreference === 'phone' && phone) return 'teléfono';
    return phone ? 'WhatsApp' : (email ? 'email' : 'canal elegido');
  }

  function buildLeadNotification(type, status, lead, { event = 'status_update' } = {}) {
    const meta = leadStatusMeta(type, status) || {};
    const customerName = lead?.customer_name || lead?.owner_name || 'Hola';
    const channel = notificationChannel(lead?.contact_preference, lead?.email || lead?.owner_email, lead?.phone || lead?.owner_phone);
    const subject = meta.subject || 'Actualización sobre tu solicitud en RG Cars TDF';
    const intro = `${customerName},`;
    const main = meta.message || 'Ya recibimos tu caso y lo estamos procesando.';
    const closing = `Vamos a seguir por ${channel}. Si necesitás algo antes, también podés escribirnos por WhatsApp.`;
    const footer = 'RG Cars TDF\nSarmiento 2760 · Río Grande, Tierra del Fuego';
    return {
      to: lead?.email || lead?.owner_email || '',
      subject,
      text: [intro, '', main, '', closing, '', footer].join('\n'),
      event,
      type,
      status,
      customer_name: customerName,
    };
  }

  async function sendLeadNotification(type, status, lead, options = {}) {
    const to = lead?.email || lead?.owner_email || '';
    const endpoint = String(window.RG?.NOTIFY_WEBHOOK_URL || '').trim();
    if (!to) {
      return { sent: false, reason: 'missing_email' };
    }
    if (!endpoint) {
      return { sent: false, reason: 'handled_by_database_webhook' };
    }
    if (/\/functions\/v1\/rgcars-notify(?:$|[?#])/i.test(endpoint)) {
      return { sent: false, reason: 'use_supabase_database_webhook' };
    }
    const payload = buildLeadNotification(type, status, lead, options);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || 'No se pudo enviar la notificación por email.');
    }
    return { sent: true };
  }


  const HEADER_PRIMARY_LINKS = [
    { key: 'stock', href: './index.html#explorar-stock', label: 'Comprar un auto' },
    { key: 'consignacion', href: './consignacion.html', label: 'Vendé tu auto' },
    { key: 'scouting', href: './scouting.html', label: 'Búsqueda personalizada' },
    { key: 'financiacion', href: './financiacion.html', label: 'Financiación' },
  ];

  const HEADER_SERVICE_LINKS = [
    { key: 'seguros', href: './seguros.html', label: 'Seguros' },
    { key: 'peritaje', href: './peritaje.html', label: 'Peritaje' },
  ];

  const HEADER_MOBILE_LINKS = [
    ...HEADER_PRIMARY_LINKS,
    ...HEADER_SERVICE_LINKS,
    { key: 'contacto', href: './index.html#contacto', label: 'Contacto' },
  ];

  function currentHeaderServiceKey() {
    const file = String((window.location.pathname || '').split('/').pop() || 'index.html').toLowerCase();
    const map = {
      '': 'stock',
      'index.html': 'stock',
      'vehicle.html': 'stock',
      'consignacion.html': 'consignacion',
      'scouting.html': 'scouting',
      'financiacion.html': 'financiacion',
      'seguros.html': 'seguros',
      'peritaje.html': 'peritaje',
    };
    return map[file] || '';
  }

  function buildHeaderLink(item, currentKey, extraClass = '') {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.label;
    if (extraClass) link.className = extraClass;
    if (item.key === currentKey) link.setAttribute('aria-current', 'page');
    return link;
  }

  function closeHeaderServicesMenus(except = null) {
    document.querySelectorAll('.services-menu.is-open').forEach((menu) => {
      if (except && menu === except) return;
      const button = menu.querySelector('.services-toggle');
      const panel = menu.querySelector('.services-dropdown');
      menu.classList.remove('is-open');
      if (button) button.setAttribute('aria-expanded', 'false');
      if (panel) panel.hidden = true;
    });
  }

  function closeHeaderMobileMenus(except = null) {
    document.querySelectorAll('.site-header .mobile-menu-shell.is-open').forEach((shell) => {
      if (except && shell === except) return;
      const header = shell.closest('.site-header');
      const toggle = header?.querySelector('.header-mobile-toggle');
      shell.classList.remove('is-open');
      shell.hidden = true;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('has-mobile-menu-open');
    });
  }

  function initUnifiedPublicHeader() {
    const headers = document.querySelectorAll('body.public-theme .site-header');
    if (!headers.length) return;

    const currentKey = currentHeaderServiceKey();
    const isServicesCurrent = HEADER_SERVICE_LINKS.some((item) => item.key === currentKey);

    headers.forEach((header, index) => {
      if (header.dataset.rgHeaderBuilt === 'true') return;
      header.dataset.rgHeaderBuilt = 'true';

      const inner = header.querySelector('.header-inner');
      const brand = inner?.querySelector('.brand');
      if (!inner || !brand) return;

      const previousNav = inner.querySelector('.header-nav');
      const previousActions = inner.querySelector('.header-actions');
      if (previousNav) previousNav.remove();
      if (previousActions) previousActions.remove();
      inner.querySelector('.header-mobile-actions')?.remove();
      header.querySelector('.mobile-menu-shell')?.remove();

      const desktopNav = document.createElement('nav');
      desktopNav.className = 'header-nav header-nav--desktop';
      desktopNav.setAttribute('aria-label', 'Navegación principal');
      HEADER_PRIMARY_LINKS.forEach((item) => {
        desktopNav.appendChild(buildHeaderLink(item, currentKey));
      });

      const servicesWrapper = document.createElement('div');
      servicesWrapper.className = 'services-menu';
      if (isServicesCurrent) servicesWrapper.classList.add('has-current');

      const servicesButton = document.createElement('button');
      servicesButton.type = 'button';
      servicesButton.className = 'services-toggle';
      servicesButton.setAttribute('aria-expanded', 'false');
      servicesButton.setAttribute('aria-haspopup', 'true');
      servicesButton.setAttribute('aria-controls', `servicesMenuPanel-${index + 1}`);
      if (isServicesCurrent) servicesButton.setAttribute('aria-current', 'page');
      servicesButton.innerHTML = '<span class="services-toggle__label">Servicios</span><span class="services-toggle__caret" aria-hidden="true">▼</span>';

      const servicesDropdown = document.createElement('div');
      servicesDropdown.className = 'services-dropdown';
      servicesDropdown.id = `servicesMenuPanel-${index + 1}`;
      servicesDropdown.hidden = true;
      HEADER_SERVICE_LINKS.forEach((item) => {
        const link = buildHeaderLink(item, currentKey);
        link.addEventListener('click', () => closeHeaderServicesMenus());
        servicesDropdown.appendChild(link);
      });

      servicesButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = servicesWrapper.classList.contains('is-open');
        closeHeaderServicesMenus(isOpen ? null : servicesWrapper);
        servicesWrapper.classList.toggle('is-open', !isOpen);
        servicesButton.setAttribute('aria-expanded', String(!isOpen));
        servicesDropdown.hidden = isOpen;
      });
      servicesDropdown.addEventListener('click', (event) => event.stopPropagation());

      servicesWrapper.append(servicesButton, servicesDropdown);
      desktopNav.appendChild(servicesWrapper);

      const desktopActions = document.createElement('nav');
      desktopActions.className = 'header-actions header-actions--desktop';
      desktopActions.setAttribute('aria-label', 'Acciones principales');
      desktopActions.innerHTML = `
        <a class="btn btn-primary header-wa-link" href="https://wa.me/5492964588267" target="_blank" rel="noreferrer">WhatsApp</a>
      `;

      const mobileActions = document.createElement('div');
      mobileActions.className = 'header-mobile-actions';
      mobileActions.innerHTML = `
        <button type="button" class="header-mobile-toggle" aria-expanded="false" aria-controls="mobileSiteMenu-${index + 1}" aria-label="Abrir menú">
          <span></span><span></span><span></span>
        </button>
      `;

      const mobileShell = document.createElement('div');
      mobileShell.className = 'mobile-menu-shell';
      mobileShell.id = `mobileSiteMenu-${index + 1}`;
      mobileShell.hidden = true;
      mobileShell.innerHTML = `
        <button type="button" class="mobile-menu-backdrop" aria-label="Cerrar menú"></button>
        <div class="mobile-menu-panel" role="dialog" aria-modal="true" aria-label="Menú principal">
          <div class="mobile-menu-head">
            <span>Menú</span>
            <button type="button" class="mobile-menu-close" aria-label="Cerrar menú">×</button>
          </div>
          <nav class="mobile-menu-nav" aria-label="Navegación móvil"></nav>
        </div>
      `;

      const mobileNav = mobileShell.querySelector('.mobile-menu-nav');
      HEADER_MOBILE_LINKS.forEach((item) => {
        const link = buildHeaderLink(item, currentKey, 'mobile-menu-link');
        link.addEventListener('click', () => closeHeaderMobileMenus());
        mobileNav.appendChild(link);
      });

      const mobileToggle = mobileActions.querySelector('.header-mobile-toggle');
      const openMobileMenu = () => {
        closeHeaderMobileMenus(mobileShell);
        closeHeaderServicesMenus();
        mobileShell.hidden = false;
        mobileShell.classList.add('is-open');
        mobileToggle.setAttribute('aria-expanded', 'true');
        document.body.classList.add('has-mobile-menu-open');
      };
      const closeMobileMenu = () => closeHeaderMobileMenus();

      mobileToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = mobileShell.classList.contains('is-open');
        if (isOpen) {
          closeMobileMenu();
        } else {
          openMobileMenu();
        }
      });
      mobileShell.querySelector('.mobile-menu-backdrop')?.addEventListener('click', closeMobileMenu);
      mobileShell.querySelector('.mobile-menu-close')?.addEventListener('click', closeMobileMenu);
      mobileShell.querySelector('.mobile-menu-panel')?.addEventListener('click', (event) => event.stopPropagation());

      inner.append(desktopNav, desktopActions, mobileActions);
      header.appendChild(mobileShell);

      if (!document.querySelector('.whatsapp-fab')) {
        const fab = document.createElement('a');
        const phone = String(window.RG?.WHATSAPP || '5492964588267').replace(/\D+/g, '');
        fab.className = 'whatsapp-fab';
        fab.href = `https://wa.me/${phone}`;
        fab.target = '_blank';
        fab.rel = 'noreferrer';
        fab.setAttribute('aria-label', 'Abrir WhatsApp');
        fab.innerHTML = '<img class="whatsapp-fab__icon" src="./imagenes/whatsapp.png" alt="" aria-hidden="true">';
        document.body.appendChild(fab);
      }
    });

    if (document.body.dataset.headerServicesBound === 'true') return;
    document.body.dataset.headerServicesBound = 'true';

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.services-menu')) closeHeaderServicesMenus();
      if (!event.target.closest('.header-mobile-actions') && !event.target.closest('.mobile-menu-panel')) {
        closeHeaderMobileMenus();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeHeaderServicesMenus();
        closeHeaderMobileMenus();
      }
    });
  }

  function injectFeedbackButton() {
    if (!document.body?.classList.contains('public-theme')) return;
    if (document.querySelector('.feedback-floating-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feedback-floating-button';
    button.textContent = 'Ayudanos a mejorar 🙌';
    button.addEventListener('click', openFeedbackModal);
    document.body.appendChild(button);
    buildFeedbackModal();
  }



  function configuredSiteUrl() {
    const configured = String(window.RG?.SITE_URL || '').trim();
    if (configured) {
      try {
        const url = new URL(configured);
        return url.toString().replace(/\/$/, '');
      } catch {
        // ignore invalid SITE_URL and fallback to current origin
      }
    }
    return window.location.origin.replace(/\/$/, '');
  }

  function currentCanonicalUrl() {
    const url = new URL(window.location.href);
    url.hash = '';
    const file = String((url.pathname || '').split('/').pop() || 'index.html').toLowerCase();
    if (file === 'vehicle.html') {
      const id = url.searchParams.get('id');
      url.search = id ? `?id=${encodeURIComponent(id)}` : '';
    } else {
      url.search = '';
    }
    const siteUrl = configuredSiteUrl();
    return `${siteUrl}${url.pathname}${url.search}`;
  }

  function upsertMetaAttribute(attr, key, content) {
    if (!content) return;
    let element = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attr, key);
      document.head.appendChild(element);
    }
    element.setAttribute('content', content);
  }

  function injectSeoTags() {
    if (!document.body?.classList.contains('public-theme')) return;
    const title = document.title || 'RG Cars TDF';
    const description = document.head.querySelector('meta[name="description"]')?.getAttribute('content') || 'RG Cars TDF';
    const canonicalHref = currentCanonicalUrl();

    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', canonicalHref);

    upsertMetaAttribute('property', 'og:type', 'website');
    upsertMetaAttribute('property', 'og:site_name', 'RG Cars TDF');
    upsertMetaAttribute('property', 'og:title', title);
    upsertMetaAttribute('property', 'og:description', description);
    upsertMetaAttribute('property', 'og:url', canonicalHref);
    upsertMetaAttribute('name', 'twitter:card', 'summary_large_image');
    upsertMetaAttribute('name', 'twitter:title', title);
    upsertMetaAttribute('name', 'twitter:description', description);
    upsertMetaAttribute('name', 'theme-color', '#0f1720');
  }

  function injectFooterBackofficeLink() {
    if (!document.body?.classList.contains('public-theme')) return;
    document.querySelectorAll('.site-footer').forEach((footer) => {
      footer.innerHTML = `
        <div class="container footer-main">
          <div class="footer-brand-block">
            <img src="./imagenes/isotipo-white.png" alt="RG Cars TDF" class="footer-brand-logo" />
            <p>Compra, venta y servicios para tu vehículo con atención clara, directa y personalizada.</p>
          </div>

          <div class="footer-columns">
            <div class="footer-column">
              <h3>Comprar</h3>
              <a href="./index.html#explorar-stock">Explorar stock</a>
              <a href="./index.html#stock">Catálogo</a>
            </div>
            <div class="footer-column">
              <h3>Servicios</h3>
              <a href="./consignacion.html">Consignación</a>
              <a href="./scouting.html">Búsqueda personalizada</a>
              <a href="./financiacion.html">Financiación</a>
              <a href="./seguros.html">Seguros</a>
              <a href="./peritaje.html">Peritaje</a>
            </div>
            <div class="footer-column">
              <h3>Contacto</h3>
              <a href="https://wa.me/5492964588267" target="_blank" rel="noreferrer">WhatsApp</a>
              <a href="https://taplink.cc/rgcarstdf?from=qr" target="_blank" rel="noreferrer">Redes</a>
              <span class="footer-address">Sarmiento 2760 · Río Grande, TDF</span>
            </div>
          </div>
        </div>

        <div class="container footer-bottom">
          <p>Copyright © 2026 RG Cars TDF. Todos los derechos reservados.</p>
          <div class="footer-bottom-links">
            <a href="./index.html">Inicio</a>
            <a href="./consignacion.html">Vendé tu auto</a>
            <a href="./scouting.html">Búsqueda personalizada</a>
          </div>
        </div>
      `;
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFeedbackModal();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectSeoTags();
      initUnifiedPublicHeader();
      injectFooterBackofficeLink();
      injectFeedbackButton();
    });
  } else {
    injectSeoTags();
    initUnifiedPublicHeader();
    injectFooterBackofficeLink();
    injectFeedbackButton();
  }

  window.RGShared = {
    formatPrice,
    formatKm,
    formatPercent,
    statusLabel,
    statusClass,
    categoryLabel,
    escapeHTML,
    waLink,
    vehicleUrl,
    financingUrl,
    insuranceUrl,
    peritajeUrl,
    textOrDash,
    firstImage,
    loadImageAsDataUrl,
    normalizePlate,
    fetchVehicleById,
    arrayFromUnknown,
    populateSelect,
    populateYearRange,
    populateCitySelect,
    populateBrandSelect,
    populateModelSelect,
    kmRangeOptions,
    leadStatusMeta,
    leadStatusLabel,
    leadStatusClass,
    leadStatusOptions,
    buildLeadNotification,
    sendLeadNotification,
  };
})();
