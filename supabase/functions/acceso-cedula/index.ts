import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AX2 — Genera/rota el acceso por CÉDULA + PIN para personal SIN correo, de forma
// GENÉRICA por tipo de rol (no clona conductor-crear-acceso: lo generaliza).
//   tipo 'conductor' → ficha en `conductores`   → rol chofer_transportista
//   tipo 'capataz'   → ficha en `personal_obra`  → rol capataz
// Mismo patrón: usuario auth con email sintético determinista por cédula, email
// confirmado, rol asignado y la ficha enlazada (usuario_id). Idempotente (rota PIN
// si ya existe). service_role; el llamador se re-verifica con su propio token.
// La función chofer existente (conductor-crear-acceso) sigue viva para la app; esta
// es el camino go-forward y ya soporta ambos tipos.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Tipo = "conductor" | "capataz";
interface Cfg {
  tabla: string;
  dominio: string;
  prefijo: string;
  rol: string;
  modulosGate: string[]; // además de admin
  cedula: (row: Record<string, unknown>) => string;
  nombre: (row: Record<string, unknown>) => string;
}
const CFG: Record<Tipo, Cfg> = {
  conductor: {
    tabla: "conductores", dominio: "@conductores.constructorasd.local", prefijo: "c-",
    rol: "chofer_transportista", modulosGate: ["flota"],
    cedula: (r) => String(r.cedula ?? ""),
    nombre: (r) => String(r.nombre ?? "Conductor"),
  },
  capataz: {
    tabla: "personal_obra", dominio: "@personal.constructorasd.local", prefijo: "cap-",
    rol: "capataz", modulosGate: ["proyectos", "rrhh"],
    cedula: (r) => String(r.documento_numero ?? ""),
    nombre: (r) => `${r.nombre ?? ""} ${r.apellido ?? ""}`.trim() || "Capataz",
  },
};

