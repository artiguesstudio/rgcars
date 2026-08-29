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

  const LEAD_SUCCESS_EMAIL_MESSAGE = 'Recibimos tu consulta. Un asesor de RG Cars TDF se va a contactar con vos a la brevedad. También te enviamos una confirmación por email.';
  const LEAD_SUCCESS_SAVED_ONLY_MESSAGE = 'Recibimos tu consulta. Un asesor de RG Cars TDF se va a contactar con vos a la brevedad. No pudimos enviar la confirmación por email, pero tu solicitud quedó registrada.';
  const LEAD_SUCCESS_MESSAGE = LEAD_SUCCESS_EMAIL_MESSAGE;
  const LEAD_ERROR_MESSAGE = 'No pudimos enviar la consulta. Intentá nuevamente o escribinos por WhatsApp.';

  function hasVehiclePrice(value) {
    const number = Number(value);
    return value != null && value !== '' && Number.isFinite(number) && number > 0;
  }

  function formatPrice(value, currency = 'ARS') {
    if (!hasVehiclePrice(value)) return 'Consultar';
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

  function minimumDownPayment(vehicle = {}) {
    const value = vehicle.minimum_down_payment ?? vehicle.entrega_minima ?? vehicle.min_down_payment ?? null;
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  function minimumDownPaymentLabel(vehicle = {}) {
    const value = minimumDownPayment(vehicle);
    return value ? `Entrega mínima desde ${formatPrice(value, vehicle.currency || 'ARS')}` : '';
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

  function normalizeStatus(status) {
    const normalized = String(status || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

    if (normalized.includes('proximo') || normalized.includes('incoming')) return 'incoming';
    if (normalized.includes('reserv')) return 'reserved';
    if (normalized.includes('vend') || normalized.includes('sold')) return 'sold';
    if (normalized.includes('oculto') || normalized.includes('hidden')) return 'hidden';
    return 'available';
  }

  function statusLabel(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'incoming') return 'Próximo ingreso';
    if (normalized === 'reserved') return 'Reservado';
    if (normalized === 'sold') return 'Vendido';
    if (normalized === 'hidden') return 'Oculto';
    return 'Disponible';
  }

  function statusClass(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'incoming') return 'is-incoming';
    if (normalized === 'reserved') return 'is-reserved';
    if (normalized === 'sold') return 'is-sold';
    if (normalized === 'hidden') return 'is-hidden';
    return 'is-available';
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
    if (hasVehiclePrice(vehicle?.price)) url.searchParams.set('vehicle_price', String(vehicle.price));
    if (vehicle?.brand) url.searchParams.set('brand', vehicle.brand);
    if (vehicle?.model) url.searchParams.set('model', vehicle.model);
    if (vehicle?.year) url.searchParams.set('year', String(vehicle.year));
    return url.toString();
  }

  function availabilityValue(value, falseValues = ['no', 'false', '0', 'n']) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;
    return !falseValues.includes(normalized);
  }

  function availabilityFromKeys(vehicle, keys, falseValues) {
    if (!vehicle) return true;
    const values = keys
      .map((key) => availabilityValue(vehicle[key], falseValues))
      .filter((value) => value !== null);
    if (!values.length) return true;
    return values.some(Boolean);
  }

  function vehicleFinancingAvailable(vehicle = null) {
    return availabilityFromKeys(vehicle, [
      'financing_available',
      'has_financing',
      'financingAvailable',
      'financing',
      'finance_available',
      'financing_enabled',
      'private_financing_enabled',
    ]);
  }

  function supermovilidadSectionUrl() {
    const url = new URL(`${siteRoot()}index.html`);
    url.hash = 'supermovilidad';
    return url.toString();
  }

  function vehicleInsuranceAvailable(vehicle = null) {
    return availabilityFromKeys(vehicle, [
      'insurance_available',
      'has_insurance',
      'insuranceAvailable',
      'insurance',
      'seguro_available',
      'insurance_enabled',
    ]);
  }

  function vehicleWebAvailable(vehicle = null) {
    return availabilityFromKeys(vehicle, [
      'is_visible',
      'visible',
      'show_on_web',
      'web_available',
      'web',
      'web_enabled',
    ], ['no', 'false', '0', 'n', 'oculto']);
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

  function normalizeLeadText(value) {
    return String(value || '').trim();
  }

  function leadPhoneDigits(value) {
    return normalizeLeadText(value).replace(/\D+/g, '');
  }

  function isValidLeadName(value) {
    return normalizeLeadText(value).length >= 2;
  }

  function isValidLeadPhone(value) {
    const phone = normalizeLeadText(value);
    if (!phone) return false;
    if (!/^[\d\s()+-]+$/.test(phone)) return false;
    return leadPhoneDigits(phone).length >= 6;
  }

  function isValidLeadEmail(value) {
    const email = normalizeLeadText(value).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
  }

  async function submitServiceLead(payload) {
    const supabaseUrl = String(window.RG?.SUPABASE_URL || '').trim().replace(/\/+$/g, '');
    const anonKey = String(window.RG?.SUPABASE_ANON_KEY || '').trim();

    if (!supabaseUrl || !anonKey) {
      throw new Error(LEAD_ERROR_MESSAGE);
    }

    const measurementContext = window.RGMeasurement?.leadSubmissionContext?.(payload || {}) || null;
    const requestPayload = measurementContext
      ? {
          ...(payload || {}),
          eventId: measurementContext.eventId,
          submissionKey: measurementContext.submissionKey,
          attribution: measurementContext.attribution,
        }
      : (payload || {});

    const response = await fetch(`${supabaseUrl}/functions/v1/create-lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(requestPayload),
    });

    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok || !result?.ok) {
      throw new Error(normalizeLeadText(result?.error) || LEAD_ERROR_MESSAGE);
    }

    if (result?.saved) {
      window.RGMeasurement?.trackLeadSaved?.(result, payload || {}, measurementContext || {});
    }
    return result;
  }

  function leadSubmissionSuccessMessage(result) {
    if (result?.saved && result?.emailSentToUser) return LEAD_SUCCESS_EMAIL_MESSAGE;
    if (result?.saved) return LEAD_SUCCESS_SAVED_ONLY_MESSAGE;
    return LEAD_ERROR_MESSAGE;
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

  function publicSupabaseClient() {
    if (!window.supabase?.createClient || !window.RG?.SUPABASE_URL || !window.RG?.SUPABASE_ANON_KEY) {
      throw new Error('Supabase no está configurado.');
    }
    if (!window.__rgPublicSupabaseClient) {
      window.__rgPublicSupabaseClient = window.supabase.createClient(
        window.RG.SUPABASE_URL,
        window.RG.SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
      );
    }
    return window.__rgPublicSupabaseClient;
  }

  async function fetchVehicleById(id) {
    const sb = publicSupabaseClient();
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
    return publicSupabaseClient();
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
        <div class="feedback-modal__eyebrow">Ayudanos a mejorar !!!</div>
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

  const JOB_APPLICATION_MAX_FILE_BYTES = 5 * 1024 * 1024;
  const JOB_APPLICATION_FILE_EXTENSIONS = ['pdf', 'doc', 'docx'];
  const RECRUITMENT_DIRECT_HASH = '#postulacion-vendedor';
  let recruitmentTrigger = null;
  let recruitmentPreviousHash = null;

  function recruitmentEndpoint() {
    return String(window.RG?.JOB_APPLICATION_ENDPOINT || './api/job-applications.php').trim();
  }

  function isRecruitmentDirectLink() {
    return String(window.location.hash || '').toLowerCase() === RECRUITMENT_DIRECT_HASH;
  }

  function updateRecruitmentUrl(open) {
    if (!window.history?.replaceState) return;
    const url = new URL(window.location.href);
    if (open) {
      if (url.hash !== RECRUITMENT_DIRECT_HASH) recruitmentPreviousHash = url.hash || '';
      url.hash = RECRUITMENT_DIRECT_HASH;
    } else if (url.hash.toLowerCase() === RECRUITMENT_DIRECT_HASH) {
      url.hash = recruitmentPreviousHash || '';
      recruitmentPreviousHash = null;
    }
    window.history.replaceState(window.history.state, '', url.toString());
  }

  function closeRecruitmentModal(restoreFocus = true, updateUrl = true) {
    const modal = document.querySelector('[data-recruitment-modal]');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('recruitment-modal-open');
    recruitmentTrigger?.setAttribute('aria-expanded', 'false');
    if (updateUrl) updateRecruitmentUrl(false);
    if (restoreFocus) recruitmentTrigger?.focus({ preventScroll: true });
  }

  function openRecruitmentModal(options = {}) {
    const modal = document.querySelector('[data-recruitment-modal]');
    if (!modal) return;
    closeFeedbackModal();
    modal.hidden = false;
    document.body.classList.add('recruitment-modal-open');
    recruitmentTrigger?.setAttribute('aria-expanded', 'true');
    if (options.updateUrl !== false) updateRecruitmentUrl(true);
    const firstField = modal.querySelector('input[name="full_name"]');
    if (firstField) window.setTimeout(() => firstField.focus(), 30);
  }

  function syncRecruitmentModalWithUrl() {
    if (isRecruitmentDirectLink()) openRecruitmentModal({ updateUrl: false });
    else closeRecruitmentModal(false, false);
  }

  function setRecruitmentMessage(form, message, state = '') {
    const messageEl = form.querySelector('[data-job-application-message]');
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.classList.remove('is-error', 'is-success');
    if (state) messageEl.classList.add(`is-${state}`);
  }

  function validateJobApplication(form, formData) {
    const fullName = String(formData.get('full_name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const phoneDigits = String(formData.get('phone') || '').replace(/\D+/g, '');
    const age = Number(formData.get('age'));
    const maritalStatus = String(formData.get('marital_status') || '');
    const childrenCountValue = String(formData.get('children_count') ?? '').trim();
    const childrenCount = Number(childrenCountValue);
    const salesExperienceYearsValue = String(formData.get('sales_experience_years') ?? '').trim();
    const salesExperienceYears = Number(salesExperienceYearsValue);
    const automotiveExperience = String(formData.get('automotive_sales_experience') || '');
    const experience = String(formData.get('experience') || '').trim();
    const license = String(formData.get('has_driving_license') || '');
    const cv = formData.get('cv');

    if (fullName.length < 3) return { field: 'full_name', message: 'Ingresá tu nombre y apellido.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) return { field: 'email', message: 'Ingresá un email válido.' };
    if (phoneDigits.length < 8) return { field: 'phone', message: 'Ingresá un teléfono o WhatsApp válido.' };
    if (!Number.isInteger(age) || age < 18 || age > 80) return { field: 'age', message: 'Ingresá una edad válida.' };
    if (!maritalStatus) return { field: 'marital_status', message: 'Seleccioná tu estado civil.' };
    if (childrenCountValue === '' || !Number.isInteger(childrenCount) || childrenCount < 0 || childrenCount > 20) return { field: 'children_count', message: 'Ingresá una cantidad de hijos válida.' };
    if (salesExperienceYearsValue === '' || !Number.isInteger(salesExperienceYears) || salesExperienceYears < 0 || salesExperienceYears > 40) return { field: 'sales_experience_years', message: 'Ingresá tus años de experiencia en ventas.' };
    if (!['yes', 'no'].includes(automotiveExperience)) return { field: 'automotive_sales_experience', message: 'Indicá si tenés experiencia en venta de vehículos.' };
    if (license !== 'yes') return { field: 'has_driving_license', message: 'Para esta búsqueda es obligatorio contar con carnet de conducir vigente.' };
    if (experience.length < 30) return { field: 'experience', message: 'Contanos un poco más sobre tu experiencia en ventas.' };
    if (!(cv instanceof File) || !cv.name || cv.size < 1) return { field: 'cv', message: 'Adjuntá tu CV para completar la postulación.' };
    if (cv.size > JOB_APPLICATION_MAX_FILE_BYTES) return { field: 'cv', message: 'El CV no puede superar los 5 MB.' };
    const extension = cv.name.split('.').pop()?.toLowerCase() || '';
    if (!JOB_APPLICATION_FILE_EXTENSIONS.includes(extension)) return { field: 'cv', message: 'Adjuntá el CV en formato PDF, DOC o DOCX.' };
    if (formData.get('privacy_consent') !== 'accepted') return { field: 'privacy_consent', message: 'Necesitamos tu autorización para tratar los datos de la postulación.' };
    return null;
  }

  async function submitJobApplication(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const formData = new FormData(form);
    const validation = validateJobApplication(form, formData);

    if (validation) {
      setRecruitmentMessage(form, validation.message, 'error');
      form.querySelector(`[name="${validation.field}"]`)?.focus();
      return;
    }

    const endpoint = recruitmentEndpoint();
    if (!endpoint) {
      setRecruitmentMessage(form, 'El formulario no está disponible en este momento. Escribinos por WhatsApp para postularte.', 'error');
      return;
    }

    formData.set('position', 'Vendedor/a con experiencia');
    formData.set('source_page', feedbackSourcePage());
    formData.set('source_url', window.location.href);

    try {
      submitButton?.setAttribute('disabled', 'disabled');
      if (submitButton) submitButton.textContent = 'Enviando postulación…';
      setRecruitmentMessage(form, 'Estamos cargando tu CV de forma segura…');

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        throw new Error(result?.error || 'No pudimos enviar la postulación. Intentá nuevamente.');
      }

      form.reset();
      const fileName = form.querySelector('[data-job-cv-name]');
      if (fileName) fileName.textContent = 'PDF, DOC o DOCX · máximo 5 MB';
      setRecruitmentMessage(form, '¡Postulación enviada! Recibimos tus datos y tu CV correctamente.', 'success');
      window.RGMeasurement?.track?.('generate_lead', {
        service_type: 'recruitment',
        position: 'sales',
        source_page: feedbackSourcePage(),
      });
    } catch (error) {
      console.error('job application submission failure', error);
      setRecruitmentMessage(form, error?.message || 'No pudimos enviar la postulación. Intentá nuevamente.', 'error');
    } finally {
      submitButton?.removeAttribute('disabled');
      if (submitButton) submitButton.textContent = 'Enviar postulación';
    }
  }

  function buildRecruitmentModal() {
    if (document.querySelector('[data-recruitment-modal]')) return;

    const modal = document.createElement('div');
    modal.id = 'recruitmentModal';
    modal.className = 'recruitment-modal';
    modal.setAttribute('data-recruitment-modal', 'true');
    modal.hidden = true;
    modal.innerHTML = `
      <div class="recruitment-modal__backdrop" data-recruitment-close="true"></div>
      <div class="recruitment-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="recruitmentModalTitle" aria-describedby="recruitmentModalDescription">
        <button type="button" class="recruitment-modal__close" aria-label="Cerrar formulario de postulación" data-recruitment-close="true">×</button>
        <aside class="recruitment-modal__media" aria-hidden="true">
          <img src="./imagenes/busqueda-vendedor-rg-cars.png" alt="" loading="lazy" decoding="async" fetchpriority="low" />
          <div class="recruitment-modal__media-overlay">
            <span>Sumate a RG Cars TDF</span>
            <strong>Buscamos vendedor/a</strong>
          </div>
        </aside>
        <section class="recruitment-modal__content">
          <div class="recruitment-modal__eyebrow">Búsqueda laboral abierta</div>
          <h2 id="recruitmentModalTitle">Queremos conocerte</h2>
          <p id="recruitmentModalDescription" class="recruitment-modal__copy">Si tenés experiencia en ventas y carnet de conducir vigente, completá el formulario y adjuntá tu CV.</p>

          <form class="job-application-form" data-job-application-form novalidate>
            <input class="job-application-form__website" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />

            <div class="job-application-form__grid">
              <label class="field job-application-form__wide">
                <span>Nombre y apellido</span>
                <input class="input" type="text" name="full_name" maxlength="120" autocomplete="name" placeholder="Tu nombre completo" required />
              </label>
              <label class="field">
                <span>Email</span>
                <input class="input" type="email" name="email" maxlength="160" autocomplete="email" inputmode="email" placeholder="tuemail@dominio.com" required />
              </label>
              <label class="field">
                <span>Teléfono / WhatsApp</span>
                <input class="input" type="tel" name="phone" maxlength="40" autocomplete="tel" inputmode="tel" placeholder="2964 000000" required />
              </label>
              <label class="field">
                <span>Edad</span>
                <input class="input" type="number" name="age" min="18" max="80" inputmode="numeric" placeholder="Ej. 28" required />
              </label>
              <label class="field">
                <span>Estado civil</span>
                <select class="select" name="marital_status" required>
                  <option value="">Seleccioná una opción</option>
                  <option value="single">Soltero/a</option>
                  <option value="married">Casado/a</option>
                  <option value="domestic_partnership">Unión convivencial</option>
                  <option value="divorced">Divorciado/a</option>
                  <option value="widowed">Viudo/a</option>
                  <option value="prefer_not_to_say">Prefiero no informarlo</option>
                </select>
              </label>
              <label class="field">
                <span>Hijos (¿cuántos?)</span>
                <input class="input" type="number" name="children_count" min="0" max="20" inputmode="numeric" placeholder="0" required />
              </label>
              <label class="field">
                <span>Años de experiencia en ventas</span>
                <input class="input" type="number" name="sales_experience_years" min="0" max="40" inputmode="numeric" placeholder="Ej. 4" required />
              </label>
              <label class="field">
                <span>Experiencia vendiendo vehículos</span>
                <select class="select" name="automotive_sales_experience" required>
                  <option value="">Seleccioná una opción</option>
                  <option value="yes">Sí</option>
                  <option value="no">No</option>
                </select>
              </label>
              <fieldset class="job-application-form__license">
                <legend>Carnet de conducir vigente <span>Obligatorio / excluyente</span></legend>
                <div class="job-application-form__radio-group">
                  <label><input type="radio" name="has_driving_license" value="yes" required /> Sí, tengo carnet vigente</label>
                  <label><input type="radio" name="has_driving_license" value="no" required /> No tengo</label>
                </div>
              </fieldset>
              <label class="field job-application-form__wide">
                <span>Contanos tu experiencia</span>
                <textarea class="textarea" name="experience" rows="5" minlength="30" maxlength="3000" placeholder="Experiencia en ventas, atención al cliente, logros y por qué te gustaría sumarte a RG Cars…" required></textarea>
              </label>
              <label class="field job-application-form__wide job-application-form__file">
                <span>Adjuntá tu CV <strong>Obligatorio</strong></span>
                <input class="input" type="file" name="cv" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
                <small data-job-cv-name>PDF, DOC o DOCX · máximo 5 MB</small>
              </label>
            </div>

            <label class="job-application-form__consent">
              <input type="checkbox" name="privacy_consent" value="accepted" required />
              <span>Acepto que RG Cars TDF utilice estos datos exclusivamente para evaluar mi postulación. <a href="./politica-de-privacidad.html" target="_blank" rel="noreferrer">Ver política de privacidad</a>.</span>
            </label>

            <p class="form-message job-application-form__message" data-job-application-message aria-live="polite"></p>
            <div class="job-application-form__actions">
              <button type="button" class="btn btn-ghost" data-recruitment-close="true">Cancelar</button>
              <button type="submit" class="btn btn-primary">Enviar postulación</button>
            </div>
          </form>
        </section>
      </div>
    `;
    document.body.appendChild(modal);

    const form = modal.querySelector('[data-job-application-form]');
    form?.addEventListener('submit', submitJobApplication);
    form?.querySelector('input[name="cv"]')?.addEventListener('change', (event) => {
      const file = event.currentTarget.files?.[0];
      const fileName = form.querySelector('[data-job-cv-name]');
      if (!fileName) return;
      fileName.textContent = file
        ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : 'PDF, DOC o DOCX · máximo 5 MB';
    });
    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-recruitment-close]')) closeRecruitmentModal();
    });
    modal.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), a[href]')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function injectRecruitmentButton() {
    if (!document.body?.classList.contains('public-theme')) return;
    if (document.querySelector('.recruitment-floating-button')) return;

    buildRecruitmentModal();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recruitment-floating-button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'recruitmentModal');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="recruitment-floating-button__badge">¡Sumate!</span><span>Buscamos vendedor/a</span>';
    button.addEventListener('click', openRecruitmentModal);
    document.body.appendChild(button);
    recruitmentTrigger = button;
    syncRecruitmentModalWithUrl();
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


  const LEAD_STAGE_META = {
    lead: { label: 'Lead', className: 'is-hidden' },
    opportunity: { label: 'Oportunidad', className: 'is-reserved' },
    proposal: { label: 'Propuesta', className: 'is-reserved' },
    negotiation: { label: 'Negociación', className: 'is-available' },
    won: { label: 'Ganado', className: 'is-available' },
    lost: { label: 'Perdido', className: 'is-sold' },
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

  function leadStageMeta(stage) {
    return LEAD_STAGE_META?.[stage] || LEAD_STAGE_META.lead;
  }

  function leadStageLabel(stage) {
    return leadStageMeta(stage)?.label || stage || 'Lead';
  }

  function leadStageClass(stage) {
    return leadStageMeta(stage)?.className || 'is-hidden';
  }

  function leadStageOptions(current = 'lead') {
    return Object.entries(LEAD_STAGE_META).map(([value, meta]) => `<option value="${escapeHTML(value)}" ${value === current ? 'selected' : ''}>${escapeHTML(meta.label)}</option>`).join('');
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
  ];

  const HEADER_SERVICE_LINKS = [
    { key: 'consignacion', href: './consignacion.html', label: 'Vendé tu auto' },
    { key: 'scouting', href: './scouting.html', label: 'Búsqueda personalizada' },
    { key: 'financiacion', href: './financiacion.html', label: 'Financiación' },
    { key: 'seguros', href: './seguros.html', label: 'Seguros del automotor' },
    { key: 'peritaje', href: './peritaje.html', label: 'Peritajes pre-compra' },
  ];

  const SOCIAL_ICON_ASSETS = {
    instagram: './imagenes/instagram.png',
    facebook: './imagenes/facebook.png',
    whatsapp: './imagenes/whatsapp-black.png',
  };

  const HEADER_SOCIAL_LINKS = [
    { key: 'instagram', href: String(window.RG?.INSTAGRAM_URL || '').trim(), label: 'Instagram', icon: SOCIAL_ICON_ASSETS.instagram },
    { key: 'facebook', href: String(window.RG?.FACEBOOK_URL || '').trim(), label: 'Facebook', icon: SOCIAL_ICON_ASSETS.facebook },
  ].filter((item) => item.href);
  const HEADER_CONTACT_WHATSAPP_URL = `https://wa.me/${String(window.RG?.WHATSAPP || '5492964588267').replace(/\D+/g, '')}`;

  const HEADER_MOBILE_LINKS = [
    ...HEADER_PRIMARY_LINKS,
    ...HEADER_SERVICE_LINKS,
    { key: 'contacto', href: HEADER_CONTACT_WHATSAPP_URL, label: 'Contacto', target: '_blank', rel: 'noopener noreferrer' },
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
    if (item.target) link.target = item.target;
    if (item.rel) link.rel = item.rel;
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

  function closeHeaderMobileMenus(except = null, restoreFocus = true) {
    document.querySelectorAll('.site-header .mobile-menu-shell.is-open').forEach((shell) => {
      if (except && shell === except) return;
      const header = shell.closest('.site-header');
      const toggle = header?.querySelector('.header-mobile-toggle');
      shell.classList.remove('is-open');
      shell.hidden = true;
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Abrir menú de servicios');
        if (restoreFocus) toggle.focus({ preventScroll: true });
      }
      document.body.classList.remove('has-mobile-menu-open');
    });
  }

  function isDesktopHeaderDropdownLayout() {
    return window.matchMedia('(min-width: 761px)').matches;
  }

  function positionDesktopHeaderMenu(shell, toggle) {
    if (!shell || !toggle || !isDesktopHeaderDropdownLayout()) return;
    const panel = shell.querySelector('.mobile-menu-panel');
    if (!panel) return;

    const viewportPadding = 16;
    const triggerGap = 12;
    const toggleRect = toggle.getBoundingClientRect();
    const panelWidth = Math.min(panel.offsetWidth || 296, Math.max(240, window.innerWidth - (viewportPadding * 2)));
    const preferredRight = Math.round(window.innerWidth - toggleRect.right);
    const maxRight = Math.max(viewportPadding, Math.round(window.innerWidth - panelWidth - viewportPadding));
    const right = Math.min(Math.max(preferredRight, viewportPadding), maxRight);
    const top = Math.max(viewportPadding, Math.round(toggleRect.bottom + triggerGap));
    const maxHeight = Math.max(220, Math.round(window.innerHeight - top - viewportPadding));

    shell.style.setProperty('--desktop-header-menu-top', `${top}px`);
    shell.style.setProperty('--desktop-header-menu-right', `${right}px`);
    shell.style.setProperty('--desktop-header-menu-max-height', `${maxHeight}px`);
  }

  function syncOpenHeaderMenusForViewport() {
    const openShells = document.querySelectorAll('.site-header .mobile-menu-shell.is-open');
    if (!openShells.length) {
      document.body.classList.remove('has-mobile-menu-open');
      return;
    }

    if (isDesktopHeaderDropdownLayout()) {
      document.body.classList.remove('has-mobile-menu-open');
      openShells.forEach((shell) => {
        const header = shell.closest('.site-header');
        const toggle = header?.querySelector('.header-mobile-toggle');
        positionDesktopHeaderMenu(shell, toggle);
      });
      return;
    }

    document.body.classList.add('has-mobile-menu-open');
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
      desktopActions.setAttribute('aria-label', 'Redes y acciones principales');
      desktopActions.innerHTML = HEADER_SOCIAL_LINKS.map((item) => `
        <a class="header-social-link" href="${item.href}" target="_blank" rel="noreferrer" aria-label="Abrir ${item.label}" title="${item.label}">
          <img class="header-social-link__icon" src="${item.icon}" alt="" aria-hidden="true" />
        </a>
      `).join('');

      const mobileActions = document.createElement('div');
      mobileActions.className = 'header-mobile-actions';
      mobileActions.innerHTML = `
        <button type="button" class="header-mobile-toggle" aria-expanded="false" aria-controls="mobileSiteMenu-${index + 1}" aria-label="Abrir menú de servicios">
          <span class="header-mobile-toggle__label">Servicios</span>
          <span class="header-mobile-toggle__icon" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>
      `;

      const mobileShell = document.createElement('div');
      mobileShell.className = 'mobile-menu-shell';
      mobileShell.id = `mobileSiteMenu-${index + 1}`;
      mobileShell.hidden = true;
      mobileShell.innerHTML = `
        <button type="button" class="mobile-menu-backdrop" aria-label="Cerrar menú"></button>
        <div class="mobile-menu-panel" role="dialog" aria-modal="true" aria-label="Servicios">
          <div class="mobile-menu-head">
            <span>Servicios</span>
            <button type="button" class="mobile-menu-close" aria-label="Cerrar menú">×</button>
          </div>
          <nav class="mobile-menu-nav" aria-label="Navegación móvil"></nav>
        </div>
      `;

      const mobileNav = mobileShell.querySelector('.mobile-menu-nav');
      HEADER_MOBILE_LINKS.forEach((item) => {
        const link = buildHeaderLink(item, currentKey, 'mobile-menu-link');
        link.addEventListener('click', () => closeHeaderMobileMenus(null, false));
        mobileNav.appendChild(link);
      });

      const mobileToggle = mobileActions.querySelector('.header-mobile-toggle');
      const openMobileMenu = () => {
        closeHeaderMobileMenus(mobileShell, false);
        closeHeaderServicesMenus();
        mobileShell.hidden = false;
        mobileShell.classList.add('is-open');
        if (isDesktopHeaderDropdownLayout()) {
          positionDesktopHeaderMenu(mobileShell, mobileToggle);
        } else {
          document.body.classList.add('has-mobile-menu-open');
        }
        mobileToggle.setAttribute('aria-expanded', 'true');
        mobileToggle.setAttribute('aria-label', 'Cerrar menú de servicios');
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

    let headerMenuViewportFrame = 0;
    window.addEventListener('resize', () => {
      if (headerMenuViewportFrame) return;
      headerMenuViewportFrame = window.requestAnimationFrame(() => {
        headerMenuViewportFrame = 0;
        syncOpenHeaderMenusForViewport();
      });
    });
  }

  function injectFeedbackButton() {
    if (!document.body?.classList.contains('public-theme')) return;
    if (document.querySelector('.feedback-floating-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feedback-floating-button';
    button.textContent = 'Ayudanos a mejorar !!! 🙌';
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

  function getStoredKey(storage, key) {
    try {
      let value = storage.getItem(key);
      if (!value) {
        value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        storage.setItem(key, value);
      }
      return value;
    } catch {
      return '';
    }
  }

  async function trackPageView() {
    if (window.RGMeasurement?.trackPageView) {
      return window.RGMeasurement.trackPageView();
    }
    return trackEvent('page_view', { page_key: currentPageKey(), page_path: window.location.pathname || '/' });
  }

  function safeAnalyticsPayload(value, depth = 0) {
    if (depth > 4 || value == null) return value == null ? null : undefined;
    if (typeof value === 'string') {
      const normalized = value.slice(0, 500);
      if (/\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/i.test(normalized) || /(?:\+?\d[\s().-]*){7,}/.test(normalized.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ''))) return '[redacted]';
      return normalized;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeAnalyticsPayload(item, depth + 1)).filter((item) => item !== undefined);
    if (typeof value === 'object') {
      const result = {};
      Object.entries(value).forEach(([key, item]) => {
        const normalizedKey = String(key || '').toLowerCase();
        const personName = ['name', 'full_name', 'first_name', 'last_name', 'customer_name', 'owner_name', 'visitor_name', 'contact_name'].includes(normalizedKey);
        if (personName || /(?:^|_)(?:email|phone|telephone|whatsapp|message|comment|notes?|cuil|dni|document|plate|address)(?:$|_)/i.test(normalizedKey)) return;
        const safe = safeAnalyticsPayload(item, depth + 1);
        if (safe !== undefined) result[key] = safe;
      });
      return result;
    }
    return undefined;
  }

  function trackEvent(eventName, payload = {}) {
    if (window.RGMeasurement?.track) {
      return window.RGMeasurement.track(eventName, payload);
    }
    if (!eventName) return;
    const eventPayload = safeAnalyticsPayload(payload && typeof payload === 'object' ? payload : {}) || {};

    try {
      window.dispatchEvent(new CustomEvent('rg:track', {
        detail: {
          event: eventName,
          payload: eventPayload,
        },
      }));
    } catch {}
  }

  function injectFooterBackofficeLink() {
    if (!document.body?.classList.contains('public-theme')) return;
    const address = String(window.RG?.AGENCY_ADDRESS || 'Sarmiento 2760 · Río Grande, Tierra del Fuego').trim();
    const instagramUrl = String(window.RG?.INSTAGRAM_URL || '').trim();
    const facebookUrl = String(window.RG?.FACEBOOK_URL || '').trim();
    const fiscalParts = [window.RG?.FISCAL_NAME, window.RG?.FISCAL_CUIT && `CUIT ${window.RG.FISCAL_CUIT}`, window.RG?.FISCAL_STATUS].filter(Boolean);
    document.querySelectorAll('.site-footer').forEach((footer) => {
      footer.innerHTML = `
        <div class="container footer-main">
          <div class="footer-brand-block">
            <img src="./imagenes/isotipo-white.png" alt="RG Cars TDF" class="footer-brand-logo" />
            <p>Compra, venta y servicios automotores con atención comercial clara, seguimiento real y foco en operaciones seguras.</p>
          </div>

          <div class="footer-columns">
            <div class="footer-column">
              <h3>Comprar</h3>
              <a href="./index.html#explorar-stock">Stock disponible</a>
              <a href="./financiacion.html">Financiación prendaria y propia</a>
            </div>
            <div class="footer-column">
              <h3>Servicios</h3>
              <a href="./consignacion.html">Vendé tu auto</a>
              <a href="./scouting.html">Búsqueda personalizada</a>
              <a href="./seguros.html">Seguros del automotor</a>
              <a href="./peritaje.html">Peritajes pre-compra</a>
              <a href="./peritaje.html#gestoria">Gestoría</a>
            </div>
            <div class="footer-column">
              <h3>Legal y ayuda</h3>
              <a href="./terminos-y-condiciones.html">Términos y condiciones</a>
              <a href="./politica-de-privacidad.html">Política de privacidad</a>
              <button type="button" class="footer-text-button" data-rg-open-consent>Preferencias de medición</button>
              <a href="./faq.html">FAQ</a>
              <a href="./sitemap.html">Sitemap</a>
              <a href="https://www.argentina.gob.ar/economia/industria-y-comercio/defensadelconsumidor" target="_blank" rel="noreferrer">Defensa del Consumidor</a>
            </div>
            <div class="footer-column">
              <h3>Contacto</h3>
              <a href="https://wa.me/${String(window.RG?.WHATSAPP || '5492964588267').replace(/\D+/g, '')}" target="_blank" rel="noreferrer">WhatsApp</a>
              ${instagramUrl ? `<a href="${instagramUrl}" target="_blank" rel="noreferrer">Instagram</a>` : ''}
              ${facebookUrl ? `<a href="${facebookUrl}" target="_blank" rel="noreferrer">Facebook</a>` : ''}
              <a href="mailto:${String(window.RG?.ADMIN_EMAIL || 'rgcarstdf@gmail.com').trim()}">${String(window.RG?.ADMIN_EMAIL || 'rgcarstdf@gmail.com').trim()}</a>
            </div>
          </div>
        </div>

        <div class="container footer-bottom footer-bottom--centered">
          <p class="footer-copyright">Copyright © 2026 RG Cars TDF. Todos los derechos reservados.</p>
          <p class="footer-address footer-address--bottom">${address}</p>
          ${fiscalParts.length ? `<p class="footer-fiscal">${fiscalParts.join(' · ')}</p>` : ''}
        </div>
      `;
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeFeedbackModal();
      closeRecruitmentModal();
    }
  });
  window.addEventListener('hashchange', syncRecruitmentModalWithUrl);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectSeoTags();
      initUnifiedPublicHeader();
      injectFooterBackofficeLink();
      injectFeedbackButton();
      injectRecruitmentButton();
      trackPageView();
    });
  } else {
    injectSeoTags();
    initUnifiedPublicHeader();
    injectFooterBackofficeLink();
    injectFeedbackButton();
    injectRecruitmentButton();
    trackPageView();
  }

  window.RGShared = {
    formatPrice,
    hasVehiclePrice,
    minimumDownPayment,
    minimumDownPaymentLabel,
    formatKm,
    formatPercent,
    normalizeStatus,
    statusLabel,
    statusClass,
    categoryLabel,
    escapeHTML,
    waLink,
    vehicleUrl,
    financingUrl,
    vehicleFinancingAvailable,
    supermovilidadSectionUrl,
    vehicleInsuranceAvailable,
    vehicleWebAvailable,
    insuranceUrl,
    peritajeUrl,
    textOrDash,
    firstImage,
    loadImageAsDataUrl,
    normalizePlate,
    normalizeLeadText,
    leadPhoneDigits,
    isValidLeadName,
    isValidLeadPhone,
    isValidLeadEmail,
    LEAD_SUCCESS_MESSAGE,
    LEAD_SUCCESS_EMAIL_MESSAGE,
    LEAD_SUCCESS_SAVED_ONLY_MESSAGE,
    LEAD_ERROR_MESSAGE,
    submitServiceLead,
    leadSubmissionSuccessMessage,
    fetchVehicleById,
    publicSupabaseClient,
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
    leadStageMeta,
    leadStageLabel,
    leadStageClass,
    leadStageOptions,
    buildLeadNotification,
    sendLeadNotification,
    trackEvent,
  };
})();
