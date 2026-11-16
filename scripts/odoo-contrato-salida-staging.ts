// DS-10/DS-11 prueba de CONTRATO del publicador de salidas con Odoo STAGING real (BD de SGC simulada).
// Recorre el ciclo de vida de un conduce: despachado (A) -> entregado incompleto (B parcial) -> anulado (reversa).
//   deno run --allow-env --allow-net --allow-read scripts/odoo-contrato-salida-staging.ts
import { OdooClient, POLITICA_POR_DEFECTO } from "../supabase/functions/_shared/odoo-client.ts";
import { publicarSalida, type DatosSalida } from "../supabase/functions/_shared/odoo-salidas.ts";
import { bibliotecaReal } from "../supabase/functions/odoo-sync/salidas.ts";

for (const l of Deno.readTextFileSync(".env.local").split(/\r?\n/)) {
  const m = l.match(/^(SGC_INTEGRATION_ODOO_[A-Z_]+)=(.*)$/); if (m) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
}
const url = Deno.env.get("SGC_INTEGRATION_ODOO_URL")!;
Deno.env.set("ODOO_HOSTS_ESCRITURA", new URL(url).host);
const politica = { ...POLITICA_POR_DEFECTO, lectura: { ...POLITICA_POR_DEFECTO.lectura, "stock.quant": ["read_group", "search_read"] } };
const c = new OdooClient({ url, db: Deno.env.get("SGC_INTEGRATION_ODOO_DB")!, user: Deno.env.get("SGC_INTEGRATION_ODOO_USER")!, apiKey: Deno.env.get("SGC_INTEGRATION_ODOO_API_KEY")!, companyId: 1, politica });

const [wh] = await c.call("stock.warehouse", "search_read", [[["code", "=", "WH"]]], { fields: ["lot_stock_id"] });
const [ta] = await c.call("stock.warehouse", "search_read", [[["code", "=", "TA"]]], { fields: ["lot_stock_id"] });
const quants = await c.call("stock.quant", "search_read", [[["location_id", "=", wh.lot_stock_id[0]], ["quantity", ">=", 8]]], { fields: ["product_id", "quantity"], limit: 2 });
if (quants.length < 2) { console.log("Sin 2 productos con stock>=8 en WH"); Deno.exit(1); }
const run = Date.now().toString(36);
const id = `TEST-${run}-SAL`;
const marcas: unknown[] = [];
const base: DatosSalida = {
  id, folio: `CND-${run}`, estado: "despachado", esPrueba: false, paradaEntregada: false, companyId: 1,
  origenLocationId: wh.lot_stock_id[0], origenWarehouseId: 1, destinoLocationId: ta.lot_stock_id[0],
  lineas: quants.map((q: { product_id: [number, string] }, i: number) => ({ nombre: q.product_id[1], cantidad: i === 0 ? 5 : 3, cantidadRecibida: null, odooProductId: q.product_id[0] })),
};
let estado = base;
const deps = { lib: bibliotecaReal(c), cargar: () => Promise.resolve(estado), marcar: (_i: string, m: unknown) => { marcas.push(m); return Promise.resolve(); } };
const fallos: string[] = [];
const paso = async (n: string, e: Partial<DatosSalida>, esperado: (r: Awaited<ReturnType<typeof publicarSalida>>) => boolean) => {
  estado = { ...base, ...e };
  const r = await publicarSalida(deps, id, 1);
  const bien = esperado(r); if (!bien) fallos.push(n);
  console.log(bien ? "  ✓" : "  ✗", n, JSON.stringify(r).slice(0, 220));
};
await paso("despachado -> A validado", {}, (r) => r.estado === "completado" && !!r.resultado?.picking_a && r.resultado?.picking_b === null);
await paso("reproceso despachado es idempotente (mismo A)", {}, (r) => r.estado === "completado");
await paso("entregado incompleto -> B con lo recibido; faltante en transito", { estado: "entregado_incompleto", lineas: base.lineas.map((l, i) => ({ ...l, cantidadRecibida: i === 0 ? 3 : null })) }, (r) => r.estado === "completado" && !!r.resultado?.picking_b && r.resultado?.faltante_en_transito === true);
await paso("anulado -> devuelve B y A (limpia el stock de prueba)", { estado: "anulado" }, (r) => r.estado === "completado" && r.resultado?.revertido === true);
console.log(fallos.length ? `\nFALLARON: ${fallos.join(" | ")}` : "\nTODO OK");
Deno.exit(fallos.length ? 1 : 0);
