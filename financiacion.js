const form = document.getElementById('financingForm');
const message = document.getElementById('financingMessage');
const submitButton = document.getElementById('financingSubmit');
const urlParams = new URLSearchParams(window.location.search);

const FINANCING_MODAL_ID = 'financingOptionModal';
const FINANCING_MODAL_TITLE_ID = 'financingOptionModalTitle';
const FINANCING_MODAL_DESCRIPTION_ID = 'financingOptionModalDescription';
const FOCUSABLE_SELECTOR = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let financingModalRefs = null;
let lastFinancingOptionTrigger = null;

function showMessage(text, ok = true) {
  if (!message) return;
  message.textContent = text;
  message.className = `form-message ${ok ? 'is-success' : 'is-error'}`;
  message.hidden = false;
}

function clearMessage() {
  if (!message) return;
  message.textContent = '';
  message.className = 'form-message';
  message.hidden = true;
}

function parseAmount(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits ? Number(digits) : null;
}

function prefillFromUrl() {
  if (!form) return;
  const vehicleId = urlParams.get('vehicle_id');
  const vehicleTitle = window.RGShared.normalizeLeadText(urlParams.get('vehicle_title'));
  if (vehicleId) form.vehicle_id.value = vehicleId;
  if (vehicleTitle) {
    form.financing_interest.value = vehicleTitle;
    form.dataset.vehicleTitle = vehicleTitle;
  } else {
    delete form.dataset.vehicleTitle;
  }
}

function resetForm() {
  if (!form) return;
  form.reset();
  prefillFromUrl();
  clearMessage();
}

function validate() {
  if (!form) return false;

  if (!window.RGShared.isValidLeadName(form.customer_name.value)) {
    form.customer_name.focus();
    showMessage('Ingresá un nombre completo válido.', false);
    return false;
  }

  if (!window.RGShared.isValidLeadPhone(form.phone.value)) {
    form.phone.focus();
    showMessage('Ingresá un WhatsApp válido para que podamos contactarte.', false);
    return false;
  }

  if (!window.RGShared.isValidLeadEmail(form.email.value)) {
    form.email.focus();
    showMessage('Ingresá un email válido para enviarte la confirmación.', false);
    return false;
  }

  clearMessage();
  return true;
}

function financingWhatsAppUrl(prefilledMessage) {
  const phone = String(window.RG?.WHATSAPP || '5492964588267').replace(/\D+/g, '');
  const text = window.RGShared.normalizeLeadText(prefilledMessage);
  const baseUrl = `https://wa.me/${phone}`;
  return text ? `${baseUrl}?text=${encodeURIComponent(text)}` : baseUrl;
}

