const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);

const form = document.getElementById('financingForm');
const message = document.getElementById('financingMessage');
const title = document.getElementById('financingTitle');
const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));
const entitySelect = document.getElementById('entity');
const profileSelect = document.getElementById('profile_code');
const installmentsSelect = document.getElementById('installments');
const yearSelect = document.getElementById('vehicle_year');
const vehicleTypeSelect = document.getElementById('vehicle_type');
const amountInput = document.getElementById('requested_amount');
const submitButton = document.getElementById('financingSubmit');
const simulationDetailButton = document.getElementById('openSimulationDetail');
const simulationDetailModal = document.getElementById('simulationDetailModal');

function bindAmountMask() {
  if (!amountInput) return;
  amountInput.addEventListener('input', () => {
    const caretAtEnd = amountInput.selectionStart === amountInput.value.length;
    amountInput.value = formatMoneyInput(amountInput.value);
    if (caretAtEnd) amountInput.setSelectionRange(amountInput.value.length, amountInput.value.length);
    recalculate();
  });
  amountInput.addEventListener('blur', () => {
    amountInput.value = formatMoneyInput(amountInput.value);
  });
}

let financeProfiles = Array.isArray(window.RGFinanceDefaults) ? [...window.RGFinanceDefaults] : [];

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

function money(value) {
  return Number(String(value || '').replace(/\D+/g, '')) || 0;
}

function formatMoneyInput(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  const number = Number(digits);
  return `$${number.toLocaleString('es-AR')}`;
}

function annuity(amount, monthlyRate, months) {
  if (!months || amount <= 0) return 0;
  if (!monthlyRate) return amount / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return amount * ((monthlyRate * factor) / (factor - 1));
}

function activeMode() {
  return form.operation_type.value || 'agency';
}

function formatInstallments(months) {
  return months ? `${months} cuotas` : '-';
}

function vehicleTypeLabel(value) {
  const map = {
    auto: 'Auto',
    pickup: 'Pickup / camioneta',
    suv: 'SUV',
    utilitario: 'Utilitario',
  };
  return map[String(value || '').toLowerCase()] || 'Vehículo';
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setHidden(id, hidden) {
  const node = document.getElementById(id);
  if (node) node.hidden = !!hidden;
}

function closeSimulationModal() {
  if (!simulationDetailModal) return;
  simulationDetailModal.hidden = true;
  document.body.classList.remove('feedback-modal-open');
}

function openSimulationModal() {
  if (!simulationDetailModal) return;
  simulationDetailModal.hidden = false;
  document.body.classList.add('feedback-modal-open');
}

function setMode(mode) {
  form.operation_type.value = mode;
  modeButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.mode === mode));
  title.textContent = mode === 'private' ? 'Financiación para compras entre particulares' : 'Financiación para autos de la agencia';
  document.querySelectorAll('.private-only').forEach((node) => node.classList.toggle('is-hidden', mode !== 'private'));
  populateEntities();
  populateProfiles();
  populateInstallments();
  recalculate();
}

function availableProfiles() {
  const mode = activeMode();
  const vehicleType = vehicleTypeSelect.value || 'auto';
  const year = Number(yearSelect.value || 0);
  return financeProfiles.filter((item) => {
    const scopeOk = !item.operation_scope || item.operation_scope === 'both' || item.operation_scope === mode;
    const typeOk = !item.vehicle_type || item.vehicle_type === 'all' || item.vehicle_type === vehicleType || (vehicleType === 'pickup' && item.vehicle_type === 'camioneta');
    const yearFromOk = !item.year_from || !year || year >= Number(item.year_from);
    const yearToOk = !item.year_to || !year || year <= Number(item.year_to);
    return item.active !== false && scopeOk && typeOk && yearFromOk && yearToOk;
  });
}

function activeProfile() {
  const candidates = availableProfiles();
  return candidates.find((item) => String(item.code) === String(profileSelect.value)) || candidates[0] || null;
}

