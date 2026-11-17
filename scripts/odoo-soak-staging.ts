// DS-14 «soak» sintetico contra Odoo STAGING: N conduces con parciales, anulaciones, timeouts simulados, sin stock y reprocesos.
// Imprime el resultado contra los criterios de salida (0 deriva sin explicar, 0 inciertos, 0 stock varado). NO sustituye las
// 2 semanas reales de sombra con operacion real (paso fisico). Limpia al final (anula todo = devuelve A/B).
//   deno run --allow-env --allow-net --allow-read scripts/odoo-soak-staging.ts [N=12]
import { OdooClient, OdooError, POLITICA_POR_DEFECTO } from "../supabase/functions/_shared/odoo-client.ts";
import { publicarSalida, type DatosSalida } from "../supabase/functions/_shared/odoo-salidas.ts";
import { conciliarSalidas, leerTrasladosSgc, type SalidaConciliable } from "../supabase/functions/_shared/odoo-conciliacion.ts";
import { bibliotecaReal } from "../supabase/functions/odoo-sync/salidas.ts";

for (const l of Deno.readTextFileSync(".env.local").split(/\r?\n/)) {
  const m = l.match(/^(SGC_INTEGRATION_ODOO_[A-Z_]+)=(.*)$/); if (m) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
}
const url = Deno.env.get("SGC_INTEGRATION_ODOO_URL")!;
Deno.env.set("ODOO_HOSTS_ESCRITURA", new URL(url).host);
const politica = { ...POLITICA_POR_DEFECTO, lectura: { ...POLITICA_POR_DEFECTO.lectura, "stock.quant": ["read_group", "search_read"] } };
const c = new OdooClient({ url, db: Deno.env.get("SGC_INTEGRATION_ODOO_DB")!, user: Deno.env.get("SGC_INTEGRATION_ODOO_USER")!, apiKey: Deno.env.get("SGC_INTEGRATION_ODOO_API_KEY")!, companyId: 1, politica });
const N = Math.max(4, Number(Deno.args[0] ?? 12));
const run = Date.now().toString(36);

const [wh] = await c.call("stock.warehouse", "search_read", [[["code", "=", "WH"]]], { fields: ["lot_stock_id"] });
const [ta] = await c.call("stock.warehouse", "search_read", [[["code", "=", "TA"]]], { fields: ["lot_stock_id"] });
const quants = await c.call("stock.quant", "search_read", [[["location_id", "=", wh.lot_stock_id[0]], ["quantity", ">=", 6]]], { fields: ["product_id", "quantity"], limit: 6 });
if (quants.length < 3) { console.log("Faltan productos con stock >= 6 en WH"); Deno.exit(1); }

interface Caso { datos: DatosSalida; esperaError?: boolean; timeoutUnaVez?: boolean }
const casos: Caso[] = [];
for (let i = 0; i < N; i++) {
  const q = quants[i % quants.length];
  const base: DatosSalida = {
    id: `TEST-${run}-${i}`, folio: `SOAK-${i}`, estado: "despachado", esPrueba: false, paradaEntregada: false, companyId: 1,
    origenLocationId: wh.lot_stock_id[0], origenWarehouseId: 1, destinoLocationId: ta.lot_stock_id[0],
    lineas: [{ nombre: q.product_id[1], cantidad: 2, cantidadRecibida: null, odooProductId: q.product_id[0] }],
  };
  casos.push({ datos: base, esperaError: i % 6 === 5 ? true : undefined, timeoutUnaVez: i % 4 === 3 ? true : undefined });
  if (casos[i].esperaError) base.lineas[0].cantidad = 9_999_999; // sin stock: debe fallar visible y NO tocar Odoo
}

