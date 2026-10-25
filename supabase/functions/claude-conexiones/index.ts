import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";

// ============================================================================
// CR1 (FASE 5) — desconectar/revocar el conector de Claude Desktop.
//   `desconectar`: la propia persona corta TODAS sus conexiones OAuth (en la
//   práctica, solo las de Claude — es el único servidor OAuth que el SGC
//   expone hoy). Usa `auth.oauth.listGrants`/`revokeGrant` con SU PROPIO JWT
//   (self-service; no hace falta service role).
//   `revocar`: solo admin, para OTRA persona. auth.oauth.* es siempre
//   "self" (REST /user/oauth/grants con el JWT del propio usuario) — no existe
//   un endpoint admin para revocar el grant de otra persona. Se resuelve
//   igual que el puente de WhatsApp: se emite una sesión real para esa persona
//   con la service role (generateLink + verify) y se llama el MISMO endpoint
//   self-service con ESE token, solo dentro de esta edge.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function revocarGrantsDe(accessToken: string) {
  const list = await fetch(`${SUPABASE_URL}/auth/v1/user/oauth/grants`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!list.ok) throw new Error(`No se pudieron leer las conexiones (${list.status}).`);
  const grants = (await list.json()) as { client_id: string }[];
  let revocados = 0;
  for (const g of grants) {
    const del = await fetch(`${SUPABASE_URL}/auth/v1/user/oauth/grants?client_id=${encodeURIComponent(g.client_id)}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (del.ok) revocados++;
  }
  return revocados;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Sesión inválida" }, 401);

  const { error: oauthErr } = await supabase.rpc("rechazar_si_cliente_oauth");
  if (oauthErr) {
    if (oauthErr.code === "42501") {
      return json({ error: "Esta acción no está permitida desde un conector externo (Claude)." }, 403);
    }
    console.error("rechazar_si_cliente_oauth falló (no es Claude):", oauthErr);
    return json({ error: `No se pudo verificar el origen de la sesión: ${oauthErr.message}` }, 500);
  }

  let payload: { accion?: string; usuario_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }
  const { accion, usuario_id } = payload;

  if (accion === "desconectar") {
    try {
      const revocados = await revocarGrantsDe(authHeader.replace(/^Bearer\s+/i, ""));
      return json({ ok: true, revocados });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "No se pudo desconectar." }, 500);
    }
  }

  if (accion === "revocar") {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (!isAdmin) return json({ error: "Solo un administrador puede revocar la conexión de otra persona." }, 403);
    if (!usuario_id) return json({ error: "Falta usuario_id." }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: target } = await admin.schema("sgc").from("usuarios").select("email").eq("id", usuario_id).maybeSingle();
    if (!target?.email) return json({ error: "Usuario no encontrado." }, 404);

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: target.email });
    const tokenHash = (link as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token
      ?? (link as { hashed_token?: string } | null)?.hashed_token;
    if (linkErr || !tokenHash) return json({ error: "No se pudo preparar la revocación." }, 500);
    const vres = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
    });
    const vj = await vres.json();
    if (!vj?.access_token) return json({ error: "No se pudo preparar la revocación." }, 500);

    try {
      const revocados = await revocarGrantsDe(vj.access_token);
      // service role: el log es de la PERSONA REVOCADA (usuario_id), no del
      // admin que ejecuta — la RLS de claude_llamadas no lo dejaría insertar
      // como el caller normal.
      await admin.schema("sgc").from("claude_llamadas").insert({
        usuario_id, herramienta: "admin_revocar", ok: true,
        params_resumen: { por: userData.user.id, revocados },
      }).then(() => {}, () => {});
      return json({ ok: true, revocados });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "No se pudo revocar." }, 500);
    }
  }

  return json({ error: "Acción no reconocida." }, 400);
});
