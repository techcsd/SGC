import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";

// AZ10 — Fin de impersonación: limpia la marca app_metadata.impersonated_by del objetivo
// y registra el cierre en auditoría. Se llama YA restaurada la sesión admin (el que llama
// vuelve a ser admin), así que el is_admin() pasa.

// DN-18 (ronda DN) — fábricas de cliente inyectables (ver admin-entrar-como/index.ts).
// deno-lint-ignore no-explicit-any
export type FabricaCliente = (url: string, key: string, headers?: Record<string, string>) => any;

export async function manejar(
  req: Request,
  fabricas: { crearAnon: FabricaCliente; crearAdmin: FabricaCliente } = {
    crearAnon: (url, key, headers) => createClient(url, key, { global: { headers } }),
    crearAdmin: (url, key) => createClient(url, key, { db: { schema: "sgc" } }),
  },
): Promise<Response> {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const supabaseUrl = envRequerido("SUPABASE_URL");
    const anonKey = envRequerido("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = fabricas.crearAnon(supabaseUrl, anonKey, { Authorization: authHeader });
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

    const { userId } = await req.json();
    if (typeof userId !== "string" || !userId) return json({ error: "userId requerido." }, 400);

    const admin = fabricas.crearAdmin(supabaseUrl, serviceRoleKey);
    // Limpia la marca de impersonación del objetivo.
    await admin.auth.admin.updateUserById(userId, { app_metadata: {} }).then(() => {}, () => {});

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "impersonacion_fin",
      target_user_id: userId,
      metadata: { ended_at: new Date().toISOString() },
    }).then(() => {}, () => {});

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
}

if (import.meta.main) {
  Deno.serve((req: Request) => manejar(req));
}
