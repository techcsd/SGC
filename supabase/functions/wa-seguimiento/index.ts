import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { ajustarCorreoResend } from "../_shared/entorno.ts";
import { enviarTextoWhatsapp, type GraphConfig } from "../_shared/whatsapp.ts";
import {
  fechaRD, evaluarHallazgo, filtrarParaRecordar, filtrarParaVencer,
  consolidarPorPersona, consolidarEscalacionNivel3, dentroDeVentanaWhatsapp,
  dedupeKey, construirCorreoRecordatorio, construirCorreoEscalacionNivel3,
  type ConsolidadoPersona, type HallazgoAEvaluar,
} from "../_shared/wa-seguimiento.ts";

// ============================================================================
// DL4/F4 (ronda DL, 10-nov-2026) — wa-seguimiento: escalera de recordatorios
// de hallazgos de WhatsApp con responsable y seguimiento activo (DL3).
// Invocada EXCLUSIVAMENTE por pg_cron (x-sync-secret, nunca un JWT de
// Supabase) — mismo patrón que wa-extract. Lógica pura (niveles, consolidado,
// dedupe, textos) en ../_shared/wa-seguimiento.ts, con tests.
//
// Gate (DL-15): si sgc.envio_automatico_activo('wa_recordatorios') es falso,
// no hace nada (familia sembrada APAGADA — Xaviel la enciende cuando quiera).
// body.tarea='probar' arma el correo/push/whatsapp SOLO para quien lo pide.
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTIFICATIONS_FROM_EMAIL = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v26.0";

// deno-lint-ignore no-explicit-any
type Any = any;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" }, auth: { persistSession: false } });
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function logEvento(sb: Any, nivel: "info" | "alerta" | "critico", codigo: string, detalle: Any = {}) {
  await sb.from("wa_eventos").insert({ nivel, codigo, detalle }).then(() => {}, () => {});
}

async function registrarRecordatorio(sb: Any, fila: Any) {
  // dedupe_key único: un reintento del mismo día para la misma persona/canal
  // simplemente no vuelve a enviar (conflicto silencioso, esperado).
  await sb.from("wa_recordatorios").insert(fila).then(() => {}, (e: Any) => {
    if (!String(e?.message ?? "").toLowerCase().includes("duplicate")) {
      console.error("[wa-seguimiento] no se pudo registrar el log:", e);
    }
  });
}