function populateEntities() {
  const entities = Array.from(new Set(availableProfiles().map((item) => item.entity))).sort((a, b) => a.localeCompare(b, 'es'));
  window.RGShared.populateSelect(entitySelect, entities, { placeholder: 'Seleccioná una entidad', allowBlank: false, current: entitySelect.value || entities[0] || '' });
}

function populateProfiles() {
  const current = profileSelect.value;
  const profiles = availableProfiles().filter((item) => !entitySelect.value || item.entity === entitySelect.value).sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || String(a.label).localeCompare(String(b.label), 'es'));
  window.RGShared.populateSelect(profileSelect, profiles.map((item) => ({ value: item.code, label: item.label })), { placeholder: 'Seleccioná una línea', allowBlank: false, current: current || profiles[0]?.code || '' });
  form.selected_profile_code.value = profileSelect.value || '';
}

function populateInstallments() {
  const profile = activeProfile();
  const options = Array.isArray(profile?.installments) ? profile.installments : [12, 18, 24, 36, 48, 60];
  const current = installmentsSelect.value;
  window.RGShared.populateSelect(installmentsSelect, options.map((months) => ({ value: String(months), label: `${months} cuotas` })), { placeholder: 'Seleccioná plazo', allowBlank: false, current: current || String(options[0] || '') });
}

function calculationFor(profile, amount, months) {
  if (!profile || amount <= 0 || !months) {
    return {
      installment: 0,
      total: 0,
      rateText: '-',
      factorText: '-',
      methodText: '-',
      note: 'Esperando datos para simular.',
    };
  }

  const grossAmount = amount;

  if (profile.calc_method === 'factor_per_10000') {
    const factorMap = profile.quota_factors || {};
    const factor = Number(factorMap[String(months)] || 0);
    const installment = factor ? (grossAmount / 10000) * factor : 0;
    return {
      installment,
      total: installment * months,
      rateText: factor ? `${factor.toLocaleString('es-AR', { maximumFractionDigits: 2 })} por cada $10.000` : '-',
      factorText: factor ? `${factor.toLocaleString('es-AR', { maximumFractionDigits: 2 })} por cada $10.000 financiados` : '-',
      methodText: 'Coeficiente aplicado sobre cada $10.000 financiados',
      note: profile.notes || 'La cuota total se estima aplicando el coeficiente de la línea al monto ingresado.',
    };
  }

  const monthlyRate = profile.monthly_rate_override != null
    ? Number(profile.monthly_rate_override)
    : (Number(profile.annual_rate || 0) / 12 / 100);
  const installment = annuity(grossAmount, monthlyRate, months);
  const total = installment * months;
  const annualRate = Number(profile.annual_rate || 0);
  return {
    installment,
    total,
    rateText: annualRate ? `${annualRate.toLocaleString('es-AR', { maximumFractionDigits: 2 })}% TNA` : 'Coeficiente interno',
    factorText: '',
    methodText: profile.monthly_rate_override != null ? 'Cuota calculada con tasa mensual fija de la línea' : 'Cuota estimada con tasa nominal anual y plazo seleccionado',
    note: profile.notes || 'Resultado orientativo sujeto a evaluación crediticia.',
  };
}

