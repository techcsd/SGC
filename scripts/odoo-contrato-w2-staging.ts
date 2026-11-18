// W2 (DS-17/DS-28/DS-29) prueba de CONTRATO contra Odoo STAGING real (la BD de SGC se simula; solo se escribe en Odoo).
// Todo lo creado lleva origin/nombre SGC-*-TEST-<run> y se REVIERTE al final (pickings devueltos, ajustes compensados, ubicacion archivada).
// Queda en staging, y se declara: 1-2 adjuntos `ir.attachment` en pickings de prueba ya revertidos (la politica del cliente no permite unlink)
// y 1 ubicacion de prueba archivada. El saldo de stock de WH, TA y transito del producto de prueba debe quedar igual al inicial.
//   deno run --allow-env --allow-net --allow-read scripts/odoo-contrato-w2-staging.ts
import { OdooClient, POLITICA_POR_DEFECTO } from "../supabase/functions/_shared/odoo-client.ts";
import { publicarSalida, type DatosSalida } from "../supabase/functions/_shared/odoo-salidas.ts";
import { bibliotecaReal } from "../supabase/functions/odoo-sync/salidas.ts";
import { publicarAjusteFaltante, refFaltante, type DatosAjusteFaltante } from "../supabase/functions/_shared/odoo-faltantes.ts";
import { aplicarAperturaBodega, refApertura, type DatosApertura } from "../supabase/functions/_shared/odoo-corte.ts";
import { ajustarArticulo, compensarAjuste } from "../supabase/functions/_shared/odoo-ajustes.ts";
import { adjuntarPdfAPicking, nombreAdjuntoConduce } from "../supabase/functions/_shared/odoo-adjuntos.ts";
import { buscarPickingPorOrigin, devolverTraslado } from "../supabase/functions/_shared/odoo-traslados.ts";

for (const l of Deno.readTextFileSync(".env.local").split(/\r?\n/)) {
  const m = l.match(/^(SGC_INTEGRATION_ODOO_[A-Z_]+)=(.*)$/); if (m) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
}
const url = Deno.env.get("SGC_INTEGRATION_ODOO_URL")!;
Deno.env.set("ODOO_HOSTS_ESCRITURA", new URL(url).host); // guardia de host (DS-02): solo staging
const politica = {
  lectura: { ...POLITICA_POR_DEFECTO.lectura, "stock.location": ["search_read", "read"] },
  escritura: { ...POLITICA_POR_DEFECTO.escritura, "stock.location": ["create", "write"] }, // SOLO este script crea la ubicacion de prueba
};
const c = new OdooClient({ url, db: Deno.env.get("SGC_INTEGRATION_ODOO_DB")!, user: Deno.env.get("SGC_INTEGRATION_ODOO_USER")!, apiKey: Deno.env.get("SGC_INTEGRATION_ODOO_API_KEY")!, companyId: 1, politica });

const run = Date.now().toString(36);
const fallos: string[] = [];
const ok = (n: string, b: boolean, extra = "") => { console.log(b ? "  ✓" : "  ✗", n, extra); if (!b) fallos.push(n); };
const saldo = async (loc: number, prod: number) => (await c.call("stock.quant", "search_read", [[["location_id", "=", loc], ["product_id", "=", prod]]], { fields: ["quantity"] })).reduce((s: number, q: { quantity: number }) => s + q.quantity, 0);
const marcar = () => Promise.resolve();

const [wh] = await c.call("stock.warehouse", "search_read", [[["code", "=", "WH"]]], { fields: ["id", "lot_stock_id"] });
const [ta] = await c.call("stock.warehouse", "search_read", [[["code", "=", "TA"]]], { fields: ["id", "lot_stock_id"] });
const WHS = wh.lot_stock_id[0]; const TAS = ta.lot_stock_id[0];
const [q0] = await c.call("stock.quant", "search_read", [[["location_id", "=", WHS], ["quantity", ">=", 30]]], { fields: ["product_id", "quantity"], limit: 1 });
const prod = q0.product_id[0]; const prodNombre = q0.product_id[1];
const lib = bibliotecaReal(c);
const TRANSITO = await lib.transitoLocationId();
const [s0, t0, tr0] = [await saldo(WHS, prod), await saldo(TAS, prod), await saldo(TRANSITO, prod)];
console.log(`Producto de prueba con stock en WH: ${prodNombre}`);

