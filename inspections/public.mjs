import { prepareInspectionReport, formatInspectionDate, itemDetails, ratingLabel, downloadInspectionPdf } from './pdf.mjs';
import { inspectionEndpoint, inspectionHeaders } from './transport.mjs';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function appendText(parent, tag, className, text) {
  const child = element(tag, className, text); parent.append(child); return child;
}

// Keep the vehicle's primary action tied to the same verified public report.
function syncInspectionLink(host, available) {
  for (const link of document.querySelectorAll('[data-inspection-link]')) {
    if (link.getAttribute('aria-controls') !== host.id) continue;
    link.hidden = !available;
    link.onclick = available ? (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const details = host.querySelector('.inspection-public__details');
      if (details) details.open = true;
      host.tabIndex = -1;
      host.focus({ preventScroll: true });
      host.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } : null;
  }
}

/** The API returns one approved projection, never raw inspections/documents. */
export async function fetchPublicInspection(vehicleId, { fetcher = globalThis.fetch, config = globalThis.RG } = {}) {
  if (!vehicleId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(inspectionEndpoint(config), {
      method: 'POST', signal: controller.signal,
      headers: inspectionHeaders(config), cache: 'no-store',
      body: JSON.stringify({ action: 'public', vehicle_id: vehicleId }),
    });
    if (!response.ok) throw new Error('El informe público no está disponible.');
    const payload = await response.json();
    if (!payload.data) return null;
    if (String(payload.data.vehicle_id) !== String(vehicleId)) throw new Error('El informe no corresponde al vehículo.');
    return prepareInspectionReport(payload.data);
  } finally { clearTimeout(timer); }
}