async function enviarCorreoResend(resendApiKey: string, to: string[], subject: string, textoPlano: string) {
  const body = ajustarCorreoResend({ from: NOTIFICATIONS_FROM_EMAIL, to, subject, text: textoPlano });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function procesarPersona(
  sb: Any, resendApiKey: string | null, consolidado: ConsolidadoPersona, hoyRD: string, prueba: boolean,
) {
  const { usuarioId, items, nivelMax } = consolidado;
  const hallazgoIds = items.map((h) => h.id);

  const marcar = (canal: string, estado: string, motivo?: string | null) =>
    registrarRecordatorio(sb, {
      usuario_id: usuarioId, canal, nivel: nivelMax, hallazgo_ids: hallazgoIds, estado,
      motivo: motivo ?? null,
      // DL-26 (probar): sin dedupe_key, para que una prueba nunca choque con un envío real del día.
      dedupe_key: prueba ? null : dedupeKey(usuarioId, hoyRD, canal),
    });

  // ── Correo (DL-14, canal autoritativo vía destinatarios_notificacion) ─────
  const { data: destEmail } = await sb.rpc("destinatarios_notificacion", {
    p_tipo: "wa_recordatorio", p_usuarios: [usuarioId], p_canal: "email",
  });
  const filaEmail = ((destEmail ?? []) as Any[])[0] as { email?: string; excluido_por?: string | null } | undefined;
  if (!filaEmail?.email) {
    await marcar("email", "omitido", "sin_destinatario");
  } else if (filaEmail.excluido_por) {
    await marcar("email", "silenciado", filaEmail.excluido_por);
  } else if (!resendApiKey) {
    await marcar("email", "fallido", "sin_resend_api_key");
  } else {
    const { asunto, textoPlano } = construirCorreoRecordatorio(items);
    try {
      await enviarCorreoResend(resendApiKey, [filaEmail.email], prueba ? `[PRUEBA] ${asunto}` : asunto, textoPlano);
      await marcar("email", prueba ? "prueba" : "enviado");
    } catch (e) {
      console.error("[wa-seguimiento] correo falló:", e);
      await marcar("email", "fallido", String(e instanceof Error ? e.message : e).slice(0, 200));
    }
  }

  // ── Bandeja + push (mismo gate, canal in_app) ─────────────────────────────
  const { data: destInApp } = await sb.rpc("destinatarios_notificacion", {
    p_tipo: "wa_recordatorio", p_usuarios: [usuarioId], p_canal: "in_app",
  });
  const filaInApp = ((destInApp ?? []) as Any[])[0] as { excluido_por?: string | null } | undefined;
  if (!filaInApp) {
    await marcar("inapp", "omitido", "sin_destinatario");
  } else if (filaInApp.excluido_por) {
    await marcar("inapp", "silenciado", filaInApp.excluido_por);
  } else if (prueba) {
    await marcar("inapp", "prueba");
  } else {
    const { asunto } = construirCorreoRecordatorio(items);
    await sb.rpc("notificar_usuarios", {
      p_usuarios: [usuarioId], p_tipo: "wa_recordatorio", p_titulo: asunto,
      p_mensaje: items.map((h) => h.resumen).join(" · ").slice(0, 300), p_ruta: "/compa",
    }).then(() => {}, (e: Any) => console.error("[wa-seguimiento] notificar_usuarios falló:", e));
    await marcar("inapp", "enviado");
  }

  // ── WhatsApp privado (DL-13 — apagado por defecto; solo con plantilla o ventana 24h) ─
  const { data: cfgRow } = await sb.from("wa_config").select("recordatorio_whatsapp").eq("id", true).maybeSingle();
  if (cfgRow?.recordatorio_whatsapp) {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      await marcar("whatsapp", "fuera_de_ventana", "sin_config_whatsapp");
    } else {
      const { data: auth } = await sb.from("whatsapp_autorizados")
        .select("telefono").eq("usuario_id", usuarioId).eq("activo", true).maybeSingle();
      if (!auth?.telefono) {
        await marcar("whatsapp", "omitido", "no_autorizado");
      } else {
        const { data: conv } = await sb.from("whatsapp_conversaciones")
          .select("ultimo_mensaje_en").eq("telefono", auth.telefono).maybeSingle();
        if (!dentroDeVentanaWhatsapp(conv?.ultimo_mensaje_en ?? null)) {
          await marcar("whatsapp", "fuera_de_ventana");
        } else {
          const { textoPlano } = construirCorreoRecordatorio(items);
          try {
            if (!prueba) {
              const cfg: GraphConfig = { token: WHATSAPP_TOKEN, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, graphVersion: WHATSAPP_GRAPH_VERSION };
              const r = await enviarTextoWhatsapp(cfg, auth.telefono, textoPlano);
              if (!r.ok) throw new Error(r.error ?? "sin detalle");
            }
            await marcar("whatsapp", prueba ? "prueba" : "enviado");
          } catch (e) {
            console.error("[wa-seguimiento] whatsapp falló:", e);
            await marcar("whatsapp", "fallido", String(e instanceof Error ? e.message : e).slice(0, 200));
          }
        }
      }
    }
  }

  if (!prueba) {
    await sb.rpc("wa_marcar_recordatorio_enviado", { p_ids: hallazgoIds }).then(() => {}, () => {});
  }
}

async function procesarEscalacionNivel3(sb: Any, resendApiKey: string | null, porGrupo: Map<string, HallazgoAEvaluar[]>, hoyRD: string) {
  if (!porGrupo.size || !resendApiKey) return;
  for (const [grupoJid, items] of porGrupo) {
    const { data: grupo } = await sb.from("wa_grupos").select("nombre, responsables").eq("jid", grupoJid).maybeSingle();
    const nombre = grupo?.nombre ?? grupoJid;
    const usuariosTec = await sb.from("usuarios").select("id")
      .ilike("email", "Tecnologia@constructorasd.com").eq("activo", true).maybeSingle();
    const destinatarios = [...new Set([...(grupo?.responsables ?? []), usuariosTec.data?.id].filter(Boolean))] as string[];
    if (!destinatarios.length) continue;

    const { data: dest } = await sb.rpc("destinatarios_notificacion", {
      p_tipo: "wa_recordatorio", p_usuarios: destinatarios, p_canal: "email",
    });
    const correos = ((dest ?? []) as Any[]).filter((d) => d.email && !d.excluido_por).map((d) => d.email);
    if (!correos.length) continue;

    const { asunto, textoPlano } = construirCorreoEscalacionNivel3(nombre, items);
    try {
      await enviarCorreoResend(resendApiKey, correos, asunto, textoPlano);
      await registrarRecordatorio(sb, {
        usuario_id: null, canal: "email", nivel: 3, hallazgo_ids: items.map((h) => h.id),
        estado: "enviado", motivo: `escalacion_grupo:${grupoJid}`,
        dedupe_key: `escalacion|${grupoJid}|${hoyRD}`,
      });
    } catch (e) {
      console.error("[wa-seguimiento] escalación nivel 3 falló:", e);
    }
  }
}

