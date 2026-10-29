import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ajustarCorreoResend } from "../_shared/entorno.ts";
import * as XLSX from "npm:xlsx@0.18.5";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";

// CW4 — Rendimiento semanal por vehículo (pedido de Eduardo): correo con el
// resumen en el cuerpo + Excel adjunto, a Eduardo + Flota. Server-to-server
// desde sgc.rendimiento_vehiculos_enviar_semana (cron de los lunes 7:00 AM RD)
// vía pg_net con `x-sync-secret`. Desplegar con verify_jwt=false.
//
// Mismos números que la pantalla Flota › Rendimiento (misma RPC
// reporte_rendimiento_vehiculos) — AU1: el correo no inventa datos nuevos.

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
function fmtDate(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(s);
}
/** Resta días a una fecha YYYY-MM-DD sin depender de la zona del worker. */
function restarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - dias * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function nf(n: unknown, dec = 1): string {
  return Number(n ?? 0).toLocaleString("es-DO", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

const CONFIANZA_LABEL: Record<string, string> = {
  sin_datos: "Sin datos suficientes",
  baja: "Confianza baja",
  media: "Confianza media",
  alta: "Confianza alta",
};

// deno-lint-ignore no-explicit-any
type Any = any;

const TD = "padding:6px 10px;border-bottom:1px solid #eee;";
const TH = "padding:6px 10px;border-bottom:2px solid #ddd;color:#555;text-align:left;";
function tabla(cols: string[], rows: string[][]): string {
  const head = cols.map((c) => `<th style="${TH}">${esc(c)}</th>`).join("");
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c, i) => `<td style="${TD}${i > 0 ? "text-align:center;" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${cols.length}" style="padding:10px;color:#888;">Sin echadas en este período.</td></tr>`;
  return `<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 14px;">` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Devuelve el .xlsx ya en base64 (evita pasar por Uint8Array/btoa a mano). */
function componerExcelBase64(filas: Any[]): string {
  const cols = ["Vehículo", "Placa", "Rendimiento", "Unidad", "Confianza", "Echadas usadas", "Echadas totales",
    "Echadas excluidas (duplicadas)", "Total km/horas", "Total galones", "Rendimiento esperado", "Última echada"];
  const rows = filas.map((f) => [
    f.alias || f.placa || "(sin placa)", f.placa ?? "", f.rendimiento ?? "—", f.unidad,
    CONFIANZA_LABEL[f.confianza] ?? f.confianza, f.echadas_usadas, f.echadas_total, f.echadas_excluidas_dup,
    f.total_km, f.total_galones, f.baseline ?? "—", f.estado_actual ?? "—",
  ]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Rendimiento");
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = construirCors(req, { headersExtra: "x-sync-secret" });
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const supabase = createClient(
    envRequerido("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "sgc" } },
  );
  let destinatarioPrueba: string | null = null;
  try {
    const secret = req.headers.get("x-sync-secret");
    const expected = Deno.env.get("INFRA_SYNC_SECRET");
    if (!expected || secret !== expected) return json({ error: "No autorizado." }, 401);

    const body = await req.json();
    const desde = String(body.desde ?? "");
    const hasta = String(body.hasta ?? "");
    if (!desde || !hasta) return json({ error: "Falta desde/hasta." }, 400);
    destinatarioPrueba = typeof body.destinatario_prueba === "string" ? body.destinatario_prueba.trim() : null;

    const { data: filas, error: rpcError } = await supabase.rpc("reporte_rendimiento_vehiculos", {
      p_desde: desde, p_hasta: hasta, p_vehiculo_id: null,
    });
    if (rpcError) throw new Error(rpcError.message);
    const r: Any[] = Array.isArray(filas) ? filas : [];

    // DB10 (DB-06) — variación vs la semana ANTERIOR: misma RPC corrida 7 días
    // atrás (mismos números que la pantalla, AU1 — el correo no inventa datos).
    const prevDesde = restarDias(desde, 7), prevHasta = restarDias(hasta, 7);
    const { data: filasPrev } = await supabase.rpc("reporte_rendimiento_vehiculos", {
      p_desde: prevDesde, p_hasta: prevHasta, p_vehiculo_id: null,
    });
    const prevPorVeh = new Map<string, Any>(((filasPrev ?? []) as Any[]).map((f) => [f.vehiculo_id, f]));

    // DB-06 — costo del combustible del período por vehículo (suma de las echadas
    // válidas: sin invalidadas ni pruebas). La RPC no lo expone; es un agregado plano.
    const { data: costos } = await supabase
      .from("registros_combustible")
      .select("vehiculo_id, monto, invalidada, es_prueba")
      .gte("fecha", desde).lte("fecha", hasta);
    const costoPorVeh = new Map<string, number>();
    for (const c of (costos ?? []) as Any[]) {
      if (c.invalidada || c.es_prueba) continue;
      costoPorVeh.set(c.vehiculo_id, (costoPorVeh.get(c.vehiculo_id) ?? 0) + Number(c.monto ?? 0));
    }

    const variacion = (actual: number | null, base: number | null): string => {
      if (actual == null || base == null || !Number.isFinite(base) || base === 0) return "—";
      const pct = ((actual - base) / base) * 100;
      const flecha = pct > 1 ? "▲" : pct < -1 ? "▼" : "=";
      return `${flecha} ${pct > 0 ? "+" : ""}${nf(pct, 1)}%`;
    };

    const conDatos = r.filter((f) => f.rendimiento != null);
    const sinDatos = r.filter((f) => f.rendimiento == null);

    const rows = conDatos.map((f) => {
      const prev = prevPorVeh.get(f.vehiculo_id);
      const costo = costoPorVeh.get(f.vehiculo_id);
      return [
        String(f.alias || f.placa || "(sin placa)"),
        `${nf(f.total_km, 0)} ${f.unidad === "km/gal" ? "km" : "h"}`,
        nf(f.total_galones, 1),
        `${nf(f.rendimiento)} ${f.unidad}`,
        costo != null ? `RD$ ${nf(costo, 0)}` : "—",
        variacion(f.rendimiento, prev?.rendimiento ?? null),
        f.baseline != null ? `${nf(f.baseline)} (${variacion(f.rendimiento, f.baseline)})` : "—",
        CONFIANZA_LABEL[f.confianza] ?? f.confianza,
      ];
    });

    const appUrl = Deno.env.get("APP_URL") ?? "https://sgcconstructorasd.com";
    const ASUNTO = "Rendimiento de combustible de la flota";
    const html =
      `<div style="font-family:Arial,sans-serif;color:#222;max-width:860px;">` +
      `<h2 style="color:#ff5f00;margin:0 0 4px;">${ASUNTO}</h2>` +
      `<p style="color:#666;margin:0 0 8px;">Semana del ${esc(fmtDate(desde))} al ${esc(fmtDate(hasta))}</p>` +
      `<p style="color:#8a5a00;font-size:12.5px;background:#fff7e6;padding:8px 12px;border-radius:8px;margin:0 0 14px;">` +
      `Aproximado: nunca se registra "tanque lleno", así que el rendimiento se calcula entre echadas (sin contar ` +
      `la primera del período) y no es exacto. El detalle completo va en el Excel adjunto.</p>` +
      tabla(["Vehículo", "Km/horas", "Galones", "Rendimiento", "Costo", "vs semana anterior", "Esperado", "Confianza"], rows) +
      (sinDatos.length
        ? `<p style="color:#888;font-size:12.5px;margin:0 0 6px;"><strong>Sin datos suficientes esta semana:</strong> ` +
          `${esc(sinDatos.map((f) => String(f.alias || f.placa || "(sin placa)")).join(", "))}.</p>`
        : "") +
      `<p style="color:#888;font-size:12px;">Ver el detalle en ` +
      `<a href="${appUrl}/flota/rendimiento-vehiculos" style="color:#ff5f00;">Flota › Rendimiento por vehículo</a>, ` +
      `o pregúntale a Compa.</p></div>`;

    const texto = [
      `${ASUNTO} — ${fmtDate(desde)} – ${fmtDate(hasta)}`,
      ``,
      ...conDatos.map((f) => {
        const prev = prevPorVeh.get(f.vehiculo_id);
        return `- ${f.alias || f.placa || "(sin placa)"}: ${nf(f.rendimiento)} ${f.unidad} · ${nf(f.total_km, 0)} km · ${nf(f.total_galones, 1)} gal · vs semana anterior ${variacion(f.rendimiento, prev?.rendimiento ?? null)} (${CONFIANZA_LABEL[f.confianza] ?? f.confianza})`;
      }),
      ...(sinDatos.length ? ["", `Sin datos: ${sinDatos.map((f) => f.alias || f.placa).join(", ")}`] : []),
      ``,
      `Detalle: ${appUrl}/flota/rendimiento-vehiculos`,
    ].join("\n");

    const excelBase64 = componerExcelBase64(r);

    let to: string[];
    if (destinatarioPrueba) {
      to = [destinatarioPrueba];
    } else {
      const { data: dest } = await supabase.rpc("destinatarios_rendimiento_vehiculos");
      to = ((dest ?? []) as { email: string }[]).map((u) => u.email).filter(Boolean);
    }
    const { data: resendApiKey } = await supabase.rpc("get_resend_api_key");
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "notificaciones@resend.dev";
    const asuntoPrefijo = destinatarioPrueba ? "[PRUEBA] " : "";

    let ok = true, errMsg: string | null = null;
    if (resendApiKey && to.length) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(ajustarCorreoResend({
          from: fromEmail, to,
          subject: `${asuntoPrefijo}Rendimiento de combustible de la flota — Semana del ${fmtDate(desde)} al ${fmtDate(hasta)}`,
          html, text: texto,
          attachments: [{ filename: `rendimiento-vehiculos-${desde}-${hasta}.xlsx`, content: excelBase64 }],
        })),
      });
      if (!res.ok) { ok = false; errMsg = await res.text(); }
    } else {
      ok = false;
      errMsg = !resendApiKey ? "sin Resend key" : "sin destinatarios";
    }

    return json({ sent: ok, to, error: errMsg, prueba: !!destinatarioPrueba });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido.";
    return json({ error: msg }, 500);
  }
});
