import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AX2 / BH4 / BI5-BI6 / CG5 — Genera/rota el acceso por CÉDULA + PIN para personal SIN
// correo, de forma GENÉRICA por tipo de rol.
//   tipo 'conductor'      → ficha en `conductores`  → rol chofer_transportista
//   tipo 'chofer_privado' → ficha en `conductores`  → rol chofer_privado
//   tipo 'capataz'        → ficha en `personal_obra` → rol capataz
//   tipo 'encargado'      → solo acceso (sin ficha) → rol encargado_patio
// Tres modos: altaDirecta (nombre+cedula) · desde ficha (entityId) · por usuario (usuarioId).
// service_role; el llamador se re-verifica con su propio token.
//
// BI6 (gate): crear acceso y rotar PIN = is_admin() OR es_tecnologia().
// BI6 (auditoría): TODA creación de acceso y TODA rotación de PIN queda en audit_log.
// BI5 (PIN): se rechazan PIN triviales (repetidos, secuencias, la propia cédula).
//
// CG5 — "Failed to send a request to the Edge Function": esa cadena la lanza supabase-js
// (FunctionsFetchError) cuando la petición NO recibe una respuesta con CORS — un fallo de
// transporte (worker frío/ocupado, timeout o rechazo del gateway), NO un error de negocio.
// Blindaje: la función se auto-autentica (por eso verify_jwt=false en config.toml, como
// conductor-crear-acceso → se elimina el rechazo del gateway sin CORS) y TODA salida es JSON
// con CORS y un `error_code` estable para que el front muestre un mensaje humano (regla 16).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
// CG5 — toda salida de error lleva un error_code estable (lo mapea el front a un mensaje humano).
function fail(error: string, error_code: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ error, error_code, ...extra }, status);
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

