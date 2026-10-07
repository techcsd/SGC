import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// CI4 — Edge PÚBLICA (verify_jwt=false) para solicitar la eliminación de cuenta
// desde la página /politicas/eliminar-cuenta (para quien ya no tiene acceso a la app).
// Recibe correo o cédula + motivo, crea la solicitud (origen='publica') vía service role,
// y SIEMPRE responde igual (no revela si el usuario existe). Honeypot + throttle simple.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Respuesta neutra: siempre la misma, exista o no el usuario.
const OK = { ok: true, message: "Recibimos tu solicitud. Si tus datos corresponden a una cuenta, la procesaremos en un máximo de 30 días." };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  let body: { identificador?: string; motivo?: string; website?: string };
  try { body = await req.json(); } catch { return json(OK); } // respuesta neutra incluso si el cuerpo es inválido

  // Honeypot: un bot rellena el campo oculto `website`. Fingimos éxito.
  if (body.website && String(body.website).trim() !== "") return json(OK);

  const identificador = String(body.identificador ?? "").trim();
  const motivo = String(body.motivo ?? "").trim().slice(0, 1000);
  if (!identificador) return json(OK); // nada que hacer; respuesta neutra

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );

  // Throttle suave: si llegan demasiadas solicitudes públicas en el último minuto,
  // aceptamos la respuesta pero no creamos más (anti-flood; no revela nada).
  try {
    const haceUnMinuto = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin.from("solicitudes_eliminacion_cuenta")
      .select("id", { count: "exact", head: true })
      .eq("origen", "publica").gte("creada_at", haceUnMinuto);
    if ((count ?? 0) >= 20) return json(OK);
  } catch { /* si falla el conteo, seguimos */ }

  try {
    await admin.rpc("crear_solicitud_eliminacion_publica", {
      p_identificador: identificador,
      p_motivo: motivo || null,
    });
  } catch { /* nunca revelamos el detalle */ }

  return json(OK);
});
