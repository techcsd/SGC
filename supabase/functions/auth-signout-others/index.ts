import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// BS3 — "Cerrar sesión en otros dispositivos" (Configuración › Sesión). Revoca
// TODAS las demás sesiones del usuario que llama, dejando VIVA la actual. Se hace
// con la sesión del propio usuario (scope 'others' de GoTrue), así que no requiere
// service-role ni saber a qué dispositivos apunta: el token del que llama define
// el alcance. Registra el evento en auditoría (best-effort).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Sesión inválida." }, 401);

    // scope 'others' → revoca las demás sesiones y mantiene VIVA la actual.
    const { error } = await callerClient.auth.signOut({ scope: "others" });
    if (error) return json({ error: error.message }, 500);

    // Auditoría best-effort (service-role opcional; si no está, se omite).
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceRoleKey) {
      const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });
      await admin
        .from("audit_log")
        .insert({
          actor_id: callerData.user.id,
          action: "signout_others",
          target_user_id: callerData.user.id,
          metadata: { at: new Date().toISOString() },
        })
        .then(() => {}, () => {});
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
