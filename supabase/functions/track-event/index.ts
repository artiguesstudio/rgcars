import { createClient } from "npm:@supabase/supabase-js@2";

type UnknownRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const forbiddenKey = /(?:^|_)(?:email|phone|telephone|whatsapp|message|comment|notes?|cuil|dni|document|plate|address)(?:$|_)/i;
const personNameKeys = new Set(["name", "full_name", "first_name", "last_name", "customer_name", "owner_name", "visitor_name", "contact_name"]);
const allowedAttributionKeys = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "qr_code", "campaign_code", "ad_code", "vehicle_id",
  "page_key", "url", "referrer", "touched_at",
]);
const allowedQueryKeys = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "qr_code", "campaign_code", "ad_code", "vehicle_id", "id", "mode",
];

function json(body: UnknownRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function privacySafeText(value: unknown, max = 500) {
  const normalized = text(value, max);
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/i.test(normalized)) return "[redacted]";
  if (/(?:\+?\d[\s().-]*){7,}/.test(normalized.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""))) return "[redacted]";
  return normalized;
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isForbiddenKey(value: string) {
  const normalized = value.toLowerCase();
  return personNameKeys.has(normalized) || forbiddenKey.test(normalized);
}

function safeUrl(value: unknown) {
  try {
    const url = new URL(text(value, 2000), "https://rgcars.invalid/");
    if (!/^https?:$/i.test(url.protocol)) return null;
    const safe = new URLSearchParams();
    allowedQueryKeys.forEach((key) => {
      const item = privacySafeText(url.searchParams.get(key), 300);
      if (item) safe.set(key, item);
    });
    url.search = safe.toString();
    url.hash = "";
    return url.hostname === "rgcars.invalid" ? `${url.pathname}${url.search}`.slice(0, 1200) : url.toString().slice(0, 1200);
  } catch {
    return null;
  }
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value == null ? null : undefined;
  if (typeof value === "string") return privacySafeText(value, 500);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1)).filter((item) => item !== undefined);
  if (isRecord(value)) {
    const result: UnknownRecord = {};
    for (const [key, item] of Object.entries(value)) {
      if (isForbiddenKey(key)) continue;
      const safe = sanitize(item, depth + 1);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }
  return undefined;
}

function sanitizeTouch(value: unknown) {
  if (!isRecord(value)) return {};
  const result: UnknownRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowedAttributionKeys.has(key)) continue;
    const normalized = key === "url" || key === "referrer"
      ? safeUrl(item)
      : (key === "touched_at" ? text(item, 50) : privacySafeText(item, 300));
    if (normalized) result[key] = normalized;
  }
  return result;
}

function sanitizeAttribution(value: unknown) {
  if (!isRecord(value)) return {};
  return {
    first_touch: sanitizeTouch(value.first_touch),
    last_touch: sanitizeTouch(value.last_touch),
    visitor_key: text(value.visitor_key, 120) || null,
    session_key: text(value.session_key, 120) || null,
    landing_url: safeUrl(value.landing_url),
    conversion_url: safeUrl(value.conversion_url),
    referrer: safeUrl(value.referrer),
    first_visit_at: text(value.first_visit_at, 50) || null,
    conversion_at: text(value.conversion_at, 50) || null,
    vehicle_id: text(value.vehicle_id, 120) || null,
    ga_client_id: text(value.ga_client_id, 120) || null,
    ga_session_id: text(value.ga_session_id, 120) || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const technicalId = crypto.randomUUID();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Servicio no configurado.", technicalId }, 503);

    const body = await req.json();
    if (!isRecord(body)) return json({ ok: false, error: "Payload inválido.", technicalId }, 400);
    const eventName = text(body.event_name, 80);
    const eventId = text(body.event_id, 120);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(eventName) || !eventId) {
      return json({ ok: false, error: "Evento inválido.", technicalId }, 400);
    }

    const payload = (sanitize(body.payload) || {}) as UnknownRecord;
    const attribution = sanitizeAttribution(body.attribution) as UnknownRecord;
    const pageKey = text(body.page_key, 80) || null;
    const pagePath = safeUrl(body.page_path);
    const visitorKey = text(attribution.visitor_key, 120) || null;
    const sessionKey = text(attribution.session_key, 120) || null;
    const vehicleId = text(payload.vehicle_id || attribution.vehicle_id, 120) || null;
    const serviceType = text(payload.service_type, 80) || null;
    const campaignReference = text(payload.campaign_reference, 80) || null;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: eventError } = await supabase.from("web_events").upsert({
      event_id: eventId,
      event_name: eventName,
      page_key: pageKey,
      page_path: pagePath,
      visitor_key: visitorKey,
      session_key: sessionKey,
      vehicle_id: vehicleId,
      service_type: serviceType,
      campaign_reference: campaignReference,
      payload,
      attribution,
    }, { onConflict: "event_id", ignoreDuplicates: true });
    if (eventError) throw new Error(`web_events:${eventError.code || "db"}`);

    if (eventName === "page_view") {
      const { error } = await supabase.from("web_page_views").upsert({
        event_id: eventId,
        page_key: pageKey || "other",
        page_path: pagePath || "/",
        page_title: text(body.page_title, 300) || null,
        referrer: text(attribution.referrer, 1200) || null,
        visitor_key: visitorKey,
        session_key: sessionKey,
        vehicle_id: vehicleId,
        attribution,
      }, { onConflict: "event_id", ignoreDuplicates: true });
      if (error) throw new Error(`web_page_views:${error.code || "db"}`);
    }

    if (eventName === "click_whatsapp" && campaignReference) {
      const { error } = await supabase.from("whatsapp_clicks").upsert({
        event_id: eventId,
        reference_code: campaignReference,
        page_key: pageKey,
        click_location: text(payload.click_location, 80) || null,
        service_type: serviceType,
        vehicle_id: vehicleId,
        visitor_key: visitorKey,
        session_key: sessionKey,
        attribution,
      }, { onConflict: "event_id", ignoreDuplicates: true });
      if (error) throw new Error(`whatsapp_clicks:${error.code || "db"}`);
    }

    return json({ ok: true, eventId, technicalId });
  } catch (error) {
    const technicalCode = error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "unexpected";
    console.error("track-event failure", { technicalId, technicalCode });
    return json({ ok: false, error: "No se pudo registrar el evento.", technicalId }, 500);
  }
});
