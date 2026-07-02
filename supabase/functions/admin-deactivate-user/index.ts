import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Deactivates or reactivates a user. Goes further than flipping
// sgc.usuarios.activo (which the existing authGuard already checks on
// every navigation): a deactivated user is also banned at the Auth layer
// via the Admin API, so an already-open session can't keep making direct
// Supabase API calls until its JWT happens to expire — the ban blocks
// both sign-in and session refresh immediately.
//
// Re-verifies the caller is admin independently; blocks an admin from
// deactivating their own account.

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autenticado." }), { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida." }), { status: 401 });
    }
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "No autorizado." }), { status: 403 });
    }

    const { userId, activo } = await req.json();
    if (typeof userId !== "string" || typeof activo !== "boolean") {
      return new Response(JSON.stringify({ error: "Parámetros inválidos." }), { status: 400 });
    }

    if (!activo && userId === callerData.user.id) {
      return new Response(JSON.stringify({ error: "No puedes desactivar tu propia cuenta." }), { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    // Supabase Auth has no "ban forever" duration — 100 years is the
    // documented convention for an effectively-permanent ban. 'none'
    // clears it.
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: activo ? "none" : "876000h",
    });
    if (banError) {
      return new Response(JSON.stringify({ error: banError.message }), { status: 400 });
    }

    const { error: updateError } = await admin.from("usuarios").update({ activo }).eq("id", userId);
    if (updateError) {
      // Revert the ban change so Auth state and the profile flag don't disagree.
      await admin.auth.admin.updateUserById(userId, { ban_duration: activo ? "876000h" : "none" });
      return new Response(JSON.stringify({ error: updateError.message }), { status: 400 });
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: activo ? "usuario_reactivado" : "usuario_desactivado",
      target_user_id: userId,
      metadata: {},
    });

    return new Response(JSON.stringify({ userId, activo }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido." }), {
      status: 500,
    });
  }
});
