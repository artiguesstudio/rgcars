type UnknownRecord = Record<string, unknown>;

type DeliveryInput = {
  supabase: any;
  providerEventName: string;
  eventId: string;
  occurredAt?: string | null;
  eventSourceUrl?: string | null;
  leadType: string;
  leadId: string;
  email?: string | null;
  phone?: string | null;
  attribution?: UnknownRecord;
  parameters?: UnknownRecord;
  actionSource?: "website" | "system_generated";
  allowMeta?: boolean;
  allowGa4?: boolean;
};

type DeliveryResult = {
  provider: "meta" | "ga4";
  status: "sent" | "failed" | "skipped";
  responseCode?: number | null;
  technicalCode?: string | null;
};

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function privacySafeText(value: unknown, max = 500) {
  const normalized = text(value, max);
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/i.test(normalized)) return "[redacted]";
  if (/(?:\+?\d[\s().-]*){7,}/.test(normalized.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""))) return "[redacted]";
  return normalized;
}

function safeEventSourceUrl(value: unknown) {
  try {
    const url = new URL(text(value, 2000));
    if (!/^https?:$/i.test(url.protocol)) return "";
    const allowed = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "fbclid", "gclid", "qr_code", "campaign_code", "ad_code", "vehicle_id", "id", "mode",
    ];
    const safe = new URLSearchParams();
    allowed.forEach((key) => {
      const item = privacySafeText(url.searchParams.get(key), 300);
      if (item) safe.set(key, item);
    });
    url.search = safe.toString();
    url.hash = "";
    return url.toString().slice(0, 1200);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function normalizePhone(value: unknown) {
  let digits = text(value).replace(/\D+/g, "").replace(/^0+/, "");
  if (!digits) return "";
  if (!digits.startsWith("54") && digits.length >= 8 && digits.length <= 11) digits = `549${digits}`;
  return digits;
}

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function touch(attribution: UnknownRecord, name: "first_touch" | "last_touch") {
  return isRecord(attribution[name]) ? attribution[name] as UnknownRecord : {};
}

function clickValue(attribution: UnknownRecord, key: string) {
  return text(touch(attribution, "last_touch")[key] || touch(attribution, "first_touch")[key], 500);
}

function eventFbc(attribution: UnknownRecord) {
  const existing = text(attribution.fbc, 500);
  if (existing) return existing;
  const fbclid = clickValue(attribution, "fbclid");
  if (!fbclid) return "";
  const touchedAt = text(touch(attribution, "last_touch").touched_at || touch(attribution, "first_touch").touched_at, 50);
  const timestamp = Math.floor((Date.parse(touchedAt) || Date.now()) / 1000);
  return `fb.1.${timestamp}.${fbclid}`;
}

async function deliveryState(supabase: any, provider: string, eventId: string, eventName: string) {
  const { data } = await supabase
    .from("conversion_delivery_log")
    .select("status, attempt_count")
    .eq("provider", provider)
    .eq("event_id", eventId)
    .eq("event_name", eventName)
    .maybeSingle();
  return data || null;
}

async function updateDeliveryLog(
  input: DeliveryInput,
  provider: "meta" | "ga4",
  status: "pending" | "sent" | "retry" | "failed" | "skipped",
  details: { responseCode?: number | null; technicalCode?: string | null; attemptCount?: number; nextRetryAt?: string | null } = {},
) {
  const now = new Date().toISOString();
  await input.supabase.from("conversion_delivery_log").upsert({
    provider,
    event_id: input.eventId,
    event_name: input.providerEventName,
    lead_type: input.leadType,
    lead_id: input.leadId,
    status,
    attempt_count: details.attemptCount || 0,
    response_code: details.responseCode ?? null,
    technical_code: text(details.technicalCode, 100) || null,
    last_attempt_at: status === "skipped" ? null : now,
    next_retry_at: details.nextRetryAt || null,
    updated_at: now,
  }, { onConflict: "provider,event_id,event_name" });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function publicParameters(value: unknown) {
  if (!isRecord(value)) return {};
  const forbidden = /(?:^|_)(?:name|email|phone|telephone|whatsapp|message|comment|notes?|cuil|dni|document|plate|address)(?:$|_)/i;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key)) continue;
    if (typeof item === "string") output[key] = privacySafeText(item, 300);
    else if (typeof item === "number" && Number.isFinite(item)) output[key] = item;
    else if (typeof item === "boolean") output[key] = item;
  }
  return output;
}

