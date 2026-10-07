import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// CI4 — Procesa una solicitud de eliminación de cuenta (solo admin).
//   accion='procesar' → el RPC anonimiza el perfil + borra device_tokens y marca
//     la solicitud 'procesada'; la edge banea al usuario en Auth (no puede iniciar
//     sesión) y borra su foto del bucket público sgc-avatars.
//   accion='rechazar' → marca 'rechazada' con nota.
// El RPC re-verifica is_admin() (SECURITY DEFINER); la edge además lo verifica con
// el token del llamador (defensa en capas).

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
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

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

    const { solicitudId, accion, nota } = await req.json();
    if (typeof solicitudId !== "string" || (accion !== "procesar" && accion !== "rechazar")) {
      return json({ error: "Parámetros inválidos." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    // Captura la foto ANTES de procesar (el RPC pone avatar_path = null).
    let avatarPath: string | null = null;
    if (accion === "procesar") {
      const { data: sol } = await admin.from("solicitudes_eliminacion_cuenta")
        .select("usuario_id").eq("id", solicitudId).maybeSingle();
      const uid = sol?.usuario_id as string | null;
      if (uid) {
        const { data: u } = await admin.from("usuarios").select("avatar_path").eq("id", uid).maybeSingle();
        avatarPath = (u?.avatar_path as string | null) ?? null;
      }
    }

    // El RPC hace la mutación de datos (con su propio gate is_admin) y devuelve el
    // usuario_id anonimizado (o null) para que la edge lo banee.
    const { data: target, error: rpcErr } = await callerClient.schema("sgc")
      .rpc("procesar_solicitud_eliminacion", { p_solicitud_id: solicitudId, p_accion: accion, p_nota: nota ?? null });
    if (rpcErr) return json({ error: rpcErr.message }, 400);

    if (accion === "procesar" && target) {
      // Banea en Auth: no puede iniciar sesión ni refrescar (como admin-deactivate-user).
      await admin.auth.admin.updateUserById(target as string, { ban_duration: "876000h" });
      // Borra la foto del bucket público (best-effort).
      if (avatarPath) {
        try { await admin.storage.from("sgc-avatars").remove([avatarPath]); } catch { /* best-effort */ }
      }
    }

    return json({ ok: true, accion, target: target ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
