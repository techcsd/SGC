import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AA20 — Precios oficiales de combustibles RD (MICM).
// Descarga el CSV oficial del MICM (dataset "Precios de combustibles, 2010–2026"),
// toma la semana vigente más reciente y guarda los 4 productos que usamos en
// sgc.fuel_prices. Invocada por pg_cron (semanal) con x-sync-secret, o a mano.
//
// Fuente: micm.gob.do (archivo estático, actualizado ~semanal; el dataset CKAN
// datos.gob.do apunta a este mismo archivo pero su metadata va rezagada, por eso
// se baja el CSV directo). CSV separado por ';', codificación latin-1.
// Mapeo de columnas → producto canónico:
//   GASOLINA PREMIUM → gasolina_premium   GASOLINA REGULAR → gasolina_regular
//   GASOIL REGULAR   → diesel_regular     GASOIL OPTIMO    → diesel_premium (fallback GASOIL PREMIUM)

const CSV_URL =
  "https://micm.gob.do/transparencias/datos-abiertos/precios-de-combustibles/precios-de-combustibles-2010-2026.csv";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function norm(s: string): string {
  // Quita marcas diacríticas (U+0300–U+036F) sin depender de literales en el regex.
  const decomposed = (s || "").normalize("NFD");
  let out = "";
  for (const ch of decomposed) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    out += ch;
  }
  return out.trim().toUpperCase();
}
function toDateISO(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const expected = Deno.env.get("FUEL_PRICES_SECRET") ?? Deno.env.get("INFRA_SYNC_SECRET");
  if (expected && req.headers.get("x-sync-secret") !== expected) {
    return json({ error: "No autorizado." }, 401);
  }

  try {
    const res = await fetch(CSV_URL, { headers: { "User-Agent": "Mozilla/5.0 (SGC fuel-prices sync)" } });
    if (!res.ok) return json({ error: `MICM respondió ${res.status}` }, 502);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("latin1").decode(buf);

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return json({ error: "CSV vacío o inesperado." }, 502);

    const header = lines[0].split(";").map(norm);
    const col = (name: string) => header.findIndex((h) => h === norm(name));
    const idx = {
      diaDesde: 0, diaHasta: 1, mes: 2, anio: 3,
      gasPrem: col("GASOLINA PREMIUM"),
      gasReg: col("GASOLINA REGULAR"),
      dieselReg: col("GASOIL REGULAR"),
      dieselOptimo: col("GASOIL OPTIMO"),
      dieselPrem: col("GASOIL PREMIUM"),
    };

    // Última fila con año y precio de gasolina premium válidos.
    let row: string[] | null = null;
    for (let i = lines.length - 1; i >= 1; i--) {
      const c = lines[i].split(";");
      const y = parseInt(c[idx.anio], 10);
      const p = parseFloat((c[idx.gasPrem] || "").replace(",", "."));
      if (y >= 2010 && y <= 2100 && p > 0) { row = c; break; }
    }
    if (!row) return json({ error: "No se encontró una fila de precios válida." }, 502);

    const anio = parseInt(row[idx.anio], 10);
    const dia = parseInt(row[idx.diaDesde], 10) || 1;
    const mesNum = MESES[(row[idx.mes] || "").trim().toLowerCase()] ?? 1;
    const vigenciaDesde = toDateISO(anio, mesNum, dia);
    const vigenciaHasta = toDateISO(anio, mesNum, dia + 6);

    const num = (v: string) => {
      const n = parseFloat((v || "").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };
    const optimo = num(row[idx.dieselOptimo]);
    const dieselPremVal = optimo > 0 ? optimo : num(row[idx.dieselPrem]);

    const productos: { producto: string; precio: number }[] = [
      { producto: "gasolina_premium", precio: num(row[idx.gasPrem]) },
      { producto: "gasolina_regular", precio: num(row[idx.gasReg]) },
      { producto: "diesel_regular", precio: num(row[idx.dieselReg]) },
      { producto: "diesel_premium", precio: dieselPremVal },
    ].filter((p) => p.precio > 0);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "sgc" } },
    );

    const rows = productos.map((p) => ({
      producto: p.producto, precio: p.precio,
      vigencia_desde: vigenciaDesde, vigencia_hasta: vigenciaHasta, fuente: "MICM",
    }));
    const { error } = await admin.from("fuel_prices").upsert(rows, { onConflict: "producto,vigencia_desde" });
    if (error) return json({ error: `No se pudo guardar: ${error.message}` }, 500);

    return json({ ok: true, vigencia_desde: vigenciaDesde, vigencia_hasta: vigenciaHasta, productos: rows });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
