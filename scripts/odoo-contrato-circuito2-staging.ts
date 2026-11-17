// DS-16..DS-22 prueba de CONTRATO del circuito 2 contra Odoo STAGING real (la BD de SGC se simula; solo se escribe en Odoo).
// Todo lo creado lleva origin/nombre SGC-*-TEST-<run> y se REVIERTE al final (recepciones devueltas, ajustes compensados, retiro devuelto).
// Queda en staging: 1 OC de prueba confirmada (una OC confirmada no se puede cancelar desde SGC, ver DS-15) y 1 ubicacion de prueba archivada.
//   deno run --allow-env --allow-net --allow-read scripts/odoo-contrato-circuito2-staging.ts
import { OdooClient, POLITICA_POR_DEFECTO } from "../supabase/functions/_shared/odoo-client.ts";
import { crearAdaptadoresOcReales } from "../supabase/functions/_shared/odoo-oc.ts";
import { publicarEntrada, recibirOc, type DatosEntrada } from "../supabase/functions/_shared/odoo-recepciones.ts";
import { compensarAjuste, publicarConteo, refAjuste, type DatosConteo } from "../supabase/functions/_shared/odoo-ajustes.ts";
import { publicarRetiro, originRetiro, type DatosRetiro } from "../supabase/functions/_shared/odoo-retiros.ts";
import { publicarSalida, type DatosSalida } from "../supabase/functions/_shared/odoo-salidas.ts";
import { bibliotecaReal } from "../supabase/functions/odoo-sync/salidas.ts";
import { buscarPickingPorOrigin, devolverTraslado } from "../supabase/functions/_shared/odoo-traslados.ts";

for (const l of Deno.readTextFileSync(".env.local").split(/\r?\n/)) {
  const m = l.match(/^(SGC_INTEGRATION_ODOO_[A-Z_]+)=(.*)$/); if (m) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
}
const url = Deno.env.get("SGC_INTEGRATION_ODOO_URL")!;
Deno.env.set("ODOO_HOSTS_ESCRITURA", new URL(url).host); // la guardia de host (DS-02): solo staging
const politica = {
  lectura: { ...POLITICA_POR_DEFECTO.lectura, "stock.location": ["search_read", "read"], "purchase.order.line": ["search_read"], "account.analytic.account": ["search_read"] },
  escritura: { ...POLITICA_POR_DEFECTO.escritura, "stock.location": ["create", "write"] }, // SOLO este script puede crear la ubicacion de prueba
};
const c = new OdooClient({ url, db: Deno.env.get("SGC_INTEGRATION_ODOO_DB")!, user: Deno.env.get("SGC_INTEGRATION_ODOO_USER")!, apiKey: Deno.env.get("SGC_INTEGRATION_ODOO_API_KEY")!, companyId: 1, politica });

const run = Date.now().toString(36);
const fallos: string[] = [];
const ok = (n: string, b: boolean, extra = "") => { console.log(b ? "  ✓" : "  ✗", n, extra); if (!b) fallos.push(n); };
const saldo = async (loc: number, prod: number) => (await c.call("stock.quant", "search_read", [[["location_id", "=", loc], ["product_id", "=", prod]]], { fields: ["quantity"] })).reduce((s: number, q: { quantity: number }) => s + q.quantity, 0);

const [wh] = await c.call("stock.warehouse", "search_read", [[["code", "=", "WH"]]], { fields: ["id", "lot_stock_id", "in_type_id"] });
const [ta] = await c.call("stock.warehouse", "search_read", [[["code", "=", "TA"]]], { fields: ["id", "lot_stock_id"] });
const WHS = wh.lot_stock_id[0]; const TAS = ta.lot_stock_id[0];
const [q0] = await c.call("stock.quant", "search_read", [[["location_id", "=", WHS], ["quantity", ">=", 20]]], { fields: ["product_id", "quantity"], limit: 1 });
const prod = q0.product_id[0]; const prodNombre = q0.product_id[1];
console.log(`Producto de prueba con stock en WH: ${prodNombre}`);
const s0 = await saldo(WHS, prod);

