import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AZ10 — Fin de impersonación: limpia la marca app_metadata.impersonated_by del objetivo
// y registra el cierre en auditoría. Se llama YA restaurada la sesión admin (el que llama
// vuelve a ser admin), así que el is_admin() pasa.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Sesión inválida." }, 401);
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    if (!isAdmin) return json({ error: "No autorizado." }, 403);

    const { userId } = await req.json();
    if (typeof userId !== "string" || !userId) return json({ error: "userId requerido." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });
    // Limpia la marca de impersonación del objetivo.
    await admin.auth.admin.updateUserById(userId, { app_metadata: {} }).then(() => {}, () => {});

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "impersonacion_fin",
      target_user_id: userId,
      metadata: { ended_at: new Date().toISOString() },
    }).then(() => {}, () => {});

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
