import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// V4 — Email a TODOS los usuarios activos cuando se publica una nueva versión
// de la app móvil. Se llama desde la web justo después de publicar (el aviso
// in-app ya se creó vía RPC notificar_todos). Resend key desde Vault (no-op si
// no está). Un fallo de correo NUNCA debe bloquear la publicación.

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } },
    );
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Sesión inválida." }, 401);

    // Solo un admin puede disparar el correo masivo (igual que notificar_todos).
    const { data: esAdmin } = await callerClient.rpc("is_admin");
    if (esAdmin !== true) return json({ error: "No autorizado." }, 403);

    const { version, notas, apkUrl } = await req.json();
    if (!version) return json({ error: "Falta la versión." }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "sgc" } },
    );

    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    if (!resendApiKey) {
      return json({ skipped: true, reason: "Resend API key no configurada en Vault." });
    }
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";

    // Destinatarios: todos los usuarios activos con correo.
    const { data: usuarios } = await supabase
      .from("usuarios")
      .select("email")
      .eq("activo", true);
    const to = [
      ...new Set(((usuarios ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean)),
    ];
    if (to.length === 0) return json({ skipped: true, reason: "Sin destinatarios." });

    const subject = `📱 Nueva versión ${version} de la app CSD disponible`;
    const notasHtml = notas ? `<div style="margin:8px 0">${escapeHtml(String(notas))}</div>` : "";
    const descargaBtn = apkUrl
      ? `<p style="margin-top:16px">
           <a href="${escapeHtml(String(apkUrl))}"
              style="background:#ff5f00;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
             ⬇️ Descargar la actualización
           </a>
         </p>`
      : "";
    const html =
      `<h2 style="margin:0 0 8px">Nueva versión disponible: ${escapeHtml(String(version))}</h2>` +
      `<p>Ya puedes actualizar la app CSD a la versión <strong>${escapeHtml(String(version))}</strong>.</p>` +
      notasHtml +
      descargaBtn +
      `<p style="margin-top:16px;color:#666;font-size:13px">
         También puedes actualizar desde la app: Ajustes → Buscar actualización.
       </p>`;

    // Resend limita a 50 destinatarios por request (to+bcc). Enviamos en lotes
    // usando BCC (para no exponer correos) y no fallamos todo si un lote falla.
    const BATCH = 45;
    let enviados = 0;
    const errores: string[] = [];
    for (let i = 0; i < to.length; i += BATCH) {
      const lote = to.slice(i, i + BATCH);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to: fromEmail, bcc: lote, subject, html }),
      });
      if (res.ok) enviados += lote.length;
      else errores.push(await res.text());
    }
    if (enviados === 0 && errores.length > 0) {
      return json({ error: `Resend error: ${errores[0]}` }, 502);
    }
    return json({ sent: true, count: enviados, fallidos: to.length - enviados });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
