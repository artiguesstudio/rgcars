
const sb = window.supabase.createClient(RG.SUPABASE_URL, RG.SUPABASE_ANON_KEY);
const form = document.getElementById('peritajeForm');
const message = document.getElementById('peritajeMessage');
const submitButton = document.getElementById('peritajeSubmit');

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

function setDefaultDate() {
  const dateField = form.appointment_date;
  if (!dateField) return;
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  dateField.min = iso;
  if (!dateField.value) {
    const next = new Date(today.getTime() + 86400000);
    dateField.value = next.toISOString().slice(0, 10);
  }
}

function populateTimeSlots() {
  const slots = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'];
  window.RGShared.populateSelect(form.appointment_time, slots, { placeholder: 'Seleccioná un horario', current: '' });
}

function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('vehicle_id')) form.vehicle_id.value = params.get('vehicle_id');
  if (params.get('brand')) form.vehicle_brand.value = params.get('brand');
  if (params.get('model')) form.vehicle_model.value = params.get('model');
  if (params.get('year')) form.vehicle_year.value = params.get('year');
  if (params.get('plate')) form.plate.value = params.get('plate');
  if (params.get('km')) form.km.value = params.get('km');
  if (params.get('vehicle_title') && !form.notes.value) {
    form.notes.value = `Unidad de referencia: ${params.get('vehicle_title')}.`;
  }
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

function payloadFromForm() {
  return {
    status: 'new',
    vehicle_id: form.vehicle_id.value || null,
    customer_name: form.customer_name.value.trim(),
    phone: form.phone.value.trim(),
    email: form.email.value.trim() || null,
    city: form.city.value || null,
    vehicle_brand: form.vehicle_brand.value.trim(),
    vehicle_model: form.vehicle_model.value.trim(),
    vehicle_year: form.vehicle_year.value ? Number(form.vehicle_year.value) : null,
    plate: form.plate.value.trim() || null,
    km: form.km.value ? Number(form.km.value) : null,
    inspection_reason: form.inspection_reason.value || null,
    appointment_date: form.appointment_date.value || null,
    appointment_time: form.appointment_time.value || null,
    notes: form.notes.value.trim() || null,
    contact_preference: form.email.value.trim() ? 'email' : 'whatsapp',
    source_page: window.location.pathname.split('/').pop() || 'peritaje.html',
  };
}

async function generatePdf() {
  if (!validate()) return;
  if (!window.jspdf?.jsPDF) {
    showMessage('No se pudo generar la ficha porque jsPDF no está disponible.', false);
    return;
  }
  const payload = payloadFromForm();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFillColor(5, 7, 12);
  doc.rect(0, 0, 210, 34, 'F');

  try {
    const logo = await window.RGShared.loadImageAsDataUrl('./imagenes/isotipo-white.png');
    if (logo) doc.addImage(logo, 'PNG', 14, 8, 42, 10, undefined, 'FAST');
  } catch (error) {
    console.warn('No se pudo cargar el logo para la ficha de peritaje:', error.message);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('Ficha de peritaje', 196, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('RG Cars TDF · Coordinación comercial', 196, 23, { align: 'right' });
  doc.text(`Generada: ${new Date().toLocaleDateString('es-AR')}`, 196, 28, { align: 'right' });

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(14, 44, 182, 228, 8, 8, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);

  const row = (x, y, w, label, value) => {
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(x, y, w, 15, 4, 4, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(label, x + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text(String(value || '-'), x + 4, y + 11);
  };

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`${payload.vehicle_brand} ${payload.vehicle_model} ${payload.vehicle_year || ''}`.trim(), 20, 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(92, 103, 120);
  doc.text(`Fecha tentativa: ${payload.appointment_date || '-'} · Horario: ${payload.appointment_time || '-'}`, 20, 69);
  doc.text(`Motivo: ${payload.inspection_reason || '-'}`, 20, 76);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.text('Datos del titular', 20, 92);
  row(20, 98, 80, 'Nombre y apellido', payload.customer_name);
  row(106, 98, 80, 'Celular', payload.phone);
  row(20, 116, 80, 'E-mail', payload.email || '-');
  row(106, 116, 80, 'Ciudad', payload.city || '-');

  doc.text('Datos de la unidad', 20, 144);
  row(20, 150, 80, 'Marca', payload.vehicle_brand);
  row(106, 150, 80, 'Modelo', payload.vehicle_model);
  row(20, 168, 80, 'Año', payload.vehicle_year || '-');
  row(106, 168, 80, 'Patente', payload.plate || '-');
  row(20, 186, 80, 'Kilometraje', payload.km ? `${Number(payload.km).toLocaleString('es-AR')} km` : '-');
  row(106, 186, 80, 'Motivo', payload.inspection_reason || '-');

  doc.text('Observaciones', 20, 214);
  doc.setFillColor(245, 247, 250);
  doc.roundedRect(20, 220, 166, 34, 4, 4, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(71, 85, 105);
  doc.text(doc.splitTextToSize(payload.notes || 'Sin observaciones adicionales.', 156), 24, 228);

  doc.setFillColor(214, 31, 38);
  doc.roundedRect(20, 258, 70, 14, 5, 5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('RG Cars TDF', 55, 267, { align: 'center' });

  doc.setTextColor(92, 103, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Sarmiento 2760 · Río Grande, Tierra del Fuego', 96, 265);
  doc.text(`WhatsApp: +${window.RG.WHATSAPP}`, 96, 270);

  doc.save(`peritaje-${String(payload.vehicle_brand || 'vehiculo').toLowerCase()}-${String(payload.vehicle_model || '').toLowerCase()}.pdf`);
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();
  if (!validate()) return;

  submitButton.disabled = true;
  const original = submitButton.textContent;
  submitButton.textContent = 'Enviando…';

  try {
    const payload = payloadFromForm();
    const { error } = await sb.from('peritaje_leads').insert(payload);
    if (error) throw error;
    await window.RGShared.sendLeadNotification('peritaje', 'new', payload, { event: 'created' }).catch((error) => console.warn('No se pudo enviar el email de peritaje:', error.message));
    showMessage('La solicitud de peritaje quedó en curso. RG Cars TDF va a revisar el caso y a confirmar la agenda por el canal elegido.', true);
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'No se pudo enviar la solicitud de peritaje.', false);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = original;
  }
}

form?.addEventListener('submit', handleSubmit);
document.getElementById('peritajeReset')?.addEventListener('click', () => { form.reset(); setDefaultDate(); populateTimeSlots(); window.RGShared.populateCitySelect(form.city); prefillFromUrl(); clearMessage(); });window.RGShared.populateCitySelect(form.city);
populateTimeSlots();
setDefaultDate();
prefillFromUrl();
