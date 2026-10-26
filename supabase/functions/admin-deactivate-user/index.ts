import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";

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
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No autenticado." }, 401);
    }

    const supabaseUrl = envRequerido("SUPABASE_URL");
    const anonKey = envRequerido("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return json({ error: "Sesión inválida." }, 401);
    }
    // CR1 (FASE 5) — las acciones admin-* rechazan tokens OAuth (Claude).
    const { error: oauthErr } = await callerClient.schema("sgc").rpc("rechazar_si_cliente_oauth");
    if (oauthErr) {
      if (oauthErr.code === "42501") {
        return json({ error: "Esta acción no está permitida desde un conector externo (Claude)." }, 403);
      }
      console.error("rechazar_si_cliente_oauth falló (no es Claude):", oauthErr);
      return json({ error: `No se pudo verificar el origen de la sesión: ${oauthErr.message}` }, 500);
    }
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    if (!isAdmin) {
      return json({ error: "No autorizado." }, 403);
    }

    const { userId, activo } = await req.json();
    if (typeof userId !== "string" || typeof activo !== "boolean") {
      return json({ error: "Parámetros inválidos." }, 400);
    }

    if (!activo && userId === callerData.user.id) {
      return json({ error: "No puedes desactivar tu propia cuenta." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    // Supabase Auth has no "ban forever" duration — 100 years is the
    // documented convention for an effectively-permanent ban. 'none'
    // clears it.
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: activo ? "none" : "876000h",
    });
    if (banError) {
      return json({ error: banError.message }, 400);
    }

    const { error: updateError } = await admin.from("usuarios").update({ activo }).eq("id", userId);
    if (updateError) {
      // Revert the ban change so Auth state and the profile flag don't disagree.
      await admin.auth.admin.updateUserById(userId, { ban_duration: activo ? "876000h" : "none" });
      return json({ error: updateError.message }, 400);
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: activo ? "usuario_reactivado" : "usuario_desactivado",
      target_user_id: userId,
      metadata: {},
    });

    return json({ userId, activo });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
