import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets an admin trigger a password reset for a user without ever seeing
// or setting the password themselves. Generates a real recovery link via
// the Admin API, then emails it via Resend (reusing the same Vault-backed
// key as notificar-solicitud). If Resend isn't configured yet, the link
// is returned in the response instead of silently doing nothing — an
// admin is the only one who ever sees that response.

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
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No autenticado." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return json({ error: "Sesión inválida." }, 401);
    }
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    if (!isAdmin) {
      return json({ error: "No autorizado." }, 403);
    }

    const { userId, redirectTo } = await req.json();
    if (typeof userId !== "string") {
      return json({ error: "Parámetros inválidos." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    const { data: usuario, error: usuarioError } = await admin
      .from("usuarios")
      .select("email, nombre")
      .eq("id", userId)
      .single();
    if (usuarioError || !usuario) {
      return json({ error: "Usuario no encontrado." }, 404);
    }

    // BI5 — un email sintético (.local, sin MX) NUNCA recibe correo. GoTrue
    // devuelve 200 para cualquier dirección (anti-enumeración), así que llamar a
    // resetPasswordForEmail aquí produciría un "sent: true" que MIENTE. Se rechaza
    // de entrada: ese usuario entra por cédula + PIN → el admin usa "Fijar PIN".
    const SYNTH_DOMAINS = ["@conductores.constructorasd.local", "@personal.constructorasd.local", "@test.constructorasd.local"];
    const email = String(usuario.email ?? "");
    if (SYNTH_DOMAINS.some((d) => email.toLowerCase().endsWith(d))) {
      await admin.from("audit_log").insert({
        actor_id: callerData.user.id, action: "password_reset_rechazado_sintetico",
        target_user_id: userId, metadata: { email, motivo: "email_sintetico_sin_buzon" },
      }).then(() => {}, () => {});
      return json({
        error: "Este usuario no tiene correo real (entra con cédula + PIN). Usa \"Fijar PIN\" para cambiar su acceso.",
        sintetico: true,
      }, 400);
    }

    // Same redirectTo-from-caller-origin pattern as admin-create-user — see
    // the comment there. Without it this fell back to the Site URL (localhost).
    // Deliver via Supabase's Auth mailer (reliable — same channel that sends
    // the original invites). Resend is not used here because this project has
    // no verified Resend sending domain. Fall back to returning a fresh link
    // only if the send fails, so the admin can share it manually.
    const redirect = typeof redirectTo === "string" && redirectTo ? redirectTo : undefined;
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
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: usuario.email,
        ...(redirect ? { options: { redirectTo: redirect } } : {}),
      });
      actionLink = linkData?.properties?.action_link;
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "password_reset_solicitado",
      target_user_id: userId,
      metadata: { emailSent: sent },
    });

    return json({ sent, actionLink });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
