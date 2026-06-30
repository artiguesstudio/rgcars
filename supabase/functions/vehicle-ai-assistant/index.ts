import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type UnknownRecord = Record<string, unknown>;

function json(body: UnknownRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function finiteNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function arrayOfText(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const raw = text(value);
  return raw ? raw.split(/\n|,/g).map(text).filter(Boolean) : [];
}

function isPlainObject(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeVehicle(value: unknown) {
  const input = isPlainObject(value) ? value : {};
  return {
    brand: text(input.brand),
    model: text(input.model),
    year: finiteNumber(input.year),
    title: text(input.title),
    km: finiteNumber(input.km),
    engine: text(input.engine),
    transmission: text(input.transmission),
    drivetrain: text(input.drivetrain),
    fuel_type: text(input.fuel_type),
    color: text(input.color),
    featured_equipment: arrayOfText(input.featured_equipment),
    status: text(input.status),
    price: finiteNumber(input.price),
    currency: text(input.currency) || "ARS",
    category: text(input.category),
    existing_description: text(input.existing_description),
    notes: text(input.notes),
  };
}

async function requireAuthenticatedUser(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !anonKey || !token) throw new Error("No autorizado.");

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("No autorizado.");
  return data.user;
}

function buildPrompt(vehicle: UnknownRecord) {
  return [
    "Generá una ficha comercial para un vehículo de RG Cars TDF.",
    "Reglas estrictas:",
    "- No inventes motor, kilometraje, versión, financiación, garantía, equipamiento, estado mecánico, historial ni datos no informados.",
    "- Si falta un dato, omitilo o agregalo en warnings.",
    "- Usá español rioplatense profesional, claro y prudente.",
    "- No publiques ni confirmes disponibilidad futura.",
    "- Devolvé solo JSON válido con las claves solicitadas.",
    "",
    "Formato requerido:",
    "{",
    '  "title": "string",',
    '  "description": "string",',
    '  "featured_equipment": ["string"],',
    '  "highlights": ["string"],',
    '  "whatsapp_copy": "string",',
    '  "social_copy": "string",',
    '  "warnings": ["string"]',
    "}",
    "",
    `Datos cargados: ${JSON.stringify(vehicle)}`,
  ].join("\n");
}

function parseJsonObject(value: string) {
  const raw = String(value || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("La IA no devolvió JSON válido.");
    return JSON.parse(match[0]);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    await requireAuthenticatedUser(req);

    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";
    if (!apiKey) {
      return json({
        configured: false,
        message: "La función de IA está creada, pero falta configurar OPENAI_API_KEY en Supabase.",
      });
    }

    const body = await req.json().catch(() => ({}));
    const vehicle = sanitizeVehicle(isPlainObject(body) ? body.vehicle : {});
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Sos un asistente comercial prudente para una concesionaria. Tu prioridad es no inventar datos.",
          },
          { role: "user", content: buildPrompt(vehicle) },
        ],
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json({ error: result?.error?.message || "No se pudo generar la ficha con IA." }, response.status);
    }

    const content = result?.choices?.[0]?.message?.content || "";
    const suggestion = parseJsonObject(content);
    return json({ configured: true, suggestion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar la solicitud.";
    const status = message === "No autorizado." ? 401 : 400;
    return json({ error: message }, status);
  }
});
