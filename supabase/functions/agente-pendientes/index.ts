import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";

// ============================================================================
// DM2 (ronda DM, PROMPT 140 F7) — Agente de Pendientes (N3): "sub agent... daily
// and weekly recopile the pending reports... create a note, or add them to an
// existing note (by choice of the user)". Cron diario 7am RD y semanal lunes
// 7:15am RD (ver sql/2026-11-10-dm2-agente-pendientes.sql). Mismo patrón que
// agente-cronista: 100% determinista, cero costo de IA, solo lee/escribe la
// nota — nunca envía nada por su cuenta salvo el aviso corto.
//
// Fuentes (DM-33, las cuatro elegidas): reportes de Soporte abiertos/en
// progreso · errores del sistema no esperados (agrupados por firma,
// sgc.app_error_estados) · preguntas que Compa no pudo contestar
// (assistant_consultas_no_atendidas) · hallazgos de WhatsApp en seguimiento
// (solo si la persona tiene tecnologia.wa_grupos). Cada fuente respeta los
// permisos de quien recibe (sgc.agente_pendientes_permisos).
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hoyRD(): Date {
  // America/Santo_Domingo = UTC-4 todo el año (sin horario de verano).
  return new Date(Date.now() - 4 * 3600 * 1000);
}
function fechaIsoRD(): string {
  return hoyRD().toISOString().slice(0, 10);
}
function diasDesde(iso: string): number {
  return Math.floor((hoyRD().getTime() - new Date(iso).getTime()) / 86_400_000);
}
// Hash corto y estable para usar como clave oculta de una firma de error (no es uuid).
function hashFirma(firma: string): string {
  let h = 0;
  for (let i = 0; i < firma.length; i++) h = (h * 31 + firma.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function truncar(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
// Réplica exacta de sgc.error_firma() (sql/2026-09-03-bi4-panel-errores.sql) —
// agrupa por el mismo criterio que usa el panel "Reportes de errores", para no
// contar "sw_update... (1ª vez)"/"(2ª vez)" como firmas distintas.
function errorFirma(message: string): string {
  let s = message ?? "";
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
  s = s.replace(/\b\d+\b/g, "<n>");
  s = s.replace(/\([^)]*\)/g, "(…)");
  s = s.replace(/\s+/g, " ");
  return s.slice(0, 200);
}

function refKey(tipo: string, id: string): string {
  return `{ref:${tipo}:${id}}`;
}
/** Refs que la persona ya marcó a mano — no se reabren aunque el dato siga pendiente. */
function refsMarcados(contenido: string): Set<string> {
  const set = new Set<string>();
  const re = /- \[x\].*?(\{ref:[a-z]+:[^}]+\})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido))) set.add(m[1]);
  return set;
}

interface ItemPendiente {
  checked: boolean;
  linea: string;
}