async function handleSeguimiento(sb: Any, prueba: boolean, usuarioPrueba?: string) {
  if (!prueba && !(await sb.rpc("envio_automatico_activo", { p_familia: "wa_recordatorios" }).then((r: Any) => r.data))) {
    return json({ ok: true, omitido: "apagado" });
  }

  const ahora = Date.now();
  const hoyRD = fechaRD(new Date(ahora));

  const { data: pendientes, error } = await sb.from("wa_hallazgos")
    .select("id, responsable_id, grupo_jid, resumen, fecha_mencionada, seguimiento_desde, wa_grupos!inner(nombre)")
    .in("seguimiento", ["activo", "vencido"])
    .not("responsable_id", "is", null)
    .not("seguimiento_desde", "is", null);

  if (error) {
    console.error("[wa-seguimiento] error leyendo pendientes:", error);
    await logEvento(sb, "alerta", "wa_seguimiento_error", { paso: "leer_pendientes", error: String(error.message ?? error).slice(0, 500) });
    return json({ ok: false, error: "No se pudieron leer los pendientes." }, 500);
  }

  let base = ((pendientes ?? []) as Any[]).map((h) => ({
    id: h.id, responsable_id: h.responsable_id, grupo_jid: h.grupo_jid,
    grupo_nombre: h.wa_grupos?.nombre ?? h.grupo_jid, resumen: h.resumen,
    fecha_mencionada: h.fecha_mencionada, seguimiento_desde: h.seguimiento_desde,
  }));

  if (prueba && usuarioPrueba) {
    base = base.filter((h) => h.responsable_id === usuarioPrueba);
    if (!base.length) {
      // Sin pendientes reales → ejemplo, para poder "probar" aunque no tengas nada asignado.
      base = [{
        id: "00000000-0000-0000-0000-000000000000", responsable_id: usuarioPrueba,
        grupo_jid: "demo", grupo_nombre: "Grupo de ejemplo",
        resumen: "Ejemplo: confirmar si ya llegó el material pedido",
        fecha_mencionada: null, seguimiento_desde: new Date(ahora - 30 * 3_600_000).toISOString(),
      }];
    }
  }

  const evaluados = base.map((h) => evaluarHallazgo(h, hoyRD, ahora));
  const paraRecordar = filtrarParaRecordar(evaluados);
  const paraVencer = filtrarParaVencer(evaluados);

  if (!prueba && paraVencer.length) {
    await sb.rpc("wa_marcar_vencido", { p_ids: paraVencer.map((h) => h.id) }).then(() => {}, () => {});
  }

  const { data: resendApiKey } = await sb.rpc("get_resend_api_key");

  const consolidados = consolidarPorPersona(paraRecordar);
  for (const c of consolidados) {
    await procesarPersona(sb, resendApiKey ?? null, c, hoyRD, prueba);
  }

  if (!prueba) {
    const escalacion = consolidarEscalacionNivel3(paraRecordar);
    await procesarEscalacionNivel3(sb, resendApiKey ?? null, escalacion, hoyRD);
    await sb.rpc("envio_automatico_marcar_enviado", { p_familia: "wa_recordatorios" }).then(() => {}, () => {});
  }

  return json({ ok: true, personas: consolidados.length, vencidos: paraVencer.length, prueba });
}

// DL-26 — dos formas de llamar esta edge:
//  (a) el cron, con x-sync-secret → corrida real (gate envio_automatico_activo).
//  (b) la pantalla, con el JWT de un usuario real + {"tarea":"probar"} → arma el
//      recordatorio SOLO para quien lo pide (su propio auth.uid(), nunca uno
//      ajeno — el userId nunca se toma del body, siempre de getUser()).
async function resolverLlamador(req: Request): Promise<{ ok: true; prueba: boolean; usuarioId?: string } | { ok: false; status: number; error: string }> {
  const secret = req.headers.get("x-sync-secret");
  if (secret && secret === Deno.env.get("INFRA_SYNC_SECRET")) {
    return { ok: true, prueba: false };
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, status: 401, error: "No autenticado." };
  const callerClient = createClient(SUPABASE_URL, envRequerido("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await callerClient.auth.getUser();
  if (error || !data.user) return { ok: false, status: 401, error: "Sesión inválida." };
  const { data: puede } = await callerClient.schema("sgc").rpc("puede_operar_submodulo", { p_key: "tecnologia.wa_grupos" });
  if (!puede) return { ok: false, status: 403, error: "No autorizado." };
  return { ok: true, prueba: true, usuarioId: data.user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const llamador = await resolverLlamador(req);
  if (!llamador.ok) return json({ error: llamador.error }, llamador.status);

  let body: Any = {};
  try { body = await req.json(); } catch { body = {}; }
  // Un cron autenticado con x-sync-secret nunca pide "probar"; solo la pantalla
  // (JWT) llega aquí con prueba=true, y siempre es prueba (nunca una corrida real).
  const prueba = llamador.prueba || String(body?.tarea ?? "") === "probar";

  const sb = admin();
  try {
    return await handleSeguimiento(sb, prueba, llamador.usuarioId);
  } catch (e) {
    console.error("[wa-seguimiento] error inesperado:", e);
    await logEvento(sb, "alerta", "wa_seguimiento_error", { paso: "handler", error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    return json({ ok: false, error: "Error interno procesando la solicitud." }, 500);
  }
});
