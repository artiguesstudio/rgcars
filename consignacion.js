const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const panels = Array.from(document.querySelectorAll('#consignmentForm .wizard-panel'));
const navButtons = Array.from(document.querySelectorAll('#consignmentStepsNav [data-step-nav]'));
const title = document.getElementById('wizardTitle');
const progressBar = document.getElementById('wizardProgressBar');
const prevBtn = document.getElementById('consignmentPrev');
const nextBtn = document.getElementById('consignmentNext');
const submitBtn = document.getElementById('consignmentSubmit');
const form = document.getElementById('consignmentForm');
const message = document.getElementById('consignmentMessage');
const photosInput = document.getElementById('photos');
const photoPreview = document.getElementById('photoPreview');
const categorySelect = document.getElementById('category');
const brandSelect = document.getElementById('brand');
const modelSelect = document.getElementById('model');

const STEP_TITLES = [
  'Paso 1 · Datos del vehículo',
  'Paso 2 · Estado y precio',
  'Paso 3 · Contacto y fotos',
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
        const entryTrigger = entry.querySelector('.accordion-trigger');
        if (entryTrigger) entryTrigger.setAttribute('aria-expanded', 'false');
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

function populateCatalog() {
  window.RGShared.populateBrandSelect(brandSelect, categorySelect.value || 'auto', brandSelect.value);
  window.RGShared.populateModelSelect(modelSelect, brandSelect.value === 'Otro' ? '' : brandSelect.value, categorySelect.value || 'auto', modelSelect.value);
}

function populateStaticOptions() {
  window.RGShared.populateYearRange(document.getElementById('year'), { start: 1990, end: new Date().getFullYear() + 1, allowBlank: false });
  window.RGShared.populateSelect(document.getElementById('fuel'), window.RGCatalog?.fuelOptions || [], { placeholder: 'Seleccioná una opción', allowBlank: false });
  window.RGShared.populateSelect(document.getElementById('transmission'), window.RGCatalog?.transmissionOptions || ['Manual', 'Automática'], { placeholder: 'Seleccioná una opción', allowBlank: false });
  window.RGShared.populateCitySelect(document.getElementById('owner_city'));
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

  if (index === 1) {
    const expected = Number(form.expected_price.value || 0);
    const min = Number(form.min_acceptable_price.value || 0);
    if (min > expected) {
      showMessage('El mínimo aceptable no puede ser mayor al precio ideal.', false);
      return false;
    }
  }

  clearMessage();
  return true;
}

function previewFiles(files) {
  if (!photoPreview) return;
  if (!files?.length) {
    photoPreview.innerHTML = '<div class="empty-inline">Podés subir frente, laterales, interior, tablero, motor y detalles.</div>';
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

function syncDebtField() {
  const select = document.getElementById('has_debt');
  const input = document.getElementById('debt_notes');
  const wrapper = document.getElementById('debtNotesField');
  const active = select.value === 'yes';
  wrapper.classList.toggle('is-hidden', !active);
  input.required = active;
  if (!active) input.value = '';
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
      km: form.km.value ? Number(form.km.value) : null,
      plate: window.RGShared.normalizePlate(form.plate.value) || null,
      category: form.category.value || 'auto',
      fuel: form.fuel.value || null,
      transmission: form.transmission.value || null,
      condition_summary: form.condition_summary.value.trim(),
      mechanical_notes: null,
      cosmetic_notes: form.cosmetic_notes.value.trim() || null,
      service_history: form.service_history.value.trim() || null,
      accepts_trade_in: form.accepts_trade_in.value === 'true',
      ready_to_transfer: form.ready_to_transfer.value === 'true',
      has_debt: form.has_debt.value === 'yes',
      debt_notes: form.debt_notes.value.trim() || null,
      expected_price: form.expected_price.value ? Number(form.expected_price.value) : null,
      min_acceptable_price: form.min_acceptable_price.value ? Number(form.min_acceptable_price.value) : null,
      max_expected_price: null,
      pricing_notes: form.pricing_notes.value.trim() || null,
      owner_name: form.owner_name.value.trim(),
      owner_phone: form.owner_phone.value.trim(),
      owner_email: form.owner_email.value.trim(),
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
    syncDebtField();
    previewFiles([]);
    setStep(0);
    await window.RGShared.sendLeadNotification('consignment', 'new', payload, { event: 'created' }).catch((error) => console.warn('No se pudo enviar el email de consignación:', error.message));
    showMessage('Tu solicitud fue enviada correctamente. Ya quedó en curso y pronto nos vamos a poner en contacto.', true);
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'No se pudo enviar la ficha.', false);
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
categorySelect?.addEventListener('change', () => {
  brandSelect.value = '';
  modelSelect.value = '';
  populateCatalog();
});
brandSelect?.addEventListener('change', () => {
  window.RGShared.populateModelSelect(modelSelect, brandSelect.value === 'Otro' ? '' : brandSelect.value, categorySelect.value || 'auto');
});
document.getElementById('has_debt')?.addEventListener('change', syncDebtField);

toggleManualField(brandSelect, 'brand_other');
toggleManualField(modelSelect, 'model_other');
populateStaticOptions();
syncDebtField();
setStep(0);
initFaqAccordion();
