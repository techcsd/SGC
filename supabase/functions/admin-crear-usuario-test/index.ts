import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AY7 — Crea un USUARIO DE PRUEBA: usuario real de auth con email sintético SIN
// buzón (t-<n>@test.constructorasd.local), rol(es) reales y es_prueba=true. Se
// comporta 100% como su rol. service_role, admin-only (re-verificado aquí).
// Devuelve las credenciales (email + password generado) para "credenciales" y
// "entrar como". El password NO se guarda; para re-entrar se rota vía
// admin-usuario-test-login.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const TEST_DOMAIN = "@test.constructorasd.local";
function genPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

Deno.serve(async (req: Request) => {
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
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    if (!isAdmin) return json({ error: "No autorizado. Solo un administrador puede crear usuarios de prueba." }, 403);

    const { nombre, roleIds } = await req.json();
    if (typeof nombre !== "string" || !nombre.trim()) return json({ error: "El nombre es requerido." }, 400);
    const roles: number[] = Array.isArray(roleIds) ? roleIds.filter((r) => Number.isInteger(r)) : [];

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    // Email sintético único: t-<n>@… con n = (# de usuarios test) + 1; si choca,
    // se le añade un sufijo aleatorio corto.
    const { count } = await admin.from("usuarios").select("id", { count: "exact", head: true }).eq("es_prueba", true);
    let n = (count ?? 0) + 1;
    let email = `t-${n}${TEST_DOMAIN}`;
    const { data: clash } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (clash?.id) email = `t-${n}-${genPassword().slice(0, 4).toLowerCase()}${TEST_DOMAIN}`;

    const password = genPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { nombre: nombre.trim(), es_prueba: true },
    });
    if (createError || !created.user) return json({ error: createError?.message ?? "No se pudo crear el usuario de prueba." }, 400);
    const userId = created.user.id;

    const { error: profileError } = await admin
      .from("usuarios").insert({ id: userId, nombre: nombre.trim(), email, activo: true, es_prueba: true });
    if (profileError) {
      await admin.auth.admin.deleteUser(userId);
      return json({ error: `No se pudo crear el perfil: ${profileError.message}` }, 400);
    }

    if (roles.length) {
      const rows = roles.map((rol_id) => ({ usuario_id: userId, rol_id, asignado_por: callerData.user!.id }));
      const { error: rolErr } = await admin.from("usuarios_roles").upsert(rows, { onConflict: "usuario_id,rol_id", ignoreDuplicates: true });
      if (rolErr) {
        await admin.from("usuarios").delete().eq("id", userId);
        await admin.auth.admin.deleteUser(userId);
        return json({ error: `No se pudo asignar el rol: ${rolErr.message}` }, 400);
      }
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id, action: "usuario_test_creado", target_user_id: userId,
      metadata: { email, nombre: nombre.trim(), roleIds: roles },
    }).then(() => {}, () => {});

    return json({ userId, email, password });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