// ── DS-16: OC -> recepcion parcial -> segunda recepcion -> reintento -> rechazo ─────────────────────────────────────────────
console.log("DS-16 recepciones sobre la OC");
const ad = crearAdaptadoresOcReales(() => c);
const [prov] = await c.call("res.partner", "search_read", [[["supplier_rank", ">", 0]]], { fields: ["id"], limit: 1 });
const oc = await ad.crear({
  orden_id: `test-${run}`, numero: `CIRC2-${run}`, odoo_proveedor_id: prov.id, odoo_analytic_id: 23, odoo_entorno: "dev",
  fecha: new Date().toISOString().slice(0, 10), notas: "Prueba de contrato circuito 2 (se devuelve)", lineas: [{ odoo_product_id: prod, cantidad: 10, precio_unitario: 1, descripcion: prodNombre }],
});
ok("OC de prueba creada", oc.estado === "completado");
const ocId = (oc.resultado as { odoo_id: number }).odoo_id;
let sinConfirmar = "";
try { await recibirOc(c, { ocId, entradaId: `E0-${run}`, lineas: [{ productId: prod, cantidad: 1 }] }); } catch (e) { sinConfirmar = (e as Error).message; }
ok("recibir una OC en borrador se rechaza con mensaje", sinConfirmar.includes("no está confirmada"), sinConfirmar.slice(0, 60));
const conf = await ad.confirmar({ odoo_id: ocId });
ok("OC confirmada (genera la recepcion)", conf.estado === "completado");
const r1 = await recibirOc(c, { ocId, entradaId: `E1-${run}`, lineas: [{ productId: prod, cantidad: 6 }] });
ok("recepcion PARCIAL 6 de 10 -> backorder", r1.parcial && !!r1.backorderId, JSON.stringify(r1));
ok("el stock subio exactamente 6", (await saldo(WHS, prod)) - s0 === 6);
const r1b = await recibirOc(c, { ocId, entradaId: `E1-${run}`, lineas: [{ productId: prod, cantidad: 6 }] });
ok("reintento de la misma entrada NO suma de nuevo", r1b.reutilizado && (await saldo(WHS, prod)) - s0 === 6);
let exceso = "";
try { await recibirOc(c, { ocId, entradaId: `E2x-${run}`, lineas: [{ productId: prod, cantidad: 9 }] }); } catch (e) { exceso = (e as Error).message; }
ok("recibir mas de lo pendiente se rechaza sin escribir", exceso.includes("más de lo pedido") && (await saldo(WHS, prod)) - s0 === 6, exceso.slice(0, 50));
const r2 = await recibirOc(c, { ocId, entradaId: `E2-${run}`, lineas: [{ productId: prod, cantidad: 4 }] });
ok("2.a recepcion (4) cierra la OC sobre el backorder", !r2.parcial && r2.pickingId === r1.backorderId && (await saldo(WHS, prod)) - s0 === 10);
// limpieza: devolver las dos recepciones al proveedor
for (const p of [r1.pickingId, r2.pickingId]) await devolverTraslado(c, p, { salidaId: `CIRC2-${run}-REC`, paso: p === r1.pickingId ? "A" : "B", companyId: 1 });
ok("limpieza: recepciones devueltas, saldo = inicial", (await saldo(WHS, prod)) === s0);

// ── DS-16/DS-19 publicarEntrada: pendiente/rechazada no tocan Odoo; recepcion libre y su compensacion por prueba ───────────────
console.log("DS-16/DS-19 publicarEntrada");
const marcas: unknown[] = []; const marcar = (_i: string, m: unknown) => { marcas.push(m); return Promise.resolve(); };
const entBase: DatosEntrada = { id: `ENT-${run}`, esPrueba: false, pendienteConfirmacion: false, rechazada: false, origenTipo: "compra", ordenCompraId: null, ocOdooId: null, salidaId: null,
  bodegaLocationId: WHS, bodegaWarehouseId: wh.id, lineas: [{ nombre: prodNombre, cantidad: 2, odooProductId: prod }], pickingIdPrevio: null, companyId: 1 };
