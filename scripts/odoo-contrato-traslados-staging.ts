// DS-10 prueba de CONTRATO contra Odoo STAGING (Deno). Crea pickings con origin SGC-TRAS-TEST-<run>, los valida y los revierte.
// Solo staging: la guardia de host exige ODOO_HOSTS_ESCRITURA (se toma del host de SGC_INTEGRATION_ODOO_URL).
//   deno run --allow-env --allow-net --allow-read scripts/odoo-contrato-traslados-staging.ts
import { OdooClient, POLITICA_POR_DEFECTO } from "../supabase/functions/_shared/odoo-client.ts";
import { buscarPickingPorOrigin, cancelarTraslado, crearTraslado, devolverTraslado, obtenerTraslado, originTraslado, publicarNotaPicking, resolverAutorOdoo, TrasladoError, validarTraslado } from "../supabase/functions/_shared/odoo-traslados.ts";

// carga de .env.local (sin imprimir valores)
for (const l of Deno.readTextFileSync(".env.local").split(/\r?\n/)) {
  const m = l.match(/^(SGC_INTEGRATION_ODOO_[A-Z_]+)=(.*)$/);
  if (m) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
}
const url = Deno.env.get("SGC_INTEGRATION_ODOO_URL")!;
Deno.env.set("ODOO_HOSTS_ESCRITURA", new URL(url).host);
const politica = { ...POLITICA_POR_DEFECTO, lectura: { ...POLITICA_POR_DEFECTO.lectura, "stock.quant": ["read_group", "search_read"] } };
const c = new OdooClient({ url, db: Deno.env.get("SGC_INTEGRATION_ODOO_DB")!, user: Deno.env.get("SGC_INTEGRATION_ODOO_USER")!, apiKey: Deno.env.get("SGC_INTEGRATION_ODOO_API_KEY")!, companyId: 1, politica });

const run = Date.now().toString(36);
const ok = (m: string) => console.log("  ✓", m);
const fallo: string[] = [];
const prueba = async (nombre: string, f: () => Promise<void>) => { try { await f(); ok(nombre); } catch (e) { fallo.push(nombre); console.log("  ✗", nombre, "->", e instanceof Error ? e.message : e, e instanceof TrasladoError ? `[${e.codigo}] causa=${e.causa}` : ""); } };

// Datos de staging: almacen WH (stock 8), tipo interno, transito, un producto con stock suficiente
const [wh] = await c.call("stock.warehouse", "search_read", [[["code", "=", "WH"]]], { fields: ["lot_stock_id", "int_type_id"] });
const [transito] = await c.call("stock.location", "search_read", [[["usage", "=", "transit"]]], { fields: ["id"] }).catch(async () => [{ id: 13 }]);
const ORIGEN = wh.lot_stock_id[0];
const TRANSITO = transito?.id ?? 13;
const TIPO = wh.int_type_id[0];
const [destWh] = await c.call("stock.warehouse", "search_read", [[["code", "=", "TA"]]], { fields: ["lot_stock_id"] });
const DESTINO = destWh.lot_stock_id[0];
const quants = await c.call("stock.quant", "search_read", [[["location_id", "=", ORIGEN], ["quantity", ">=", 5]]], { fields: ["product_id", "quantity"], limit: 1 });
const prod = quants[0];
console.log(`run=${run} origen=${ORIGEN} transito=${TRANSITO} destino=${DESTINO} producto=${prod?.product_id?.[1]} stock=${prod?.quantity}`);
if (!prod) { console.log("Sin producto con stock en WH para probar"); Deno.exit(1); }
const P = prod.product_id[0];
const base = { companyId: 1, pickingTypeId: TIPO, items: [{ productId: P, cantidad: 1 }] };
const creados: number[] = [];