async function deliverMeta(input: DeliveryInput): Promise<DeliveryResult> {
  if (input.allowMeta === false) return { provider: "meta", status: "skipped", technicalCode: "consent_denied" };
  const datasetId = text(Deno.env.get("META_PIXEL_ID"), 30);
  const accessToken = text(Deno.env.get("META_CAPI_ACCESS_TOKEN"), 1000);
  const graphVersion = text(Deno.env.get("META_GRAPH_API_VERSION"), 20);
  if (!/^\d{5,20}$/.test(datasetId) || !accessToken || !/^v\d+\.\d+$/.test(graphVersion)) {
    await updateDeliveryLog(input, "meta", "skipped", { technicalCode: "missing_server_config" });
    return { provider: "meta", status: "skipped", technicalCode: "missing_server_config" };
  }

  const existing = await deliveryState(input.supabase, "meta", input.eventId, input.providerEventName);
  if (existing?.status === "sent") return { provider: "meta", status: "sent", technicalCode: "already_sent" };

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const attribution = isRecord(input.attribution) ? input.attribution : {};
  const userData: UnknownRecord = {};
  if (email) userData.em = [await sha256(email)];
  if (phone) userData.ph = [await sha256(phone)];
  if (input.leadId) userData.external_id = [await sha256(`${input.leadType}:${input.leadId}`)];
  const fbp = text(attribution.fbp, 500);
  const fbc = eventFbc(attribution);
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const event: UnknownRecord = {
    event_name: input.providerEventName,
    event_time: Math.floor((Date.parse(text(input.occurredAt, 50)) || Date.now()) / 1000),
    event_id: input.eventId,
    action_source: input.actionSource || "website",
    user_data: userData,
    custom_data: publicParameters(input.parameters),
  };
  const eventSourceUrl = safeEventSourceUrl(input.eventSourceUrl);
  if (eventSourceUrl) event.event_source_url = eventSourceUrl;

  const testEventCode = text(Deno.env.get("META_TEST_EVENT_CODE"), 100);
  const body: UnknownRecord = { data: [event] };
  if (testEventCode) body.test_event_code = testEventCode;
  const endpoint = `https://graph.facebook.com/${graphVersion}/${datasetId}/events?access_token=${encodeURIComponent(accessToken)}`;

  let lastCode: number | null = null;
  let technicalCode = "request_failed";
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attemptsUsed = attempt;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      lastCode = response.status;
      if (response.ok) {
        await updateDeliveryLog(input, "meta", "sent", { responseCode: response.status, technicalCode: "accepted", attemptCount: attempt });
        return { provider: "meta", status: "sent", responseCode: response.status, technicalCode: "accepted" };
      }
      let responseBody: UnknownRecord = {};
      try { responseBody = await response.json(); } catch {}
      const apiError = isRecord(responseBody.error) ? responseBody.error : {};
      technicalCode = text(apiError.code || `http_${response.status}`, 100);
      if (response.status < 500 && response.status !== 429) break;
    } catch {
      technicalCode = "network_error";
    }
    if (attempt < 3) await wait(attempt * 250);
  }

  await updateDeliveryLog(input, "meta", "failed", { responseCode: lastCode, technicalCode, attemptCount: attemptsUsed });
  return { provider: "meta", status: "failed", responseCode: lastCode, technicalCode };
}

async function deliverGa4(input: DeliveryInput): Promise<DeliveryResult> {
  if (input.allowGa4 === false) return { provider: "ga4", status: "skipped", technicalCode: "consent_denied" };
  const measurementId = text(Deno.env.get("GA4_MEASUREMENT_ID"), 30);
  const apiSecret = text(Deno.env.get("GA4_API_SECRET"), 500);
  const attribution = isRecord(input.attribution) ? input.attribution : {};
  const clientId = text(attribution.ga_client_id, 120);
  if (!/^G-[A-Z0-9]+$/i.test(measurementId) || !apiSecret || !clientId) {
    await updateDeliveryLog(input, "ga4", "skipped", { technicalCode: !clientId ? "missing_client_id" : "missing_server_config" });
    return { provider: "ga4", status: "skipped", technicalCode: !clientId ? "missing_client_id" : "missing_server_config" };
  }

  const existing = await deliveryState(input.supabase, "ga4", input.eventId, input.providerEventName);
  if (existing?.status === "sent") return { provider: "ga4", status: "sent", technicalCode: "already_sent" };

  const params: UnknownRecord = {
    ...publicParameters(input.parameters),
    event_id: input.eventId,
    engagement_time_msec: 1,
  };
  const sessionId = text(attribution.ga_session_id, 120);
  if (sessionId) params.session_id = sessionId;
  const occurredAtMs = Date.parse(text(input.occurredAt, 50));
  const body: UnknownRecord = { client_id: clientId, events: [{ name: input.providerEventName, params }] };
  if (Number.isFinite(occurredAtMs)) body.timestamp_micros = String(Math.floor(occurredAtMs * 1000));
  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  let lastCode: number | null = null;
  let technicalCode = "request_failed";
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attemptsUsed = attempt;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      lastCode = response.status;
      if (response.ok) {
        await updateDeliveryLog(input, "ga4", "sent", { responseCode: response.status, technicalCode: "accepted", attemptCount: attempt });
        return { provider: "ga4", status: "sent", responseCode: response.status, technicalCode: "accepted" };
      }
      technicalCode = `http_${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch {
      technicalCode = "network_error";
    }
    if (attempt < 3) await wait(attempt * 250);
  }

  await updateDeliveryLog(input, "ga4", "failed", { responseCode: lastCode, technicalCode, attemptCount: attemptsUsed });
  return { provider: "ga4", status: "failed", responseCode: lastCode, technicalCode };
}

export async function deliverConversion(input: DeliveryInput) {
  const results: DeliveryResult[] = [];
  if (input.allowMeta !== false) results.push(await deliverMeta(input));
  if (input.allowGa4 === true) results.push(await deliverGa4(input));
  return results;
}
