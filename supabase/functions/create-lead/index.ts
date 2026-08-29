import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
import { deliverConversion } from "../_shared/conversion-delivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_FROM = "RG Cars TDF <no-responder@rgcars.com.ar>";

const SERVICE_CONFIG = {
  vende_tu_auto: {
    label: "vender tu auto",
    adminLabel: "Vendé tu auto",
    table: "consignment_leads",
    defaultSource: "servicio_vende_tu_auto",
  },
  busqueda_personalizada: {
    label: "búsqueda personalizada",
    adminLabel: "Búsqueda personalizada",
    table: "scouting_requests",
    defaultSource: "servicio_busqueda_personalizada",
  },
  financiacion: {
    label: "financiación",
    adminLabel: "Financiación",
    table: "financing_leads",
    defaultSource: "servicio_financiacion",
  },
  seguro_automotor: {
    label: "seguros del automotor",
    adminLabel: "Seguros del automotor",
    table: "insurance_leads",
    defaultSource: "servicio_seguro_automotor",
  },
  peritaje_precompra: {
    label: "peritaje pre-compra",
    adminLabel: "Peritajes pre-compra",
    table: "peritaje_leads",
    defaultSource: "servicio_peritaje_precompra",
  },
} as const;

type ServiceType = keyof typeof SERVICE_CONFIG;
type UnknownRecord = Record<string, unknown>;

type LeadInput = {
  serviceType: ServiceType;
  source: string;
  name: string;
  phone: string;
  email: string;
  message: string | null;
  vehicleId: string | null;
  vehicleTitle: string | null;
  metadata: UnknownRecord;
  eventId: string;
  submissionKey: string;
  attribution: UnknownRecord;
};

function json(body: UnknownRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value: unknown) {
  return normalizeText(value);
}

function parseInteger(value: unknown) {
  if (value == null || value === "") return null;
  const digits = String(value).replace(/\D+/g, "");
  return digits ? Number(digits) : null;
}

function isPlainObject(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function privacySafeText(value: unknown, max = 500) {
  const normalized = normalizeText(value).slice(0, max);
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/i.test(normalized)) return "[redacted]";
  if (/(?:\+?\d[\s().-]*){7,}/.test(normalized.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""))) return "[redacted]";
  return normalized;
}

function technicalCode(value: unknown, fallback = "unexpected") {
  if (isPlainObject(value)) return normalizeText(value.code || value.status || fallback).slice(0, 80) || fallback;
  return fallback;
}

const ATTRIBUTION_TOUCH_KEYS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "qr_code", "campaign_code", "ad_code", "vehicle_id",
  "page_key", "url", "referrer", "touched_at",
]);
const ATTRIBUTION_QUERY_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "qr_code", "campaign_code", "ad_code", "vehicle_id", "id", "mode",
];

function sanitizeAttributionUrl(value: unknown) {
  try {
    const url = new URL(normalizeText(value));
    if (!/^https?:$/i.test(url.protocol)) return null;
    const safe = new URLSearchParams();
    ATTRIBUTION_QUERY_KEYS.forEach((key) => {
      const item = privacySafeText(url.searchParams.get(key), 300);
      if (item) safe.set(key, item);
    });
    url.search = safe.toString();
    url.hash = "";
    return url.toString().slice(0, 1200);
  } catch {
    return null;
  }
}

function sanitizeAttributionTouch(value: unknown) {
  if (!isPlainObject(value)) return {};
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (!ATTRIBUTION_TOUCH_KEYS.has(key)) continue;
    if (key === "url" || key === "referrer") {
      const url = sanitizeAttributionUrl(item);
      if (url) output[key] = url;
      continue;
    }
    const normalized = key === "touched_at" ? normalizeText(item).slice(0, 50) : privacySafeText(item, 300);
    if (normalized) output[key] = normalized;
  }
  return output;
}

