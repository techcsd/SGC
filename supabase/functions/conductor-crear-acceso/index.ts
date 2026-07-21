import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// P5 — Genera o rota el acceso (cédula + PIN) de un conductor. service_role.
// Dado un conductor_id + PIN (6 dígitos): crea un usuario auth con email
// sintético determinista (c-{cedula}@conductores.constructorasd.local, email
// confirmado, sin verificación), le asigna el rol chofer_transportista y enlaza
// conductores.usuario_id. Idempotente: si el conductor ya tiene acceso, solo
// rota el PIN (reset). Gated a admin o módulo flota (re-verificado aquí, no se
// confía en el front).

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

/** Email sintético determinista a partir de la cédula (solo dígitos). */
function syntheticEmail(cedula: string): string {
  const digits = (cedula || "").replace(/\D/g, "");
  return `c-${digits}@conductores.constructorasd.local`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Re-verifica al llamador con su propio token (mismo patrón que admin-create-user).
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Sesión inválida." }, 401);

    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    const { data: tieneFlota } = await callerClient.schema("sgc").rpc("tiene_modulo", { p_modulo: "flota" });
    if (!isAdmin && !tieneFlota) {
      return json({ error: "No autorizado. Solo admin o Flota puede generar accesos." }, 403);
    }

    const { conductorId, pin } = await req.json();
    if (typeof conductorId !== "string" || !conductorId) {
      return json({ error: "conductorId requerido." }, 400);
    }
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      return json({ error: "El PIN debe tener exactamente 6 dígitos." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    // Cargar el conductor
    const { data: conductor, error: condError } = await admin
      .from("conductores")
      .select("id, cedula, nombre, usuario_id")
      .eq("id", conductorId)
      .maybeSingle();
    if (condError || !conductor) return json({ error: "Conductor no encontrado." }, 404);

    const email = syntheticEmail(conductor.cedula);
    const SYNTH_DOMAIN = "@conductores.constructorasd.local";

    // Caso 1: ya tiene acceso → rotar PIN. PERO si está vinculado a una cuenta con
    // correo REAL (p. ej. el jefe de flota Misael, que entra con su correo de
    // trabajo), NO se le toca la contraseña — eso rompería su login normal.
    if (conductor.usuario_id) {
      const { data: linked } = await admin
        .from("usuarios")
        .select("email")
        .eq("id", conductor.usuario_id)
        .maybeSingle();
      const linkedEmail = (linked?.email ?? "") as string;
      if (linkedEmail && !linkedEmail.endsWith(SYNTH_DOMAIN)) {
        return json(
          {
            error:
              "Este conductor ya inicia sesión con su correo de trabajo. El acceso por cédula + PIN es solo para conductores sin correo.",
          },
          409,
        );
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(conductor.usuario_id, {
        password: pin,
      });
      if (updErr) return json({ error: `No se pudo actualizar el PIN: ${updErr.message}` }, 400);
      // Limpiar cualquier bloqueo previo.
      await admin.from("conductor_login_intentos").delete().eq("cedula", conductor.cedula);
      return json({ email, usuarioId: conductor.usuario_id, rotated: true });
    }

    // Caso 2: puede existir un auth user con ese email (por ejecución previa
    // parcial). Buscarlo antes de crear (idempotencia).
    let userId: string | null = null;
    const { data: existingProfile } = await admin
      .from("usuarios")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingProfile?.id) {
      userId = existingProfile.id as string;
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password: pin });
      if (updErr) return json({ error: `No se pudo fijar el PIN: ${updErr.message}` }, 400);
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: pin,
        email_confirm: true,
        user_metadata: { nombre: conductor.nombre, conductor: true },
      });
      if (createError || !created.user) {
        return json({ error: createError?.message ?? "No se pudo crear el acceso." }, 400);
      }
      userId = created.user.id;

      const { error: profileError } = await admin
        .from("usuarios")
        .insert({ id: userId, nombre: conductor.nombre, email, activo: true });
      if (profileError) {
        await admin.auth.admin.deleteUser(userId);
        return json({ error: `No se pudo crear el perfil: ${profileError.message}` }, 400);
      }
    }

    // Asignar rol chofer_transportista. R13 — el conductor DEBE quedar 100%
    // provisionado (usuario + rol con módulo flota); si algo falla aquí, el login
    // lo rebotaría con "sin módulos". Por eso se falla ruidosamente en vez de
    // dejarlo a medias.
    const { data: rol, error: rolLookupErr } = await admin
      .from("roles").select("id").eq("codigo", "chofer_transportista").maybeSingle();
    if (rolLookupErr || rol?.id == null) {
      return json({ error: "No existe el rol 'chofer_transportista'. Configúralo en Administración › Roles antes de dar acceso." }, 400);
    }
    const { error: rolAssignErr } = await admin
      .from("usuarios_roles")
      .upsert({ usuario_id: userId, rol_id: rol.id, asignado_por: callerData.user.id }, {
        onConflict: "usuario_id,rol_id",
        ignoreDuplicates: true,
      });
    if (rolAssignErr) {
      return json({ error: `No se pudo asignar el rol de conductor: ${rolAssignErr.message}` }, 400);
    }

    // Enlazar el conductor con su usuario.
    const { error: linkErr } = await admin
      .from("conductores")
      .update({ usuario_id: userId })
      .eq("id", conductorId);
    if (linkErr) return json({ error: `No se pudo enlazar el conductor: ${linkErr.message}` }, 400);

    return json({ email, usuarioId: userId, created: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