// BR8 — el acceso por cédula+PIN ya no es solo para choferes/capataces.
type Tipo = "conductor" | "capataz" | "encargado" | "chofer_privado";
interface Cfg {
  tabla: string;
  dominio: string;
  prefijo: string;
  rol: string;
  soloAltaDirecta?: boolean; // no tiene tabla de ficha; solo alta directa / rotación por usuarioId
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
  // Chofer privado (personal de gerencia): misma ficha de conductor (@conductores → el
  // trigger le fabrica su ficha) pero rol chofer_privado (fuera de la rotación de flota).
  chofer_privado: {
    tabla: "conductores", dominio: "@conductores.constructorasd.local", prefijo: "c-",
    rol: "chofer_privado",
    cedula: (r) => String(r.cedula ?? ""),
    nombre: (r) => String(r.nombre ?? "Chofer privado"),
  },
  capataz: {
    tabla: "personal_obra", dominio: "@personal.constructorasd.local", prefijo: "cap-",
    rol: "capataz",
    cedula: (r) => String(r.documento_numero ?? ""),
    nombre: (r) => `${r.nombre ?? ""} ${r.apellido ?? ""}`.trim() || "Capataz",
  },
  encargado: {
    tabla: "usuarios", dominio: "@acceso.constructorasd.local", prefijo: "e-",
    rol: "encargado_patio", soloAltaDirecta: true,
    cedula: (r) => String(r.cedula ?? ""),
    nombre: (r) => String(r.nombre ?? "Encargado"),
  },
};
const SYNTH_DOMAINS = ["@conductores.constructorasd.local", "@personal.constructorasd.local", "@acceso.constructorasd.local", "@test.constructorasd.local"];
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
    if (!authHeader) return fail("No autenticado.", "no_auth", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return fail("Sesión inválida. Vuelve a iniciar sesión.", "sesion_invalida", 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });
    const audit = (action: string, targetUserId: string | null, metadata: Record<string, unknown>) =>
      admin.from("audit_log").insert({ actor_id: callerData.user.id, action, target_user_id: targetUserId, metadata }).then(() => {}, () => {});

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return fail("Petición inválida.", "cuerpo_invalido", 400);
    }
    const { tipo, entityId, usuarioId, pin, nombre: nombreDirecto, cedula: cedulaDirecta } = body as Record<string, unknown>;

    // ── MODO 4 (BI6-FASE5): el PROPIO usuario rota SU PIN de acceso ────────────
    if (body?.self === true) {
      const uid = callerData.user.id;
      const pinActual = String(body.pinActual ?? "");
      const pinNuevo = String(body.pinNuevo ?? "");
      if (!/^\d{6}$/.test(pinNuevo)) return fail("El PIN nuevo debe tener exactamente 6 dígitos.", "pin_formato", 400);
      const { data: me } = await admin.from("usuarios").select("id, email, cedula").eq("id", uid).maybeSingle();
      if (!me) return fail("Usuario no encontrado.", "usuario_no_encontrado", 404);
      const email = String(me.email ?? "");
      if (!esEmailSintetico(email)) {
        return fail("Tu cuenta inicia sesión con correo. Para cambiar tu contraseña usa el enlace de restablecimiento por correo.", "cuenta_con_correo", 409);
      }
      if (pinNuevo === pinActual) return fail("El PIN nuevo debe ser distinto del actual.", "pin_igual", 400);
      const check = createClient(supabaseUrl, anonKey);
      const { error: reauthErr } = await check.auth.signInWithPassword({ email, password: pinActual });
      if (reauthErr) return fail("Tu PIN actual no es correcto.", "pin_incorrecto", 401);
      const cedForCheck = String(me.cedula ?? "") || email.split("@")[0].replace(/^(cap-|c-|t-)/, "");
      if (esPinTrivial(pinNuevo, cedForCheck)) return fail("Ese PIN es demasiado fácil de adivinar (repetido, secuencia o tu cédula). Elige otro.", "pin_debil", 400);
      const { error: updErr } = await admin.auth.admin.updateUserById(uid, { password: pinNuevo });
      if (updErr) return fail(`No se pudo cambiar el PIN: ${updErr.message}`, "pin_update_fallo", 400);
      await admin.from("conductor_login_intentos").delete().eq("cedula", cedForCheck.replace(/\D/g, "")).then(() => {}, () => {});
      await audit("credencial_pin_rotado", uid, { via: "self", email });
      return json({ self: true, rotated: true });
    }

    // BI6 — gate único para gestionar accesos de OTROS: admin o tecnología.
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    const { data: esTec } = await callerClient.schema("sgc").rpc("es_tecnologia");
    if (!isAdmin && !esTec) return fail("No autorizado. Solo Administración o Tecnología pueden gestionar accesos de campo.", "no_autorizado", 403);

    // ── MODO 3 (BI5): rotar el PIN de un usuario existente por su id ───────────
    if (typeof usuarioId === "string" && usuarioId) {
      if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return fail("El PIN debe tener exactamente 6 dígitos.", "pin_formato", 400);
      const { data: target } = await admin.from("usuarios").select("id, nombre, email, cedula").eq("id", usuarioId).maybeSingle();
      if (!target) return fail("Usuario no encontrado.", "usuario_no_encontrado", 404);
      const email = String(target.email ?? "");
      if (!esEmailSintetico(email)) {
        return fail("Este usuario inicia sesión con su correo. Usa el restablecimiento por correo.", "cuenta_con_correo", 409);
      }
      const cedForCheck = String(target.cedula ?? "") || email.split("@")[0].replace(/^(cap-|c-|t-)/, "");
      if (esPinTrivial(pin, cedForCheck)) return fail("Ese PIN es demasiado fácil de adivinar (repetido, secuencia o tu cédula). Elige otro.", "pin_debil", 400);
      const { error: updErr } = await admin.auth.admin.updateUserById(usuarioId, { password: pin });
      if (updErr) return fail(`No se pudo fijar el PIN: ${updErr.message}`, "pin_update_fallo", 400);
      await admin.from("conductor_login_intentos").delete().eq("cedula", cedForCheck.replace(/\D/g, "")).then(() => {}, () => {});
      await audit("credencial_pin_rotado", usuarioId, { via: "usuarioId", email, por: isAdmin ? "admin" : "tecnologia" });
      return json({ usuarioId, email, rotated: true });
    }

    if (tipo !== "conductor" && tipo !== "capataz" && tipo !== "encargado" && tipo !== "chofer_privado") return fail("Tipo de acceso inválido.", "tipo_invalido", 400);
    const cfg = CFG[tipo as Tipo];
    if (cfg.soloAltaDirecta && (typeof entityId === "string" && entityId)) {
      return fail(`El tipo '${tipo}' se crea por alta directa (nombre + cédula), no desde una ficha.`, "tipo_solo_alta_directa", 400);
    }
    // BH4 — dos modos: desde una ficha existente (entityId) o ALTA DIRECTA (nombre+cedula).
    const altaDirecta = (!entityId || typeof entityId !== "string") &&
      typeof nombreDirecto === "string" && String(nombreDirecto).trim() !== "" &&
      typeof cedulaDirecta === "string" && String(cedulaDirecta).replace(/\D/g, "") !== "";
    if (!altaDirecta && (typeof entityId !== "string" || !entityId)) {
      return fail("Indica una ficha (entityId), un usuario (usuarioId) o nombre + cédula para el alta directa.", "falta_datos", 400);
    }
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return fail("El PIN debe tener exactamente 6 dígitos.", "pin_formato", 400);

    // ── BH4 — ALTA DIRECTA: crear el acceso sin ficha previa (nombre + cédula). ──
    if (altaDirecta) {
      const cedula = String(cedulaDirecta).replace(/\D/g, "");
      if (esPinTrivial(pin, cedula)) return fail("Ese PIN es demasiado fácil de adivinar (repetido, secuencia o la cédula). Elige otro.", "pin_debil", 400);
      const nombre = String(nombreDirecto).trim();
      const email = syntheticEmail(cfg.prefijo, cedula, cfg.dominio);

      // AU18 — la cédula es identidad: si ya existe esa persona, se BLOQUEA con salida.
      const { data: dupCedula } = await admin.from("usuarios").select("id, nombre").eq("cedula", cedula).maybeSingle();
      const { data: dupEmail } = await admin.from("usuarios").select("id, nombre").eq("email", email).maybeSingle();
      const dup = dupCedula ?? dupEmail;
      if (dup?.id) {
        return fail(
          `Ya existe un usuario con esa cédula: "${dup.nombre}". Usa "Fijar PIN" en su ficha en vez de crear otro.`,
          "cedula_existe", 409,
          { duplicado: { id: dup.id, nombre: dup.nombre } },
        );
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: pin, email_confirm: true,
        user_metadata: { nombre, acceso_cedula: true, rol_tipo: tipo },
      });
      if (createError || !created.user) return fail(createError?.message ?? "No se pudo crear el acceso.", "crear_acceso_fallo", 400);
      const userId = created.user.id;
      const { error: profErr } = await admin.from("usuarios").insert({ id: userId, nombre, email, cedula, activo: true });
      if (profErr) { await admin.auth.admin.deleteUser(userId); return fail(`No se pudo crear el perfil: ${profErr.message}`, "perfil_fallo", 400); }

      const { data: rol, error: rolErr } = await admin.from("roles").select("id").eq("codigo", cfg.rol).maybeSingle();
      if (rolErr || rol?.id == null) { await admin.auth.admin.deleteUser(userId); return fail(`No existe el rol '${cfg.rol}'. Configúralo en Administración › Roles.`, "rol_inexistente", 400); }
      const { error: rolAssignErr } = await admin.from("usuarios_roles")
        .upsert({ usuario_id: userId, rol_id: rol.id, asignado_por: callerData.user.id }, { onConflict: "usuario_id,rol_id", ignoreDuplicates: true });
      if (rolAssignErr) return fail(`No se pudo asignar el rol: ${rolAssignErr.message}`, "rol_asignar_fallo", 400);

      await audit("credencial_acceso_creado", userId, { via: "alta_directa", tipo, cedula, email, rol: cfg.rol });
      return json({ email, usuarioId: userId, cedula, created: true, altaDirecta: true });
    }

    const { data: ficha, error: fErr } = await admin.from(cfg.tabla).select("*").eq("id", entityId).maybeSingle();
    if (fErr || !ficha) return fail("Ficha no encontrada.", "ficha_no_encontrada", 404);

    const cedula = cfg.cedula(ficha);
    if (!cedula.replace(/\D/g, "")) return fail("La ficha no tiene cédula/documento válido para generar el acceso.", "ficha_sin_cedula", 400);
    if (esPinTrivial(pin, cedula)) return fail("Ese PIN es demasiado fácil de adivinar (repetido, secuencia o la cédula). Elige otro.", "pin_debil", 400);
    const nombre = cfg.nombre(ficha);
    const email = syntheticEmail(cfg.prefijo, cedula, cfg.dominio);
    const fichaUsuarioId = (ficha as Record<string, unknown>).usuario_id as string | null;

    // Caso 1: ya tiene acceso → rotar PIN (salvo que use correo real).
    if (fichaUsuarioId) {
      const { data: linked } = await admin.from("usuarios").select("email").eq("id", fichaUsuarioId).maybeSingle();
      const linkedEmail = (linked?.email ?? "") as string;
      if (linkedEmail && !linkedEmail.endsWith(cfg.dominio)) {
        return fail("Esta persona ya inicia sesión con su correo. El acceso por cédula + PIN es solo para quien no tiene correo.", "ya_correo_real", 409);
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(fichaUsuarioId, { password: pin });
      if (updErr) return fail(`No se pudo actualizar el PIN: ${updErr.message}`, "pin_update_fallo", 400);
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
      if (updErr) return fail(`No se pudo fijar el PIN: ${updErr.message}`, "pin_update_fallo", 400);
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: pin, email_confirm: true,
        user_metadata: { nombre, acceso_cedula: true, rol_tipo: tipo },
      });
      if (createError || !created.user) return fail(createError?.message ?? "No se pudo crear el acceso.", "crear_acceso_fallo", 400);
      userId = created.user.id;
      // BH4 — la cédula también se persiste en el alta desde ficha (identidad única).
      const { error: profErr } = await admin.from("usuarios").insert({ id: userId, nombre, email, cedula: cedula.replace(/\D/g, ""), activo: true });
      if (profErr) { await admin.auth.admin.deleteUser(userId); return fail(`No se pudo crear el perfil: ${profErr.message}`, "perfil_fallo", 400); }
    }

    // Rol.
    const { data: rol, error: rolErr } = await admin.from("roles").select("id").eq("codigo", cfg.rol).maybeSingle();
    if (rolErr || rol?.id == null) return fail(`No existe el rol '${cfg.rol}'. Configúralo en Administración › Roles.`, "rol_inexistente", 400);
    const { error: rolAssignErr } = await admin.from("usuarios_roles")
      .upsert({ usuario_id: userId, rol_id: rol.id, asignado_por: callerData.user.id }, { onConflict: "usuario_id,rol_id", ignoreDuplicates: true });
    if (rolAssignErr) return fail(`No se pudo asignar el rol: ${rolAssignErr.message}`, "rol_asignar_fallo", 400);

    // Enlazar la ficha con su usuario.
    const { error: linkErr } = await admin.from(cfg.tabla).update({ usuario_id: userId }).eq("id", entityId);
    if (linkErr) return fail(`No se pudo enlazar la ficha: ${linkErr.message}`, "enlace_fallo", 400);

    await audit(reused ? "credencial_pin_rotado" : "credencial_acceso_creado", userId, { via: "ficha", tipo, cedula: cedula.replace(/\D/g, ""), email, rol: cfg.rol });
    return json({ email, usuarioId: userId, created: true });
  } catch (e) {
    // CG5 — red de seguridad: cualquier excepción inesperada sale igualmente como JSON+CORS.
    return fail(e instanceof Error ? e.message : "Error desconocido.", "interno", 500);
  }
});