async function recolectar(svc: ReturnType<typeof createClient>, usuarioId: string, marcados: Set<string>) {
  const { data: permisos } = await svc.rpc("agente_pendientes_permisos", { p_usuario: usuarioId }).single() as {
    data: { ve_tecnologia: boolean; ve_wa: boolean } | null;
  };
  const veTecnologia = permisos?.ve_tecnologia ?? false;
  const veWa = permisos?.ve_wa ?? false;

  const items: ItemPendiente[] = [];
  let nSoporte = 0, nErrores = 0, nGaps = 0, nWa = 0, antiguos7d = 0;

  if (veTecnologia) {
    const { data: reportes } = await svc
      .from("reportes_usuario")
      .select("id, asunto, estado, created_at")
      .in("estado", ["abierto", "en_progreso"])
      .order("created_at", { ascending: true });
    for (const r of reportes ?? []) {
      nSoporte++;
      const dias = diasDesde(r.created_at as string);
      if (dias > 7) antiguos7d++;
      const ref = refKey("sop", r.id as string);
      items.push({
        checked: marcados.has(ref),
        linea: `[Soporte] "${truncar(r.asunto as string, 70)}" — lleva ${dias} día(s) (${r.estado}) — [ver](/admin/reportes) ${ref}`,
      });
    }

    const { data: errores } = await svc
      .from("app_error_reports")
      .select("message, error_type, user_id, created_at");
    const { data: estados } = await svc.from("app_error_estados").select("firma, estado");
    const estadoPorFirma = new Map((estados ?? []).map((e) => [e.firma as string, e.estado as string]));
    const grupos = new Map<string, { firma: string; ejemplo: string; n: number; usuarios: Set<string>; primera: string; ultima: string }>();
    for (const e of errores ?? []) {
      const firma = errorFirma(e.message as string);
      const g = grupos.get(firma) ?? { firma, ejemplo: e.message as string, n: 0, usuarios: new Set(), primera: e.created_at as string, ultima: e.created_at as string };
      g.n++;
      if (e.user_id) g.usuarios.add(e.user_id as string);
      if ((e.created_at as string) < g.primera) g.primera = e.created_at as string;
      if ((e.created_at as string) > g.ultima) g.ultima = e.created_at as string;
      grupos.set(firma, g);
    }
    for (const g of grupos.values()) {
      const estado = estadoPorFirma.get(g.firma) ?? "abierto";
      if (estado === "solucionado" || estado === "regla_negocio") continue;
      nErrores++;
      const dias = diasDesde(g.ultima);
      if (diasDesde(g.primera) > 7) antiguos7d++;
      const nueva = diasDesde(g.primera) < 1;
      const ref = refKey("err", hashFirma(g.firma));
      items.push({
        checked: marcados.has(ref),
        linea: `[Error]${nueva ? " NUEVO" : ""} "${truncar(g.ejemplo, 70)}" (${g.n}x, ${g.usuarios.size} persona(s), última hace ${dias} día(s)) — [ver](/tecnologia/reportes-errores) ${ref}`,
      });
    }

    const { data: gaps } = await svc
      .from("assistant_consultas_no_atendidas")
      .select("id, pregunta, created_at")
      .eq("resuelto", false)
      .order("created_at", { ascending: true });
    for (const gpt of gaps ?? []) {
      nGaps++;
      const dias = diasDesde(gpt.created_at as string);
      if (dias > 7) antiguos7d++;
      const ref = refKey("gap", gpt.id as string);
      items.push({
        checked: marcados.has(ref),
        linea: `[Compa] "${truncar(gpt.pregunta as string, 70)}" — lleva ${dias} día(s) sin responder — [ver](/tecnologia/consultas-compa) ${ref}`,
      });
    }
  }

  if (veWa) {
    const { data: hallazgos } = await svc
      .from("wa_hallazgos")
      .select("id, resumen, seguimiento, seguimiento_desde")
      .in("seguimiento", ["activo", "vencido"])
      .order("seguimiento_desde", { ascending: true });
    for (const h of hallazgos ?? []) {
      nWa++;
      const ref = refKey("wa", h.id as string);
      items.push({
        checked: marcados.has(ref),
        linea: `[WhatsApp] "${truncar((h.resumen as string) ?? "", 70)}" (${h.seguimiento}) — [ver](/tecnologia/whatsapp) ${ref}`,
      });
    }
  }

  return { items, nSoporte, nErrores, nGaps, nWa, antiguos7d };
}

function construirNota(contenidoPrevio: string, items: ItemPendiente[], resumen: { nSoporte: number; nErrores: number; nGaps: number; nWa: number; antiguos7d: number }, modo: string): string {
  const fecha = fechaIsoRD();

  const hoyLineas = items.length
    ? items.map((i) => `- [${i.checked ? "x" : " "}] ${i.linea}`)
    : ["Sin pendientes."];

  // "Esta semana" — se reescribe solo en la corrida semanal (lunes); se conserva
  // tal cual en las corridas diarias de entre semana.
  const prevSemanaMatch = /## Esta semana\n([\s\S]*?)(?=\n## |$)/.exec(contenidoPrevio);
  let semanaBloque = prevSemanaMatch ? prevSemanaMatch[1].trim() : "(se arma el próximo lunes)";
  if (modo === "semanal") {
    const total = items.length;
    semanaBloque = `Semana del ${fecha}: ${total} pendiente(s) (${resumen.nSoporte} Soporte · ${resumen.nErrores} errores · ${resumen.nGaps} Compa · ${resumen.nWa} WhatsApp).` +
      (resumen.antiguos7d > 0 ? ` ${resumen.antiguos7d} llevan más de 7 días abiertos.` : " Ninguno lleva más de 7 días.");
  }

  // "Historial" — una línea por corrida, se conservan los últimos 14 días.
  const prevHistMatch = /## Historial\n([\s\S]*?)$/.exec(contenidoPrevio);
  const prevHistLineas = prevHistMatch
    ? prevHistMatch[1].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- "))
    : [];
  const nuevaLineaHist = `- ${fecha} (${modo}): ${items.length} pendiente(s) (${resumen.nSoporte} Soporte · ${resumen.nErrores} errores · ${resumen.nGaps} Compa · ${resumen.nWa} WhatsApp)`;
  const historial = [nuevaLineaHist, ...prevHistLineas.filter((l) => {
    const m = /^- (\d{4}-\d{2}-\d{2})/.exec(l);
    if (!m) return true;
    return diasDesde(m[1]) <= 14;
  })];

  return [
    "# Pendientes",
    "",
    `_Actualizado ${fecha} por el Agente de Pendientes._`,
    "",
    "## Hoy",
    "",
    ...hoyLineas,
    "",
    "## Esta semana",
    "",
    semanaBloque,
    "",
    "## Historial",
    "",
    ...historial,
  ].join("\n");
}