let ent = { ...entBase, pendienteConfirmacion: true };
const dE = { c, cargar: () => Promise.resolve(ent), marcar, encolarSalida: () => Promise.resolve() };
const pen = await publicarEntrada(dE, ent.id, 1);
ok("entrada pendiente de confirmacion: no toca Odoo", pen.resultado?.omitido === "pendiente_confirmacion" && (await saldo(WHS, prod)) === s0);
ent = { ...entBase };
const lib1 = await publicarEntrada(dE, ent.id, 1);
const pLibre = await buscarPickingPorOrigin(c, `SGC-ENT-${ent.id}`);
ok("recepcion libre (sin OC): +2 en el almacen, idempotente", lib1.estado === "completado" && pLibre?.state === "done" && (await saldo(WHS, prod)) === s0 + 2);
await publicarEntrada(dE, ent.id, 2);
ok("reintento de la libre no suma", (await saldo(WHS, prod)) === s0 + 2);
ent = { ...entBase, esPrueba: true, pickingIdPrevio: pLibre!.id };
const comp = await publicarEntrada(dE, ent.id, 1);
ok("real -> prueba: se COMPENSA en Odoo (saldo = inicial)", comp.resultado?.omitido === "es_prueba_compensado" && (await saldo(WHS, prod)) === s0);

// ── DS-17/DS-19: salida A -> entrada ligada confirma B -> real->prueba compensa ──────────────────────────────────────────────
console.log("DS-17/DS-19 salida + entrada ligada");
const idS = `TEST-${run}-SAL`;
let sal: DatosSalida = { id: idS, folio: `CND-${run}`, estado: "despachado", esPrueba: false, paradaEntregada: false, companyId: 1, origenLocationId: WHS, origenWarehouseId: wh.id, destinoLocationId: TAS,
  lineas: [{ nombre: prodNombre, cantidad: 3, cantidadRecibida: null, odooProductId: prod }] };
const dS = { lib: bibliotecaReal(c), cargar: () => Promise.resolve(sal), marcar };
const a1 = await publicarSalida(dS, idS, 1);
ok("despachado -> A (origen -> transito)", a1.estado === "completado" && (await saldo(WHS, prod)) === s0 - 3);
sal = { ...sal, entradaConfirmada: true };
const b1 = await publicarSalida(dS, idS, 1);
ok("entrada ligada confirmada -> B (transito -> destino), sin recepcion de proveedor", b1.estado === "completado" && !!b1.resultado?.picking_b && (await saldo(TAS, prod)) >= 3);
// DS-20: una linea anadida despues de publicar genera complemento (sin duplicar A)
sal = { ...sal, lineas: [...sal.lineas, { nombre: prodNombre + " (libre)", cantidad: 1, cantidadRecibida: null, odooProductId: prod }] };
const c1 = await publicarSalida(dS, idS, 1);
ok("DS-20: linea regularizada despues -> complemento A-C/B-C", c1.estado === "completado" && !!c1.resultado?.picking_a_complemento && !!c1.resultado?.picking_b_complemento, JSON.stringify(c1.resultado).slice(0, 120));
const c2 = await publicarSalida(dS, idS, 2);
const nComp = (await c.call("stock.picking", "search_read", [[["origin", "=like", `SGC-TRAS-${idS}-A-C%`]]], { fields: ["id"] })).length;
ok("DS-20: reintento no duplica el complemento", c2.estado === "completado" && nComp === 1, `complementos A-C=${nComp}`);
sal = { ...sal, esPrueba: true };
const rv = await publicarSalida(dS, idS, 1);
ok("DS-19: real -> prueba compensa A y B (saldo WH = inicial)", rv.resultado?.por === "es_prueba" && (await saldo(WHS, prod)) === s0, `saldo=${await saldo(WHS, prod)} inicial=${s0}`);

