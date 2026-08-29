import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const vehicleArg = process.argv.find((argument) => argument.startsWith('--vehicle='));
const limitArg = process.argv.find((argument) => argument.startsWith('--limit='));
const onlyVehicleId = vehicleArg ? vehicleArg.slice('--vehicle='.length).trim() : '';
const requestedLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : 0;

if (typeof fetch !== 'function' || typeof FormData !== 'function') {
  throw new Error('Este script requiere Node.js 18 o una versión posterior.');
}

const configText = await readFile(new URL('../config.js', import.meta.url), 'utf8');
const supabaseUrl = String(process.env.RGC_SUPABASE_URL || configValue('SUPABASE_URL')).replace(/\/+$/g, '');
const anonKey = String(process.env.RGC_SUPABASE_ANON_KEY || configValue('SUPABASE_ANON_KEY'));
const storageEndpoint = String(process.env.RGC_STORAGE_ENDPOINT || '').trim();

async function main() {
if (!supabaseUrl || !anonKey) {
  throw new Error('No se encontró la configuración de Supabase.');
}

if (applyChanges && !/^https:\/\//i.test(storageEndpoint)) {
  throw new Error('Para aplicar la migración definí RGC_STORAGE_ENDPOINT con la URL HTTPS completa del endpoint en cPanel.');
}

const accessToken = applyChanges ? await adminAccessToken() : (process.env.RGC_SUPABASE_ACCESS_TOKEN || anonKey);
const vehicles = await loadVehicles(accessToken);
const selectedVehicles = onlyVehicleId
  ? vehicles.filter((vehicle) => String(vehicle.id) === onlyVehicleId)
  : vehicles;

let candidates = selectedVehicles
  .flatMap((vehicle) => normalizedImages(vehicle.images).map((image, index) => ({ vehicle, image, index })))
  .filter(({ image }) => isSupabaseStorageUrl(imageUrl(image)));

if (requestedLimit > 0) {
  candidates = candidates.slice(0, requestedLimit);
}

console.log(`Vehículos revisados: ${selectedVehicles.length}`);
console.log(`Fotos pendientes en Supabase Storage: ${candidates.length}`);

if (!applyChanges) {
  console.log('Simulación terminada. No se modificó ningún archivo ni registro.');
  console.log('Usá --apply después de publicar el endpoint y configurar las variables indicadas en STORAGE-MIGRATION.md.');
  process.exit(0);
}

const candidateIndexes = new Map();
for (const candidate of candidates) {
  const vehicleId = String(candidate.vehicle.id);
  if (!candidateIndexes.has(vehicleId)) candidateIndexes.set(vehicleId, new Set());
  candidateIndexes.get(vehicleId).add(candidate.index);
}

let migratedCount = 0;
let failedCount = 0;
for (const vehicle of selectedVehicles) {
  const indexes = candidateIndexes.get(String(vehicle.id));
  if (!indexes?.size) continue;

  const nextImages = normalizedImages(vehicle.images);
  let vehicleFailed = false;
  for (const index of indexes) {
    const currentValue = nextImages[index];
    const sourceUrl = imageUrl(currentValue);
    try {
      const newUrl = await copyImage(vehicle.id, sourceUrl, accessToken);
      nextImages[index] = replaceImageUrl(currentValue, newUrl);
      migratedCount += 1;
      console.log(`[${migratedCount}/${candidates.length}] ${vehicle.id}: ${newUrl}`);
    } catch (error) {
      failedCount += 1;
      vehicleFailed = true;
      console.error(`No se pudo copiar ${sourceUrl}: ${error.message}`);
      break;
    }
  }

  if (vehicleFailed) {
    console.error(`No se actualizó el vehículo ${vehicle.id}; podés ejecutar el script otra vez sin duplicar los archivos ya copiados.`);
    continue;
  }

  await updateVehicleImages(vehicle.id, nextImages, accessToken);
}

console.log(`Migración finalizada. Copiadas: ${migratedCount}. Fallidas: ${failedCount}.`);
console.log('Los originales de Supabase no se eliminaron. Verificá el sitio antes de liberar ese espacio.');
if (failedCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`No se pudo ejecutar la migración: ${error.message}`);
  if (String(error.message).includes('exceed_cached_egress_quota')) {
    console.error('Supabase bloqueó el proyecto por cuota de egress. Hay que restaurar temporalmente el servicio para leer la tabla y descargar los originales.');
  }
  process.exitCode = 1;
});