/** Crea y publica un conduce entregado incompleto (5 enviados, 3 recibidos -> 2 en transito). Devuelve su estado de datos. */
async function conduceIncompleto(id: string) {
  const sal: DatosSalida = { id, folio: `CND-${id}`, estado: "entregado_incompleto", esPrueba: false, paradaEntregada: true, companyId: 1, origenLocationId: WHS, origenWarehouseId: wh.id, destinoLocationId: TAS,
    lineas: [{ nombre: prodNombre, cantidad: 5, cantidadRecibida: 3, odooProductId: prod }] };
  const adjuntos: string[] = [];
  const r = await publicarSalida({ lib, cargar: () => Promise.resolve(sal), marcar, adjuntarPdf: (pid, paso) => { adjuntos.push(`${paso}:${pid}`); return Promise.resolve(null); } }, id, 1);
  return { sal, r, adjuntos };
}
const dFal = (id: string, sid: string, solId: string, extra: Partial<DatosAjusteFaltante>): DatosAjusteFaltante => ({
  id: solId, salidaId: sid, folio: `CND-${sid}`, estado: "rechazada", accion: "devolver_transito", esPrueba: false, faltante: 2, articuloNombre: prodNombre, odooProductId: prod,
  origenLocationId: WHS, origenWarehouseId: wh.id, companyId: 1, ...extra,
});
const depsFal = (d: DatosAjusteFaltante) => ({ c, lib, cargar: () => Promise.resolve(d), marcar });

// ── DS-17 rechazo: faltante en transito -> devuelto al ORIGEN ─────────────────────────────────────────────────────────────
console.log("DS-17 faltante: devolucion transito -> origen");
const idR = `TEST-${run}-FR`; const solR = `${run}0000000000`;
const R = await conduceIncompleto(idR);
ok("conduce incompleto publicado: A(5) y B(3); faltante 2 en transito", R.r.estado === "completado" && R.r.resultado?.faltante_en_transito === true && (await saldo(WHS, prod)) === s0 - 5 && (await saldo(TAS, prod)) === t0 + 3 && (await saldo(TRANSITO, prod)) === tr0 + 2,
  `WH=${await saldo(WHS, prod) - s0} TA=${await saldo(TAS, prod) - t0} TR=${await saldo(TRANSITO, prod) - tr0}`);
const dR = dFal("r", idR, solR, { accion: "devolver_transito" });
const dev1 = await publicarAjusteFaltante(depsFal({ ...dR, estado: "pendiente", accion: null }), solR, 1);
ok("solicitud pendiente: no toca Odoo", dev1.resultado?.omitido === "sin_decision" && (await saldo(WHS, prod)) === s0 - 5);
const exceso = await publicarAjusteFaltante(depsFal({ ...dR, faltante: 3 }), solR, 1);
ok("faltante mayor que lo que hay en transito: rechazado con mensaje, sin escribir", exceso.estado === "error" && (exceso.error ?? "").includes("mayor que lo que ese conduce dejó") && (await saldo(WHS, prod)) === s0 - 5, (exceso.error ?? "").slice(0, 70));
const dev2 = await publicarAjusteFaltante(depsFal(dR), solR, 1);
const pF = await buscarPickingPorOrigin(c, refFaltante(idR, solR));
ok("rechazo: picking transito -> origen validado; WH recupera 2, transito vuelve al inicial", dev2.estado === "completado" && pF?.state === "done" && (await saldo(WHS, prod)) === s0 - 3 && (await saldo(TRANSITO, prod)) === tr0, JSON.stringify(dev2.resultado));
await publicarAjusteFaltante(depsFal(dR), solR, 2);
ok("reintento: un solo efecto (sin segundo picking ni saldo extra)", (await saldo(WHS, prod)) === s0 - 3 && (await c.call("stock.picking", "search_read", [[["origin", "=like", `SGC-TRAS-${idR}-F%`]]], { fields: ["id"] })).length === 1);

// ── DS-28 aprobacion: baja del faltante desde transito ───────────────────────────────────────────────────────────────────
console.log("DS-28 faltante: baja desde transito (ajuste aprobado)");
const idA = `TEST-${run}-FA`; const solA = `${run}1111111111`;
const A = await conduceIncompleto(idA);
ok("segundo conduce incompleto: faltante 2 en transito", A.r.estado === "completado" && (await saldo(TRANSITO, prod)) === tr0 + 2);
const dA = dFal("a", idA, solA, { estado: "aprobada", accion: "ajuste" });
const ap = await publicarAjusteFaltante(depsFal(dA), solA, 1);
ok("aprobado: baja de 2 en transito con la accion de inventario (transito vuelve al inicial, WH/TA sin cambio)", ap.estado === "completado" && (await saldo(TRANSITO, prod)) === tr0 && (await saldo(WHS, prod)) === s0 - 8 && (await saldo(TAS, prod)) === t0 + 6,
  `estado=${ap.estado} error=${ap.error ?? ""} TR=${await saldo(TRANSITO, prod) - tr0}`);
await publicarAjusteFaltante(depsFal(dA), solA, 2);
ok("reintento de la baja: un solo efecto", (await saldo(TRANSITO, prod)) === tr0);

