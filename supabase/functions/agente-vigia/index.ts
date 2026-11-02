import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { transcripcionAtascada, envioAtascado, errorEsRepetido, dedupClaveError } from "../_shared/agentes-reglas.ts";

// ============================================================================
// DF2 — Agente Vigía (Nivel 2). Lo invoca pg_cron cada 5 min (x-sync-secret,
// mismo patrón que check-domains/fuel-prices). 100% determinista — sin
// llamadas a Anthropic, cero costo de IA.
//
// Revisa 3 cosas y, si corresponde, ejecuta UNA de las 4 acciones cerradas de
// sgc.agente_acciones_permitidas (DF-09). Nunca toca bitácoras/inventario/
// conduces/dinero: los `update` de abajo son solo sobre columnas de pipeline
// de transcripción (audio_notas), nunca sobre el contenido de negocio.
//
//   1) Transcripciones atascadas en sgc.audio_notas (procesando > 30 min)
//      → reintentar_transcripcion_atascada (resetea el estado, no el contenido).
//   2) Envíos atascados en sgc.outbox_atascados (sistema, sin resolver > 2h)
//      → reiniciar_envio_atascado (recordatorio real vía sgc.notificar; un
//        outbox local de la app no se puede "reiniciar" desde el servidor).
//   3) Errores repetidos en sgc.app_error_reports (mismo tipo+mensaje, ≥5 en
//      la última hora) → abrir_reporte_soporte (sgc.reportes_usuario).
//
// Conduces sin firmar (recordar_firma_conduce) NO se duplica aquí: ya existe
// el cron `sgc-recordar-firma-despachante` → sgc.recordar_conduces_por_firmar()
// cada 2h. Re-disparar lo mismo cada 5 min sería spam. Queda fuera de alcance
// de esta pasada (documentado, no fue un olvido).
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LIMITE_POR_CHEQUEO = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  const { data: agente } = await svc.from("agentes").select("id").eq("clave", "vigia").maybeSingle();
  const agenteId: string | null = agente?.id ?? null;
  const { data: acciones } = await svc.from("agente_acciones_permitidas").select("id, clave");
  const accionId = (clave: string) => acciones?.find((a: { clave: string }) => a.clave === clave)?.id ?? null;

  const resumen = { transcripciones_reintentadas: 0, envios_recordados: 0, reportes_abiertos: 0 };

  async function registrarAccion(accionClave: string, queHizo: string, resultado: string, reversible: boolean) {
    const accId = accionId(accionClave);
    if (!agenteId || !accId) return;
    await svc.from("agente_acciones").insert({
      agente_id: agenteId, accion_permitida_id: accId, que_hizo: queHizo, resultado, reversible,
    });
  }

  async function registrarHallazgo(severidad: string, titulo: string, detalle: string, origen: string) {
    if (!agenteId) return;
    await svc.from("agente_hallazgos").insert({ agente_id: agenteId, severidad, titulo, detalle, origen });
  }

  const ahoraIso = new Date().toISOString();

  // ── 1) Transcripciones atascadas (sgc.audio_notas) ────────────────────────
  try {
    const { data: candidatas } = await svc
      .from("audio_notas")
      .select("id, entidad_tipo, entidad_id, created_at")
      .eq("transcripcion_estado", "procesando")
      .order("created_at", { ascending: true })
      .limit(200);
    const atascadas = (candidatas ?? [])
      .filter((a) => transcripcionAtascada("procesando", a.created_at, ahoraIso))
      .slice(0, LIMITE_POR_CHEQUEO);

    for (const a of atascadas) {
      await svc.from("audio_notas").update({
        transcripcion_estado: "pendiente", transcripcion_intentos: 0, transcripcion_error: null,
      }).eq("id", a.id);
      resumen.transcripciones_reintentadas++;
      await registrarAccion(
        "reintentar_transcripcion_atascada",
        `Reintentó transcripción atascada de audio_notas ${a.id} (${a.entidad_tipo}/${a.entidad_id})`,
        "Reseteada a pendiente para que transcribe-now la retome.",
        true,
      );
    }
    if (atascadas.length) {
      await registrarHallazgo("baja", `${atascadas.length} transcripción(es) atascada(s) reintentada(s)`,
        atascadas.map((a) => a.id).join(", "), "audio_notas");
    }
  } catch (e) {
    console.error("vigia: transcripciones", e);
  }

  // ── 2) Envíos atascados (sgc.outbox_atascados) ────────────────────────────
  try {
    const { data: candidatos } = await svc
      .from("outbox_atascados")
      .select("id, usuario_id, tipo_op, resuelto, categoria, ultima_vez")
      .eq("resuelto", false)
      .eq("categoria", "sistema")
      .order("ultima_vez", { ascending: true })
      .limit(200);
    const atascados = (candidatos ?? [])
      .filter((o) => envioAtascado(o.resuelto, o.categoria, o.ultima_vez, ahoraIso))
      .slice(0, LIMITE_POR_CHEQUEO);

    const usuariosAvisados = new Set<string>();
    for (const o of atascados) {
      if (!o.usuario_id || usuariosAvisados.has(o.usuario_id)) continue;
      usuariosAvisados.add(o.usuario_id);
      await svc.rpc("notificar", {
        p_usuario: o.usuario_id,
        p_tipo: "sistema",
        p_titulo: "Tienes un envío pendiente",
        p_mensaje: "Abre la app para reintentar un envío que quedó atascado.",
        p_ruta: null,
      });
      resumen.envios_recordados++;
      await registrarAccion(
        "reiniciar_envio_atascado",
        `Recordó a usuario ${o.usuario_id} reabrir la app (${o.tipo_op} atascado)`,
        "Notificación enviada vía sgc.notificar.",
        false,
      );
    }
  } catch (e) {
    console.error("vigia: outbox", e);
  }

  // ── 3) Errores repetidos (sgc.app_error_reports) ──────────────────────────
  try {
    const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: errores } = await svc
      .from("app_error_reports")
      .select("error_type, message")
      .gte("created_at", desde)
      .limit(500);

    const conteos = new Map<string, number>();
    for (const e of errores ?? []) {
      const clave = dedupClaveError(e.error_type, e.message);
      conteos.set(clave, (conteos.get(clave) ?? 0) + 1);
    }

    const { data: reportero } = await svc
      .from("usuarios_roles")
      .select("usuario_id, roles!inner(codigo)")
      .eq("roles.codigo", "admin")
      .limit(1)
      .maybeSingle();
    const reporteroId: string | null = reportero?.usuario_id ?? null;

    for (const [clave, n] of conteos) {
      if (!errorEsRepetido(n)) continue;
      const [tipo, mensaje] = clave.split("::");
      const asunto = `Error repetido detectado por Vigía: ${tipo}`;
      const { data: existente } = await svc
        .from("reportes_usuario")
        .select("id")
        .eq("asunto", asunto)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();
      if (existente || !reporteroId) continue;

      await svc.from("reportes_usuario").insert({
        usuario_id: reporteroId, tipo: "bug", asunto,
        descripcion: `${mensaje} — ${n} veces en la última hora (detectado automáticamente).`,
      });
      resumen.reportes_abiertos++;
      await registrarAccion(
        "abrir_reporte_soporte",
        `Abrió reporte de soporte por error repetido: ${tipo}`,
        `${n} ocurrencias en 1 hora.`,
        true,
      );
      await registrarHallazgo("media", asunto, `${mensaje} (${n}x)`, "app_error_reports");
    }
  } catch (e) {
    console.error("vigia: errores repetidos", e);
  }

  if (agenteId) {
    await svc.from("agente_eventos").insert({
      agente_id: agenteId, tipo: "ronda", estado: "observando",
      resumen: `Transcripciones reintentadas: ${resumen.transcripciones_reintentadas} · Envíos recordados: ${resumen.envios_recordados} · Reportes abiertos: ${resumen.reportes_abiertos}`,
      evidencia_json: resumen,
    });
  }

  return json({ ok: true, ...resumen });
});
