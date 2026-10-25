import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";

// AZ10 — "Entrar como" CUALQUIER usuario (soporte/depuración), con diseño de seguridad.
// Decisiones (Xaviel): puede impersonar TODO admin · sin aviso al usuario · firmas
// permitidas pero MARCADAS · sesión máx. 1 h.
//
// A diferencia del flujo de usuarios de prueba, aquí NO se rota la contraseña de la
// cuenta real: se emite un enlace mágico (generateLink) del que se consume el token_hash
// para iniciar sesión como el objetivo. Se marca al objetivo con app_metadata.impersonated_by
// (para poder atribuir escrituras) y se registra auditoría inmutable (audit_log).
//
// Candados duros (independientes de las decisiones):
//  - solo admin puede impersonar;
//  - no se impersona a otro admin;
//  - no se impersona a uno mismo;
//  - no se toca contraseña ni correo del objetivo.

Deno.serve(async (req: Request) => {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
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
    if (!isAdmin) return json({ error: "No autorizado. Solo un administrador puede entrar como otro usuario." }, 403);

    const { userId } = await req.json();
    if (typeof userId !== "string" || !userId) return json({ error: "userId requerido." }, 400);
    if (userId === callerData.user.id) return json({ error: "Ya eres tú." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });
    const { data: target } = await admin
      .from("usuarios")
      .select("id, email, nombre, activo")
      .eq("id", userId)
      .maybeSingle();
    if (!target) return json({ error: "Usuario no encontrado." }, 404);
    if (!target.email) return json({ error: "El usuario no tiene correo/login para impersonar." }, 400);

    // Candado: no impersonar a otro admin.
    const { data: adminRoles } = await admin
      .from("usuarios_roles")
      .select("rol:roles(codigo)")
      .eq("usuario_id", userId);
    const esAdminObjetivo = (adminRoles ?? []).some((r: { rol?: { codigo?: string } }) => r.rol?.codigo === "admin");
    if (esAdminObjetivo) return json({ error: "No se puede entrar como otro administrador." }, 403);

    // Marca al objetivo para atribuir escrituras hechas durante la impersonación.
    const startedAt = new Date().toISOString();
    await admin.auth.admin.updateUserById(userId, {
      app_metadata: { impersonated_by: callerData.user.id, impersonated_at: startedAt },
    }).then(() => {}, () => {});

    // Enlace mágico → token_hash (no cambia la contraseña, no envía correo).
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      // revierte la marca si no se pudo emitir el acceso
      await admin.auth.admin.updateUserById(userId, { app_metadata: {} }).then(() => {}, () => {});
      return json({ error: `No se pudo preparar el acceso: ${linkErr?.message ?? "sin token"}` }, 400);
    }

    // Auditoría inmutable: quién → a quién, cuándo empezó.
    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "impersonacion_inicio",
      target_user_id: userId,
      metadata: { email: target.email, nombre: target.nombre, started_at: startedAt },
    }).then(() => {}, () => {});

    return json({ email: target.email, nombre: target.nombre, token_hash: tokenHash, started_at: startedAt });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
