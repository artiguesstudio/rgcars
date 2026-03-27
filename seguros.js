const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const form = document.getElementById('insuranceForm');
const message = document.getElementById('insuranceMessage');
const submitButton = document.getElementById('insuranceSubmit');

function showMessage(text, ok = true) {
  message.textContent = text;
  message.className = `form-message ${ok ? 'is-success' : 'is-error'}`;
  message.hidden = false;
}

function clearMessage() {
  message.textContent = '';
  message.className = 'form-message';
  message.hidden = true;
}

function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('vehicle_id')) form.vehicle_id.value = params.get('vehicle_id');
  if (params.get('vehicle_title')) form.vehicle_title.value = params.get('vehicle_title');
  if (params.get('brand')) form.vehicle_brand.value = params.get('brand');
  if (params.get('model')) form.vehicle_model.value = params.get('model');
  if (params.get('year')) form.vehicle_year.value = params.get('year');
}

function validate() {
  const required = Array.from(form.querySelectorAll('[required]'));
  for (const field of required) {
    if (field.type === 'checkbox') {
      if (!field.checked) {
        field.focus();
        field.reportValidity?.();
        return false;
      }
      continue;
    }
    if (!field.value?.trim()) {
      field.focus();
      field.reportValidity?.();
      return false;
    }
  }
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();
  if (!validate()) return;

  submitButton.disabled = true;
  const original = submitButton.textContent;
  submitButton.textContent = 'Enviando…';

  try {
    const payload = {
      status: 'new',
      customer_name: form.customer_name.value.trim(),
      cuil: form.cuil.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      city: form.city.value.trim() || null,
      vehicle_id: form.vehicle_id.value || null,
      vehicle_title: form.vehicle_title.value.trim(),
      vehicle_brand: form.vehicle_brand.value.trim() || null,
      vehicle_model: form.vehicle_model.value.trim() || null,
      vehicle_year: form.vehicle_year.value ? Number(form.vehicle_year.value) : null,
      plate: form.plate.value.trim() || null,
      insured_amount: form.insured_amount.value ? Number(form.insured_amount.value) : null,
      coverage_type: form.coverage_type.value,
      use_type: form.use_type.value || 'particular',
      insurer_preference: form.insurer_preference.value || null,
      current_insurer: form.current_insurer.value.trim() || null,
      needs_financing: form.needs_financing.checked,
      notes: form.notes.value.trim() || null,
      source_page: window.location.pathname.split('/').pop() || 'seguros.html',
    };

    const { error } = await sb.from('insurance_leads').insert(payload);
    if (error) throw error;

    form.reset();
    prefillFromUrl();
    await window.RGShared.sendLeadNotification('insurance', 'new', payload, { event: 'created' }).catch((error) => console.warn('No se pudo enviar el email de seguros:', error.message));
    showMessage('La pre-cotización quedó enviada. Tu solicitud ya está en curso y pronto nos vamos a poner en contacto.', true);
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'No se pudo enviar la pre-cotización.', false);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = original;
  }
}

form?.addEventListener('submit', handleSubmit);
document.getElementById('insuranceReset')?.addEventListener('click', () => { form.reset(); prefillFromUrl(); clearMessage(); });
prefillFromUrl();
