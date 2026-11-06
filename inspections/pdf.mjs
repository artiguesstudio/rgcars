// On-demand PDF generation for the backoffice.
import { prepareInspectionReport, formatInspectionDate, itemDetails, ratingLabel, cleanText } from './presentation.mjs';
export { prepareInspectionReport, formatInspectionDate, itemDetails, ratingLabel } from './presentation.mjs';

let pdfLibrary;
const pdfCache = new Map();
async function loadPdfLibrary() {
  if (globalThis.jspdf?.jsPDF) return globalThis.jspdf.jsPDF;
  if (!pdfLibrary) pdfLibrary = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.async = true;
    script.onload = () => globalThis.jspdf?.jsPDF ? resolve(globalThis.jspdf.jsPDF) : reject(new Error('No se pudo iniciar el generador PDF.'));
    script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar el generador PDF. Revisá la conexión e intentá nuevamente.')); };
    document.head.append(script);
  }).catch((error) => { pdfLibrary = null; throw error; });
  return pdfLibrary;
}

async function loadPhoto(url) {
  if (!url || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const photo = new Image();
    const timeout = setTimeout(() => resolve(null), 10000);
    photo.crossOrigin = 'anonymous';
    photo.onload = () => {
      clearTimeout(timeout);
      try {
        const scale = Math.min(1, 1000 / Math.max(photo.width, photo.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(photo.width * scale)); canvas.height = Math.max(1, Math.round(photo.height * scale));
        canvas.getContext('2d').drawImage(photo, 0, 0, canvas.width, canvas.height);
        resolve({ data: canvas.toDataURL('image/jpeg', 0.8), ratio: canvas.width / canvas.height });
      } catch { resolve(null); }
    };
    photo.onerror = () => { clearTimeout(timeout); resolve(null); };
    photo.src = url;
  });
}

