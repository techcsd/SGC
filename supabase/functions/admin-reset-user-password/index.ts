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

    const { userId } = await req.json();
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

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: usuario.email,
    });
    if (linkError || !linkData) {
      return json({ error: linkError?.message ?? "Error al generar el enlace." }, 400);
    }
    const actionLink = linkData.properties.action_link;

    const { data: resendApiKey } = await admin.rpc("get_resend_api_key");
    let sent = false;
    if (resendApiKey) {
      const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          to: [usuario.email],
          subject: "Restablece tu contraseña — SGC",
          html: `<p>Hola ${usuario.nombre ?? ""},</p><p>Un administrador solicitó restablecer tu contraseña. Haz clic en el siguiente enlace para elegir una nueva:</p><p><a href="${actionLink}">Restablecer contraseña</a></p><p>Si no esperabas este correo, puedes ignorarlo.</p>`,
        }),
      });
      sent = res.ok;
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "password_reset_solicitado",
      target_user_id: userId,
      metadata: { emailSent: sent },
    });

    return json({ sent, actionLink: sent ? undefined : actionLink });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
