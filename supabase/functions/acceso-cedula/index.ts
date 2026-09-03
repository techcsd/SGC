import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AX2 / BH4 / BI5-BI6 — Genera/rota el acceso por CÉDULA + PIN para personal SIN
// correo, de forma GENÉRICA por tipo de rol.
//   tipo 'conductor' → ficha en `conductores`   → rol chofer_transportista
//   tipo 'capataz'   → ficha en `personal_obra`  → rol capataz
// Tres modos:
//   1) altaDirecta  (nombre + cedula)  → crea el acceso sin ficha previa.
//   2) desde ficha  (entityId)         → crea/enlaza o rota el PIN por la ficha.
//   3) por usuario  (usuarioId)  [BI5] → ROTA el PIN de un usuario existente,
//      direccionado por su id (el camino que faltaba en Administración → Usuarios).
// service_role; el llamador se re-verifica con su propio token.
//
// BI6 (gate): crear acceso y rotar PIN = is_admin() OR es_tecnologia() (decisión
// Xaviel 03-sep). Antes bastaba tener el módulo flota/proyectos/rrhh — cualquiera
// con Flota podía crear un chofer con la contraseña que quisiera. Ahora no.
// BI6 (auditoría): TODA creación de acceso y TODA rotación de PIN queda en audit_log.
// BI5 (PIN): se rechazan PIN triviales (repetidos, secuencias, la propia cédula).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// BI5 — un PIN de 6 dígitos es trivial si: todos iguales, secuencia asc/desc, o es
// (parte de) la propia cédula. También un puñado de combos comunes.
function esPinTrivial(pin: string, cedula = ""): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true; // 000000, 111111…
  const COMUNES = new Set(["123456", "654321", "123123", "121212", "112233", "102030", "147258"]);
  if (COMUNES.has(pin)) return true;
  let asc = true, desc = true;
  for (let i = 1; i < 6; i++) {
    const d = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  if (asc || desc) return true;
  const ced = (cedula || "").replace(/\D/g, "");
  if (ced && ced.includes(pin)) return true; // el PIN aparece dentro de la cédula
  return false;
}