// Limpieza opcional de una corrida anterior: LIMPIAR=<salidaId> devuelve su picking A validado
if (Deno.env.get("LIMPIAR")) {
  const sid = Deno.env.get("LIMPIAR")!;
  const pk = await buscarPickingPorOrigin(c, originTraslado(sid, "A"));
  if (pk && pk.state === "done") { const d = await devolverTraslado(c, pk.id, { salidaId: sid, paso: "A", companyId: 1 }); console.log("limpieza", sid, d.estado); }
  Deno.exit(0);
}
const salida = `TEST-${run}-1`;
let A = 0;
await prueba("crear A (origen->transito) en borrador", async () => {
  const r = await crearTraslado(c, { ...base, salidaId: salida, paso: "A", origenLocationId: ORIGEN, destinoLocationId: TRANSITO });
  A = r.pickingId; creados.push(A); if (r.reutilizado || r.estado === "done") throw new Error("estado inesperado " + r.estado);
});
await prueba("crear A de nuevo es idempotente (mismo picking)", async () => {
  const r = await crearTraslado(c, { ...base, salidaId: salida, paso: "A", origenLocationId: ORIGEN, destinoLocationId: TRANSITO });
  if (!r.reutilizado || r.pickingId !== A) throw new Error("duplicó");
});
await prueba("validar A (sin asistente inmediato)", async () => {
  const r = await validarTraslado(c, A); if (r.estado !== "done") throw new Error(r.estado);
});
await prueba("validar A otra vez es idempotente", async () => { const r = await validarTraslado(c, A); if (!r.reutilizado) throw new Error("no idempotente"); });
let B = 0;
await prueba("crear y validar B (transito->destino)", async () => {
  const r = await crearTraslado(c, { ...base, salidaId: salida, paso: "B", origenLocationId: TRANSITO, destinoLocationId: DESTINO });
  B = r.pickingId; creados.push(B); const v = await validarTraslado(c, B); if (v.estado !== "done") throw new Error(v.estado);
});
await prueba("chatter en texto plano con autor tecnico", async () => {
  const [me] = await c.call("res.users", "search_read", [[["login", "=", Deno.env.get("SGC_INTEGRATION_ODOO_USER")!]]], { fields: ["partner_id"] });
  const autor = await resolverAutorOdoo(c, { correo: "no-existe@example.com", tecnicoPartnerId: me.partner_id[0] });
  if (autor.via !== "cuenta_tecnica") throw new Error(autor.via);
  await publicarNotaPicking(c, A, "Prueba <b>de</b> contrato SGC", autor);
});
await prueba("sin stock: error traducido (no traza)", async () => {
  const r = await crearTraslado(c, { ...base, items: [{ productId: P, cantidad: 9999999 }], salidaId: `TEST-${run}-2`, paso: "A", origenLocationId: ORIGEN, destinoLocationId: TRANSITO });
  creados.push(r.pickingId);
  try { await validarTraslado(c, r.pickingId); throw new Error("NO falló: se validó sin stock"); } catch (e) {
    if (!(e instanceof TrasladoError) || e.codigo !== "sin_stock") throw e;
  }
  await cancelarTraslado(c, r.pickingId);
});
await prueba("cancelar un borrador", async () => {
  const r = await crearTraslado(c, { ...base, salidaId: `TEST-${run}-3`, paso: "A", origenLocationId: ORIGEN, destinoLocationId: TRANSITO });
  const x = await cancelarTraslado(c, r.pickingId); if (x.estado !== "cancel") throw new Error(x.estado);
});
await prueba("cancelar un picking validado se rechaza", async () => {
  try { await cancelarTraslado(c, A); throw new Error("canceló un done"); } catch (e) { if (!(e instanceof TrasladoError) || e.codigo !== "estado_invalido") throw e; }
});
// limpieza: devolver B y A para dejar el stock como estaba
await prueba("devolver B y A (limpieza del stock)", async () => {
  const dB = await devolverTraslado(c, B, { salidaId: salida, paso: "B", companyId: 1 });
  const dA = await devolverTraslado(c, A, { salidaId: salida, paso: "A", companyId: 1 });
  if (dA.estado !== "done" || dB.estado !== "done") throw new Error("devolución no validada");
  const dB2 = await devolverTraslado(c, B, { salidaId: salida, paso: "B", companyId: 1 });
  if (!dB2.reutilizado) throw new Error("devolución no idempotente");
});
const o = await obtenerTraslado(c, A);
console.log(`origin A = ${originTraslado(salida, "A")} estado final=${o?.state}`);
console.log(fallo.length ? `\nFALLARON ${fallo.length}: ${fallo.join(" | ")}` : "\nTODO OK");
Deno.exit(fallo.length ? 1 : 0);