// ── DS-22: ajuste por conteo aplicado y deshacer ────────────────────────────────────────────────────────────────────────────
console.log("DS-22 conteos / ajustes");
const idC = `CONT-${run}`;
let conteo: DatosConteo = { id: idC, tipo: "conteo_fisico", estado: "borrador", esPrueba: false, bodegaLocationId: WHS, lineas: [{ nombre: prodNombre, odooProductId: prod, cantidadContada: s0 + 2 }] };
const dC = { c, cargar: () => Promise.resolve(conteo), marcar };
ok("conteo en borrador NO publica", (await publicarConteo(dC, idC, 1)).resultado?.omitido === "no_aplicado" && (await saldo(WHS, prod)) === s0);
conteo = { ...conteo, estado: "aplicado" };
const ap = await publicarConteo(dC, idC, 1);
ok("conteo aplicado: saldo = contado (accion de negocio de Odoo)", ap.estado === "completado" && (await saldo(WHS, prod)) === s0 + 2);
await publicarConteo(dC, idC, 2);
ok("repetir el lote: un solo efecto", (await saldo(WHS, prod)) === s0 + 2);
conteo = { ...conteo, estado: "cancelado" };
const un = await publicarConteo(dC, idC, 1);
ok("deshacer: compensa el delta (saldo = inicial)", un.estado === "completado" && (await saldo(WHS, prod)) === s0);
const nada = await compensarAjuste(c, { ref: refAjuste(idC), locationId: WHS });
ok("deshacer es idempotente", nada.every((x) => x.estado === "reutilizada") && (await saldo(WHS, prod)) === s0);

// ── DS-21: retiro -> cuarentena (ubicacion de prueba) -> descarte; se revierte ──────────────────────────────────────────────────
console.log("DS-21 retiros / cuarentena");
const [padre] = await c.call("stock.location", "read", [[WHS]], { fields: ["location_id"] });
const cuar = await c.call("stock.location", "create", [{ name: `SGC-TEST-CUARENTENA-${run}`, usage: "internal", location_id: padre.location_id[0], company_id: 1 }]);
const idR = `RET-${run}`;
let ret: DatosRetiro = { id: idR, folio: `RET-${run}`, estado: "pendiente", esPrueba: false, disposicion: null, items: [{ nombre: prodNombre, cantidad: 2, odooProductId: prod }],
  obraLocationId: WHS /* el almacen de la obra: aqui WH hace de origen con existencias */, destinoWarehouseId: wh.id, destinoStockLocationId: TAS, cuarentenaLocationId: cuar, companyId: 1 };
const dR = { c, cargar: () => Promise.resolve(ret), marcar };
ok("retiro solo solicitado: no publica", (await publicarRetiro(dR, idR, 1)).resultado?.omitido === "sin_hecho_fisico");
ret = { ...ret, estado: "en_cuarentena" };
const rq = await publicarRetiro(dR, idR, 1);
ok("recibido: obra -> cuarentena (sale del origen, no es material nuevo)", rq.estado === "completado" && (await saldo(WHS, prod)) === s0 - 2 && (await saldo(cuar, prod)) === 2);
await publicarRetiro(dR, idR, 2);
ok("reintento no duplica cuarentena", (await saldo(cuar, prod)) === 2);
ret = { ...ret, estado: "dispuesta", disposicion: "descarte" };
const ds = await publicarRetiro(dR, idR, 1);
ok("descarte: cuarentena -> desecho", ds.estado === "completado" && (await saldo(cuar, prod)) === 0, JSON.stringify(ds.resultado));
// limpieza: devolver desecho -> cuarentena y cuarentena -> obra
const pDisp = await buscarPickingPorOrigin(c, originRetiro(idR, "DISP")); const pIn = await buscarPickingPorOrigin(c, originRetiro(idR, "IN"));
await devolverTraslado(c, pDisp!.id, { salidaId: idR, paso: "B", companyId: 1 });
await devolverTraslado(c, pIn!.id, { salidaId: idR, paso: "A", companyId: 1 });
ok("limpieza: saldo WH = inicial y cuarentena vacia", (await saldo(WHS, prod)) === s0 && (await saldo(cuar, prod)) === 0, `WH=${await saldo(WHS, prod)} inicial=${s0}`);
await c.call("stock.location", "write", [[cuar], { active: false }]);

console.log(fallos.length ? `\nFALLARON: ${fallos.join(" | ")}` : "\nTODO OK");
Deno.exit(fallos.length ? 1 : 0);