type Tipo = "conductor" | "capataz";
interface Cfg {
  tabla: string;
  dominio: string;
  prefijo: string;
  rol: string;
  cedula: (row: Record<string, unknown>) => string;
  nombre: (row: Record<string, unknown>) => string;
}
const CFG: Record<Tipo, Cfg> = {
  conductor: {
    tabla: "conductores", dominio: "@conductores.constructorasd.local", prefijo: "c-",
    rol: "chofer_transportista",
    cedula: (r) => String(r.cedula ?? ""),
    nombre: (r) => String(r.nombre ?? "Conductor"),
  },
  capataz: {
    tabla: "personal_obra", dominio: "@personal.constructorasd.local", prefijo: "cap-",
    rol: "capataz",
    cedula: (r) => String(r.documento_numero ?? ""),
    nombre: (r) => `${r.nombre ?? ""} ${r.apellido ?? ""}`.trim() || "Capataz",
  },
};
const SYNTH_DOMAINS = ["@conductores.constructorasd.local", "@personal.constructorasd.local", "@test.constructorasd.local"];
function esEmailSintetico(email: string): boolean {
  return SYNTH_DOMAINS.some((d) => email.toLowerCase().endsWith(d));
}
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

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });
    const audit = (action: string, targetUserId: string | null, metadata: Record<string, unknown>) =>
      admin.from("audit_log").insert({ actor_id: callerData.user.id, action, target_user_id: targetUserId, metadata }).then(() => {}, () => {});

    const body = await req.json();
    const { tipo, entityId, usuarioId, pin, nombre: nombreDirecto, cedula: cedulaDirecta } = body;

    // ── MODO 4 (BI6-FASE5): el PROPIO usuario rota SU PIN de acceso ────────────
    // NO pasa por el gate admin/tecnología: cualquier trabajador autenticado puede
    // cambiar SU PROPIO PIN, verificando el actual (re-auth). Solo aplica a cuentas
    // de email sintético (acceso por cédula); las de correo real usan el enlace por
    // correo. Nunca puede tocar el PIN de OTRO usuario: el target es siempre el uid
    // del token. Queda auditado (via='self'). Va ANTES del gate a propósito.
    if (body?.self === true) {
      const uid = callerData.user.id;
      const pinActual = String(body.pinActual ?? "");
      const pinNuevo = String(body.pinNuevo ?? "");
      if (!/^\d{6}$/.test(pinNuevo)) return json({ error: "El PIN nuevo debe tener exactamente 6 dígitos." }, 400);
      const { data: me } = await admin.from("usuarios").select("id, email, cedula").eq("id", uid).maybeSingle();
      if (!me) return json({ error: "Usuario no encontrado." }, 404);
      const email = String(me.email ?? "");
      if (!esEmailSintetico(email)) {
        return json({ error: "Tu cuenta inicia sesión con correo. Para cambiar tu contraseña usa el enlace de restablecimiento por correo." }, 409);
      }
      if (pinNuevo === pinActual) return json({ error: "El PIN nuevo debe ser distinto del actual." }, 400);
      // Verifica el PIN actual re-autenticando en un cliente efímero (no toca la sesión).
      const check = createClient(supabaseUrl, anonKey);
      const { error: reauthErr } = await check.auth.signInWithPassword({ email, password: pinActual });
      if (reauthErr) return json({ error: "Tu PIN actual no es correcto." }, 401);
      const cedForCheck = String(me.cedula ?? "") || email.split("@")[0].replace(/^(cap-|c-|t-)/, "");
      if (esPinTrivial(pinNuevo, cedForCheck)) return json({ error: "Ese PIN es demasiado fácil de adivinar (repetido, secuencia o tu cédula). Elige otro." }, 400);
      const { error: updErr } = await admin.auth.admin.updateUserById(uid, { password: pinNuevo });
      if (updErr) return json({ error: `No se pudo cambiar el PIN: ${updErr.message}` }, 400);
      await admin.from("conductor_login_intentos").delete().eq("cedula", cedForCheck.replace(/\D/g, "")).then(() => {}, () => {});
      await audit("credencial_pin_rotado", uid, { via: "self", email });
      return json({ self: true, rotated: true });
    }

    // BI6 — gate único para gestionar accesos de OTROS: admin o tecnología.
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    const { data: esTec } = await callerClient.schema("sgc").rpc("es_tecnologia");
    if (!isAdmin && !esTec) return json({ error: "No autorizado. Solo Administración o Tecnología pueden gestionar accesos de campo." }, 403);

    // ── MODO 3 (BI5): rotar el PIN de un usuario existente por su id ───────────
    if (typeof usuarioId === "string" && usuarioId) {
      if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return json({ error: "El PIN debe tener exactamente 6 dígitos." }, 400);
      const { data: target } = await admin.from("usuarios").select("id, nombre, email, cedula").eq("id", usuarioId).maybeSingle();
      if (!target) return json({ error: "Usuario no encontrado." }, 404);
      const email = String(target.email ?? "");
      if (!esEmailSintetico(email)) {
        return json({ error: "Este usuario inicia sesión con su correo. Usa el restablecimiento por correo." }, 409);
      }
      const cedForCheck = String(target.cedula ?? "") || email.split("@")[0].replace(/^(cap-|c-|t-)/, "");
      if (esPinTrivial(pin, cedForCheck)) return json({ error: "Ese PIN es demasiado fácil de adivinar (repetido, secuencia o tu cédula). Elige otro." }, 400);
      const { error: updErr } = await admin.auth.admin.updateUserById(usuarioId, { password: pin });
      if (updErr) return json({ error: `No se pudo fijar el PIN: ${updErr.message}` }, 400);
      await admin.from("conductor_login_intentos").delete().eq("cedula", cedForCheck.replace(/\D/g, "")).then(() => {}, () => {});
      await audit("credencial_pin_rotado", usuarioId, { via: "usuarioId", email, por: isAdmin ? "admin" : "tecnologia" });
      return json({ usuarioId, email, rotated: true });
    }

    if (tipo !== "conductor" && tipo !== "capataz") return json({ error: "tipo inválido." }, 400);
    const cfg = CFG[tipo as Tipo];
    // BH4 — dos modos: desde una ficha existente (entityId) o ALTA DIRECTA (nombre+cedula).
    const altaDirecta = (!entityId || typeof entityId !== "string") &&
      typeof nombreDirecto === "string" && String(nombreDirecto).trim() !== "" &&
      typeof cedulaDirecta === "string" && String(cedulaDirecta).replace(/\D/g, "") !== "";
    if (!altaDirecta && (typeof entityId !== "string" || !entityId)) {
      return json({ error: "Indica una ficha (entityId), un usuario (usuarioId) o nombre + cédula para el alta directa." }, 400);
    }
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return json({ error: "El PIN debe tener exactamente 6 dígitos." }, 400);

    // ── BH4 — ALTA DIRECTA: crear el acceso sin ficha previa (nombre + cédula). ──
    if (altaDirecta) {
      const cedula = String(cedulaDirecta).replace(/\D/g, "");
      if (esPinTrivial(pin, cedula)) return json({ error: "Ese PIN es demasiado fácil de adivinar (repetido, secuencia o la cédula). Elige otro." }, 400);
      const nombre = String(nombreDirecto).trim();
      const email = syntheticEmail(cfg.prefijo, cedula, cfg.dominio);

      // AU18 — la cédula es identidad: si ya existe esa persona, se BLOQUEA con salida.
      const { data: dupCedula } = await admin.from("usuarios").select("id, nombre").eq("cedula", cedula).maybeSingle();
      const { data: dupEmail } = await admin.from("usuarios").select("id, nombre").eq("email", email).maybeSingle();
      const dup = dupCedula ?? dupEmail;
      if (dup?.id) {
        return json({
          error: `Ya existe un usuario con esa cédula: "${dup.nombre}". Usa "Fijar PIN" en su ficha en vez de crear otro.`,
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

      await audit("credencial_acceso_creado", userId, { via: "alta_directa", tipo, cedula, email, rol: cfg.rol });
      return json({ email, usuarioId: userId, cedula, created: true, altaDirecta: true });
    }

    const { data: ficha, error: fErr } = await admin.from(cfg.tabla).select("*").eq("id", entityId).maybeSingle();
    if (fErr || !ficha) return json({ error: "Ficha no encontrada." }, 404);

    const cedula = cfg.cedula(ficha);
    if (!cedula.replace(/\D/g, "")) return json({ error: "La ficha no tiene cédula/documento válido para generar el acceso." }, 400);
    if (esPinTrivial(pin, cedula)) return json({ error: "Ese PIN es demasiado fácil de adivinar (repetido, secuencia o la cédula). Elige otro." }, 400);
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
      await audit("credencial_pin_rotado", fichaUsuarioId, { via: "ficha", tipo, cedula: cedula.replace(/\D/g, ""), email });
      return json({ email, usuarioId: fichaUsuarioId, rotated: true });
    }

    // AU18 — avisar si ya existe un usuario con esa cédula (posible duplicado de persona).
    let userId: string | null = null;
    let reused = false;
    const { data: existingProfile } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (existingProfile?.id) {
      userId = existingProfile.id as string;
      reused = true;
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

    await audit(reused ? "credencial_pin_rotado" : "credencial_acceso_creado", userId, { via: "ficha", tipo, cedula: cedula.replace(/\D/g, ""), email, rol: cfg.rol });
    return json({ email, usuarioId: userId, created: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