/** Exported for PDF QA with the same jsPDF version already used by the admin. */
export async function buildInspectionPdf(source, { internal = false, preview = false, jsPDF, includePhotos = true } = {}) {
  const report = prepareInspectionReport(source, { internal, preview });
  const Constructor = jsPDF || await loadPdfLibrary();
  // Fetch promptly in small concurrent batches while signed evidence URLs are fresh.
  const photos = new Map();
  if (includePhotos) {
    let nextPhoto = 0;
    await Promise.all(Array.from({ length: Math.min(6, report.evidence.length) }, async () => {
      while (nextPhoto < report.evidence.length) {
        const index = nextPhoto++;
        const evidence = report.evidence[index];
        photos.set(index, await loadPhoto(evidence.url));
      }
    }));
  }
  const doc = new Constructor({ unit: 'mm', format: 'a4', compress: true });
  doc.inspectionEvidenceFailures = includePhotos ? report.evidence.length - [...photos.values()].filter(Boolean).length : 0;
  const left = 16, width = 178, bottom = 273;
  let y = 42;
  const red = [200, 16, 46], ink = [15, 23, 42], muted = [71, 85, 105];
  const pdfText = (value) => cleanText(value).replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u2026/g, '...');
  function header() {
    doc.setFillColor(...red); doc.rect(0, 0, 210, 4, 'F');
    doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('FICHA DE PERITAJE', left, 16);
    doc.setFontSize(10); doc.text('RG CARS TDF S.R.L.', left, 23);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.setFontSize(8.5);
    doc.text(internal ? 'USO INTERNO - contiene información privada' : preview && report.status !== 'published' ? 'VISTA PREVIA - NO PUBLICADO' : 'INFORME PÚBLICO', left, 30);
    doc.setDrawColor(225, 229, 235); doc.line(left, 34, 194, 34);
  }
  function nextPage() { doc.addPage(); header(); y = 42; }
  function ensure(height) { if (y + height > bottom) nextPage(); }
  function paragraph(value, { bold = false, size = 9, color = ink, indent = 0, after = 2 } = {}) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfText(value), width - indent);
    const lineHeight = size * 0.43;
    for (const line of lines) { ensure(lineHeight); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); doc.text(line, left + indent, y); y += lineHeight; }
    y += after;
  }
  function section(title) {
    ensure(18); y += 3;
    doc.setFillColor(244, 246, 249); doc.roundedRect(left, y - 4, width, 10, 2, 2, 'F');
    paragraph(title, { bold: true, size: 10, indent: 3, after: 6 });
  }
  header();
  paragraph([report.vehicle.brand, report.vehicle.model, report.vehicle.version].filter(Boolean).join(' ') || 'Vehículo', { bold: true, size: 15, after: 3 });
  paragraph(`Dominio: ${report.vehicle.plate || '-'} | Año: ${report.vehicle.year || '-'} | Kilometraje: ${report.vehicle.km ?? '-'} km`);
  paragraph(`Localidad: ${report.locality || '-'} | Peritaje realizado el ${formatInspectionDate(report.inspection_date)}`);
  if (report.inspector_name) paragraph(`Perito: ${report.inspector_name}`);
  if (internal) {
    paragraph(`Estado del informe: ${report.status || 'draft'} | Versión: ${report.version || '-'} | Revisión: ${report.revision || '-'}`);
    section('CLIENTE / PROPIETARIO - PRIVADO');
    paragraph(`Nombre: ${report.owner.name || '-'} | Teléfono: ${report.owner.phone || '-'}`);
    paragraph(`Email: ${report.owner.email || '-'}`);
  }
  section('RESULTADOS Y DICTÁMENES');
  paragraph(report.score.complete ? `Puntaje final: ${report.score.nota_10.toFixed(2)} / 10 (${report.score.total_100.toFixed(2)} / 100)` : 'INFORME INCOMPLETO - Sin puntaje final definitivo', { bold: true, size: 13 });
  paragraph(`Estado general: ${report.fitness || 'Pendiente'} | Nivel de riesgo: ${report.risk || 'Pendiente'}`, { bold: true });
  paragraph(`Fundamentos del dictamen: ${report.verdict_reason || 'Pendiente'}`);
  paragraph('La aptitud y el riesgo son dictámenes expresos del perito, independientes de la nota. El resultado describe la inspección en la fecha indicada y no constituye una garantía absoluta.', { color: muted, size: 8.5 });
  for (const category of report.config.categories) {
    const score = report.score.categories.find((entry) => entry.id === category.id);
    paragraph(`${category.label}: ${score?.complete && score.points !== null ? score.points.toFixed(2) : 'Pendiente'} / ${category.max.toFixed(2)}`, { size: 8.5, after: 1 });
  }
  paragraph(`Criterio interno sujeto a validación del cliente. Configuración: ${report.config.version || '-'}; escala: ${report.config.scale_version || report.config.version || '-'}. Cada área conserva su máximo; N/A justificado no computa.`, { color: muted, size: 8, after: 5 });
  const percentageScoring = report.config.categories.some((category) => category.items.some((item) => item.scoring === 'percentage'));
  paragraph(`Factores del informe: Bueno = ${report.config.factors.B ?? '-'}; Regular = ${report.config.factors.R ?? '-'}; Malo = ${report.config.factors.M ?? '-'}.${percentageScoring ? ' Vida útil de frenos: porcentaje / 100.' : ''} Puntos de área = máximo x suma(peso x factor) / suma(pesos aplicables).`, { color: muted, size: 8 });
  let itemNumber = 0;
  for (const category of report.config.categories) {
    section(category.label);
    const score = report.score.categories.find((entry) => entry.id === category.id);
    paragraph(`Máximo: ${category.max.toFixed(2)} | Resultado: ${score?.complete && score.points !== null ? score.points.toFixed(2) : score?.non_evaluable ? 'No evaluable: requiere revisión' : 'Pendiente'} | Suma de pesos aplicables: ${score?.denominator ?? '-'}`, { color: muted, size: 8 });
    for (const item of category.items) {
      const answer = report.answers[item.id];
      ensure(16);
      paragraph(`${++itemNumber}. ${item.label} - ${ratingLabel(answer.rating, item, answer.value)} (peso ${item.weight})`, { bold: true, size: 9, after: 1 });
      for (const detail of itemDetails(item, answer)) paragraph(detail, { indent: 3, size: 8.5, after: 1 });
      if (answer.notes) paragraph(`Observación: ${answer.notes}`, { indent: 3, size: 8.5, after: 1 });
      y += 2;
    }
  }
  section('OBSERVACIONES GENERALES');
  paragraph(report.observations || 'Sin observaciones generales registradas.');
  if (internal && report.internal_notes) { section('NOTAS INTERNAS - PRIVADO'); paragraph(report.internal_notes); }
  if (report.evidence.length) {
    section(internal ? 'EVIDENCIA FOTOGRÁFICA - USO INTERNO' : 'EVIDENCIA FOTOGRÁFICA APROBADA');
    const itemMap = new Map(report.config.categories.flatMap((category) => category.items).map((item) => [item.id, item.label]));
    for (const [index, evidence] of report.evidence.entries()) {
      const photo = photos.get(index);
      ensure(photo ? 80 : 20);
      paragraph(`${index + 1}. ${itemMap.get(evidence.item_id) || 'Evidencia de inspección'}`, { bold: true });
      if (evidence.caption) paragraph(evidence.caption, { size: 8.5 });
      if (photo) {
        const height = Math.min(65, 120 / photo.ratio), imageWidth = height * photo.ratio;
        ensure(height + 5); doc.addImage(photo.data, 'JPEG', left, y, imageWidth, height); y += height + 5;
      } else paragraph('La imagen no se pudo incorporar. Consultá la fotografía en la ficha del peritaje.', { size: 8, color: muted });
    }
  }
  if (report.signature) {
    section('CONFORMIDAD DEL PERITO');
    paragraph(`Firma electrónica simple: ${report.signature.name || report.inspector_name || 'Perito'}`);
    paragraph(`Fecha de conformidad: ${formatInspectionDate(report.signature.signed_at)}`);
    if (report.signature.image_data_url) { ensure(30); doc.addImage(report.signature.image_data_url, 'PNG', left, y, 70, 25); y += 30; }
    paragraph('Esta firma electrónica no se presenta como firma digital certificada.', { color: muted, size: 8 });
  }
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page); doc.setDrawColor(225, 229, 235); doc.line(left, 280, 194, 280);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...muted);
    doc.text(`Folio ${pdfText(report.id)} | ${formatInspectionDate(report.inspection_date)}`, left, 286);
    doc.text(`${page} / ${pageCount}`, 194, 286, { align: 'right' });
  }
  return doc;
}

export async function downloadInspectionPdf(source, { internal = false, preview = false } = {}) {
  const report = prepareInspectionReport(source, { internal, preview });
  // Cache by sanitized content as well as revision: an unsaved draft can change before its next revision.
  // Signed URLs rotate without changing the approved report or the resulting PDF.
  const cacheKey = `${internal ? 'internal' : preview ? 'preview' : 'public'}:${JSON.stringify({ ...report, evidence: report.evidence.map(({ url, ...entry }) => entry) })}`;
  let blob = pdfCache.get(cacheKey);
  let missingEvidence = 0;
  if (!blob) {
    const doc = await buildInspectionPdf(report, { internal, preview });
    missingEvidence = doc.inspectionEvidenceFailures;
    blob = doc.output('blob');
    if (!missingEvidence) {
      if (pdfCache.size >= 4) pdfCache.delete(pdfCache.keys().next().value);
      pdfCache.set(cacheKey, blob);
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `peritaje-${internal ? 'interno' : preview && report.status !== 'published' ? 'vista-previa' : 'publico'}-${report.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40)}.pdf`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { missingEvidence, expectedEvidence: report.evidence.length };
}
