import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { importarLlaveMaestra, toHexBytea, fromHexBytea, cifrarTexto, descifrarTexto } from "../_shared/cripto-secretos.ts";

// ============================================================================
// DA4/DA6 — clave de acceso del equipo (personal o compartida), cifrada
// AES-256-GCM con la MISMA llave maestra del Vault (BOVEDA_MASTER_KEY, una
// sola por entorno) pero FUERA del Vault: tabla y gate propios
// (sgc.puede_ver_claves_equipos), sin reautenticación de contraseña (no es el
// Vault), con valor visible 30s y Cache-Control: no-store.
//
// Reglas de esta pieza (no negociables, DA-06/DA-17):
//   - El valor en claro NUNCA se registra en logs ni en tec_equipo_historial.
//   - Nunca alcanzable desde el conector de Claude (DZ-15 — verify-boveda-
//     fuera-de-ia.mjs se extiende para buscar también "equipos-clave").
//   - Sin BOVEDA_MASTER_KEY configurada: se deshabilita con aviso, NUNCA
//     guarda nada en claro.
//
//   Entrada (POST, JWT del usuario):
//     { accion: 'ver'|'guardar'|'quitar', equipo_id,
//       tipo_clave?: 'personal'|'compartida', valor?: string }
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALOR_VISIBLE_SEG = 30;

// deno-lint-ignore no-explicit-any
type Any = any;

let masterKeyPromise: Promise<CryptoKey> | null = null;
function masterKey(): Promise<CryptoKey> {
  if (!masterKeyPromise) masterKeyPromise = importarLlaveMaestra(envRequerido("BOVEDA_MASTER_KEY"));
  return masterKeyPromise;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = { ...construirCors(req), "Cache-Control": "no-store" };
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  // Sin llave maestra configurada: deshabilitada, nunca guarda en claro.
  if (!Deno.env.get("BOVEDA_MASTER_KEY")) {
    return json({ ok: false, error: "La clave de equipos no está configurada todavía en este entorno." }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autenticado." }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).schema("sgc");

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ ok: false, error: "Sesión inválida." }, 401);
  const userId = userData.user.id;

  // DZ-15 — nunca alcanzable desde el conector de Claude (OAuth).
  const { error: oauthErr } = await userClient.schema("sgc").rpc("rechazar_si_cliente_oauth");
  if (oauthErr) return json({ ok: false, error: "Esta acción no está permitida desde un conector externo." }, 403);

  // DA-06 — gate propio (NO el genérico de módulo tecnología).
  const { data: puede } = await userClient.schema("sgc").rpc("puede_ver_claves_equipos");
  if (!puede) return json({ ok: false, error: "No autorizado." }, 403);

  let body: Any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Cuerpo inválido." }, 400);
  }
  const accion = body?.accion;
  const equipoId = body?.equipo_id;
  if (!equipoId) return json({ ok: false, error: "Falta el equipo." }, 400);

  async function auditar(descripcion: string) {
    await svc.from("tec_equipo_historial").insert({
      equipo_id: equipoId, tipo_cambio: "clave", descripcion, usuario_id: userId,
    });
  }

  try {
    if (accion === "ver") {
      const { data: fila, error } = await svc
        .from("tec_equipo_claves")
        .select("valor_cifrado, valor_iv, tipo_clave")
        .eq("equipo_id", equipoId)
        .maybeSingle();
      if (error) throw error;
      if (!fila?.valor_cifrado || !fila?.valor_iv) return json({ ok: false, error: "Este equipo no tiene clave guardada." }, 404);
      const valor = await descifrarTexto(await masterKey(), fromHexBytea(fila.valor_cifrado), fromHexBytea(fila.valor_iv), equipoId);
      await auditar("Alguien vio la clave del equipo.");
      return json({ ok: true, valor, tipo_clave: fila.tipo_clave, visible_segundos: VALOR_VISIBLE_SEG });
    }

    if (accion === "guardar") {
      const { tipo_clave, valor } = body;
      if (!tipo_clave || !["personal", "compartida"].includes(tipo_clave)) {
        return json({ ok: false, error: "Indica si la clave es personal o compartida." }, 400);
      }
      if (typeof valor !== "string" || !valor.length) return json({ ok: false, error: "Escribe la clave." }, 400);
      const { cifrado, iv } = await cifrarTexto(await masterKey(), valor, equipoId);
      const { error } = await svc.from("tec_equipo_claves").upsert({
        equipo_id: equipoId, tipo_clave, valor_cifrado: toHexBytea(cifrado), valor_iv: toHexBytea(iv),
        actualizada_por: userId, actualizada_en: new Date().toISOString(),
      }, { onConflict: "equipo_id" });
      if (error) throw error;
      await auditar("Alguien guardó/cambió la clave del equipo.");
      return json({ ok: true });
    }

    if (accion === "quitar") {
      const { error } = await svc.from("tec_equipo_claves").delete().eq("equipo_id", equipoId);
      if (error) throw error;
      await auditar("Alguien quitó la clave del equipo.");
      return json({ ok: true });
    }

    return json({ ok: false, error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("equipos-clave edge error:", e instanceof Error ? e.message : JSON.stringify(e));
    return json({ ok: false, error: "No se pudo completar la operación." }, 500);
  }
});
