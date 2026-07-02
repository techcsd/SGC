import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets an admin trigger a password reset for a user without ever seeing
// or setting the password themselves. Generates a real recovery link via
// the Admin API, then emails it via Resend (reusing the same Vault-backed
// key as notificar-solicitud). If Resend isn't configured yet, the link
// is returned in the response instead of silently doing nothing — an
// admin is the only one who ever sees that response.

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

    const { userId } = await req.json();
    if (typeof userId !== "string") {
      return new Response(JSON.stringify({ error: "Parámetros inválidos." }), { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    const { data: usuario, error: usuarioError } = await admin
      .from("usuarios")
      .select("email, nombre")
      .eq("id", userId)
      .single();
    if (usuarioError || !usuario) {
      return new Response(JSON.stringify({ error: "Usuario no encontrado." }), { status: 404 });
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: usuario.email,
    });
    if (linkError || !linkData) {
      return new Response(JSON.stringify({ error: linkError?.message ?? "Error al generar el enlace." }), {
        status: 400,
      });
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

    return new Response(JSON.stringify({ sent, actionLink: sent ? undefined : actionLink }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido." }), {
      status: 500,
    });
  }
});
