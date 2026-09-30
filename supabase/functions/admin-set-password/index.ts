import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// CC3 — Un admin FIJA la contraseña de un usuario (los QA/sintéticos no tienen
// buzón para el "reset por correo"). service_role solo aquí; gate is_admin().
// El admin escribe una contraseña (fuerza ≥ 10 con número) o pide GENERAR una;
// se devuelve UNA vez (se muestra con Copiar) y NUNCA se guarda. Para cuentas
// REALES (no qa_*, no es_prueba, no sintéticas) marca debe_cambiar_password=true
// → el usuario la cambia al entrar (nadie queda conociendo la contraseña de otro).
// Audita `password_establecida_por_admin` (sin la contraseña).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function genPassword(): string {
  // Genera una contraseña fuerte (letras sin ambigüedad + al menos un dígito).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const nums = "23456789";
  const arr = new Uint32Array(15);
  crypto.getRandomValues(arr);
  const body = Array.from(arr.slice(0, 13), (n) => chars[n % chars.length]).join("");
  const d1 = nums[arr[13] % nums.length];
  const d2 = nums[arr[14] % nums.length];
  return `${body}${d1}${d2}`;
}
// Fuerza mínima: ≥ 10 caracteres y al menos un número.
function esFuerte(pw: string): boolean {
  return typeof pw === "string" && pw.length >= 10 && /[0-9]/.test(pw);
}

const SYNTH_DOMAINS = ["@conductores.constructorasd.local", "@personal.constructorasd.local", "@test.constructorasd.local"];

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
    if (!isAdmin) return json({ error: "No autorizado." }, 403);

    const { userId, password: rawPw, generate } = await req.json();
    if (typeof userId !== "string" || !userId) return json({ error: "userId requerido." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });
    const { data: target } = await admin
      .from("usuarios").select("id, email, es_prueba").eq("id", userId).maybeSingle();
    if (!target) return json({ error: "Usuario no encontrado." }, 404);

    // ¿Cuenta real? (no qa_*, no es_prueba, no sintética) → debe cambiarla al entrar.
    const email = String(target.email ?? "").toLowerCase();
    const esSintetico = SYNTH_DOMAINS.some((d) => email.endsWith(d));
    const esQa = email.startsWith("qa_");
    const esReal = !esSintetico && !esQa && !target.es_prueba;

    const password = generate === true ? genPassword() : rawPw;
    if (!esFuerte(password)) {
      return json({ error: "La contraseña debe tener al menos 10 caracteres e incluir un número." }, 400);
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password });
    if (updErr) return json({ error: `No se pudo establecer la contraseña: ${updErr.message}` }, 400);

    // Para cuentas reales: forzar cambio al entrar. Para qa/sintéticas/prueba: no.
    if (esReal) {
      await admin.from("usuarios").update({ debe_cambiar_password: true }).eq("id", userId).then(() => {}, () => {});
    } else {
      await admin.from("usuarios").update({ debe_cambiar_password: false }).eq("id", userId).then(() => {}, () => {});
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "password_establecida_por_admin",
      target_user_id: userId,
      metadata: { email, generada: generate === true, debe_cambiar: esReal },
    }).then(() => {}, () => {});

    // Se devuelve la contraseña SOLO si el admin la generó (para mostrarla una vez).
    return json({ ok: true, password: generate === true ? password : undefined, debeCambiar: esReal });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
