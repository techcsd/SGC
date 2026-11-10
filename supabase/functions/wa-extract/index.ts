import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { resolverSttConfig, transcribirAudio } from "../_shared/stt.ts";
import { llamarClaude, extraerJson, MODELO_WA_DEFECTO } from "../_shared/claude.ts";
import { enviarAlerta } from "../_shared/alertas.ts";
import { EXTRACCION_SYSTEM_PROMPT } from "./prompts/extraccion.ts";
import { construirResumenSystemPrompt } from "./prompts/resumen.ts";
import {
  esMensajeBajoSenal, validarHallazgos, validarCierres, presupuestoExcedido, latidoCaido,
  visionLimiteAlcanzado, construirPromptExtraccion, type MensajeParaPrompt, type HallazgoAbiertoParaPrompt,
} from "./logica.ts";

// ============================================================================
// DB-S4 (ronda DB, PROMPT DB-2) — wa-extract: cron que procesa mensajes
// pendientes de `sgc.wa_mensajes_grupo` con Claude (extracción de hallazgos,
// transcripción/visión de media, resúmenes diarios/semanales) y vigila el
// latido del listener externo (csd-wa-listener, repo hermano). Lo invoca
// EXCLUSIVAMENTE pg_cron (ver sql/2026-11-05-db2-whatsapp-grupos.sql §13) con
// x-sync-secret, nunca un JWT de Supabase — mismo patrón que check-domains.
//
// Rutas por body.tarea: (default/undefined) extracción batch | 'revisar_latido'
// | 'resumenes_dia' | 'resumenes_semana'.
//
// Lógica pura (pre-filtro de bajo-señal, validación de forma de hallazgo,
// chequeo de presupuesto, chequeo de latido, construcción de prompt) vive en
// ./logica.ts — con tests en ./logica.test.ts. Este archivo solo orquesta I/O.
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO_EXTRACCION = Deno.env.get("WA_EXTRACT_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? MODELO_WA_DEFECTO;
const VISION_LIMITE_DIARIO = Number(Deno.env.get("WA_VISION_LIMITE_DIARIO") ?? "200") || 200;

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TAMANO_BATCH = 80;
const CONTEXTO_PREVIO_N = 10;

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

function aMensajePrompt(m: Any): MensajeParaPrompt {
  return {
    id: m.id,
    autor_nombre: m.autor_nombre ?? null,
    autor_telefono: m.autor_telefono,
    texto: m.texto ?? null,
    transcripcion: m.transcripcion ?? null,
    descripcion_media: m.descripcion_media ?? null,
    tipo: m.tipo,
    enviado_en: m.enviado_en,
  };
}

// ── Extracción batch (tarea por defecto) ────────────────────────────────────
async function marcarProcesados(sb: Any, ids: string[]) {
  if (!ids.length) return;
  await sb.from("wa_mensajes_grupo")
    .update({ procesado: true, procesado_en: new Date().toISOString() })
    .in("id", ids)
    .then(() => {}, () => {});
}

async function tokensHoyWa(sb: Any): Promise<number> {
  const { data } = await sb.rpc("wa_uso_ia_tokens_hoy");
  return Number(data ?? 0);
}

async function presupuestoConfigurado(sb: Any): Promise<number | null> {
  const { data } = await sb.from("wa_config").select("budget_tokens_dia").eq("id", true).maybeSingle();
  return data?.budget_tokens_dia ?? null;
}

async function yaAlertoPresupuestoHoy(sb: Any): Promise<boolean> {
  const inicioDia = new Date(); inicioDia.setUTCHours(0, 0, 0, 0);
  const { count } = await sb.from("wa_eventos").select("id", { count: "exact", head: true })
    .eq("codigo", "presupuesto_ia_agotado").gte("creado_en", inicioDia.toISOString());
  return (count ?? 0) > 0;
}

async function alertarPresupuestoAgotadoUnaVez(sb: Any) {
  if (await yaAlertoPresupuestoHoy(sb)) return;
  await logEvento(sb, "alerta", "presupuesto_ia_agotado", {});
  await enviarAlerta(sb, {
    nivel: "alerta",
    titulo: "Presupuesto diario de IA de WhatsApp agotado",
    detalleHtml: "<p>wa-extract alcanzó el presupuesto diario de tokens (wa_config.budget_tokens_dia). Se detuvo la extracción/visión por el resto del día.</p>",
    detalleTexto: "wa-extract alcanzó el presupuesto diario de tokens. Se detuvo la extracción/visión por el resto del día.",
  }).catch(() => {});
}

async function visionUsadosHoy(sb: Any): Promise<number> {
  const inicioDia = new Date(); inicioDia.setUTCHours(0, 0, 0, 0);
  const { count } = await sb.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
    .eq("funcion", "wa_vision").gte("created_at", inicioDia.toISOString());
  return count ?? 0;
}

// Match ligero (nice-to-have, opcional) de materiales mencionados en un
// pedido_material contra sgc.articulos.nombre — no bloquea ni enlentece el
// camino principal si falla.
async function anotarPosibleMatchMaterial(sb: Any, resumen: string, detalle: string | null): Promise<string | null> {
  try {
    const texto = `${resumen} ${detalle ?? ""}`;
    // Extrae palabras de 4+ letras (candidatas a nombre de material) para el ilike.
    const palabras = [...new Set((texto.match(/[a-záéíóúñ]{4,}/gi) ?? []).map((w) => w.toLowerCase()))].slice(0, 6);
    if (!palabras.length) return detalle;
    for (const palabra of palabras) {
      const { data } = await sb.schema("sgc").from("articulos").select("nombre").eq("activo", true)
        .ilike("nombre", `%${palabra}%`).limit(3);
      if (data?.length) {
        const nombres = data.map((d: Any) => d.nombre).join(", ");
        return `${detalle ?? ""}${detalle ? " " : ""}(posible match en inventario: ${nombres})`.trim();
      }
    }
    return detalle;
  } catch (e) {
    console.error("[wa-extract] match de material falló (no bloqueante):", e);
    return detalle;
  }
}

async function procesarGrupo(sb: Any, grupoJid: string, mensajes: Any[], budgetTokensDia: number | null, visionUsados: { n: number }) {
  const idsTodos = mensajes.map((m) => m.id as string);

  // (a) Pre-filtro de bajo-señal — sin costo de IA.
  const bajoSenal = mensajes.filter((m) => esMensajeBajoSenal(m));
  await marcarProcesados(sb, bajoSenal.map((m) => m.id));
  let restantes = mensajes.filter((m) => !esMensajeBajoSenal(m));

  // (b) Voice notes sin transcripción.
  const sttCfg = resolverSttConfig();
  for (const m of restantes.filter((m) => m.tipo === "audio" && !m.transcripcion)) {
    if (!sttCfg) {
      await marcarProcesados(sb, [m.id]);
      restantes = restantes.filter((r) => r.id !== m.id);
      continue;
    }
    if (!m.media_ref) {
      await marcarProcesados(sb, [m.id]);
      restantes = restantes.filter((r) => r.id !== m.id);
      continue;
    }
    try {
      const { data: blob, error: dlErr } = await sb.storage.from("wa-media").download(m.media_ref);
      if (dlErr || !blob) throw dlErr ?? new Error("sin datos");
      const ext = String(m.media_mime ?? "").includes("mp4") ? "mp4" : "ogg";
      const transcripcion = await transcribirAudio(blob, ext, sttCfg);
      await sb.from("wa_mensajes_grupo").update({ transcripcion }).eq("id", m.id).then(() => {}, () => {});
      m.transcripcion = transcripcion;
    } catch (e) {
      console.error("[wa-extract] transcripción falló:", e);
      await marcarProcesados(sb, [m.id]); // no bloquear el pipeline por un audio que no se pudo transcribir
      restantes = restantes.filter((r) => r.id !== m.id);
    }
  }

  // (c) Imágenes sin descripción.
  for (const m of restantes.filter((m) => m.tipo === "imagen" && !m.descripcion_media)) {
    if (!ANTHROPIC_API_KEY || !m.media_ref) {
      await marcarProcesados(sb, [m.id]);
      restantes = restantes.filter((r) => r.id !== m.id);
      continue;
    }
    if (visionLimiteAlcanzado(visionUsados.n, VISION_LIMITE_DIARIO)) {
      await marcarProcesados(sb, [m.id]);
      restantes = restantes.filter((r) => r.id !== m.id);
      continue;
    }
    try {
      const { data: blob, error: dlErr } = await sb.storage.from("wa-media").download(m.media_ref);
      if (dlErr || !blob) throw dlErr ?? new Error("sin datos");
      const buf = new Uint8Array(await blob.arrayBuffer());
      let binario = "";
      for (let i = 0; i < buf.length; i++) binario += String.fromCharCode(buf[i]);
      const base64 = btoa(binario);
      const resultado = await llamarClaude({
        apiKey: ANTHROPIC_API_KEY!,
        modelo: MODELO_EXTRACCION,
        maxTokens: 200,
        system: "Describe la imagen en 1-2 oraciones en español, enfocándote en relevancia de construcción (avance de obra, materiales visibles, daños, documentos/recibos con montos legibles). Si no hay nada relevante, dilo brevemente. No inventes texto que no se vea con claridad.",
        mensajes: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: m.media_mime || "image/jpeg", data: base64 } }] }],
      });
      await sb.from("wa_mensajes_grupo").update({ descripcion_media: resultado.texto }).eq("id", m.id).then(() => {}, () => {});
      m.descripcion_media = resultado.texto;
      visionUsados.n++;
      await sb.rpc("wa_uso_ia_registrar", {
        p_funcion: "wa_vision", p_modelo: resultado.modelo, p_tokens_in: resultado.tokensIn, p_tokens_out: resultado.tokensOut,
      }).then(() => {}, () => {});
    } catch (e) {
      console.error("[wa-extract] visión falló:", e);
      await marcarProcesados(sb, [m.id]);
      restantes = restantes.filter((r) => r.id !== m.id);
    }
  }

  // (c2) Documentos PDF o texto plano/markdown sin descripción — Claude lee
  // PDFs nativamente (bloque "document") y texto plano se lee directo (sin
  // IA de visión, solo se resume). Mismo cupo diario que visión (comparten
  // visionUsados.n) para no abrir un gasto de IA sin tope aparte. Otros
  // formatos de documento (docx, xlsx, etc.) no se leen — no vale la pena
  // fingir lectura de lo que no se puede abrir.
  const TEXTO_PLANO_MAX_CHARS = 8000; // ~2000 tokens, acota costo/tamaño de un .txt/.md grande
  for (const m of restantes.filter((m) => {
    if (m.tipo !== "documento" || m.descripcion_media) return false;
    const mime = String(m.media_mime ?? "");
    return mime.includes("pdf") || mime.startsWith("text/");
  })) {
    if (!ANTHROPIC_API_KEY || !m.media_ref) continue;
    if (visionLimiteAlcanzado(visionUsados.n, VISION_LIMITE_DIARIO)) continue;
    const esPdf = String(m.media_mime ?? "").includes("pdf");
    try {
      const { data: blob, error: dlErr } = await sb.storage.from("wa-media").download(m.media_ref);
      if (dlErr || !blob) throw dlErr ?? new Error("sin datos");

      const contenido = esPdf
        ? await (async () => {
            const buf = new Uint8Array(await blob.arrayBuffer());
            let binario = "";
            for (let i = 0; i < buf.length; i++) binario += String.fromCharCode(buf[i]);
            return [{ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf", data: btoa(binario) } }];
          })()
        : [{ type: "text" as const, text: (await blob.text()).slice(0, TEXTO_PLANO_MAX_CHARS) }];

      const resultado = await llamarClaude({
        apiKey: ANTHROPIC_API_KEY!,
        modelo: MODELO_EXTRACCION,
        maxTokens: 300,
        system: esPdf
          ? "Describe de qué trata este documento PDF en 1-3 oraciones en español, para contexto de una constructora (ej. cotización, factura, contrato, plano, recibo). Si tiene montos, fechas, o nombres de proveedor/cliente legibles, inclúyelos. Si no puedes leer el contenido con claridad, dilo brevemente. No inventes datos que no se vean."
          : "Resume de qué trata este archivo de texto en 1-3 oraciones en español, para contexto de una constructora. Si es código o configuración, di su propósito general, no lo repitas línea por línea. No inventes contenido que no esté en el texto.",
        mensajes: [{ role: "user", content: contenido }],
      });
      await sb.from("wa_mensajes_grupo").update({ descripcion_media: resultado.texto }).eq("id", m.id).then(() => {}, () => {});
      m.descripcion_media = resultado.texto;
      visionUsados.n++;
      await sb.rpc("wa_uso_ia_registrar", {
        p_funcion: "wa_documento", p_modelo: resultado.modelo, p_tokens_in: resultado.tokensIn, p_tokens_out: resultado.tokensOut,
      }).then(() => {}, () => {});
    } catch (e) {
      console.error("[wa-extract] descripción de documento falló:", e);
      // sigue sin descripcion_media -- el bloque de abajo lo marca procesado igual (no se reintenta en bucle).
    }
  }

  // Documentos: marcar procesados (PDF/texto plano ya intentaron descripción
  // arriba; el resto de formatos no entra a extracción como "contenido
  // legible" salvo que tengan texto propio).
  const documentos = restantes.filter((m) => m.tipo === "documento");
  await marcarProcesados(sb, documentos.map((m) => m.id));
  restantes = restantes.filter((m) => m.tipo !== "documento");

  if (!restantes.length) return;

  // (d) Extracción — presupuesto diario primero. ANTHROPIC_API_KEY ya está
  // garantizada aquí (gate al tope del handler para toda tarea no-latido).
  const tokensHoy = await tokensHoyWa(sb);
  if (presupuestoExcedido(tokensHoy, budgetTokensDia)) {
    await alertarPresupuestoAgotadoUnaVez(sb);
    // No se marcan procesados — quedan pendientes para el próximo corrido (mañana, presupuesto reiniciado).
    return;
  }

  const { data: grupoRow } = await sb.from("wa_grupos").select("proyecto_id").eq("jid", grupoJid).maybeSingle();
  const proyectoId = grupoRow?.proyecto_id ?? null;

  const primerEnviado = restantes.reduce((min: string, m: Any) => (m.enviado_en < min ? m.enviado_en : min), restantes[0].enviado_en);
  const { data: contextoRows } = await sb.from("wa_mensajes_grupo")
    .select("id,autor_nombre,autor_telefono,texto,transcripcion,descripcion_media,tipo,enviado_en")
    .eq("grupo_jid", grupoJid).eq("procesado", true).lt("enviado_en", primerEnviado)
    .order("enviado_en", { ascending: false }).limit(CONTEXTO_PREVIO_N);
  const contexto = (contextoRows ?? []).reverse().map(aMensajePrompt);
  const batch = restantes.map(aMensajePrompt);
  const idsPermitidos = new Set(batch.map((m) => m.id));

  // DL-06/DL-16 — últimos 15 hallazgos abiertos del grupo, con id CORTO (nunca
  // el uuid real) para que el modelo pueda referenciarlos en "cierres" sin
  // poder inventar uno ni gastar tokens en uuids.
  const { data: abiertosRows } = await sb.from("wa_hallazgos")
    .select("id,tipo,resumen")
    .eq("grupo_jid", grupoJid)
    .in("estado", ["nuevo", "revisado"])
    .neq("seguimiento", "resuelto")
    .order("creado_en", { ascending: false })
    .limit(15);
  const mapaAbiertos = new Map<string, string>(); // idCorto -> uuid real
  const abiertosPrompt: HallazgoAbiertoParaPrompt[] = ((abiertosRows ?? []) as Any[]).map((h, i) => {
    const idCorto = `h${i + 1}`;
    mapaAbiertos.set(idCorto, h.id);
    return { idCorto, tipo: h.tipo, resumen: h.resumen };
  });

  const prompt = construirPromptExtraccion(contexto, batch, abiertosPrompt);
  let parseado: { hallazgos?: Any[]; cierres?: Any[] } | null = null;
  let resultado: Awaited<ReturnType<typeof llamarClaude>> | null = null;
  for (let intento = 0; intento < 2 && parseado === null; intento++) {
    try {
      resultado = await llamarClaude({
        apiKey: ANTHROPIC_API_KEY!,
        modelo: MODELO_EXTRACCION,
        system: EXTRACCION_SYSTEM_PROMPT,
        mensajes: [{ role: "user", content: prompt }],
        maxTokens: 2048,
      });
      parseado = extraerJson<{ hallazgos?: Any[]; cierres?: Any[] }>(resultado.texto);
    } catch (e) {
      console.error(`[wa-extract] llamada a Claude falló (intento ${intento + 1}):`, e);
    }
  }

  if (resultado) {
    await sb.rpc("wa_uso_ia_registrar", {
      p_funcion: "wa_extract", p_modelo: resultado.modelo, p_tokens_in: resultado.tokensIn, p_tokens_out: resultado.tokensOut,
    }).then(() => {}, () => {});
  }

  const hallazgos = validarHallazgos(parseado?.hallazgos, idsPermitidos);
  for (const h of hallazgos) {
    let detalle = h.detalle;
    if (h.tipo === "pedido_material") {
      detalle = await anotarPosibleMatchMaterial(sb, h.resumen, h.detalle);
    }
    await sb.rpc("wa_hallazgo_insertar_v2", {
      p_grupo_jid: grupoJid, p_tipo: h.tipo, p_resumen: h.resumen, p_detalle: detalle,
      p_personas: JSON.stringify(h.personas), p_fecha_mencionada: h.fecha_mencionada,
      p_monto: h.monto, p_moneda: h.moneda, p_proyecto_id: proyectoId,
      p_mensaje_ids: h.mensaje_ids, p_confianza: h.confianza, p_responsable_hint: h.responsable_hint,
    }).then(() => {}, (e: Any) => console.error("[wa-extract] wa_hallazgo_insertar_v2 falló:", e));
  }

  // DL-16 — cierres: el modelo detectó que un mensaje de este batch responde/
  // cumple un hallazgo abierto que le pasamos como contexto.
  const cierres = validarCierres(parseado?.cierres, new Set(mapaAbiertos.keys()), idsPermitidos);
  for (const c of cierres) {
    const hallazgoIdReal = mapaAbiertos.get(c.hallazgo_id_corto);
    if (!hallazgoIdReal) continue;
    await sb.rpc("wa_hallazgo_cerrar_por_mensaje", {
      p_hallazgo_id: hallazgoIdReal, p_mensaje_id: c.mensaje_id, p_motivo: c.motivo, p_confianza: c.confianza,
    }).then(() => {}, (e: Any) => console.error("[wa-extract] wa_hallazgo_cerrar_por_mensaje falló:", e));
  }

  await marcarProcesados(sb, idsTodos.filter((id) => restantes.some((m) => m.id === id)));
}

async function handleExtraccion(sb: Any) {
  const { data: pendientes, error } = await sb.from("wa_mensajes_grupo")
    .select("id,grupo_jid,autor_telefono,autor_nombre,tipo,texto,transcripcion,descripcion_media,media_ref,media_mime,enviado_en, wa_grupos!inner(modo)")
    .eq("procesado", false)
    .in("wa_grupos.modo", ["memoria", "consulta"])
    .order("enviado_en", { ascending: true })
    .limit(TAMANO_BATCH);

  if (error) {
    console.error("[wa-extract] error leyendo pendientes:", error);
    await logEvento(sb, "alerta", "wa_extract_error", { paso: "leer_pendientes", error: String(error.message ?? error).slice(0, 500) });
    return json({ ok: false, error: "No se pudieron leer los mensajes pendientes." }, 500);
  }

  const filas = (pendientes ?? []) as Any[];
  if (!filas.length) return json({ ok: true, procesados: 0, grupos: 0 });

  const porGrupo = new Map<string, Any[]>();
  for (const f of filas) {
    const lista = porGrupo.get(f.grupo_jid) ?? [];
    lista.push(f);
    porGrupo.set(f.grupo_jid, lista);
  }

  const budgetTokensDia = await presupuestoConfigurado(sb);
  const visionUsados = { n: await visionUsadosHoy(sb) };

  for (const [grupoJid, mensajes] of porGrupo) {
    try {
      await procesarGrupo(sb, grupoJid, mensajes, budgetTokensDia, visionUsados);
    } catch (e) {
      console.error(`[wa-extract] error procesando grupo ${grupoJid}:`, e);
      await logEvento(sb, "alerta", "wa_extract_error", { paso: "procesar_grupo", grupo_jid: grupoJid, error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    }
  }

  return json({ ok: true, procesados: filas.length, grupos: porGrupo.size });
}

// ── revisar_latido (dead-man del listener) ──────────────────────────────────
async function alertoRecientementePorHost(sb: Any, host: string): Promise<boolean> {
  const hace10min = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await sb.from("wa_eventos").select("id", { count: "exact", head: true })
    .eq("codigo", "listener_latido_caido").eq("detalle->>host", host).gte("creado_en", hace10min);
  return (count ?? 0) > 0;
}

async function ultimaAlertaFueDeHostCaido(sb: Any, host: string): Promise<boolean> {
  const { data } = await sb.from("wa_eventos").select("codigo").eq("detalle->>host", host)
    .in("codigo", ["listener_latido_caido", "listener_recuperado"])
    .order("creado_en", { ascending: false }).limit(1).maybeSingle();
  return data?.codigo === "listener_latido_caido";
}

async function handleRevisarLatido(sb: Any) {
  const { data: hosts, error } = await sb.from("wa_listener_estado").select("host,estado,ultimo_latido_en");
  if (error) {
    console.error("[wa-extract] error leyendo wa_listener_estado:", error);
    await logEvento(sb, "alerta", "wa_extract_error", { paso: "revisar_latido", error: String(error.message ?? error).slice(0, 500) });
    return json({ ok: false, error: "No se pudo revisar el latido del listener." }, 500);
  }

  const resultados: Any[] = [];
  for (const h of (hosts ?? []) as Any[]) {
    const caido = latidoCaido(h.estado, h.ultimo_latido_en);
    if (caido) {
      if (!(await alertoRecientementePorHost(sb, h.host))) {
        await enviarAlerta(sb, {
          nivel: "alerta",
          titulo: `WhatsApp listener (${h.host}) sin latido`,
          detalleHtml: `<p>El listener de WhatsApp (<b>${h.host}</b>) no ha dado señal de vida en más de 10 minutos, o reportó un estado problemático (<b>${h.estado}</b>).</p>`,
          detalleTexto: `El listener de WhatsApp (${h.host}) no ha dado señal de vida en más de 10 minutos, o reportó estado ${h.estado}.`,
        }).catch(() => {});
        await logEvento(sb, "alerta", "listener_latido_caido", { host: h.host, estado: h.estado, ultimo_latido_en: h.ultimo_latido_en });
      }
      resultados.push({ host: h.host, caido: true });
    } else {
      if (await ultimaAlertaFueDeHostCaido(sb, h.host)) {
        await logEvento(sb, "info", "listener_recuperado", { host: h.host, estado: h.estado });
      }
      resultados.push({ host: h.host, caido: false });
    }
  }
  return json({ ok: true, hosts: resultados });
}

// ── resumenes_dia / resumenes_semana ─────────────────────────────────────────
function inicioDeHoyUtc(): Date {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d;
}

async function procesarResumen(sb: Any, periodo: "dia" | "semana") {
  const ahora = new Date();
  let desde: Date, hasta: Date, fecha: string;
  if (periodo === "dia") {
    desde = inicioDeHoyUtc();
    hasta = ahora;
    fecha = desde.toISOString().slice(0, 10);
  } else {
    // Semana que termina ayer (el cron corre el lunes temprano, cubre lun-dom anterior).
    const hoy = inicioDeHoyUtc();
    hasta = hoy;
    desde = new Date(hoy.getTime() - 7 * 24 * 3600_000);
    fecha = desde.toISOString().slice(0, 10);
  }

  const { data: grupos } = await sb.from("wa_grupos").select("jid,nombre,modo").in("modo", ["memoria", "consulta"]);
  for (const g of (grupos ?? []) as Any[]) {
    try {
      const { data: mensajes, count } = await sb.from("wa_mensajes_grupo")
        .select("autor_nombre,texto,transcripcion,descripcion_media,enviado_en", { count: "exact" })
        .eq("grupo_jid", g.jid).gte("enviado_en", desde.toISOString()).lt("enviado_en", hasta.toISOString())
        .order("enviado_en", { ascending: true }).limit(500);
      const total = count ?? (mensajes ?? []).length;
      if (total < 5) continue; // no vale la pena resumir actividad mínima

      const { data: hallazgos } = await sb.from("wa_hallazgos").select("tipo,resumen")
        .eq("grupo_jid", g.jid).gte("creado_en", desde.toISOString()).lt("creado_en", hasta.toISOString())
        .order("creado_en", { ascending: false }).limit(50);

      const archivo = (mensajes ?? [])
        .map((m: Any) => `${m.autor_nombre ?? "alguien"}: ${m.texto ?? m.transcripcion ?? m.descripcion_media ?? "(sin contenido)"}`)
        .join("\n").slice(-12000);
      const listaHallazgos = (hallazgos ?? []).map((h: Any) => `- (${h.tipo}) ${h.resumen}`).join("\n") || "(ninguno)";

      if (!ANTHROPIC_API_KEY) continue;
      const budgetTokensDia = await presupuestoConfigurado(sb);
      const tokensHoy = await tokensHoyWa(sb);
      if (presupuestoExcedido(tokensHoy, budgetTokensDia)) { await alertarPresupuestoAgotadoUnaVez(sb); continue; }

      const resultado = await llamarClaude({
        apiKey: ANTHROPIC_API_KEY!,
        modelo: MODELO_EXTRACCION,
        system: construirResumenSystemPrompt(periodo, g.nombre || g.jid),
        mensajes: [{ role: "user", content: `MENSAJES (${periodo === "dia" ? "hoy" : "última semana"}):\n${archivo}\n\nHALLAZGOS DEL PERIODO:\n${listaHallazgos}\n\nDevuelve SOLO el objeto JSON.` }],
        maxTokens: 800,
      });
      await sb.rpc("wa_uso_ia_registrar", {
        p_funcion: "wa_resumen", p_modelo: resultado.modelo, p_tokens_in: resultado.tokensIn, p_tokens_out: resultado.tokensOut,
      }).then(() => {}, () => {});

      const parsed = extraerJson<{ resumen?: string; puntos_clave?: Any[] }>(resultado.texto);
      const resumenTexto = typeof parsed?.resumen === "string" ? parsed.resumen.trim() : null;
      const puntosClave = Array.isArray(parsed?.puntos_clave) ? parsed!.puntos_clave!.filter((p) => typeof p === "string") : [];
      if (!resumenTexto) continue;

      await sb.from("wa_resumenes").upsert({
        grupo_jid: g.jid, periodo, fecha, resumen: resumenTexto, puntos_clave: puntosClave, mensajes_cubiertos: total,
      }, { onConflict: "grupo_jid,periodo,fecha" }).then(() => {}, (e: Any) => console.error("[wa-extract] upsert wa_resumenes falló:", e));
    } catch (e) {
      console.error(`[wa-extract] error resumiendo grupo ${g.jid}:`, e);
      await logEvento(sb, "alerta", "wa_extract_error", { paso: `resumen_${periodo}`, grupo_jid: g.jid, error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    }
  }
  return json({ ok: true, periodo });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  let body: Any = {};
  try { body = await req.json(); } catch { body = {}; }
  const tarea = String(body?.tarea ?? "");

  const sb = admin();

  // Gate único para TODAS las tareas IA-dependientes (extracción/visión,
  // resúmenes) — revisar_latido no usa IA y sigue funcionando sin la llave.
  // Sin email (evitar spam cada 4 min mientras la llave esté ausente) — sí
  // queda en wa_eventos para que la pestaña de Tecnología lo muestre.
  if (tarea !== "revisar_latido" && !ANTHROPIC_API_KEY) {
    console.error("[wa-extract] falta ANTHROPIC_API_KEY — tarea IA-dependiente pausada.");
    await logEvento(sb, "alerta", "wa_extract_sin_api_key", { tarea: tarea || "extraccion" });
    return json({ error: "Extracción con IA no configurada (falta ANTHROPIC_API_KEY)." }, 503);
  }

  try {
    switch (tarea) {
      case "revisar_latido":
        return await handleRevisarLatido(sb);
      case "resumenes_dia":
      case "resumenes_semana":
        // DL5 — reemplazadas por la edge `wa-recap` (cursor rodante en hora RD,
        // en vez de la ventana fija en UTC de `procesarResumen`). Los crons
        // viejos ya se desprogramaron (sql/2026-11-10-dl5-wa-recap.sql); esto
        // solo cubre una llamada residual durante el ciclo de despliegue.
        return json({ ok: true, deprecado: true, usar: "wa-recap" });
      case "":
        return await handleExtraccion(sb);
      default:
        return json({ ok: false, error: `tarea desconocida: ${tarea}` }, 400);
    }
  } catch (e) {
    console.error(`[wa-extract] error inesperado (tarea=${tarea || "extraccion"}):`, e);
    await logEvento(sb, "alerta", "wa_extract_error", { paso: "handler", tarea: tarea || "extraccion", error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    return json({ ok: false, error: "Error interno procesando la solicitud." }, 500);
  }
});
