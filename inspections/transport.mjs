/** PHP is the default. An explicit endpoint also supports the Supabase Edge API. */
export function inspectionEndpoint(config = globalThis.RG) {
  const endpoint = String(config?.INSPECTIONS_ENDPOINT || '/api/inspections.php').trim();
  const url = new URL(endpoint, globalThis.location?.href || 'https://rgcars.invalid/');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('La dirección del módulo de peritajes no es válida.');
  return endpoint;
}

export function inspectionHeaders(config = globalThis.RG, accessToken = '', multipart = false) {
  const headers = multipart ? {} : { 'Content-Type': 'application/json' };
  if (config?.SUPABASE_ANON_KEY) headers.apikey = config.SUPABASE_ANON_KEY;
  const token = accessToken || config?.SUPABASE_ANON_KEY;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
