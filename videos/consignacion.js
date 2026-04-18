const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const form = document.getElementById('consignmentForm');
const panels = Array.from(document.querySelectorAll('.wizard-panel'));
const navButtons = Array.from(document.querySelectorAll('[data-step-nav]'));
const prevBtn = document.getElementById('consignmentPrev');
const nextBtn = document.getElementById('consignmentNext');
const submitBtn = document.getElementById('consignmentSubmit');
const progressBar = document.getElementById('wizardProgressBar');
const title = document.getElementById('wizardTitle');
const message = document.getElementById('consignmentMessage');
const photosInput = document.getElementById('photos');
const photoPreview = document.getElementById('photoPreview');
const brandSelect = document.getElementById('brand');
const modelSelect = document.getElementById('model');
const yearSelect = document.getElementById('year');
const kmSelect = document.getElementById('km');
const citySelect = document.getElementById('owner_city');

const STEP_TITLES = [
  'Paso 1 · Datos del vehículo',
  'Paso 2 · Contacto y fotos',
];

let currentStep = 0;

function initFaqAccordion() {
  document.querySelectorAll('.accordion-trigger').forEach((trigger) => {
    if (trigger.dataset.boundAccordion === 'true') return;
    trigger.dataset.boundAccordion = 'true';
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      const list = trigger.closest('.accordion-list');
      if (!item || !list) return;
      const isOpen = item.classList.contains('is-open');
      list.querySelectorAll('.accordion-item').forEach((entry) => {
        entry.classList.remove('is-open');
        entry.querySelector('.accordion-trigger')?.setAttribute('aria-expanded', 'false');
      });
      item.classList.toggle('is-open', !isOpen);
      trigger.setAttribute('aria-expanded', String(!isOpen));
    });
  });
}

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

function populateStaticOptions() {
  window.RGShared.populateBrandSelect(brandSelect, '', brandSelect.value);
  window.RGShared.populateModelSelect(modelSelect, brandSelect.value === 'Otro' ? '' : brandSelect.value, '', modelSelect.value);
  window.RGShared.populateYearRange(yearSelect, { start: 1990, end: new Date().getFullYear(), allowBlank: false });
  window.RGShared.populateSelect(kmSelect, window.RGShared.kmRangeOptions().map((item) => item.label), { placeholder: 'Seleccioná un rango', allowBlank: false });
  window.RGShared.populateCitySelect(citySelect);
}

function normalizeKmRange(label) {
  if (!label) return null;
  const clean = String(label).replace(/\./g, '').replace(/,/g, '').match(/(\d+)/g);
  if (!clean?.length) return null;
  return Number(clean[clean.length - 1]) || null;
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
    const value = field.type === 'checkbox' ? field.checked : field.value?.trim();
    if (!value) {
      field.focus();
      field.reportValidity?.();
      return false;
    }
  }

  const phone = document.getElementById('owner_phone')?.value || '';
  if (index === 1 && phone.replace(/\D+/g, '').length < 8) {
    showMessage('Ingresá un celular válido para que podamos contactarte.', false);
    return false;
  }

  clearMessage();
  return true;
}

function previewFiles(files) {
  if (!photoPreview) return;
  if (!files?.length) {
    photoPreview.innerHTML = '<div class="empty-inline">Las fotos son opcionales, pero ayudan a revisar mejor el caso.</div>';
    return;
  }
  photoPreview.innerHTML = Array.from(files).map((file, index) => {
    const url = URL.createObjectURL(file);
    return `<div class="photo-item"><img src="${url}" alt="Foto ${index + 1}" loading="lazy"></div>`;
  }).join('');
}

async function uploadPhotos(leadId, files) {
  if (!files?.length) return [];
  const uploaded = [];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${leadId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('consignment').upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = sb.storage.from('consignment').getPublicUrl(path);
    uploaded.push({ path, publicUrl: data.publicUrl });
  }
  return uploaded;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateStep(currentStep)) return;

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Enviando…';
  clearMessage();

  try {
    const leadId = window.crypto?.randomUUID?.() || `lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      id: leadId,
      brand: selectedOrOther(brandSelect, 'brand_other'),
      model: selectedOrOther(modelSelect, 'model_other'),
      version: form.version.value.trim() || null,
      year: form.year.value ? Number(form.year.value) : null,
      km: normalizeKmRange(form.km.value),
      plate: null,
      category: 'auto',
      fuel: null,
      transmission: null,
      condition_summary: null,
      mechanical_notes: null,
      cosmetic_notes: null,
      service_history: null,
      accepts_trade_in: false,
      ready_to_transfer: null,
      has_debt: false,
      debt_notes: null,
      expected_price: null,
      min_acceptable_price: null,
      max_expected_price: null,
      pricing_notes: form.pricing_notes.value.trim() || null,
      owner_name: form.owner_name.value.trim(),
      owner_phone: form.owner_phone.value.trim(),
      owner_email: form.owner_email.value.trim() || null,
      owner_city: form.owner_city.value.trim() || null,
      contact_preference: 'whatsapp',
      status: 'new',
    };

    const { error } = await sb.from('consignment_leads').insert(payload);
    if (error) throw error;

    const uploaded = await uploadPhotos(leadId, photosInput.files);
    if (uploaded.length) {
      const photoRows = uploaded.map((item, index) => ({
        consignment_lead_id: leadId,
        file_path: item.path,
        public_url: item.publicUrl,
        sort_order: index,
        is_cover: index === 0,
      }));
      const { error: photosError } = await sb.from('consignment_lead_photos').insert(photoRows);
      if (photosError) throw photosError;
    }

    form.reset();
    populateStaticOptions();
    previewFiles([]);
    setStep(0);
    await window.RGShared.sendLeadNotification('consignment', 'new', payload, { event: 'created' }).catch((error) => {
      console.warn('No se pudo enviar el email de consignación:', error.message);
    });
    showMessage('Tu consulta fue enviada correctamente. Ya quedó registrada y pronto nos vamos a poner en contacto.', true);
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'No se pudo enviar la consulta.', false);
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
photosInput?.addEventListener('change', (event) => previewFiles(event.target.files));
form?.addEventListener('submit', handleSubmit);
brandSelect?.addEventListener('change', () => {
  window.RGShared.populateModelSelect(modelSelect, brandSelect.value === 'Otro' ? '' : brandSelect.value, '');
});

toggleManualField(brandSelect, 'brand_other');
toggleManualField(modelSelect, 'model_other');
populateStaticOptions();
setStep(0);
initFaqAccordion();