function configValue(name) {
  const expression = new RegExp(`${name}\\s*:\\s*["']([^"']+)["']`);
  return configText.match(expression)?.[1] || '';
}

async function adminAccessToken() {
  const providedToken = String(process.env.RGC_SUPABASE_ACCESS_TOKEN || '').trim();
  if (providedToken) return providedToken;

  const email = String(process.env.RGC_ADMIN_EMAIL || '').trim();
  const password = String(process.env.RGC_ADMIN_PASSWORD || '');
  if (!email || !password) {
    throw new Error('Para aplicar la migración definí RGC_ADMIN_EMAIL y RGC_ADMIN_PASSWORD, o RGC_SUPABASE_ACCESS_TOKEN.');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const result = await readJson(response);
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.msg || result.error || 'No se pudo iniciar sesión en Supabase.');
  }
  return result.access_token;
}

async function loadVehicles(token) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: 'id,images',
      order: 'id.asc',
      limit: String(pageSize),
      offset: String(offset),
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/vehicles?${query}`, {
      headers: supabaseHeaders(token),
    });
    const page = await readJson(response);
    if (!response.ok) {
      throw new Error(page.message || page.error || `No se pudo leer vehicles (${response.status}).`);
    }
    if (!Array.isArray(page)) throw new Error('Supabase devolvió una respuesta inesperada al leer vehicles.');
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function copyImage(vehicleId, sourceUrl, token) {
  const sourceResponse = await fetch(sourceUrl, { redirect: 'follow' });
  if (!sourceResponse.ok) {
    throw new Error(`Supabase respondió ${sourceResponse.status} al descargar la imagen.`);
  }

  const blob = await sourceResponse.blob();
  const originalName = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() || 'image.jpg');
  const migrationKey = createHash('sha256').update(sourceUrl).digest('hex');
  const formData = new FormData();
  formData.append('action', 'upload');
  formData.append('vehicle_id', String(vehicleId));
  formData.append('migration_key', migrationKey);
  formData.append('image', blob, originalName);

  const uploadResponse = await fetch(storageEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const result = await readJson(uploadResponse);
  if (!uploadResponse.ok || !result.url) {
    throw new Error(result.error || `cPanel respondió ${uploadResponse.status} al subir la imagen.`);
  }

  return new URL(result.url, storageEndpoint).href;
}

async function updateVehicleImages(vehicleId, images, token) {
  const response = await fetch(`${supabaseUrl}/rest/v1/vehicles?id=eq.${encodeURIComponent(vehicleId)}`, {
    method: 'PATCH',
    headers: {
      ...supabaseHeaders(token),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ images }),
  });

  if (!response.ok) {
    const result = await readJson(response);
    throw new Error(result.message || result.error || `No se pudo actualizar el vehículo ${vehicleId} (${response.status}).`);
  }
}

function supabaseHeaders(token) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: text.slice(0, 300) };
  }
}

function normalizedImages(value) {
  return Array.isArray(value) ? [...value] : [];
}

function imageUrl(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return String(value.url ?? value.src ?? value.image_url ?? value.public_url ?? value.path ?? '');
}

function replaceImageUrl(value, url) {
  if (typeof value === 'string') return url;
  if (!value || typeof value !== 'object') return url;
  for (const key of ['url', 'src', 'image_url', 'public_url', 'path']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return { ...value, [key]: url };
  }
  return url;
}

function isSupabaseStorageUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith('.supabase.co')
      && url.pathname.includes('/storage/v1/object/public/vehicles/');
  } catch (error) {
    return false;
  }
}
