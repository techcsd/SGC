import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";

// Resends a user's invitation for when the original link expired before they
// accepted it. Delivers through Supabase's own Auth mailer (the same channel
// that sends the original invite) — NOT Resend, which has no verified sending
// domain on this project. Falls back to returning a fresh link only if the
// mailer send fails, so the admin can share it manually. Admin-only.

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
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const supabaseUrl = envRequerido("SUPABASE_URL");
    const anonKey = envRequerido("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Sesión inválida." }, 401);
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
    if (!isAdmin) return json({ error: "No autorizado." }, 403);

    const { userId, redirectTo } = await req.json();
    if (typeof userId !== "string") return json({ error: "Parámetros inválidos." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    const { data: usuario, error: usuarioError } = await admin
      .from("usuarios")
      .select("email, nombre")
      .eq("id", userId)
      .single();
    if (usuarioError || !usuario) return json({ error: "Usuario no encontrado." }, 404);

    const redirect = typeof redirectTo === "string" && redirectTo ? redirectTo : undefined;

    // Primary path: send via Supabase's Auth mailer (works — it's what delivers
    // the original invites). Uses a plain anon client so it triggers the email.
    const mailer = createClient(supabaseUrl, anonKey);
    const { error: sendError } = await mailer.auth.resetPasswordForEmail(
      usuario.email,
      redirect ? { redirectTo: redirect } : {},
    );

    let sent = false;
    let actionLink: string | undefined;
    if (!sendError) {
      sent = true;
    } else {
      // Fallback: hand the admin a fresh link to share manually.
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: usuario.email,
        ...(redirect ? { options: { redirectTo: redirect } } : {}),
      });
      actionLink = linkData?.properties?.action_link;
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "invitacion_reenviada",
      target_user_id: userId,
      metadata: { emailSent: sent },
    });

    return json({ sent, actionLink });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
