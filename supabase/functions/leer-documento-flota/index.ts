import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { construirContenido, parsearPaginas, dividirPdfEnTandas, SYSTEM, type Any } from "./lector.ts";

// ============================================================================
// DB3 — Hotfix (30-oct-2026, reporte real de Xaviel): esta edge dejó de ser
// una llamada SÍNCRONA del navegador. Un PDF largo (MARBETES.pdf, 24 páginas)
// tarda 8-13s en leerse incluso dividido en tandas paralelas — tiempo
// suficiente para rozar el límite del relay de Supabase, que corta la
// conexión del navegador con `x-relay-error` (supabase-js lo traduce a "No se
// pudo contactar el servicio"), AUNQUE la edge sí termine bien.
//
// Ahora: el navegador llama al RPC `flota_documento_lectura_crear` (rápido,
// crea una fila en `flota_documentos_lecturas`), que dispara ESTA edge vía
// pg_net (server-to-server, `x-sync-secret` — mismo patrón que
// `pagos_obra_enviar` → `pagos-descargo-enviar`). El navegador hace polling de
// la fila (select casi instantáneo) en vez de sostener una conexión larga.
//
//   Entrada (POST, server-to-server): { job_id, usuario_id, archivos: [{data, mime}] }
//   Efecto: escribe estado='listo'|'error' + resultado en la fila del trabajo.
//
//   Secrets: ANTHROPIC_API_KEY · LEER_DOCUMENTO_FLOTA_MODEL (opcional) · INFRA_SYNC_SECRET.
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LEER_DOCUMENTO_FLOTA_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

type ResultadoAnthropic =
  | { ok: true; texto: string; inTok: number; outTok: number }
  | { ok: false; error: string };

async function llamarAnthropic(content: Any[]): Promise<ResultadoAnthropic> {
  let anthRes: Response;
  try {
    anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
  } catch (_e) {
    return { ok: false, error: "No se pudo leer el documento (red)." };
  }
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    return { ok: false, error: "El lector de documentos no está disponible ahora." };
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  return { ok: true, texto, inTok: anth?.usage?.input_tokens ?? 0, outTok: anth?.usage?.output_tokens ?? 0 };
}

Deno.serve(async (req) => {
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const secret = req.headers.get("x-sync-secret");
  const expected = Deno.env.get("INFRA_SYNC_SECRET");
  if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ error: "Cuerpo inválido" }, 400); }
  const jobId = String(payload?.job_id ?? "");
  const usuarioId = String(payload?.usuario_id ?? "") || null;
  const archivos: { data: string; mime: string }[] = Array.isArray(payload?.archivos)
    ? payload.archivos.map((a: Any) => ({ data: String(a?.data ?? ""), mime: String(a?.mime ?? "") })).filter((a: Any) => a.data && a.mime)
    : [];
  if (!jobId) return json({ error: "Falta job_id." }, 400);

  const marcarError = async (msg: string) => {
    await svc.from("flota_documentos_lecturas").update({ estado: "error", resultado: { error: msg } }).eq("id", jobId);
  };

  if (!ANTHROPIC_API_KEY) { await marcarError("Lectura de documentos no configurada (sin API key)."); return json({ ok: false }); }
  if (!archivos.length) { await marcarError("Sin archivos para leer."); return json({ ok: false }); }

  const esPdfUnico = archivos.length === 1 && archivos[0].mime === "application/pdf";
  let paginasTotal: Any[] = [];
  let inTokTotal = 0, outTokTotal = 0;
  let paginasOmitidas = 0;
  let errorSiVacio: string | null = null;

  try {
    if (esPdfUnico) {
      const tandas = await dividirPdfEnTandas(archivos[0].data);
      const resultados = await Promise.all(tandas.map(async (t) => {
        const content = construirContenido([{ data: t.data, mime: "application/pdf" }]);
        return { tanda: t, r: await llamarAnthropic(content) };
      }));
      for (const { tanda, r } of resultados) {
        if (!r.ok) {
          console.error("tanda fallida", tanda.desde, r.error);
          errorSiVacio = r.error;
          paginasOmitidas += tanda.paginas;
          continue;
        }
        inTokTotal += r.inTok; outTokTotal += r.outTok;
        const paginas = parsearPaginas(r.texto, tanda.desde - 1);
        if (paginas) paginasTotal.push(...paginas);
        else paginasOmitidas += tanda.paginas;
      }
      paginasTotal.sort((a, b) => a.pagina - b.pagina);
    } else {
      let content: Any[];
      try { content = construirContenido(archivos); } catch (e) {
        await marcarError(e instanceof Error ? e.message : "Archivos no válidos.");
        return json({ ok: false });
      }
      const r = await llamarAnthropic(content);
      if (!r.ok) errorSiVacio = r.error;
      else { inTokTotal = r.inTok; outTokTotal = r.outTok; paginasTotal = parsearPaginas(r.texto) ?? []; }
    }
  } catch (e) {
    console.error("procesar lectura flota", e);
    await marcarError(e instanceof Error ? e.message : "No se pudo leer el documento.");
    return json({ ok: false });
  }

  const costoUsd = inTokTotal * PRECIO_IN + outTokTotal * PRECIO_OUT;
  try {
    await svc.from("uso_ia").insert({
      usuario_id: usuarioId, funcion: "leer_documento_flota", modelo: MODEL,
      tokens_in: inTokTotal, tokens_out: outTokTotal, costo_estimado: costoUsd,
      meta: { archivos: archivos.length, mime: archivos[0].mime, paginas_omitidas: paginasOmitidas },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  if (!paginasTotal.length) {
    await marcarError(errorSiVacio || "No se pudo interpretar el documento. Llena los campos a mano.");
    return json({ ok: false });
  }

  // AT11 — si algo no se pudo leer, se dice (no se calla una omisión silenciosa).
  await svc.from("flota_documentos_lecturas").update({
    estado: "listo",
    resultado: {
      paginas: paginasTotal, modelo: MODEL, costo_usd: costoUsd,
      ...(paginasOmitidas > 0 ? { omitidas: paginasOmitidas } : {}),
    },
  }).eq("id", jobId);

  return json({ ok: true });
});
