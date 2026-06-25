const form = document.getElementById('scoutingForm');
const message = document.getElementById('scoutingMessage');
const submitButton = document.getElementById('scoutingSubmit');

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

function parseBudget(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits ? Number(digits) : null;
}

function validate() {
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

  if (!window.RGShared.normalizeLeadText(form.searched_vehicle.value)) {
    form.searched_vehicle.focus();
    showMessage('Contanos qué vehículo estás buscando.', false);
    return false;
  }

  clearMessage();
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validate()) return;

  submitButton.disabled = true;
  const originalText = submitButton.textContent;
  submitButton.textContent = 'Enviando…';
  clearMessage();

  try {
    const vehicleQuery = window.RGShared.normalizeLeadText(form.searched_vehicle.value);
    const budgetText = window.RGShared.normalizeLeadText(form.budget_estimate.value);
    const budgetValue = parseBudget(budgetText);
    const result = await window.RGShared.submitServiceLead({
      serviceType: form.service_type.value || 'busqueda_personalizada',
      source: form.source.value || 'servicio_busqueda_personalizada',
      name: window.RGShared.normalizeLeadText(form.customer_name.value),
      phone: window.RGShared.normalizeLeadText(form.phone.value),
      email: window.RGShared.normalizeLeadText(form.email.value),
      message: budgetText ? `Presupuesto aproximado: ${budgetText}` : null,
      vehicleTitle: vehicleQuery,
      metadata: {
        category: form.category.value || 'auto',
        searched_vehicle: vehicleQuery,
        budget: budgetValue,
        budget_display: budgetText,
      },
    });

    form.reset();
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
