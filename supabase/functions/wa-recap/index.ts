import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { ajustarCorreoResend } from "../_shared/entorno.ts";
import { llamarClaude, extraerJson, MODELO_WA_DEFECTO } from "../_shared/claude.ts";
import { construirPdfSecciones, type SeccionPdf } from "../_shared/pdf-recap.ts";
import { calcularVentana, type Periodo } from "../_shared/wa-recap-ventana.ts";
import { clasificarParaRecap, loteMensajes, seccionesPdfGrupo, type HallazgoRecap } from "../_shared/wa-recap-contenido.ts";
import { construirResumenSystemPrompt } from "./prompts/resumen.ts";

// ============================================================================
// DL5/F5 (ronda DL, 10-nov-2026) — wa-recap: recap diario/semanal con PDF por
// correo, por grupo de WhatsApp. Reemplaza las tareas 'resumenes_dia'/
// 'resumenes_semana' de wa-extract (ventana fija en UTC, CONTEXTO §2.5) por
// un cursor rodante en hora America/Santo_Domingo (DL-17).
//
// Invocada por pg_cron (x-sync-secret) para la corrida real, o por la
// pantalla con el JWT de un usuario real + {"tarea":"probar","grupo":"<jid>"}
// (DL-26) — arma el PDF SOLO para quien lo pide, sin tocar cursores/log real.
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = Deno.env.get("WA_EXTRACT_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? MODELO_WA_DEFECTO;
const NOTIFICATIONS_FROM_EMAIL = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";

// deno-lint-ignore no-explicit-any
type Any = any;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" }, auth: { persistSession: false } });
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function toBase64(bytes: Uint8Array): string {
  let binary = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
async function logEvento(sb: Any, nivel: "info" | "alerta" | "critico", codigo: string, detalle: Any = {}) {
  await sb.from("wa_eventos").insert({ nivel, codigo, detalle }).then(() => {}, () => {});
}

function presupuestoExcedido(tokensHoy: number, budget: number | null | undefined): boolean {
  if (budget === null || budget === undefined || !Number.isFinite(budget) || budget <= 0) return false;
  return tokensHoy >= budget;
}
async function tokensHoyWa(sb: Any): Promise<number> {
  const { data } = await sb.rpc("wa_uso_ia_tokens_hoy");
  return Number(data ?? 0);
}
async function presupuestoConfigurado(sb: Any): Promise<number | null> {
  const { data } = await sb.from("wa_config").select("budget_tokens_dia").eq("id", true).maybeSingle();
  return data?.budget_tokens_dia ?? null;
}

// DL5/F5.2 — map-reduce: resume por lotes de 150 mensajes y funde los
// parciales en un resumen final. Si el presupuesto se agota a mitad de
// camino, devuelve lo que alcanzó a resumir (nunca null si ya hay algo).
async function resumirConMapReduce(sb: Any, grupoNombre: string, lineas: string[]): Promise<string | null> {
  if (!ANTHROPIC_API_KEY || !lineas.length) return null;
  const budget = await presupuestoConfigurado(sb);
  if (presupuestoExcedido(await tokensHoyWa(sb), budget)) return null;

  const lotes = loteMensajes(lineas, 150);
  const parciales: string[] = [];
  for (const lote of lotes) {
    if (presupuestoExcedido(await tokensHoyWa(sb), budget)) break;
    try {
      const resultado = await llamarClaude({
        apiKey: ANTHROPIC_API_KEY!, modelo: MODELO,
        system: construirResumenSystemPrompt("lote", grupoNombre),
        mensajes: [{ role: "user", content: lote.join("\n") }],
        maxTokens: 400,
      });
      await sb.rpc("wa_uso_ia_registrar", {
        p_funcion: "wa_recap", p_modelo: resultado.modelo, p_tokens_in: resultado.tokensIn, p_tokens_out: resultado.tokensOut,
      }).then(() => {}, () => {});
      const parsed = extraerJson<{ resumen?: string }>(resultado.texto);
      if (parsed?.resumen) parciales.push(parsed.resumen);
    } catch (e) {
      console.error("[wa-recap] resumen de lote falló:", e);
    }
  }
  if (!parciales.length) return null;
  if (parciales.length === 1) return parciales[0];

  try {
    const final = await llamarClaude({
      apiKey: ANTHROPIC_API_KEY!, modelo: MODELO,
      system: construirResumenSystemPrompt("final", grupoNombre),
      mensajes: [{ role: "user", content: parciales.map((p, i) => `Lote ${i + 1}: ${p}`).join("\n") }],
      maxTokens: 500,
    });
    await sb.rpc("wa_uso_ia_registrar", {
      p_funcion: "wa_recap", p_modelo: final.modelo, p_tokens_in: final.tokensIn, p_tokens_out: final.tokensOut,
    }).then(() => {}, () => {});
    const parsedFinal = extraerJson<{ resumen?: string }>(final.texto);
    return parsedFinal?.resumen ?? parciales.join(" ");
  } catch (e) {
    console.error("[wa-recap] fusión de resumen final falló:", e);
    return parciales.join(" ");
  }
}

const CAMPOS_HALLAZGO = "id,tipo,resumen,detalle,fecha_mencionada,monto,moneda,confianza,estado,seguimiento,seguimiento_desde,recordatorios_enviados,creado_en,responsable:usuarios!wa_hallazgos_responsable_id_fkey(nombre)";

function mapearHallazgos(rows: Any[] | null): HallazgoRecap[] {
  return (rows ?? []).map((r) => ({ ...r, responsable_nombre: r.responsable?.nombre ?? null }));
}

interface ResultadoGrupo {
  grupo: { jid: string; nombre: string };
  omitido: boolean;
  secciones: SeccionPdf[];
  resumenTexto: string | null;
}

async function procesarGrupoRecap(sb: Any, grupo: { jid: string; nombre: string }, periodo: Periodo, prueba: boolean): Promise<ResultadoGrupo> {
  const { data: cursorRow } = await sb.from("wa_recap_cursor").select("hasta").eq("grupo_jid", grupo.jid).eq("periodo", periodo).maybeSingle();
  const ahora = new Date();
  const ventana = calcularVentana(cursorRow?.hasta ?? null, ahora, periodo);

  const { data: cfg } = await sb.from("wa_config").select("recap_minimo_mensajes").eq("id", true).maybeSingle();
  const minimo = cfg?.recap_minimo_mensajes ?? 5;

  const { data: mensajes, count } = await sb.from("wa_mensajes_grupo")
    .select("autor_nombre,texto,transcripcion,descripcion_media,enviado_en", { count: "exact" })
    .eq("grupo_jid", grupo.jid)
    .gte("enviado_en", ventana.desde.toISOString()).lt("enviado_en", ventana.hasta.toISOString())
    .order("enviado_en", { ascending: true });
  const total = count ?? (mensajes ?? []).length;

  if (!prueba) {
    await sb.from("wa_recap_cursor")
      .upsert({ grupo_jid: grupo.jid, periodo, hasta: ventana.hasta.toISOString() }, { onConflict: "grupo_jid,periodo" })
      .then(() => {}, (e: Any) => console.error("[wa-recap] no se pudo avanzar el cursor:", e));
  }

  if (!prueba && total < minimo) {
    return { grupo, omitido: true, secciones: [], resumenTexto: null };
  }

  const lineas = ((mensajes ?? []) as Any[]).map(
    (m) => `${m.autor_nombre ?? "alguien"}: ${m.texto ?? m.transcripcion ?? m.descripcion_media ?? "(sin contenido)"}`,
  );
  const resumenTexto = await resumirConMapReduce(sb, grupo.nombre, lineas);

  const [{ data: hallazgosVentana }, { data: abiertos }, cerradosRes] = await Promise.all([
    sb.from("wa_hallazgos").select(CAMPOS_HALLAZGO).eq("grupo_jid", grupo.jid)
      .gte("creado_en", ventana.desde.toISOString()).lt("creado_en", ventana.hasta.toISOString()),
    sb.from("wa_hallazgos").select(CAMPOS_HALLAZGO).eq("grupo_jid", grupo.jid)
      .in("seguimiento", ["activo", "vencido", "resuelto_probable"]),
    periodo === "semana"
      ? sb.from("wa_hallazgos").select(CAMPOS_HALLAZGO).eq("grupo_jid", grupo.jid).eq("seguimiento", "resuelto")
        .gte("cerrado_en", ventana.desde.toISOString()).lt("cerrado_en", ventana.hasta.toISOString())
      : Promise.resolve({ data: [] }),
  ]);

  const contenido = clasificarParaRecap(
    mapearHallazgos(hallazgosVentana), mapearHallazgos(abiertos), mapearHallazgos(cerradosRes.data), ventana, periodo,
  );

  if (!prueba) {
    await sb.from("wa_resumenes").upsert({
      grupo_jid: grupo.jid, periodo, fecha: ventana.hasta.toISOString().slice(0, 10),
      desde: ventana.desde.toISOString(), hasta: ventana.hasta.toISOString(),
      resumen: resumenTexto, decisiones: contenido.decisiones, pendientes: contenido.pendientes,
      mensajes_cubiertos: total,
    }, { onConflict: "grupo_jid,periodo,fecha" }).then(() => {}, (e: Any) => console.error("[wa-recap] upsert wa_resumenes falló:", e));
  }

  return { grupo, omitido: false, secciones: seccionesPdfGrupo(grupo.nombre, resumenTexto, contenido, periodo), resumenTexto };
}

async function enviarCorreoConPdf(resendApiKey: string, to: string[], subject: string, html: string, pdf: Uint8Array, filename: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(ajustarCorreoResend({
      from: NOTIFICATIONS_FROM_EMAIL, to, subject, html,
      attachments: [{ filename, content: toBase64(pdf) }],
    })),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function handleRecap(sb: Any, periodo: Periodo, prueba: boolean, usuarioPrueba?: string, grupoPrueba?: string) {
  const familia = periodo === "dia" ? "wa_recap_diario" : "wa_recap_semanal";
  if (!prueba && !(await sb.rpc("envio_automatico_activo", { p_familia: familia }).then((r: Any) => r.data))) {
    return json({ ok: true, omitido: "apagado" });
  }

  let grupos: Array<{ jid: string; nombre: string }>;
  if (prueba) {
    if (!grupoPrueba) return json({ error: 'Falta "grupo" para probar.' }, 400);
    const { data } = await sb.from("wa_grupos").select("jid,nombre").eq("jid", grupoPrueba).maybeSingle();
    if (!data) return json({ error: "Grupo no encontrado." }, 404);
    grupos = [data];
  } else {
    const { data } = await sb.from("wa_grupos").select("jid,nombre").in("modo", ["memoria", "consulta"]);
    grupos = (data ?? []) as Any[];
  }

  const resultados: ResultadoGrupo[] = [];
  for (const g of grupos) {
    try {
      resultados.push(await procesarGrupoRecap(sb, g, periodo, prueba));
    } catch (e) {
      console.error(`[wa-recap] error procesando grupo ${g.jid}:`, e);
      await logEvento(sb, "alerta", "wa_recap_error", { paso: "procesar_grupo", grupo_jid: g.jid, error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    }
  }
  const conContenido = resultados.filter((r) => !r.omitido);

  const { data: resendApiKey } = await sb.rpc("get_resend_api_key");
  const hoyIso = new Date().toISOString().slice(0, 10);

  if (prueba) {
    const r = conContenido[0];
    if (!r) return json({ ok: true, omitido_sin_actividad: true });
    const { data: destUsuario } = await sb.from("usuarios").select("email,nombre").eq("id", usuarioPrueba).maybeSingle();
    if (!resendApiKey || !destUsuario?.email) return json({ ok: false, error: "Sin Resend o sin correo del usuario." }, 500);

    const pdf = await construirPdfSecciones(
      { tituloPortada: `[PRUEBA] Recap ${periodo === "dia" ? "diario" : "semanal"}`, subtituloPortada: `${r.grupo.nombre} · ${hoyIso}` },
      r.secciones,
    );
    const path = `prueba/${hoyIso}/${usuarioPrueba}.pdf`;
    await sb.storage.from("wa-recaps").upload(path, new Blob([pdf], { type: "application/pdf" }), { upsert: true }).then(() => {}, () => {});
    await enviarCorreoConPdf(
      resendApiKey, [destUsuario.email], `[PRUEBA] Recap de "${r.grupo.nombre}"`,
      `<p>Recap de prueba (solo para ti) del grupo "${r.grupo.nombre}".</p><p>${r.resumenTexto ?? "(sin resumen IA)"}</p><p>Generado por IA, puede contener errores.</p>`,
      pdf, "recap-prueba.pdf",
    );
    await sb.from("wa_recap_envios").insert({
      periodo, desde: new Date(Date.now() - (periodo === "dia" ? 1 : 7) * 86_400_000).toISOString(), hasta: new Date().toISOString(),
      usuario_id: usuarioPrueba, grupos: [r.grupo.jid], estado: "prueba", pdf_path: path,
    }).then(() => {}, () => {});
    return json({ ok: true, prueba: true, grupo: r.grupo.jid });
  }

  // ── Real: agrupar por destinatario, un solo PDF por persona con SOLO los
  //    grupos que sigue y que tuvieron actividad esta corrida (DL-21). ──────
  const jidsConResumen = conContenido.map((r) => r.grupo.jid);
  const campoRecap = periodo === "dia" ? "recap_dia" : "recap_semana";
  const { data: destinatarios } = jidsConResumen.length
    ? await sb.from("wa_grupo_destinatarios").select("grupo_jid, usuario_id").in("grupo_jid", jidsConResumen).eq(campoRecap, true)
    : { data: [] };

  const porUsuario = new Map<string, string[]>();
  for (const d of (destinatarios ?? []) as Any[]) {
    const lista = porUsuario.get(d.usuario_id) ?? [];
    lista.push(d.grupo_jid);
    porUsuario.set(d.usuario_id, lista);
  }

  const gruposConDestinatario = new Set((destinatarios ?? []).map((d: Any) => d.grupo_jid));
  for (const jid of jidsConResumen) {
    if (!gruposConDestinatario.has(jid)) {
      await sb.from("wa_recap_envios").insert({
        periodo, desde: new Date(Date.now() - (periodo === "dia" ? 1 : 7) * 86_400_000).toISOString(), hasta: new Date().toISOString(),
        usuario_id: null, grupos: [jid], estado: "sin_destinatarios",
      }).then(() => {}, () => {});
    }
  }

  for (const [usuarioId, jids] of porUsuario) {
    const grupoRows = conContenido.filter((r) => jids.includes(r.grupo.jid));
    const secciones = grupoRows.flatMap((r) => r.secciones);
    const { data: destUsuario } = await sb.from("usuarios").select("email,nombre").eq("id", usuarioId).maybeSingle();
    const baseLog = {
      periodo, desde: new Date(Date.now() - (periodo === "dia" ? 1 : 7) * 86_400_000).toISOString(), hasta: new Date().toISOString(),
      usuario_id: usuarioId, grupos: jids,
    };
    if (!resendApiKey || !destUsuario?.email) {
      await sb.from("wa_recap_envios").insert({ ...baseLog, estado: "fallido", motivo: !resendApiKey ? "sin_resend_api_key" : "sin_correo" }).then(() => {}, () => {});
      continue;
    }
    try {
      const pdf = await construirPdfSecciones(
        { tituloPortada: `Recap ${periodo === "dia" ? "diario" : "semanal"} de grupos de WhatsApp`, subtituloPortada: hoyIso },
        secciones,
      );
      const path = `${periodo}/${hoyIso}/${usuarioId}.pdf`;
      await sb.storage.from("wa-recaps").upload(path, new Blob([pdf], { type: "application/pdf" }), { upsert: true });
      const resumenCorto = grupoRows.map((r) => `<h3 style="margin:14px 0 4px">${r.grupo.nombre}</h3><p style="margin:0">${r.resumenTexto ?? "(sin resumen de IA — presupuesto agotado)"}</p>`).join("");
      await enviarCorreoConPdf(
        resendApiKey, [destUsuario.email],
        `Recap ${periodo === "dia" ? "diario" : "semanal"} de tus grupos de WhatsApp`,
        `${resumenCorto}<p style="margin-top:16px;color:#888">Generado por IA, puede contener errores. El PDF adjunto trae el detalle (decisiones, pendientes, fechas).</p>`,
        pdf, `recap-${periodo}-${hoyIso}.pdf`,
      );
      await sb.from("wa_resumenes").update({ pdf_path: path }).in("grupo_jid", jids).eq("periodo", periodo).eq("fecha", hoyIso).then(() => {}, () => {});
      await sb.from("wa_recap_envios").insert({ ...baseLog, estado: "enviado", pdf_path: path }).then(() => {}, () => {});
    } catch (e) {
      console.error("[wa-recap] envío falló:", e);
      await sb.from("wa_recap_envios").insert({ ...baseLog, estado: "fallido", motivo: String(e instanceof Error ? e.message : e).slice(0, 200) }).then(() => {}, () => {});
    }
  }

  await sb.rpc("envio_automatico_marcar_enviado", { p_familia: familia }).then(() => {}, () => {});
  return json({ ok: true, grupos_procesados: resultados.length, con_actividad: conContenido.length, destinatarios: porUsuario.size });
}

// DL-26 — mismas dos formas de llamar que wa-seguimiento: cron (x-sync-secret,
// corrida real) o la pantalla con el JWT de un usuario real + "probar".
async function resolverLlamador(req: Request): Promise<{ ok: true; prueba: boolean; usuarioId?: string } | { ok: false; status: number; error: string }> {
  const secret = req.headers.get("x-sync-secret");
  if (secret && secret === Deno.env.get("INFRA_SYNC_SECRET")) return { ok: true, prueba: false };
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, status: 401, error: "No autenticado." };
  const callerClient = createClient(SUPABASE_URL, envRequerido("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await callerClient.auth.getUser();
  if (error || !data.user) return { ok: false, status: 401, error: "Sesión inválida." };
  const { data: puede } = await callerClient.schema("sgc").rpc("puede_operar_submodulo", { p_key: "tecnologia.wa_grupos" });
  if (!puede) return { ok: false, status: 403, error: "No autorizado." };
  return { ok: true, prueba: true, usuarioId: data.user.id };
}

// F5.6 — descarga del PDF: GET ?modo=pdf&path=<storage path>, gate
// `puede_ver_submodulo` (lectura, no `operar`) + URL firmada de 300s. El
// front NUNCA accede al bucket directo (sin policies de cliente, como wa-media).
async function handleGetPdf(req: Request, url: URL) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autenticado." }, 401);
  const callerClient = createClient(SUPABASE_URL, envRequerido("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await callerClient.auth.getUser();
  if (error || !data.user) return json({ error: "Sesión inválida." }, 401);
  const { data: puede } = await callerClient.schema("sgc").rpc("puede_ver_submodulo", { p_key: "tecnologia.wa_grupos" });
  if (!puede) return json({ error: "No autorizado." }, 403);

  const path = url.searchParams.get("path");
  if (!path) return json({ error: "Falta path." }, 400);

  const sb = admin();
  const { data: firmada, error: errFirma } = await sb.storage.from("wa-recaps").createSignedUrl(path, 300);
  if (errFirma || !firmada) return json({ error: "No se pudo generar la descarga." }, 500);
  return json({ url: firmada.signedUrl });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("modo") === "pdf") return await handleGetPdf(req, url);
    return json({ error: "modo desconocido." }, 400);
  }

  const llamador = await resolverLlamador(req);
  if (!llamador.ok) return json({ error: llamador.error }, llamador.status);

  let body: Any = {};
  try { body = await req.json(); } catch { body = {}; }
  const tarea = String(body?.tarea ?? "");
  if (!["dia", "semana", "probar"].includes(tarea)) return json({ ok: false, error: `tarea desconocida: ${tarea}` }, 400);

  const prueba = llamador.prueba || tarea === "probar";
  // "probar" puede pedir explícitamente el periodo semanal (body.periodo); si no, dia.
  const periodoFinal: Periodo = tarea === "semana" || (tarea === "probar" && body?.periodo === "semana") ? "semana" : "dia";

  const sb = admin();
  try {
    return await handleRecap(sb, periodoFinal, prueba, llamador.usuarioId, typeof body?.grupo === "string" ? body.grupo : undefined);
  } catch (e) {
    console.error("[wa-recap] error inesperado:", e);
    await logEvento(sb, "alerta", "wa_recap_error", { paso: "handler", error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    return json({ ok: false, error: "Error interno procesando la solicitud." }, 500);
  }
});