async function escribirNota(svc: ReturnType<typeof createClient>, usuarioId: string, contenido: string, prueba: boolean) {
  const titulo = prueba ? "Pendientes (PRUEBA)" : "Pendientes";
  const { data: existente } = await svc
    .from("notas")
    .select("id")
    .eq("owner_id", usuarioId)
    .eq("titulo", titulo)
    .eq("ambito", "dev")
    .maybeSingle();

  if (existente?.id) {
    await svc.from("notas").update({ contenido, updated_at: new Date().toISOString() }).eq("id", existente.id);
    return existente.id as string;
  }
  const { data: creada } = await svc
    .from("notas")
    .insert({
      owner_id: usuarioId, titulo, contenido, ambito: "dev", formato: "markdown",
      pinned: !prueba, tags: ["pendientes"],
    })
    .select("id")
    .single();
  return creada?.id as string | undefined;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const body = await req.json().catch(() => ({}));
  const modo = (body.modo as string) ?? "diario";
  if (!["diario", "semanal", "prueba"].includes(modo)) return json({ error: "modo inválido" }, 400);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  // CU3 — la prueba manual ignora el interruptor y corre SOLO para quien la pidió.
  if (modo !== "prueba") {
    const { data: activo } = await svc.rpc("envio_automatico_activo", { p_familia: "agente_pendientes" });
    if (!activo) return json({ ok: true, omitido: "familia apagada" });
  }

  let usuarios: string[];
  if (modo === "prueba") {
    if (!body.usuario_id) return json({ error: "falta usuario_id" }, 400);
    usuarios = [body.usuario_id as string];
  } else {
    const { data: configs } = await svc.from("agente_pendientes_config").select("usuario_id").eq("activo", true);
    usuarios = (configs ?? []).map((c) => c.usuario_id as string);
  }

  const resultados: { usuario_id: string; nota_id?: string; total: number }[] = [];

  for (const usuarioId of usuarios) {
    const { data: notaExistente } = await svc
      .from("notas")
      .select("contenido")
      .eq("owner_id", usuarioId)
      .eq("titulo", modo === "prueba" ? "Pendientes (PRUEBA)" : "Pendientes")
      .eq("ambito", "dev")
      .maybeSingle();
    const marcados = refsMarcados((notaExistente?.contenido as string) ?? "");

    const { items, ...resumen } = await recolectar(svc, usuarioId, marcados);
    const contenido = construirNota((notaExistente?.contenido as string) ?? "", items, resumen, modo);
    const notaId = await escribirNota(svc, usuarioId, contenido, modo === "prueba");

    resultados.push({ usuario_id: usuarioId, nota_id: notaId, total: items.length });

    // DM-37 — aviso corto, respetando silencio (destinatarios_notificacion ya excluye
    // a quien lo tiene apagado). Para la prueba se avisa siempre (es la confirmación
    // de que corrió), para diario/semanal solo si hubo algo que contar.
    if (modo === "prueba" || items.length > 0) {
      const { data: destinatarios } = await svc.rpc("destinatarios_notificacion", {
        p_tipo: "agente_pendientes", p_modulo: null, p_usuarios: [usuarioId],
      });
      const noExcluido = (destinatarios ?? []).find((d: { usuario_id: string; excluido_por: string | null }) => d.usuario_id === usuarioId && !d.excluido_por);
      if (noExcluido) {
        const titulo = modo === "prueba" ? "Prueba del Agente de Pendientes lista" : `Pendientes de ${modo === "semanal" ? "la semana" : "hoy"}: ${resumen.nSoporte} reportes · ${resumen.nErrores} errores · ${resumen.nGaps} de Compa${resumen.nWa ? ` · ${resumen.nWa} de WhatsApp` : ""}`;
        await svc.rpc("notificar", {
          p_usuario: usuarioId, p_tipo: "agente_pendientes", p_titulo: titulo,
          p_mensaje: "Revisa la nota «Pendientes» en Notas.", p_ruta: "/notas",
        });
      }
    }
  }

  return json({ ok: true, modo, resultados });
});