function syntheticEmail(prefijo: string, cedula: string, dominio: string): string {
  return `${prefijo}${(cedula || "").replace(/\D/g, "")}${dominio}`;
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

    const { tipo, entityId, pin, nombre: nombreDirecto, cedula: cedulaDirecta } = await req.json();
    if (tipo !== "conductor" && tipo !== "capataz") return json({ error: "tipo inválido." }, 400);
    const cfg = CFG[tipo as Tipo];
    // BH4 — dos modos: desde una ficha existente (entityId) o ALTA DIRECTA (nombre+cedula).
    const altaDirecta = (!entityId || typeof entityId !== "string") &&
      typeof nombreDirecto === "string" && String(nombreDirecto).trim() !== "" &&
      typeof cedulaDirecta === "string" && String(cedulaDirecta).replace(/\D/g, "") !== "";
    if (!altaDirecta && (typeof entityId !== "string" || !entityId)) {
      return json({ error: "Indica una ficha (entityId) o nombre + cédula para el alta directa." }, 400);
    }
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return json({ error: "El PIN debe tener exactamente 6 dígitos." }, 400);

    // Autorización: admin o alguno de los módulos que administran ese tipo.
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    let permitido = !!isAdmin;
    for (const m of cfg.modulosGate) {
      if (permitido) break;
      const { data: tiene } = await callerClient.schema("sgc").rpc("tiene_modulo", { p_modulo: m });
      if (tiene) permitido = true;
    }
    if (!permitido) return json({ error: "No autorizado para generar este acceso." }, 403);

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    // ── BH4 — ALTA DIRECTA: crear el acceso sin ficha previa (nombre + cédula). ──
    if (altaDirecta) {
      const cedula = String(cedulaDirecta).replace(/\D/g, "");
      const nombre = String(nombreDirecto).trim();
      const email = syntheticEmail(cfg.prefijo, cedula, cfg.dominio);

      // AU18 — la cédula es identidad: si ya existe esa persona, se BLOQUEA con salida.
      const { data: dupCedula } = await admin.from("usuarios").select("id, nombre").eq("cedula", cedula).maybeSingle();
      const { data: dupEmail } = await admin.from("usuarios").select("id, nombre").eq("email", email).maybeSingle();
      const dup = dupCedula ?? dupEmail;
      if (dup?.id) {
        return json({
          error: `Ya existe un usuario con esa cédula: "${dup.nombre}". Usa "Crear/actualizar acceso" en su ficha en vez de crear otro.`,
          duplicado: { id: dup.id, nombre: dup.nombre },
        }, 409);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: pin, email_confirm: true,
        user_metadata: { nombre, acceso_cedula: true, rol_tipo: tipo },
      });
      if (createError || !created.user) return json({ error: createError?.message ?? "No se pudo crear el acceso." }, 400);
      const userId = created.user.id;
      const { error: profErr } = await admin.from("usuarios").insert({ id: userId, nombre, email, cedula, activo: true });
      if (profErr) { await admin.auth.admin.deleteUser(userId); return json({ error: `No se pudo crear el perfil: ${profErr.message}` }, 400); }

      const { data: rol, error: rolErr } = await admin.from("roles").select("id").eq("codigo", cfg.rol).maybeSingle();
      if (rolErr || rol?.id == null) return json({ error: `No existe el rol '${cfg.rol}'. Configúralo en Administración › Roles.` }, 400);
      const { error: rolAssignErr } = await admin.from("usuarios_roles")
        .upsert({ usuario_id: userId, rol_id: rol.id, asignado_por: callerData.user.id }, { onConflict: "usuario_id,rol_id", ignoreDuplicates: true });
      if (rolAssignErr) return json({ error: `No se pudo asignar el rol: ${rolAssignErr.message}` }, 400);

      return json({ email, usuarioId: userId, cedula, created: true, altaDirecta: true });
    }

    const { data: ficha, error: fErr } = await admin.from(cfg.tabla).select("*").eq("id", entityId).maybeSingle();
    if (fErr || !ficha) return json({ error: "Ficha no encontrada." }, 404);

    const cedula = cfg.cedula(ficha);
    if (!cedula.replace(/\D/g, "")) return json({ error: "La ficha no tiene cédula/documento válido para generar el acceso." }, 400);
    const nombre = cfg.nombre(ficha);
    const email = syntheticEmail(cfg.prefijo, cedula, cfg.dominio);
    const fichaUsuarioId = (ficha as Record<string, unknown>).usuario_id as string | null;

    // Caso 1: ya tiene acceso → rotar PIN (salvo que use correo real).
    if (fichaUsuarioId) {
      const { data: linked } = await admin.from("usuarios").select("email").eq("id", fichaUsuarioId).maybeSingle();
      const linkedEmail = (linked?.email ?? "") as string;
      if (linkedEmail && !linkedEmail.endsWith(cfg.dominio)) {
        return json({ error: "Esta persona ya inicia sesión con su correo. El acceso por cédula + PIN es solo para quien no tiene correo." }, 409);
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(fichaUsuarioId, { password: pin });
      if (updErr) return json({ error: `No se pudo actualizar el PIN: ${updErr.message}` }, 400);
      await admin.from("conductor_login_intentos").delete().eq("cedula", cedula.replace(/\D/g, "")).then(() => {}, () => {});
      return json({ email, usuarioId: fichaUsuarioId, rotated: true });
    }

    // AU18 — avisar si ya existe un usuario con esa cédula (posible duplicado de persona).
    let userId: string | null = null;
    const { data: existingProfile } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (existingProfile?.id) {
      userId = existingProfile.id as string;
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password: pin });
      if (updErr) return json({ error: `No se pudo fijar el PIN: ${updErr.message}` }, 400);
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: pin, email_confirm: true,
        user_metadata: { nombre, acceso_cedula: true, rol_tipo: tipo },
      });
      if (createError || !created.user) return json({ error: createError?.message ?? "No se pudo crear el acceso." }, 400);
      userId = created.user.id;
      // BH4 — la cédula también se persiste en el alta desde ficha (identidad única).
      const { error: profErr } = await admin.from("usuarios").insert({ id: userId, nombre, email, cedula: cedula.replace(/\D/g, ""), activo: true });
      if (profErr) { await admin.auth.admin.deleteUser(userId); return json({ error: `No se pudo crear el perfil: ${profErr.message}` }, 400); }
    }

    // Rol.
    const { data: rol, error: rolErr } = await admin.from("roles").select("id").eq("codigo", cfg.rol).maybeSingle();
    if (rolErr || rol?.id == null) return json({ error: `No existe el rol '${cfg.rol}'. Configúralo en Administración › Roles.` }, 400);
    const { error: rolAssignErr } = await admin.from("usuarios_roles")
      .upsert({ usuario_id: userId, rol_id: rol.id, asignado_por: callerData.user.id }, { onConflict: "usuario_id,rol_id", ignoreDuplicates: true });
    if (rolAssignErr) return json({ error: `No se pudo asignar el rol: ${rolAssignErr.message}` }, 400);

    // Enlazar la ficha con su usuario.
    const { error: linkErr } = await admin.from(cfg.tabla).update({ usuario_id: userId }).eq("id", entityId);
    if (linkErr) return json({ error: `No se pudo enlazar la ficha: ${linkErr.message}` }, 400);

    return json({ email, usuarioId: userId, created: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
