const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const panels = Array.from(document.querySelectorAll('#scoutingForm .wizard-panel'));
const navButtons = Array.from(document.querySelectorAll('#scoutingStepsNav [data-step-nav]'));
const title = document.getElementById('scoutingTitle');
const progressBar = document.getElementById('scoutingProgressBar');
const prevBtn = document.getElementById('scoutingPrev');
const nextBtn = document.getElementById('scoutingNext');
const submitBtn = document.getElementById('scoutingSubmit');
const form = document.getElementById('scoutingForm');
const message = document.getElementById('scoutingMessage');
const categorySelect = document.getElementById('category');
const brandSelect = document.getElementById('brand');
const modelSelect = document.getElementById('model');

const STEP_TITLES = [
  'Paso 1 · Vehículo buscado',
  'Paso 2 · Presupuesto y contacto',
];

let currentStep = 0;

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

function toggleManualField(select, inputId) {
  const input = document.getElementById(inputId);
  const wrapper = input?.closest('.conditional-field');
  if (!input || !wrapper || !select) return;
  const sync = () => {
    const active = select.value === 'Otro';
    wrapper.classList.toggle('is-hidden', !active);
    input.required = active;
    if (!active) input.value = '';
  };
  select.addEventListener('change', sync);
  sync();
}

function selectedOrOther(select, otherId) {
  const value = select.value;
  if (value === 'Otro') return document.getElementById(otherId)?.value?.trim() || null;
  return value || null;
}

function populateCatalog() {
  window.RGShared.populateBrandSelect(brandSelect, categorySelect.value || 'auto', brandSelect.value);
  window.RGShared.populateModelSelect(modelSelect, brandSelect.value === 'Otro' ? '' : brandSelect.value, categorySelect.value || 'auto', modelSelect.value);
}

function populateStaticOptions() {
  window.RGShared.populateYearRange(document.getElementById('year_min'), { start: 2010, end: new Date().getFullYear() + 1, placeholder: 'Sin mínimo' });
  window.RGShared.populateYearRange(document.getElementById('year_max'), { start: 2010, end: new Date().getFullYear() + 1, placeholder: 'Sin máximo' });
  window.RGShared.populateSelect(document.getElementById('km_max'), window.RGShared.kmRangeOptions(20000, 220000), { placeholder: 'Sin preferencia', current: '' });
  window.RGShared.populateSelect(document.getElementById('fuel'), window.RGCatalog?.fuelOptions || [], { placeholder: 'Sin preferencia', current: '' });
  window.RGShared.populateSelect(document.getElementById('transmission'), ['Manual', 'Automática'], { placeholder: 'Sin preferencia', current: '' });
  window.RGShared.populateSelect(document.getElementById('color'), window.RGCatalog?.colorOptions || [], { placeholder: 'Sin preferencia', current: '' });
  window.RGShared.populateCitySelect(document.getElementById('city'));
  populateCatalog();
}

function setStep(index) {
  currentStep = Math.max(0, Math.min(index, panels.length - 1));
  panels.forEach((panel, i) => panel.classList.toggle('is-active', i === currentStep));
  navButtons.forEach((button, i) => button.classList.toggle('is-active', i === currentStep));
  if (title) title.textContent = STEP_TITLES[currentStep];
  if (progressBar) progressBar.style.width = `${((currentStep + 1) / panels.length) * 100}%`;
  prevBtn.hidden = currentStep === 0;
  nextBtn.hidden = currentStep === panels.length - 1;
  submitBtn.hidden = currentStep !== panels.length - 1;
}

function validateStep(index) {
  const panel = panels[index];
  if (!panel) return true;
  const requiredFields = Array.from(panel.querySelectorAll('[required]')).filter((field) => !field.closest('.is-hidden'));
  for (const field of requiredFields) {
    if (!field.value?.trim()) {
      field.focus();
      field.reportValidity?.();
      return false;
    }
  }

  if (index === 0) {
    const yearMin = Number(form.year_min.value || 0);
    const yearMax = Number(form.year_max.value || 0);
    if (yearMin && yearMax && yearMin > yearMax) {
      showMessage('El año desde no puede ser mayor al año hasta.', false);
      return false;
    }
  }

  clearMessage();
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateStep(currentStep)) return;

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Guardando…';
  clearMessage();

  try {
    const requestId = window.crypto?.randomUUID?.() || `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      id: requestId,
      customer_name: form.customer_name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      city: form.city.value.trim() || null,
      contact_preference: form.contact_preference.value || 'whatsapp',
      brand: selectedOrOther(brandSelect, 'brand_other'),
      model: selectedOrOther(modelSelect, 'model_other'),
      version: form.version.value.trim() || null,
      category: form.category.value || 'auto',
      year_min: form.year_min.value ? Number(form.year_min.value) : null,
      year_max: form.year_max.value ? Number(form.year_max.value) : null,
      km_max: form.km_max.value ? Number(form.km_max.value) : null,
      fuel: form.fuel.value || null,
      transmission: form.transmission.value || null,
      color: form.color.value || null,
      price_min: form.budget_estimate.value ? Number(form.budget_estimate.value) : null,
      price_max: form.budget_estimate.value ? Number(form.budget_estimate.value) : null,
      currency: form.currency.value || 'ARS',
      financing_needed: form.financing_needed.value === 'true',
      trade_in: form.trade_in.value === 'true',
      urgency: form.urgency.value || 'media',
      use_case: null,
      must_have: form.must_have.value.trim() || null,
      notes: form.notes.value.trim() || null,
      status: 'active',
    };

    const { error } = await sb.from('scouting_requests').insert(payload);
    if (error) throw error;

    const { error: rpcError } = await sb.rpc('rebuild_matches_for_request', { p_request_id: requestId });
    if (rpcError) console.warn('No se pudo ejecutar rebuild_matches_for_request:', rpcError.message);

    form.reset();
    populateStaticOptions();
    setStep(0);
    await window.RGShared.sendLeadNotification('scouting', 'active', payload, { event: 'created' }).catch((error) => console.warn('No se pudo enviar el email de búsqueda:', error.message));
    showMessage('La búsqueda quedó activa. RG Cars ya tiene tu solicitud y te vamos a avisar por mail cuando haya una unidad compatible.', true);
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'No se pudo guardar la búsqueda.', false);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = Number(button.dataset.stepNav || 0);
    if (target <= currentStep || validateStep(currentStep)) setStep(target);
  });
});
nextBtn?.addEventListener('click', () => {
  if (!validateStep(currentStep)) return;
  setStep(currentStep + 1);
});
prevBtn?.addEventListener('click', () => setStep(currentStep - 1));
form?.addEventListener('submit', handleSubmit);
categorySelect?.addEventListener('change', () => {
  brandSelect.value = '';
  modelSelect.value = '';
  populateCatalog();
});
brandSelect?.addEventListener('change', () => {
  window.RGShared.populateModelSelect(modelSelect, brandSelect.value === 'Otro' ? '' : brandSelect.value, categorySelect.value || 'auto');
});

toggleManualField(brandSelect, 'brand_other');
toggleManualField(modelSelect, 'model_other');
populateStaticOptions();
setStep(0);
