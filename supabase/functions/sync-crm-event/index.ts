import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverConversion } from "../_shared/conversion-delivery.ts";

type UnknownRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LEAD_TABLES: Record<string, string> = {
  consignment: "consignment_leads",
  scouting: "scouting_requests",
  financing: "financing_leads",
  insurance: "insurance_leads",
  peritaje: "peritaje_leads",
};

const GA4_EVENTS = new Set([
  "working_lead", "qualify_lead", "disqualify_lead",
  "schedule_test_drive", "close_convert_lead", "close_unconvert_lead",
]);

const META_EVENT_MAP: Record<string, string | null> = {
  working_lead: null,
  qualify_lead: "CRMQualifiedLead",
  disqualify_lead: "CRMDisqualifiedLead",
  schedule_test_drive: "Schedule",
  close_convert_lead: "Purchase",
  close_unconvert_lead: "CRMUnconvertedLead",
};

function json(body: UnknownRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function leadEmail(leadType: string, lead: UnknownRecord) {
  return text(leadType === "consignment" ? lead.owner_email : lead.email);
}

function leadPhone(leadType: string, lead: UnknownRecord) {
  return text(leadType === "consignment" ? lead.owner_phone : lead.phone);
}

function validateBusinessState(eventName: string, lead: UnknownRecord) {
  const stage = text(lead.crm_stage).toLowerCase();
  const validity = text(lead.lead_validity).toLowerCase();
  const status = text(lead.status).toLowerCase();
  if (eventName === "working_lead") return !!lead.first_response_at || ["contacted", "quoted", "scheduled", "sent_to_entity"].includes(status);
  if (eventName === "qualify_lead") return validity === "qualified" || !!lead.qualified_at;
  if (eventName === "disqualify_lead") return validity === "disqualified" && !!text(lead.loss_reason);
  if (eventName === "schedule_test_drive") return !!lead.visit_scheduled_at;
  if (eventName === "close_convert_lead") return stage === "won" && !!lead.closed_at;
  if (eventName === "close_unconvert_lead") return stage === "lost" && !!lead.closed_at && !!text(lead.loss_reason);
  return false;
}

function eventMilestone(eventName: string, lead: UnknownRecord) {
  const map: Record<string, unknown> = {
    working_lead: lead.first_response_at || lead.last_touched_at,
    qualify_lead: lead.qualified_at || lead.last_touched_at,
    disqualify_lead: lead.disqualified_at || lead.closed_at || lead.last_touched_at,
    schedule_test_drive: lead.visit_scheduled_at,
    close_convert_lead: lead.closed_at,
    close_unconvert_lead: lead.closed_at,
  };
  return text(map[eventName], 50) || new Date().toISOString();
}

function deterministicEventId(leadType: string, leadId: string, eventName: string, milestone: string) {
  return `crm_${leadType}_${leadId}_${eventName}_${milestone}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const technicalId = crypto.randomUUID();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!supabaseUrl || !serviceRoleKey || !token) return json({ ok: false, error: "No autorizado.", technicalId }, 401);

    const body = await req.json();
    if (!isRecord(body)) return json({ ok: false, error: "Payload inválido.", technicalId }, 400);
    const leadType = text(body.lead_type, 40);
    const leadId = text(body.lead_id, 120);
    const eventName = text(body.event_name, 80);
    const table = LEAD_TABLES[leadType];
    if (!table || !leadId || !GA4_EVENTS.has(eventName)) return json({ ok: false, error: "Evento CRM inválido.", technicalId }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user?.email) return json({ ok: false, error: "No autorizado.", technicalId }, 401);
    const { data: profile } = await supabase
      .from("admin_access_profiles")
      .select("is_active")
      .eq("email", authData.user.email.toLowerCase())
      .eq("is_active", true)
      .maybeSingle();
    if (!profile) return json({ ok: false, error: "No autorizado.", technicalId }, 403);

    const { data: lead, error: leadError } = await supabase.from(table).select("*").eq("id", leadId).maybeSingle();
    if (leadError || !lead) return json({ ok: false, error: "Lead no encontrado.", technicalId }, 404);
    if (!validateBusinessState(eventName, lead)) return json({ ok: false, error: "El estado comercial no habilita este evento.", technicalId }, 409);

    const { data: attributionRow } = await supabase
      .from("lead_attribution")
      .select("*")
      .eq("lead_type", text(lead.service_type) || leadType)
      .eq("lead_id", leadId)
      .maybeSingle();
    const attribution = attributionRow ? {
      first_touch: attributionRow.first_touch || {},
      last_touch: attributionRow.last_touch || {},
      visitor_key: attributionRow.visitor_key || null,
      session_key: attributionRow.session_key || null,
      landing_url: attributionRow.landing_url || null,
      conversion_url: attributionRow.conversion_url || null,
      referrer: attributionRow.initial_referrer || null,
      vehicle_id: attributionRow.vehicle_id || null,
      fbp: attributionRow.fbp || null,
      fbc: attributionRow.fbc || null,
      ga_client_id: attributionRow.ga_client_id || null,
      ga_session_id: attributionRow.ga_session_id || null,
      consent: {
        analytics: attributionRow.analytics_consent === true,
        marketing: attributionRow.marketing_consent === true,
      },
    } : {
      first_touch: lead.first_touch || {},
      last_touch: lead.last_touch || {},
      visitor_key: lead.visitor_key || null,
      session_key: lead.session_key || null,
      landing_url: lead.landing_url || null,
      conversion_url: lead.conversion_url || null,
      referrer: lead.initial_referrer || null,
      vehicle_id: lead.vehicle_id || null,
      consent: { analytics: false, marketing: false },
    };

    const milestone = eventMilestone(eventName, lead);
    const baseEventId = deterministicEventId(leadType, leadId, eventName, milestone);
    const common = {
      occurredAt: milestone,
      eventSourceUrl: text(attribution.conversion_url, 1200) || null,
      leadType,
      leadId,
      email: leadEmail(leadType, lead),
      phone: leadPhone(leadType, lead),
      attribution,
      parameters: {
        lead_id: leadId,
        service_type: text(lead.service_type) || leadType,
        vehicle_id: text(lead.vehicle_id || attribution.vehicle_id) || null,
        crm_stage: text(lead.crm_stage) || null,
        lead_validity: text(lead.lead_validity) || null,
      },
      actionSource: "website" as const,
    };

    const results = [];
    results.push(...await deliverConversion({
      supabase,
      providerEventName: eventName,
      eventId: `${baseEventId}_ga4`.slice(0, 120),
      ...common,
      allowMeta: false,
      allowGa4: attribution.consent.analytics === true,
    }));

    const metaEvent = META_EVENT_MAP[eventName];
    if (metaEvent) {
      results.push(...await deliverConversion({
        supabase,
        providerEventName: metaEvent,
        eventId: `${baseEventId}_meta`.slice(0, 120),
        ...common,
        allowMeta: attribution.consent.marketing === true,
        allowGa4: false,
      }));
    }

    return json({
      ok: true,
      technicalId,
      deliveries: results.map((item) => ({ provider: item.provider, status: item.status, technicalCode: item.technicalCode || null })),
    });
  } catch {
    console.error("sync-crm-event failure", { technicalId, technicalCode: "unexpected" });
    return json({ ok: false, error: "No se pudo sincronizar el evento comercial.", technicalId }, 500);
  }
});