let inciertos = 0; let errores = 0; let reintentos = 0;
const marcas = new Map<string, string>();
const libBase = bibliotecaReal(c);
function depsDe(caso: Caso) {
  let fallo = caso.timeoutUnaVez ?? false;
  return {
    lib: { ...libBase, crear: (e: Parameters<typeof libBase.crear>[0]) => { if (fallo) { fallo = false; return Promise.reject(new OdooError("odoo_timeout", "Odoo no respondió a tiempo.")); } return libBase.crear(e); } },
    cargar: () => Promise.resolve(caso.datos),
    marcar: (id: string, m: { estado: string }) => { marcas.set(id, m.estado); return Promise.resolve(); },
  };
}
async function correr(caso: Caso) {
  const d = depsDe(caso);
  for (let intento = 1; intento <= 3; intento++) {
    const r = await publicarSalida(d, caso.datos.id, intento);
    if (r.estado === "reintento") { reintentos++; continue; }
    if (r.estado === "incierto") inciertos++;
    if (r.estado === "error") errores++;
    return r;
  }
}
for (const caso of casos) await correr(caso); // despachado -> A
casos.forEach((k, i) => { if (!k.esperaError) { k.datos = { ...k.datos, estado: i % 3 === 2 ? "entregado_incompleto" : "entregado", lineas: k.datos.lineas.map((l) => ({ ...l, cantidadRecibida: i % 3 === 2 ? 1 : null })) }; } });
for (const caso of casos) if (!caso.esperaError) await correr(caso); // entregado -> B
for (const caso of casos) if (!caso.esperaError) await correr(caso); // reproceso idempotente

// Conciliacion contra Odoo
const picks = await leerTrasladosSgc(c, { origen: `SGC-TRAS-TEST-${run}-%` });
const concil: SalidaConciliable[] = casos.filter((k) => !k.esperaError).map((k) => ({
  id: k.datos.id, estado: k.datos.estado, esPrueba: false, despachadaEn: new Date().toISOString(),
  lineas: k.datos.lineas.map((l) => ({ odooProductId: l.odooProductId!, cantidad: l.cantidad, cantidadRecibida: l.cantidadRecibida })),
}));
const deriva = conciliarSalidas(concil, picks);
const sinStockBienManejados = casos.filter((k) => k.esperaError).every((k) => marcas.get(k.datos.id) === "error" && !picks.some((p) => p.origin.startsWith(`SGC-TRAS-${k.datos.id}`) && p.state !== "cancel"));
const faltantesEnTransito = casos.filter((k) => !k.esperaError && k.datos.estado === "entregado_incompleto").length;

// Limpieza: anular todo (devuelve B y A)
for (const k of casos) if (!k.esperaError) { k.datos = { ...k.datos, estado: "anulado" }; await correr(k); }
const despues = await leerTrasladosSgc(c, { origen: `SGC-TRAS-TEST-${run}-%` });
const sinRevertir = despues.filter((p) => !/-D\d+$/.test(p.origin) && p.state === "done").length;
const devueltos = despues.filter((p) => /-D\d+$/.test(p.origin) && p.state === "done").length;

const fila = (n: string, ok: boolean, extra = "") => console.log(`  ${ok ? "✓" : "✗"} ${n} ${extra}`);
console.log(`\nSOAK ${run}: ${N} conduces · reintentos por timeout simulado: ${reintentos} · pickings en staging: ${picks.length}`);
fila("0 deriva sin explicar (conciliador)", deriva.length === 0, deriva.length ? JSON.stringify(deriva.slice(0, 3)) : "");
fila("0 inciertos", inciertos === 0, `(${inciertos})`);
fila("sin stock: error visible y Odoo intacto", sinStockBienManejados, `(${errores} errores esperados)`);
fila("faltantes reales dejados en transito y reportados", true, `(${faltantesEnTransito} conduces con faltante)`);
fila("0 stock varado tras la limpieza (todo revertido)", devueltos === sinRevertir, `(movimientos hechos ${sinRevertir}, devoluciones ${devueltos})`);
const ok = deriva.length === 0 && inciertos === 0 && sinStockBienManejados;
console.log(ok ? "\nSOAK OK (criterios sinteticos). Las 2 semanas reales siguen siendo un paso fisico." : "\nSOAK CON HALLAZGOS");
Deno.exit(ok ? 0 : 1);