function recalculate() {
  const profile = activeProfile();
  const amount = money(amountInput.value);
  const months = Number(installmentsSelect.value || 0);
  const result = calculationFor(profile, amount, months);
  const amountText = amount ? window.RGShared.formatPrice(amount) : '-';
  const installmentText = result.installment ? window.RGShared.formatPrice(result.installment) : '-';
  const totalText = result.total ? window.RGShared.formatPrice(result.total) : '-';
  const lineText = profile ? `${profile.entity || 'Entidad'} · ${profile.label || 'Línea'}` : '-';
  const installmentsText = formatInstallments(months);
  const installmentHint = profile?.calc_method === 'factor_per_10000'
    ? (result.installment ? `Cuota total estimada para tu monto. Referencia base: ${result.factorText}.` : 'Ingresá monto y plazo para calcular la cuota total estimada.')
    : 'Cuota mensual estimada según tasa y plazo seleccionados.';
  const termHint = months ? `${installmentsText} seleccionadas.` : 'Esperando datos para completar el plazo.';
  const disclaimer = [profile?.entity, profile?.label].filter(Boolean).join(' · ') || 'Simulación';
  const disclaimerText = `${disclaimer}. ${result.note}`.replace(/\s+/g, ' ').trim();

  form.estimated_monthly_payment.value = result.installment ? Math.round(result.installment) : '';
  form.estimated_total_cost.value = result.total ? Math.round(result.total) : '';
  form.estimated_monthly_rate.value = profile?.annual_rate != null ? Number(profile.annual_rate) : '';
  form.selected_profile_code.value = profile?.code || '';

  setText('resultAmount', amountText);
  setText('resultInstallment', installmentText);
  setText('resultTotal', totalText);
  setText('resultLine', lineText);
  setText('resultInstallments', installmentsText);
  setText('resultMethod', result.methodText || '-');
  setText('resultRate', result.rateText || '-');
  setText('resultPerTenThousand', result.factorText || '-');
  setText('resultInstallmentHint', installmentHint);
  setText('resultTerm', termHint);
  setHidden('resultFactorRow', !(profile?.calc_method === 'factor_per_10000' && result.factorText && result.factorText !== '-'));
  setText('simulationDisclaimer', disclaimerText);

  setText('simulationModalLine', lineText);
  setText('modalInstallment', installmentText);
  setText('modalTotal', totalText);
  setText('modalAmount', amountText);
  setText('modalEntity', profile?.entity || '-');
  setText('modalProfile', profile?.label || '-');
  setText('modalVehicleType', vehicleTypeLabel(form.vehicle_type.value));
  setText('modalYear', form.vehicle_year.value || '-');
  setText('modalInstallments', installmentsText);
  setText('modalMethod', result.methodText || '-');
  setText('modalRate', result.rateText || '-');
  setText('modalPerTenThousand', result.factorText || '-');
  setHidden('modalFactorRow', !(profile?.calc_method === 'factor_per_10000' && result.factorText && result.factorText !== '-'));
  setText('simulationModalDisclaimer', disclaimerText);
}

function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'private' || mode === 'agency') setMode(mode);
  if (params.get('vehicle_id')) form.vehicle_id.value = params.get('vehicle_id');
  if (params.get('vehicle_title')) form.vehicle_title.value = params.get('vehicle_title');
  if (params.get('year')) yearSelect.value = params.get('year');
}

function validate() {
  const required = Array.from(form.querySelectorAll('[required]')).filter((field) => !field.closest('.is-hidden'));
  for (const field of required) {
    if (!field.value?.trim()) {
      field.focus();
      field.reportValidity?.();
      return false;
    }
  }

  if (!form.phone.value.trim() && !form.email.value.trim()) {
    showMessage('Para habilitar la simulación necesitamos al menos celular o e-mail, además del CUIL.', false);
    return false;
  }

  if (!money(form.requested_amount.value)) {
    showMessage('Indicá el monto a financiar.', false);
    return false;
  }

  clearMessage();
  return true;
}