function sanitizeAttribution(value: unknown) {
  if (!isPlainObject(value)) return {};
  const consent = isPlainObject(value.consent) ? value.consent : {};
  return {
    first_touch: sanitizeAttributionTouch(value.first_touch),
    last_touch: sanitizeAttributionTouch(value.last_touch),
    visitor_key: normalizeNullableText(value.visitor_key)?.slice(0, 120) || null,
    session_key: normalizeNullableText(value.session_key)?.slice(0, 120) || null,
    landing_url: sanitizeAttributionUrl(value.landing_url),
    conversion_url: sanitizeAttributionUrl(value.conversion_url),
    referrer: sanitizeAttributionUrl(value.referrer),
    first_visit_at: normalizeNullableText(value.first_visit_at)?.slice(0, 50) || null,
    conversion_at: normalizeNullableText(value.conversion_at)?.slice(0, 50) || new Date().toISOString(),
    vehicle_id: normalizeNullableText(value.vehicle_id)?.slice(0, 120) || null,
    fbp: normalizeNullableText(value.fbp)?.slice(0, 500) || null,
    fbc: normalizeNullableText(value.fbc)?.slice(0, 500) || null,
    ga_client_id: normalizeNullableText(value.ga_client_id)?.slice(0, 120) || null,
    ga_session_id: normalizeNullableText(value.ga_session_id)?.slice(0, 120) || null,
    consent: {
      analytics: consent.analytics === true,
      marketing: consent.marketing === true,
    },
  };
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

function isValidName(value: string) {
  return value.length >= 2;
}

function isValidPhone(value: string) {
  if (!value) return false;
  if (!/^[\d\s()+-]+$/.test(value)) return false;
  return value.replace(/\D+/g, "").length >= 6;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseTeamEmails(value: string): string[] {
  return [...new Set<string>(
    String(value || "")
      .split(",")
      .map((item) => normalizeEmail(item))
      .filter(Boolean)
      .filter(isValidEmail),
  )];
}

function serviceMetadataLines(serviceType: ServiceType, lead: LeadInput) {
  const metadata = lead.metadata || {};
  switch (serviceType) {
    case "vende_tu_auto":
      return [
        ["Vehículo a vender", normalizeText(metadata.vehicle_to_sell || lead.vehicleTitle || "")],
      ];
    case "busqueda_personalizada":
      return [
        ["Vehículo buscado", normalizeText(metadata.searched_vehicle || lead.vehicleTitle || "")],
        ["Presupuesto aproximado", normalizeText(metadata.budget_display || "")],
      ];
    case "financiacion":
      return [
        ["Vehículo o monto a financiar", normalizeText(metadata.financing_reference || lead.vehicleTitle || "")],
        ["Monto estimado", normalizeText(metadata.requested_amount_display || "")],
      ];
    case "seguro_automotor":
      return [
        ["Vehículo a asegurar", normalizeText(metadata.insurance_vehicle || lead.vehicleTitle || "")],
      ];
    case "peritaje_precompra":
      return [
        ["Vehículo a peritar", normalizeText(metadata.inspection_vehicle || lead.vehicleTitle || "")],
      ];
    default:
      return [];
  }
}

function metadataSummaryText(serviceType: ServiceType, lead: LeadInput) {
  const rows = serviceMetadataLines(serviceType, lead)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  return rows.length ? rows.join("\n") : "Sin datos adicionales.";
}

function metadataSummaryHtml(serviceType: ServiceType, lead: LeadInput) {
  const rows = serviceMetadataLines(serviceType, lead).filter(([, value]) => value);
  if (!rows.length) return "<p>Sin datos adicionales.</p>";
  return `<ul>${rows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function buildCommonInsert(lead: LeadInput) {
  const firstTouch = isPlainObject(lead.attribution.first_touch) ? lead.attribution.first_touch : {};
  const lastTouch = isPlainObject(lead.attribution.last_touch) ? lead.attribution.last_touch : {};
  return {
    submission_key: lead.submissionKey,
    lead_event_id: lead.eventId,
    service_type: lead.serviceType,
    crm_stage: "lead",
    lead_validity: "pending",
    first_touch: firstTouch,
    last_touch: lastTouch,
    visitor_key: normalizeNullableText(lead.attribution.visitor_key),
    session_key: normalizeNullableText(lead.attribution.session_key),
    landing_url: normalizeNullableText(lead.attribution.landing_url),
    conversion_url: normalizeNullableText(lead.attribution.conversion_url),
    initial_referrer: normalizeNullableText(lead.attribution.referrer),
    first_visit_at: normalizeNullableText(lead.attribution.first_visit_at),
    conversion_at: normalizeNullableText(lead.attribution.conversion_at) || new Date().toISOString(),
  };
}

function buildConsignmentInsert(lead: LeadInput) {
  const vehicleSummary = normalizeText(lead.metadata.vehicle_to_sell || lead.vehicleTitle || "");
  const note = normalizeText(lead.message || "");
  return {
    ...buildCommonInsert(lead),
    id: crypto.randomUUID(),
    brand: null,
    model: null,
    version: vehicleSummary,
    year: null,
    km: null,
    plate: null,
    category: normalizeText(lead.metadata.category || "auto") || "auto",
    fuel: null,
    transmission: null,
    condition_summary: note || `Vehículo informado por el cliente: ${vehicleSummary}.`,
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
    pricing_notes: note || null,
    owner_name: lead.name,
    owner_phone: lead.phone,
    owner_email: lead.email,
    owner_city: null,
    contact_preference: "whatsapp",
    status: "new",
  };
}

function buildScoutingInsert(lead: LeadInput) {
  const vehicleQuery = normalizeText(lead.metadata.searched_vehicle || lead.vehicleTitle || "");
  const budgetText = normalizeText(lead.metadata.budget_display || "");
  const budgetValue = parseInteger(lead.metadata.budget ?? lead.metadata.budget_display);
  return {
    ...buildCommonInsert(lead),
    id: crypto.randomUUID(),
    customer_name: lead.name,
    email: lead.email,
    phone: lead.phone,
    city: null,
    contact_preference: "whatsapp",
    brand: null,
    model: null,
    version: vehicleQuery,
    category: normalizeText(lead.metadata.category || "auto") || "auto",
    year_min: null,
    year_max: null,
    km_max: null,
    fuel: null,
    transmission: null,
    color: null,
    price_min: budgetValue,
    price_max: budgetValue,
    currency: "ARS",
    financing_needed: false,
    trade_in: false,
    urgency: "media",
    use_case: "busqueda_personalizada",
    must_have: vehicleQuery,
    notes: budgetText ? `Presupuesto aproximado: ${budgetText}` : (lead.message || null),
    status: "active",
  };
}

function buildFinancingInsert(lead: LeadInput) {
  const financingReference = normalizeText(lead.metadata.financing_reference || lead.vehicleTitle || "");
  const vehiclePrice = parseInteger(lead.metadata.vehicle_price);
  const requestedAmount = parseInteger(lead.metadata.requested_amount) ?? vehiclePrice;
  return {
    ...buildCommonInsert(lead),
    status: "new",
    origin: "financiacion",
    entity: null,
    customer_name: lead.name,
    cuil: null,
    phone: lead.phone,
    email: lead.email,
    city: null,
    contact_preference: "whatsapp",
    vehicle_id: lead.vehicleId,
    vehicle_title: financingReference || lead.vehicleTitle || null,
    vehicle_brand: null,
    vehicle_model: null,
    vehicle_year: parseInteger(lead.metadata.vehicle_year),
    vehicle_total_price: vehiclePrice,
    down_payment: null,
    requested_amount: requestedAmount,
    installments: null,
    estimated_monthly_payment: null,
    estimated_total_cost: null,
    estimated_monthly_rate: null,
    operation_context: normalizeNullableText(lead.metadata.operation_type),
    notes: lead.message,
    source_page: lead.source,
    profile_code: null,
    vehicle_type: normalizeText(lead.metadata.vehicle_type || "auto") || "auto",
  };
}

function buildInsuranceInsert(lead: LeadInput) {
  const vehicleTitle = normalizeText(lead.metadata.insurance_vehicle || lead.vehicleTitle || "");
  return {
    ...buildCommonInsert(lead),
    status: "new",
    customer_name: lead.name,
    cuil: null,
    phone: lead.phone,
    email: lead.email,
    city: null,
    vehicle_id: lead.vehicleId,
    vehicle_title: vehicleTitle || null,
    vehicle_brand: null,
    vehicle_model: null,
    vehicle_year: parseInteger(lead.metadata.vehicle_year),
    plate: null,
    insured_amount: null,
    coverage_type: "a-definir",
    use_type: "particular",
    insurer_preference: null,
    current_insurer: null,
    needs_financing: false,
    notes: lead.message,
    source_page: lead.source,
  };
}

function buildPeritajeInsert(lead: LeadInput) {
  const vehicleReference = normalizeText(lead.metadata.inspection_vehicle || lead.vehicleTitle || "");
  return {
    ...buildCommonInsert(lead),
    status: "new",
    vehicle_id: lead.vehicleId,
    customer_name: lead.name,
    phone: lead.phone,
    email: lead.email,
    city: null,
    vehicle_brand: null,
    vehicle_model: vehicleReference || null,
    vehicle_year: null,
    plate: null,
    km: null,
    inspection_reason: "pre-compra",
    appointment_date: null,
    appointment_time: null,
    notes: lead.message,
    contact_preference: "whatsapp",
    source_page: lead.source,
  };
}

function buildInsertPayload(lead: LeadInput) {
  switch (lead.serviceType) {
    case "vende_tu_auto":
      return buildConsignmentInsert(lead);
    case "busqueda_personalizada":
      return buildScoutingInsert(lead);
    case "financiacion":
      return buildFinancingInsert(lead);
    case "seguro_automotor":
      return buildInsuranceInsert(lead);
    case "peritaje_precompra":
      return buildPeritajeInsert(lead);
    default:
      throw new Error("Tipo de servicio no soportado.");
  }
}

function normalizeLeadInput(body: unknown): LeadInput {
  if (!isPlainObject(body)) throw new Error("Payload inválido.");

  const serviceType = normalizeText(body.serviceType || body.service_type) as ServiceType;
  if (!(serviceType in SERVICE_CONFIG)) throw new Error("Servicio inválido.");

  const requestedSource = normalizeText(body.source);
  const source = /^[A-Za-z0-9_-]{1,80}$/.test(requestedSource) ? requestedSource : SERVICE_CONFIG[serviceType].defaultSource;
  const name = normalizeText(body.name);
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  const message = normalizeNullableText(body.message);
  const requestedVehicleId = normalizeText(body.vehicleId || body.vehicle_id);
  const vehicleId = /^[A-Za-z0-9_-]{1,120}$/.test(requestedVehicleId) ? requestedVehicleId : null;
  const vehicleTitle = normalizeNullableText(body.vehicleTitle || body.vehicle_title);
  const metadata = isPlainObject(body.metadata) ? body.metadata : {};
  const eventId = (normalizeText(body.eventId || body.event_id) || `lead_${crypto.randomUUID()}`).slice(0, 120);
  const submissionKey = (normalizeText(body.submissionKey || body.submission_key) || `sub_${crypto.randomUUID()}`).slice(0, 120);
  const attribution = sanitizeAttribution(body.attribution);

  if (!isValidName(name)) throw new Error("Ingresá un nombre completo válido.");
  if (!isValidPhone(phone)) throw new Error("Ingresá un WhatsApp válido.");
  if (!isValidEmail(email)) throw new Error("Ingresá un email válido.");
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(eventId)) throw new Error("Identificador de evento inválido.");
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(submissionKey)) throw new Error("Identificador de envío inválido.");

  return {
    serviceType,
    source,
    name,
    phone,
    email,
    message,
    vehicleId,
    vehicleTitle,
    metadata,
    eventId,
    submissionKey,
    attribution,
  };
}

function buildUserEmail(lead: LeadInput, createdAt: string) {
  const service = SERVICE_CONFIG[lead.serviceType];
  const text = [
    `Hola ${lead.name},`,
    "",
    `Recibimos tu consulta sobre ${service.label}.`,
    "",
    "Un asesor de RG Cars TDF se va a contactar con vos a la brevedad para ayudarte con la información que necesitás.",
    "",
    "Gracias por comunicarte con nosotros.",
    "",
    "RG Cars TDF",
    "Cuidamos el valor de tu esfuerzo.",
    createdAt ? `Recibido: ${createdAt}` : "",
  ].filter(Boolean).join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <p>Hola ${escapeHtml(lead.name)},</p>
      <p>Recibimos tu consulta sobre <strong>${escapeHtml(service.label)}</strong>.</p>
      <p>Un asesor de RG Cars TDF se va a contactar con vos a la brevedad para ayudarte con la información que necesitás.</p>
      <p>Gracias por comunicarte con nosotros.</p>
      <p><strong>RG Cars TDF</strong><br />Cuidamos el valor de tu esfuerzo.</p>
    </div>
  `;

  return {
    subject: "Recibimos tu consulta en RG Cars TDF",
    text,
    html,
  };
}

function buildTeamEmail(lead: LeadInput, createdAt: string, backofficeUrl: string) {
  const service = SERVICE_CONFIG[lead.serviceType];
  const detail = lead.message || "Sin detalle adicional.";
  const vehicleBlock = [lead.vehicleTitle, lead.vehicleId].filter(Boolean).join(" · ") || "Sin vehículo relacionado.";
  const additionalText = metadataSummaryText(lead.serviceType, lead);
  const additionalHtml = metadataSummaryHtml(lead.serviceType, lead);
  const backofficeButton = backofficeUrl
    ? `<p><a href="${escapeHtml(backofficeUrl)}" style="display:inline-block;background:#e31c25;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Ingresar al backoffice</a></p>`
    : "";

  const text = [
    "Nuevo lead recibido desde RG Cars TDF.",
    "",
    `Servicio: ${service.adminLabel}`,
    "",
    "Datos del contacto:",
    `Nombre: ${lead.name}`,
    `WhatsApp: ${lead.phone}`,
    `Email: ${lead.email}`,
    "",
    `Detalle: ${detail}`,
    "",
    "Datos adicionales:",
    additionalText,
    "",
    `Vehículo relacionado: ${vehicleBlock}`,
    `Origen: ${lead.source}`,
    `Fecha: ${createdAt}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <p><strong>Nuevo lead recibido desde RG Cars TDF.</strong></p>
      <p><strong>Servicio:</strong> ${escapeHtml(service.adminLabel)}</p>
      <p><strong>Datos del contacto:</strong><br />
      Nombre: ${escapeHtml(lead.name)}<br />
      WhatsApp: ${escapeHtml(lead.phone)}<br />
      Email: ${escapeHtml(lead.email)}</p>
      <p><strong>Detalle:</strong><br />${escapeHtml(detail)}</p>
      <p><strong>Datos adicionales:</strong></p>
      ${additionalHtml}
      <p><strong>Vehículo relacionado:</strong><br />${escapeHtml(vehicleBlock)}</p>
      <p><strong>Origen:</strong> ${escapeHtml(lead.source)}<br />
      <strong>Fecha:</strong> ${escapeHtml(createdAt)}</p>
      ${backofficeButton}
    </div>
  `;

  return {
    subject: `Nuevo lead: ${service.adminLabel}`,
    text,
    html,
  };
}

async function resolveBackofficeRecipients(supabase: any) {
  const directEnv = parseTeamEmails(Deno.env.get("BACKOFFICE_NOTIFICATION_EMAILS") || "");
  try {
    const { data, error } = await supabase
      .from("admin_access_profiles")
      .select("email, is_active")
      .eq("is_active", true)
      .order("email", { ascending: true });

    if (error) throw error;

    const fromTable: string[] = [...new Set<string>((data || [])
      .map((item: any) => normalizeEmail(item?.email))
      .filter(Boolean)
      .filter(isValidEmail))];

    return fromTable.length ? fromTable : directEnv;
  } catch (error) {
    console.warn("create-lead recipient lookup failure", { technicalCode: technicalCode(error, "lookup") });
    return directEnv;
  }
}

async function persistNotificationState(
  supabase: any,
  table: string,
  id: string,
  state: {
    emailSentToUser: boolean;
    emailSentToTeam: boolean;
    emailError: string | null;
    notifiedAt: string | null;
  },
) {
  try {
    const { error } = await supabase
      .from(table)
      .update({
        email_sent_to_user: state.emailSentToUser,
        email_sent_to_team: state.emailSentToTeam,
        email_error: state.emailError,
        notified_at: state.notifiedAt,
      })
      .eq("id", id);

    if (error) throw error;
  } catch (error) {
    console.warn("create-lead notification state failure", { table, technicalCode: technicalCode(error, "db") });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Método no permitido." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return json({
        ok: false,
        error: "Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en la función.",
      }, 500);
    }

    const lead = normalizeLeadInput(await req.json());
    const service = SERVICE_CONFIG[lead.serviceType];
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existingLead } = await supabase
      .from(service.table)
      .select("id, lead_event_id")
      .eq("submission_key", lead.submissionKey)
      .maybeSingle();
    if (existingLead?.id) {
      return json({
        ok: true,
        saved: true,
        deduplicated: true,
        leadId: existingLead.id,
        eventId: normalizeText(existingLead.lead_event_id) || lead.eventId,
        serviceType: lead.serviceType,
        emailSentToUser: false,
        emailSentToTeam: false,
        emailError: null,
      });
    }

    const insertPayload = buildInsertPayload(lead);
    let wasDeduplicated = false;
    let { data: savedLead, error: insertError } = await supabase
      .from(service.table)
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError?.code === "23505") {
      const duplicate = await supabase
        .from(service.table)
        .select("*, lead_event_id")
        .eq("submission_key", lead.submissionKey)
        .maybeSingle();
      if (duplicate.data?.id) {
        savedLead = duplicate.data;
        insertError = null;
        wasDeduplicated = true;
      }
    }

    if (insertError || !savedLead) {
      console.error("create-lead persistence failure", { technicalCode: insertError?.code || "missing_row" });
      return json({ ok: false, error: "No pudimos enviar tu consulta. Intentá nuevamente o escribinos por WhatsApp." }, 500);
    }

    const firstTouch = isPlainObject(lead.attribution.first_touch) ? lead.attribution.first_touch : {};
    const lastTouch = isPlainObject(lead.attribution.last_touch) ? lead.attribution.last_touch : {};
    const attributionConsent = isPlainObject(lead.attribution.consent) ? lead.attribution.consent : {};
    const canonicalEventId = normalizeText(savedLead.lead_event_id) || lead.eventId;
    const { error: attributionError } = await supabase.from("lead_attribution").upsert({
      lead_type: lead.serviceType,
      lead_id: savedLead.id,
      submission_key: lead.submissionKey,
      event_id: canonicalEventId,
      first_touch: firstTouch,
      last_touch: lastTouch,
      visitor_key: normalizeNullableText(lead.attribution.visitor_key),
      session_key: normalizeNullableText(lead.attribution.session_key),
      landing_url: normalizeNullableText(lead.attribution.landing_url),
      conversion_url: normalizeNullableText(lead.attribution.conversion_url),
      initial_referrer: normalizeNullableText(lead.attribution.referrer),
      vehicle_id: lead.vehicleId || normalizeNullableText(lead.attribution.vehicle_id),
      fbp: normalizeNullableText(lead.attribution.fbp),
      fbc: normalizeNullableText(lead.attribution.fbc),
      ga_client_id: normalizeNullableText(lead.attribution.ga_client_id),
      ga_session_id: normalizeNullableText(lead.attribution.ga_session_id),
      analytics_consent: attributionConsent.analytics === true,
      marketing_consent: attributionConsent.marketing === true,
      first_visit_at: normalizeNullableText(lead.attribution.first_visit_at),
      converted_at: normalizeNullableText(lead.attribution.conversion_at) || new Date().toISOString(),
    }, { onConflict: "lead_type,lead_id" });
    if (attributionError) {
      console.error("create-lead attribution failure", { technicalCode: attributionError.code || "db" });
    }

    const consent = isPlainObject(lead.attribution.consent) ? lead.attribution.consent : {};
    await deliverConversion({
      supabase,
      providerEventName: "Lead",
      eventId: canonicalEventId,
      occurredAt: normalizeNullableText(lead.attribution.conversion_at) || savedLead.created_at,
      eventSourceUrl: normalizeNullableText(lead.attribution.conversion_url),
      leadType: lead.serviceType,
      leadId: String(savedLead.id),
      email: lead.email,
      phone: lead.phone,
      attribution: lead.attribution,
      parameters: {
        lead_id: String(savedLead.id),
        service_type: lead.serviceType,
        vehicle_id: lead.vehicleId,
        source: lead.source,
      },
      actionSource: "website",
      allowMeta: consent.marketing === true,
      allowGa4: false,
    }).catch(() => {
      console.error("create-lead conversion delivery failure", { technicalCode: "unexpected" });
    });

    if (wasDeduplicated) {
      return json({
        ok: true,
        saved: true,
        deduplicated: true,
        leadId: savedLead.id,
        eventId: canonicalEventId,
        serviceType: lead.serviceType,
        emailSentToUser: false,
        emailSentToTeam: false,
        emailError: null,
      });
    }

    if (lead.serviceType === "busqueda_personalizada") {
      const { error: matchError } = await supabase.rpc("rebuild_matches_for_request", {
        p_request_id: savedLead.id,
      });
      if (matchError) {
        console.warn("create-lead matching failure", { technicalCode: technicalCode(matchError, "rpc") });
      }
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
    const emailFrom = normalizeText(Deno.env.get("EMAIL_FROM")) || DEFAULT_FROM;
    const backofficeUrl = normalizeText(Deno.env.get("BACKOFFICE_URL"));
    const createdAt = normalizeText(savedLead.created_at) || new Date().toISOString();
    const createdAtLabel = new Date(createdAt).toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Argentina/Buenos_Aires",
    });

    let emailSentToUser = false;
    let emailSentToTeam = false;
    const emailErrors: string[] = [];

    if (!resendApiKey) {
      emailErrors.push("Falta RESEND_API_KEY en la función.");
    } else {
      const resend = new Resend(resendApiKey);
      const userEmail = buildUserEmail(lead, createdAtLabel);
      try {
        await resend.emails.send({
          from: emailFrom,
          to: [lead.email],
          subject: userEmail.subject,
          text: userEmail.text,
          html: userEmail.html,
        });
        emailSentToUser = true;
      } catch (error) {
        console.error("create-lead user email failure", { technicalCode: technicalCode(error, "email") });
        emailErrors.push("No se pudo enviar el email de confirmación al usuario.");
      }

      const teamRecipients = await resolveBackofficeRecipients(supabase);
      if (!teamRecipients.length) {
        emailErrors.push("No hay destinatarios internos configurados.");
      } else {
        const teamEmail = buildTeamEmail(lead, createdAtLabel, backofficeUrl);
        try {
          await resend.emails.send({
            from: emailFrom,
            to: teamRecipients,
            subject: teamEmail.subject,
            text: teamEmail.text,
            html: teamEmail.html,
          });
          emailSentToTeam = true;
        } catch (error) {
          console.error("create-lead team email failure", { technicalCode: technicalCode(error, "email") });
          emailErrors.push("No se pudo enviar el email interno al backoffice.");
        }
      }
    }

    const emailError = emailErrors.length ? emailErrors.join(" ") : null;
    const notifiedAt = emailSentToUser || emailSentToTeam ? new Date().toISOString() : null;

    await persistNotificationState(supabase, service.table, savedLead.id, {
      emailSentToUser,
      emailSentToTeam,
      emailError,
      notifiedAt,
    });

    return json({
      ok: true,
      saved: true,
      leadId: savedLead.id,
      eventId: canonicalEventId,
      serviceType: lead.serviceType,
      emailSentToUser,
      emailSentToTeam,
      emailError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No pudimos procesar la consulta.";
    const status = /válido|inválido|Servicio inválido|Payload inválido/i.test(message) ? 400 : 500;
    console.error("create-lead failure", { technicalCode: technicalCode(error) });
    return json({ ok: false, error: message }, status);
  }
});
