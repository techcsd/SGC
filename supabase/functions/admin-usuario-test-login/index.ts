import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AY7 — "Entrar como" un usuario de prueba: el admin obtiene credenciales
// frescas del usuario test para iniciar sesión como él (QA). service_role,
// admin-only. SOLO funciona con usuarios es_prueba (nunca cuentas reales).
// Rota el password a uno nuevo y lo devuelve; audita quién entró y cuándo.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function genPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
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
    const { data: target } = await admin.from("usuarios").select("id, email, es_prueba").eq("id", userId).maybeSingle();
    if (!target) return json({ error: "Usuario no encontrado." }, 404);
    if (!target.es_prueba) return json({ error: "Solo se puede entrar como un usuario de prueba." }, 403);

    const password = genPassword();
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password });
    if (updErr) return json({ error: `No se pudo preparar el acceso: ${updErr.message}` }, 400);

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id, action: "usuario_test_login", target_user_id: userId,
      metadata: { email: target.email },
    }).then(() => {}, () => {});

    return json({ email: target.email, password });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