async function loadProfiles() {
  try {
    const { data, error } = await sb.from('finance_rate_profiles').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    if (Array.isArray(data) && data.length) {
      financeProfiles = data.map((item) => ({
        ...item,
        installments: Array.isArray(item.installments) ? item.installments : [],
        quota_factors: item.quota_factors || {},
      }));
    }
  } catch (error) {
    console.warn('Usando tasas fallback:', error.message || error);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();
  recalculate();
  if (!validate()) return;

  submitButton.disabled = true;
  const original = submitButton.textContent;
  submitButton.textContent = 'Enviando…';

  try {
    const profile = activeProfile();
    const payload = {
      status: 'new',
      origin: activeMode(),
      entity: entitySelect.value,
      customer_name: form.customer_name.value.trim(),
      cuil: form.cuil.value.trim(),
      phone: form.phone.value.trim() || null,
      email: form.email.value.trim() || null,
      city: form.city.value.trim() || null,
      contact_preference: form.contact_preference.value || 'whatsapp',
      vehicle_id: form.vehicle_id.value || null,
      vehicle_title: form.vehicle_title.value.trim(),
      vehicle_brand: null,
      vehicle_model: null,
      vehicle_year: form.vehicle_year.value ? Number(form.vehicle_year.value) : null,
      vehicle_total_price: null,
      down_payment: null,
      requested_amount: money(form.requested_amount.value) || null,
      installments: Number(form.installments.value || 0) || null,
      estimated_monthly_payment: money(form.estimated_monthly_payment.value) || null,
      estimated_total_cost: money(form.estimated_total_cost.value) || null,
      estimated_monthly_rate: Number(profile?.annual_rate || 0) || null,
      operation_context: activeMode() === 'private' ? (form.operation_context.value.trim() || null) : null,
      notes: form.notes.value.trim() || null,
      source_page: window.location.pathname.split('/').pop() || 'financiacion.html',
      profile_code: profile?.code || null,
      vehicle_type: form.vehicle_type.value || 'auto',
    };

    const { error } = await sb.from('financing_leads').insert(payload);
    if (error) throw error;

    closeSimulationModal();
    form.reset();
    window.RGShared.populateCitySelect(document.getElementById('city'));
    window.RGShared.populateYearRange(yearSelect, { start: 2010, end: new Date().getFullYear() + 1, allowBlank: false, current: String(new Date().getFullYear()) });
    setMode('agency');
    prefillFromUrl();
    recalculate();
    await window.RGShared.sendLeadNotification('financing', 'new', payload, { event: 'created' }).catch((error) => console.warn('No se pudo enviar el email de financiación:', error.message));
    showMessage('La simulación quedó guardada. Tu solicitud ya está en curso y pronto nos vamos a poner en contacto.', true);
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'No se pudo guardar la simulación.', false);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = original;
  }
}

modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode || 'agency')));
entitySelect?.addEventListener('change', () => { populateProfiles(); populateInstallments(); recalculate(); });
profileSelect?.addEventListener('change', () => { populateInstallments(); recalculate(); });
bindAmountMask();
installmentsSelect?.addEventListener('change', recalculate);
vehicleTypeSelect?.addEventListener('change', () => { populateEntities(); populateProfiles(); populateInstallments(); recalculate(); });
yearSelect?.addEventListener('change', () => { populateEntities(); populateProfiles(); populateInstallments(); recalculate(); });
document.getElementById('resetSimulation')?.addEventListener('click', () => {
  closeSimulationModal();
  form.reset();
  window.RGShared.populateCitySelect(document.getElementById('city'));
  window.RGShared.populateYearRange(yearSelect, { start: 2010, end: new Date().getFullYear() + 1, allowBlank: false, current: String(new Date().getFullYear()) });
  setMode('agency');
  prefillFromUrl();
  recalculate();
  clearMessage();
});
form?.addEventListener('submit', handleSubmit);
simulationDetailButton?.addEventListener('click', openSimulationModal);
simulationDetailModal?.addEventListener('click', (event) => {
  if (event.target.closest('[data-simulation-close="true"]')) closeSimulationModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && simulationDetailModal && !simulationDetailModal.hidden) closeSimulationModal();
});

(async function init() {
  window.RGShared.populateCitySelect(document.getElementById('city'));
  window.RGShared.populateYearRange(yearSelect, { start: 2010, end: new Date().getFullYear() + 1, allowBlank: false, current: String(new Date().getFullYear()) });
  await loadProfiles();
  setMode('agency');
  prefillFromUrl();
  populateEntities();
  populateProfiles();
  populateInstallments();
  recalculate();
})();
