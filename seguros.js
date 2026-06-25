const form = document.getElementById('insuranceForm');
const message = document.getElementById('insuranceMessage');
const submitButton = document.getElementById('insuranceSubmit');
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

function prefillFromUrl() {
  const vehicleId = urlParams.get('vehicle_id');
  const vehicleTitle = window.RGShared.normalizeLeadText(urlParams.get('vehicle_title'));
  if (vehicleId) form.vehicle_id.value = vehicleId;
  if (vehicleTitle) {
    form.vehicle_title.value = vehicleTitle;
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
  const original = submitButton.textContent;
  submitButton.textContent = 'Enviando…';
  clearMessage();

  try {
    const vehicleTitle = window.RGShared.normalizeLeadText(form.vehicle_title.value) || form.dataset.vehicleTitle || null;
    const note = window.RGShared.normalizeLeadText(form.notes.value);
    const result = await window.RGShared.submitServiceLead({
      serviceType: form.service_type.value || 'seguro_automotor',
      source: form.source.value || 'servicio_seguro_automotor',
      name: window.RGShared.normalizeLeadText(form.customer_name.value),
      phone: window.RGShared.normalizeLeadText(form.phone.value),
      email: window.RGShared.normalizeLeadText(form.email.value),
      message: note || null,
      vehicleId: form.vehicle_id.value || null,
      vehicleTitle: vehicleTitle || null,
      metadata: {
        insurance_vehicle: vehicleTitle || null,
        vehicle_year: urlParams.get('year') ? Number(urlParams.get('year')) : null,
      },
    });

    resetForm();
    showMessage(window.RGShared.leadSubmissionSuccessMessage(result), true);
  } catch (error) {
    console.error(error);
    showMessage(error?.message || window.RGShared.LEAD_ERROR_MESSAGE, false);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = original;
  }
}

form?.addEventListener('submit', handleSubmit);
document.getElementById('insuranceReset')?.addEventListener('click', resetForm);
prefillFromUrl();
