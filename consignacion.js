const form = document.getElementById('consignmentForm');
const message = document.getElementById('consignmentMessage');
const submitButton = document.getElementById('consignmentSubmit');

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

function validate() {
  if (!window.RGShared.isValidLeadName(form.owner_name.value)) {
    form.owner_name.focus();
    showMessage('Ingresá un nombre completo válido.', false);
    return false;
  }

  if (!window.RGShared.isValidLeadPhone(form.owner_phone.value)) {
    form.owner_phone.focus();
    showMessage('Ingresá un WhatsApp válido para que podamos contactarte.', false);
    return false;
  }

  if (!window.RGShared.isValidLeadEmail(form.owner_email.value)) {
    form.owner_email.focus();
    showMessage('Ingresá un email válido para enviarte la confirmación.', false);
    return false;
  }

  if (!window.RGShared.normalizeLeadText(form.vehicle_to_sell.value)) {
    form.vehicle_to_sell.focus();
    showMessage('Contanos qué vehículo querés vender.', false);
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
    const vehicleSummary = window.RGShared.normalizeLeadText(form.vehicle_to_sell.value);
    const note = window.RGShared.normalizeLeadText(form.pricing_notes.value);
    const result = await window.RGShared.submitServiceLead({
      serviceType: form.service_type.value || 'vende_tu_auto',
      source: form.source.value || 'servicio_vende_tu_auto',
      name: window.RGShared.normalizeLeadText(form.owner_name.value),
      phone: window.RGShared.normalizeLeadText(form.owner_phone.value),
      email: window.RGShared.normalizeLeadText(form.owner_email.value),
      message: note || null,
      vehicleTitle: vehicleSummary,
      metadata: {
        category: form.category.value || 'auto',
        vehicle_to_sell: vehicleSummary,
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