// ── DS-28 adjunto: PDF firmado como ir.attachment del picking ────────────────────────────────────────────────────────────────
console.log("DS-28 adjunto PDF al picking");
const pickA = await buscarPickingPorOrigin(c, `SGC-TRAS-${idA}-A`);
const pdf = btoa("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const nombrePdf = nombreAdjuntoConduce(`CND-${idA}`, "A");
const a1 = await adjuntarPdfAPicking(c, pickA!.id, { nombre: nombrePdf, base64: pdf });
const a2 = await adjuntarPdfAPicking(c, pickA!.id, { nombre: nombrePdf, base64: pdf });
const regs = await c.call("ir.attachment", "search_read", [[["res_model", "=", "stock.picking"], ["res_id", "=", pickA!.id]]], { fields: ["name", "mimetype"] });
ok("adjunto creado una vez y sin duplicar al repetir", a1.creado && !a2.creado && a1.id === a2.id && regs.length === 1 && regs[0].mimetype === "application/pdf", `adjuntos=${regs.length} mime=${regs[0]?.mimetype}`);

// ── DS-29 apertura en una ubicacion de prueba (jamas en el stock real) ──────────────────────────────────────────────────────────
console.log("DS-29 apertura por bodega");
const [padre] = await c.call("stock.location", "read", [[WHS]], { fields: ["location_id"] });
const loc = await c.call("stock.location", "create", [{ name: `SGC-TEST-APERT-${run}`, usage: "internal", location_id: padre.location_id[0], company_id: 1 }]);
const [otro] = await c.call("stock.quant", "search_read", [[["location_id", "=", WHS], ["quantity", ">=", 1], ["product_id", "!=", prod]]], { fields: ["product_id"], limit: 1 });
const prod2 = otro.product_id[0];
await ajustarArticulo(c, { nombre: `SGC-TEST-PREP-${run}`, locationId: loc, productId: prod2, objetivo: 3 }); // algo que SGC no gestiona (solo-Odoo)
await ajustarArticulo(c, { nombre: `SGC-TEST-PREP-${run}`, locationId: loc, productId: prod, objetivo: 4 });
const bodegaId = `TEST-${run}-BOD`;
const datos: DatosApertura = { fase_corte: true, configurada: true, fecha_corte: new Date().toISOString().slice(0, 10), apertura_hecha: false, hoy: new Date().toISOString().slice(0, 10), location_id: loc, saldos: [{ odoo_product_id: prod, cantidad: 6 }] };
const plan = await aplicarAperturaBodega(c, bodegaId, datos, "plan", 1);
ok("plan: ajuste +2 del homologado, 1 producto solo-Odoo sin tocar, sin escribir", plan.ajustes.length === 1 && plan.ajustes[0].delta === 2 && plan.solo_odoo === 1 && (await saldo(loc, prod)) === 4);
const apl = await aplicarAperturaBodega(c, bodegaId, datos, "aplicar", 1);
ok("aplicar: saldo de la bodega de prueba = SGC (6); el solo-Odoo sigue en 3", apl.aplicadas === 1 && (await saldo(loc, prod)) === 6 && (await saldo(loc, prod2)) === 3, JSON.stringify({ aplicadas: apl.aplicadas }));
const apl2 = await aplicarAperturaBodega(c, bodegaId, datos, "aplicar", 1);
ok("repetir la apertura: sin cambios (un solo efecto)", apl2.ajustes.length === 0 && (await saldo(loc, prod)) === 6);
const fase = await aplicarAperturaBodega(c, bodegaId, { ...datos, fase_corte: false }, "aplicar").then(() => "paso", (e) => (e as Error).message);
ok("fase de corte apagada: rechaza", fase.includes("apagada"));

// ── Limpieza ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("Limpieza");
await ajustarArticulo(c, { nombre: `SGC-TEST-LIMPIA-${run}`, locationId: loc, productId: prod, objetivo: 0 });
await ajustarArticulo(c, { nombre: `SGC-TEST-LIMPIA-${run}`, locationId: loc, productId: prod2, objetivo: 0 });
await c.call("stock.location", "write", [[loc], { active: false }]);
// 1) revertir la baja (aprobacion): +2 en transito
await compensarAjuste(c, { ref: `${refFaltante(idA, solA)}-AJ`, locationId: TRANSITO });
// 2) revertir la devolucion de faltante (WH -> transito)
await devolverTraslado(c, pF!.id, { salidaId: `${idR}-F`, paso: "B", companyId: 1 });
// 3) compensar los dos conduces (real -> prueba: devuelve B y A)
for (const [id, base] of [[idR, R.sal], [idA, A.sal]] as Array<[string, DatosSalida]>) {
  await publicarSalida({ lib, cargar: () => Promise.resolve({ ...base, esPrueba: true }), marcar }, id, 1);
}
const [s1, t1, tr1, lw] = [await saldo(WHS, prod), await saldo(TAS, prod), await saldo(TRANSITO, prod), await saldo(loc, prod)];
ok("limpieza: WH, TA, transito y la ubicacion de prueba = inicial", s1 === s0 && t1 === t0 && tr1 === tr0 && lw === 0, `WH=${s1 - s0} TA=${t1 - t0} TR=${tr1 - tr0} loc=${lw}`);
void refApertura;

console.log(fallos.length ? `\nFALLARON: ${fallos.join(" | ")}` : "\nTODO OK");
Deno.exit(fallos.length ? 1 : 0);
