const form = document.getElementById('financingForm');
const message = document.getElementById('financingMessage');
const submitButton = document.getElementById('financingSubmit');
const urlParams = new URLSearchParams(window.location.search);

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
  form.reset();
  prefillFromUrl();
  clearMessage();
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