export function renderPublicInspection(source, host) {
  let report = prepareInspectionReport(source);
  let lastRefreshed = Date.now();
  let refreshing;
  async function refreshReport(force = false) {
    if (!force && Date.now() - lastRefreshed < 40000) return report;
    if (!refreshing) refreshing = fetchPublicInspection(report.vehicle_id).then((fresh) => {
      if (!fresh) { host.hidden = true; host.replaceChildren(); syncInspectionLink(host, false); throw new Error('El informe ya no está publicado.'); }
      const changed = fresh.id !== report.id || fresh.revision !== report.revision;
      report = fresh; lastRefreshed = Date.now();
      if (changed) renderPublicInspection(fresh, host);
      else for (const anchor of host.querySelectorAll('[data-inspection-evidence]')) {
        const photo = report.evidence.find((entry) => entry.id === anchor.dataset.inspectionEvidence);
        if (photo?.url) { anchor.href = photo.url; const image = anchor.querySelector('img'); if (image) image.src = photo.url; }
      }
      return fresh;
    }).finally(() => { refreshing = null; });
    return refreshing;
  }
  host.replaceChildren(); host.className = 'inspection-public';
  host.setAttribute('aria-labelledby', 'inspection-public-heading');
  const intro = element('div', 'inspection-public__intro');
  const heading = element('div');
  appendText(heading, 'span', 'eyebrow', 'Estado de la unidad');
  const title = appendText(heading, 'h2', '', 'Peritaje verificado'); title.id = 'inspection-public-heading';
  appendText(heading, 'p', 'inspection-public__date', `Peritaje realizado el ${formatInspectionDate(report.inspection_date)}${report.locality ? ` · ${report.locality}` : ''}`);
  if (report.inspector_name) appendText(heading, 'p', 'inspection-public__date', `Perito: ${report.inspector_name}`);
  intro.append(heading);
  const score = element('div', 'inspection-public__score');
  score.setAttribute('aria-label', `Calificación ${report.score.nota_10.toFixed(1)} sobre 10`);
  appendText(score, 'strong', '', report.score.nota_10.toFixed(1)); appendText(score, 'span', '', '/ 10');
  intro.append(score); host.append(intro);
  const badges = element('div', 'inspection-public__badges');
  appendText(badges, 'span', 'inspection-public__badge', `Estado general: ${report.fitness}`);
  appendText(badges, 'span', 'inspection-public__badge', `Riesgo: ${report.risk}`);
  host.append(badges);
  if (report.verdict_reason) appendText(host, 'p', 'inspection-public__reason', report.verdict_reason);
  appendText(host, 'p', 'inspection-public__notice', 'La aptitud y el riesgo reflejan el dictamen del perito en esa fecha y son independientes de la calificación. La inspección no constituye una garantía absoluta ni reemplaza revisiones posteriores.');
  const bars = element('div', 'inspection-public__bars');
  for (const category of report.config.categories) {
    const result = report.score.categories.find((value) => value.id === category.id);
    const row = element('div', 'inspection-public__bar');
    const caption = element('div', 'inspection-public__bar-caption');
    appendText(caption, 'span', '', category.label);
    appendText(caption, 'strong', '', `${result.points.toFixed(2)} / ${category.max.toFixed(2)}`);
    row.append(caption);
    const meter = element('progress'); meter.max = category.max; meter.value = result.points;
    meter.setAttribute('aria-label', `${category.label}: ${result.points.toFixed(2)} de ${category.max.toFixed(2)} puntos`);
    row.append(meter); bars.append(row);
  }
  host.append(bars);
  const actions = element('div', 'inspection-public__actions');
  const pdf = appendText(actions, 'button', 'btn btn-primary', 'Descargar informe PDF'); pdf.type = 'button';
  const status = appendText(actions, 'p', 'inspection-public__download-status', ''); status.setAttribute('role', 'status');
  pdf.addEventListener('click', async () => {
    pdf.disabled = true; status.textContent = 'Preparando el informe público…';
    try {
      const result = await downloadInspectionPdf(await refreshReport(true));
      status.textContent = result.missingEvidence ? `PDF descargado con ${result.missingEvidence} fotografía(s) no disponible(s). Reintentá la descarga para incorporarlas.` : 'Informe listo para descargar.';
    }
    catch (error) { status.textContent = error.message || 'No se pudo descargar el informe. Intentá nuevamente.'; }
    finally { pdf.disabled = false; }
  });
  host.append(actions);
  const detail = element('details', 'inspection-public__details');
  appendText(detail, 'summary', '', 'Detalle del peritaje · 83 componentes');
  const percentageScoring = report.config.categories.some((category) => category.items.some((item) => item.scoring === 'percentage'));
  appendText(detail, 'p', 'inspection-public__notice', `Datos históricos de la inspección. Bueno, Regular, Malo y No aplica son valoraciones confirmadas por el perito.${percentageScoring ? ' La vida útil de frenos se expresa como porcentaje y suma proporcionalmente al puntaje.' : ''} Las mediciones estimadas no determinan por sí solas la seguridad mecánica.`);
  let detailsRendered = false;
  detail.addEventListener('toggle', async () => {
    if (!detail.open || detailsRendered) return;
    detailsRendered = true;
    try { await refreshReport(); }
    catch { detailsRendered = false; appendText(detail, 'p', 'inspection-public__notice', 'No se pudo actualizar el informe. Cerrá y volvé a abrir el detalle para reintentar.'); return; }
    if (!host.contains(detail)) return;
    const vehicle = report.vehicle;
    appendText(detail, 'p', 'inspection-public__snapshot', `Unidad inspeccionada: ${[vehicle.brand, vehicle.model, vehicle.version, vehicle.year].filter(Boolean).join(' ')} · Dominio: ${vehicle.plate || '-'} · ${vehicle.km ?? '-'} km`);
    const photosByItem = new Map();
    for (const photo of report.evidence) {
      if (!photosByItem.has(photo.item_id)) photosByItem.set(photo.item_id, []);
      photosByItem.get(photo.item_id).push(photo);
    }
    for (const category of report.config.categories) {
      const section = element('details', 'inspection-public__category');
      appendText(section, 'summary', '', `${category.label} · ${category.items.length} componentes`);
      section.addEventListener('toggle', async () => {
        if (!section.open) return;
        try { await refreshReport(); } catch { status.textContent = 'No se pudieron actualizar las fotografías. Reintentá abrir la sección.'; }
      });
      const list = element('ul', 'inspection-public__items');
      for (const item of category.items) {
        const answer = report.answers[item.id];
        const entry = element('li', 'inspection-public__item');
        const line = element('div', 'inspection-public__item-heading');
        appendText(line, 'strong', '', item.label);
        const state = ratingLabel(answer.rating, item, answer.value);
        const stateClass = state === 'Pendiente' ? 'pending' : answer.rating === 'NA' ? 'NA' : item.scoring === 'percentage' ? 'percentage' : answer.rating;
        appendText(line, 'span', `inspection-public__rating inspection-public__rating--${stateClass}`, state);
        entry.append(line);
        for (const itemDetail of itemDetails(item, answer)) appendText(entry, 'p', 'inspection-public__item-detail', itemDetail);
        if (answer.notes) appendText(entry, 'p', 'inspection-public__notes', `Observación: ${answer.notes}`);
        const photos = photosByItem.get(item.id) || [];
        if (photos.length) {
          const grid = element('div', 'inspection-public__photos');
          for (const photo of photos) {
            if (!photo.url) continue;
            const figure = element('figure');
            const link = element('a'); link.href = photo.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.dataset.inspectionEvidence = photo.id;
            const image = element('img'); image.src = photo.url; image.alt = photo.caption || `Evidencia de ${item.label}`; image.loading = 'lazy'; image.decoding = 'async';
            image.addEventListener('error', async () => { try { await refreshReport(true); } catch { status.textContent = 'No se pudo actualizar una fotografía. Reintentá abrir la sección.'; } }, { once: true });
            link.addEventListener('click', async (event) => {
              event.preventDefault();
              const photoTab = window.open('about:blank', '_blank');
              if (photoTab) photoTab.opener = null;
              try {
                const fresh = await refreshReport(true);
                const updated = fresh.evidence.find((entry) => entry.id === photo.id);
                if (!updated?.url) throw new Error('La fotografía ya no está disponible.');
                if (photoTab) photoTab.location.href = updated.url;
                else { link.href = updated.url; status.textContent = 'El navegador bloqueó la pestaña. Abrí la fotografía con el menú del enlace actualizado.'; }
              } catch (error) { photoTab?.close(); status.textContent = error.message || 'No se pudo abrir la fotografía.'; }
            });
            link.append(image); figure.append(link);
            if (photo.caption) appendText(figure, 'figcaption', '', photo.caption);
            grid.append(figure);
          }
          entry.append(grid);
        }
        list.append(entry);
      }
      section.append(list); detail.append(section);
    }
    if (report.observations) { appendText(detail, 'h3', '', 'Observaciones generales'); appendText(detail, 'p', 'inspection-public__notes', report.observations); }
    if (report.signature) appendText(detail, 'p', 'inspection-public__notice', `Conformidad mediante firma electrónica simple: ${report.signature.name || report.inspector_name || 'Perito'}, ${formatInspectionDate(report.signature.signed_at)}. No es una firma digital certificada.`);
    appendText(detail, 'p', 'inspection-public__notice', `Folio ${report.id} · Configuración ${report.config.version}. Criterio de puntuación interno sujeto a validación del cliente.`);
  });
  host.append(detail); host.hidden = false;
  syncInspectionLink(host, true);
  return report;
}

export async function mountPublicInspection(vehicleId, host = document.getElementById('vehicleInspection')) {
  if (!host) return;
  host.hidden = true; host.replaceChildren(); host.setAttribute('aria-busy', 'true');
  syncInspectionLink(host, false);
  try {
    const report = await fetchPublicInspection(vehicleId);
    if (report) renderPublicInspection(report, host);
  } catch {
    // An unavailable or unpublished report must never invent a score or block the vehicle page.
    host.hidden = true; host.replaceChildren();
  } finally { host.removeAttribute('aria-busy'); }
}