function financingOptionsCatalog() {
  return {
    bna: {
      id: 'bna',
      title: 'BNA +Autos',
      image: './imagenes/bna.png',
      imageAlt: 'BNA +Autos',
      description: 'Una alternativa de Banco Nación para financiar la compra de vehículos nuevos o usados a través de concesionarias adheridas.',
      highlights: [
        'Préstamo personal en pesos.',
        'Gestión desde la concesionaria adherida.',
        'Plazos de hasta 72 meses.',
        'Puede financiar hasta el 100% del valor del vehículo, según la evaluación y condiciones vigentes.',
        'Disponible para personas humanas sujetas a análisis crediticio.',
      ],
      disclaimer: 'Las condiciones, montos, tasas, plazos y aprobación dependen de Banco Nación y pueden modificarse. No incluye patentamiento ni otros gastos asociados.',
      primaryAction: {
        label: 'Ver información oficial',
        href: 'https://www.bna.com.ar/home/masautos',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      secondaryAction: { label: 'Cerrar' },
    },
    santander: {
      id: 'santander',
      title: 'Santander SuperMovilidad',
      image: './imagenes/santander.png',
      imageAlt: 'Santander SuperMovilidad',
      description: 'Una plataforma que permite consultar vehículos disponibles y acceder a opciones de simulación de financiación ofrecidas por Santander.',
      highlights: [
        'Consulta de vehículos publicados por concesionarias adheridas.',
        'Acceso a simulación de préstamos prendarios.',
        'La información ingresada puede utilizarse para evaluar una solicitud financiera.',
        'Las opciones, montos y tasas disponibles se informan según el perfil y el momento de la simulación.',
      ],
      disclaimer: 'La simulación no garantiza el otorgamiento del préstamo. La aprobación, los montos y las condiciones son determinados por Santander luego de la evaluación crediticia correspondiente.',
      primaryAction: {
        label: 'Consultar condiciones',
        href: 'https://supermovilidad.com.ar/terms-and-conditions',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      secondaryAction: { label: 'Cerrar' },
    },
    prendo: {
      id: 'prendo',
      title: 'Prendo',
      image: './imagenes/prendo.png',
      imageAlt: 'Prendo',
      description: 'Una plataforma que permite simular e iniciar una precalificación para un posible crédito prendario asociado a un vehículo.',
      highlights: [
        'Permite indicar el vehículo y el monto que se necesita financiar.',
        'Realiza un proceso inicial de precalificación crediticia.',
        'Puede generar un resultado preaprobado asociado al vehículo seleccionado.',
        'El resultado queda sujeto a validación posterior de datos y documentación.',
      ],
      disclaimer: 'Una precalificación o preaprobación online no constituye la aprobación definitiva del crédito ni garantiza el desembolso de fondos. La operación final queda sujeta al análisis y verificación correspondiente.',
      primaryAction: {
        label: 'Consultar términos',
        href: 'https://prendo.ar/terms',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      secondaryAction: { label: 'Cerrar' },
    },
    propia: {
      id: 'propia',
      title: 'Financiación propia RG Cars',
      image: './imagenes/propia.png',
      imageAlt: 'Financiación propia RG Cars',
      description: 'Una alternativa de financiación gestionada directamente con el equipo de RG Cars TDF, de acuerdo con la unidad elegida y las posibilidades de cada operación.',
      highlights: [
        'Atención personalizada.',
        'Evaluación según la unidad seleccionada.',
        'Condiciones informadas de manera individual.',
        'Acompañamiento directo del equipo comercial.',
      ],
      disclaimer: 'La disponibilidad, entrega inicial, cuotas y demás condiciones se evalúan de forma personalizada y están sujetas a confirmación por parte de RG Cars TDF.',
      primaryAction: {
        label: 'Consultanos por WhatsApp',
        href: financingWhatsAppUrl('Hola, quiero recibir información sobre la financiación propia de RG Cars TDF.'),
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      secondaryAction: { label: 'Cerrar' },
    },
  };
}

function buildFinancingModal() {
  const existingModal = document.getElementById(FINANCING_MODAL_ID);
  if (existingModal) {
    financingModalRefs = {
      modal: existingModal,
      dialog: existingModal.querySelector('.financing-modal__dialog'),
      image: existingModal.querySelector('[data-financing-modal-image]'),
      title: existingModal.querySelector(`#${FINANCING_MODAL_TITLE_ID}`),
      description: existingModal.querySelector(`#${FINANCING_MODAL_DESCRIPTION_ID}`),
      highlights: existingModal.querySelector('[data-financing-modal-highlights]'),
      disclaimer: existingModal.querySelector('[data-financing-modal-disclaimer]'),
      primary: existingModal.querySelector('[data-financing-modal-primary]'),
      secondary: existingModal.querySelector('[data-financing-modal-secondary]'),
      close: existingModal.querySelector('[data-financing-modal-close-button]'),
    };
    return financingModalRefs;
  }

  const modal = document.createElement('div');
  modal.id = FINANCING_MODAL_ID;
  modal.className = 'financing-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="financing-modal__backdrop" data-financing-modal-close="true"></div>
    <div
      class="financing-modal__dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="${FINANCING_MODAL_TITLE_ID}"
      aria-describedby="${FINANCING_MODAL_DESCRIPTION_ID}"
      tabindex="-1"
    >
      <button type="button" class="financing-modal__close" aria-label="Cerrar" data-financing-modal-close="true" data-financing-modal-close-button="true">×</button>
      <div class="financing-modal__brand">
        <div class="financing-modal__brand-mark">
          <img src="" alt="" data-financing-modal-image />
        </div>
        <span class="financing-modal__eyebrow">Financiación</span>
      </div>
      <h3 id="${FINANCING_MODAL_TITLE_ID}"></h3>
      <p class="financing-modal__copy" id="${FINANCING_MODAL_DESCRIPTION_ID}"></p>
      <div class="financing-modal__section">
        <h4>Características principales</h4>
        <ul class="financing-modal__highlights" data-financing-modal-highlights="true"></ul>
      </div>
      <div class="financing-modal__disclaimer" data-financing-modal-disclaimer="true"></div>
      <div class="financing-modal__actions">
        <a class="btn btn-primary financing-modal__primary" href="#" target="_blank" rel="noopener noreferrer" data-financing-modal-primary="true"></a>
        <button type="button" class="btn btn-ghost financing-modal__secondary" data-financing-modal-close="true" data-financing-modal-secondary="true">Cerrar</button>
      </div>
    </div>
  `;

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-financing-modal-close]')) {
      closeFinancingModal();
    }
  });

  modal.addEventListener('keydown', handleFinancingModalKeydown);

  document.body.appendChild(modal);

  financingModalRefs = {
    modal,
    dialog: modal.querySelector('.financing-modal__dialog'),
    image: modal.querySelector('[data-financing-modal-image]'),
    title: modal.querySelector(`#${FINANCING_MODAL_TITLE_ID}`),
    description: modal.querySelector(`#${FINANCING_MODAL_DESCRIPTION_ID}`),
    highlights: modal.querySelector('[data-financing-modal-highlights]'),
    disclaimer: modal.querySelector('[data-financing-modal-disclaimer]'),
    primary: modal.querySelector('[data-financing-modal-primary]'),
    secondary: modal.querySelector('[data-financing-modal-secondary]'),
    close: modal.querySelector('[data-financing-modal-close-button]'),
  };

  return financingModalRefs;
}

function modalFocusableElements() {
  if (!financingModalRefs?.dialog) return [];
  return [...financingModalRefs.dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.hasAttribute('hidden')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return !element.hasAttribute('disabled');
  });
}

function trapFocusInFinancingModal(event) {
  if (event.key !== 'Tab') return;

  const focusable = modalFocusableElements();
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleFinancingModalKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFinancingModal();
    return;
  }

  trapFocusInFinancingModal(event);
}

function setOptionButtonsExpanded(expandedOptionId = '') {
  document.querySelectorAll('[data-financing-option]').forEach((button) => {
    button.setAttribute('aria-expanded', button.dataset.financingOption === expandedOptionId ? 'true' : 'false');
  });
}

function openFinancingModal(optionId, trigger) {
  const option = financingOptionsCatalog()[optionId];
  const refs = buildFinancingModal();
  if (!option || !refs) return;

  lastFinancingOptionTrigger = trigger || document.activeElement;
  refs.image.src = option.image;
  refs.image.alt = option.imageAlt;
  refs.title.textContent = option.title;
  refs.description.textContent = option.description;
  refs.disclaimer.textContent = option.disclaimer;
  refs.primary.textContent = option.primaryAction.label;
  refs.primary.href = option.primaryAction.href;
  refs.primary.target = option.primaryAction.target || '_self';
  refs.primary.rel = option.primaryAction.rel || '';
  refs.secondary.textContent = option.secondaryAction?.label || 'Cerrar';

  refs.highlights.replaceChildren();
  option.highlights.forEach((item) => {
    const highlight = document.createElement('li');
    highlight.textContent = item;
    refs.highlights.appendChild(highlight);
  });

  refs.modal.hidden = false;
  document.body.classList.add('financing-modal-open');
  setOptionButtonsExpanded(optionId);

  window.requestAnimationFrame(() => {
    refs.close?.focus({ preventScroll: true });
  });
}

function closeFinancingModal() {
  if (!financingModalRefs?.modal || financingModalRefs.modal.hidden) return;

  financingModalRefs.modal.hidden = true;
  document.body.classList.remove('financing-modal-open');
  setOptionButtonsExpanded('');
  if (lastFinancingOptionTrigger && typeof lastFinancingOptionTrigger.focus === 'function') {
    lastFinancingOptionTrigger.focus({ preventScroll: true });
  }
}

function initFinancingOptionsModal() {
  const optionButtons = [...document.querySelectorAll('[data-financing-option]')];
  if (!optionButtons.length) return;

  buildFinancingModal();
  setOptionButtonsExpanded('');

  optionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      openFinancingModal(button.dataset.financingOption, button);
    });
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validate()) return;

  submitButton.disabled = true;
  const originalText = submitButton.textContent;
  submitButton.textContent = 'Enviando…';
  clearMessage();

  try {
    const interest = window.RGShared.normalizeLeadText(form.financing_interest.value);
    const notes = window.RGShared.normalizeLeadText(form.notes.value);
    const vehiclePrice = parseAmount(urlParams.get('vehicle_price'));
    const requestedAmount = parseAmount(interest) || vehiclePrice;
    const requestedAmountDisplay = requestedAmount ? `$${Number(requestedAmount).toLocaleString('es-AR')}` : '';
    const result = await window.RGShared.submitServiceLead({
      serviceType: form.service_type.value || 'financiacion',
      source: form.source.value || 'servicio_financiacion',
      name: window.RGShared.normalizeLeadText(form.customer_name.value),
      phone: window.RGShared.normalizeLeadText(form.phone.value),
      email: window.RGShared.normalizeLeadText(form.email.value),
      message: notes || null,
      vehicleId: form.vehicle_id.value || null,
      vehicleTitle: interest || form.dataset.vehicleTitle || null,
      metadata: {
        vehicle_year: urlParams.get('year') ? Number(urlParams.get('year')) : null,
        vehicle_price: vehiclePrice,
        requested_amount: requestedAmount,
        requested_amount_display: requestedAmountDisplay,
        financing_reference: interest,
        operation_type: form.operation_type?.value || 'agency',
        vehicle_type: 'auto',
      },
    });

    resetForm();
    showMessage(window.RGShared.leadSubmissionSuccessMessage(result), true);
  } catch (error) {
    console.error(error);
    showMessage(error?.message || window.RGShared.LEAD_ERROR_MESSAGE, false);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
}

form?.addEventListener('submit', handleSubmit);
document.getElementById('resetFinancingForm')?.addEventListener('click', resetForm);

prefillFromUrl();
initFinancingOptionsModal();
