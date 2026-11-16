// DS-16 / DS-19: recepcion de OC (completa, parcial, reintento, rechazo) y devoluciones. Contrato real: scripts/odoo-contrato-circuito2-staging.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { OdooError } from "./odoo-client.ts";
import { odooFake } from "./odoo-fake-util.ts";
import { type DatosEntrada, type DepsEntrada, publicarEntrada, recibirOc } from "./odoo-recepciones.ts";
import { TrasladoError } from "./odoo-traslados.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const base: DatosEntrada = {
  id: "ent-1", esPrueba: false, pendienteConfirmacion: false, rechazada: false, origenTipo: "compra", ordenCompraId: "oc-1", ocOdooId: 100, salidaId: null,
  bodegaLocationId: 8, bodegaWarehouseId: 1, lineas: [{ nombre: "Cemento", cantidad: 6, odooProductId: 7 }], pickingIdPrevio: null, companyId: 1,
};
function deps(f: ReturnType<typeof odooFake>, e: Partial<DatosEntrada> = {}) {
  const marcas: Any[] = []; const encoladas: string[] = []; let dato = { ...base, ...e };
  const d: DepsEntrada = {
    c: f.c, cargar: () => Promise.resolve(dato), marcar: (_i, m) => { marcas.push(m); return Promise.resolve(); },
    encolarSalida: (s) => { encoladas.push(s); return Promise.resolve(); },
  };
  return { d, marcas, encoladas, set: (x: Partial<DatosEntrada>) => { dato = { ...dato, ...x }; } };
}

Deno.test("DS-16: recepcion COMPLETA valida la recepcion de la OC con las cantidades por linea", async () => {
  const f = odooFake(); f.crearOc([[7, 10]]);
  const r = await recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 10 }] });
  assertEquals(r.parcial, false); assertEquals(f.pickings[0].state, "done"); assertEquals(f.moves[0].quantity, 10);
  assertEquals(f.llamadas.includes("stock.picking.create"), false); // reutiliza la recepcion de la OC, no crea otra
});

Deno.test("DS-16: recepcion PARCIAL deja backorder y el resto pendiente; la 2.a entrada recibe sobre el backorder", async () => {
  const f = odooFake(); f.crearOc([[7, 10]]);
  const r1 = await recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 6 }] });
  assertEquals(r1.parcial, true); assertEquals(typeof r1.backorderId, "number");
  const bo = f.pickings.find((p) => p.id === r1.backorderId)!;
  assertEquals(bo.state, "assigned"); assertEquals(f.moves.find((m) => m.picking === bo.id)!.product_uom_qty, 4);
  const r2 = await recibirOc(f.c, { ocId: 100, entradaId: "e2", lineas: [{ productId: 7, cantidad: 4 }] });
  assertEquals(r2.pickingId, bo.id); assertEquals(r2.parcial, false); assertEquals(bo.state, "done");
});

Deno.test("DS-16: reintento NO suma dos veces (marca SGC-REC en un picking hecho)", async () => {
  const f = odooFake(); f.crearOc([[7, 10]]);
  const a = await recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 6 }] });
  const antes = f.pickings.length;
  const b = await recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 6 }] });
  assertEquals(b.reutilizado, true); assertEquals(b.pickingId, a.pickingId); assertEquals(f.pickings.length, antes);
  assertEquals(f.pickings.filter((p) => p.state === "done").length, 1);
});

Deno.test("DS-16: mas de lo pedido, producto ajeno, OC sin confirmar o cancelada -> error de negocio y nada se escribe", async () => {
  const f = odooFake(); f.crearOc([[7, 10]]);
  await assertRejects(() => recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 11 }] }), TrasladoError, "más de lo pedido");
  await assertRejects(() => recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 99, cantidad: 1 }] }), TrasladoError, "no pertenece");
  assertEquals(f.pickings[0].state, "assigned"); assertEquals(f.llamadas.includes("stock.picking.button_validate"), false);
  const g = odooFake(); g.crearOc([[7, 10]], "draft");
  await assertRejects(() => recibirOc(g.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 1 }] }), TrasladoError, "no está confirmada");
  const h = odooFake(); h.crearOc([[7, 10]], "cancel");
  await assertRejects(() => recibirOc(h.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 1 }] }), TrasladoError, "cancelada");
});

Deno.test("DS-16: una OC ya recibida por completo no acepta otra recepcion", async () => {
  const f = odooFake(); f.crearOc([[7, 4]]);
  await recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 4 }] });
  await assertRejects(() => recibirOc(f.c, { ocId: 100, entradaId: "e2", lineas: [{ productId: 7, cantidad: 1 }] }), TrasladoError, "ya fue recibida");
});

Deno.test("DS-16: wizard inesperado de Odoo -> no se informa sincronizado", async () => {
  const f = odooFake({ backorderWizard: true }); f.crearOc([[7, 10]]);
  await assertRejects(() => recibirOc(f.c, { ocId: 100, entradaId: "e1", lineas: [{ productId: 7, cantidad: 10 }] }), TrasladoError, "paso extra");
});

Deno.test("publicarEntrada: pendiente de confirmacion y rechazada NO materializan stock", async () => {
  const f = odooFake(); f.crearOc([[7, 10]]);
  const a = deps(f, { pendienteConfirmacion: true });
  const r1 = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r1.estado, "completado"); assertEquals(r1.resultado?.omitido, "pendiente_confirmacion"); assertEquals(a.marcas[0].estado, "pendiente");
  const b = deps(f, { rechazada: true });
  const r2 = await publicarEntrada(b.d, "ent-1", 1);
  assertEquals(r2.resultado?.omitido, "rechazada");
  assertEquals(f.pickings[0].state, "assigned"); // el stock no se movio
});

Deno.test("publicarEntrada: con OC valida la recepcion y marca sincronizado (parcial = aviso visible)", async () => {
  const f = odooFake(); f.crearOc([[7, 10]]);
  const a = deps(f);
  const r = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r.estado, "completado"); assertEquals(r.resultado?.parcial, true);
  assertEquals(a.marcas[0].estado, "sincronizado"); assertEquals(a.marcas[0].error?.includes("parcial"), true);
});

Deno.test("publicarEntrada: OC sin publicar en Odoo o articulo sin vincular -> error visible, sin escribir", async () => {
  const f = odooFake();
  const a = deps(f, { ocOdooId: null });
  const r = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r.estado, "error"); assertEquals(a.marcas[0].estado, "error");
  const b = deps(f, { lineas: [{ nombre: "X", cantidad: 1, odooProductId: null }] });
  assertEquals((await publicarEntrada(b.d, "ent-1", 1)).estado, "error");
  assertEquals(f.llamadas.length, 0);
});

Deno.test("DS-19/DS-17: entrada ligada a una salida re-encola ESA salida (completa su paso B, no es recepcion de proveedor)", async () => {
  const f = odooFake();
  const a = deps(f, { ordenCompraId: null, ocOdooId: null, origenTipo: "devolucion_obra", salidaId: "sal-9" });
  const r = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r.estado, "completado"); assertEquals(a.encoladas, ["sal-9"]);
  assertEquals(f.llamadas.length, 0); // sin picking de proveedor
});

Deno.test("DS-19: devolucion de obra SIN descuento no suma recepcion (no hay origen verificable) y queda explicada", async () => {
  const f = odooFake();
  const a = deps(f, { ordenCompraId: null, ocOdooId: null, origenTipo: "devolucion_obra", salidaId: null });
  const r = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r.resultado?.omitido, "sin_origen"); assertEquals(a.marcas[0].error?.includes("origen verificable"), true); assertEquals(f.llamadas.length, 0);
});

Deno.test("recepcion libre (sin OC): proveedor -> almacen, idempotente por origin SGC-ENT", async () => {
  const f = odooFake();
  const a = deps(f, { ordenCompraId: null, ocOdooId: null, origenTipo: "compra" });
  const r1 = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r1.estado, "completado"); assertEquals(f.pickings.length, 1); assertEquals(f.pickings[0].origin, "SGC-ENT-ent-1"); assertEquals(f.pickings[0].state, "done");
  const r2 = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r2.estado, "completado"); assertEquals(f.pickings.length, 1);
});

Deno.test("DS-19: real -> prueba despues de publicar COMPENSA (devolucion); si valido una OC, se bloquea con motivo", async () => {
  const f = odooFake();
  const a = deps(f, { ordenCompraId: null, ocOdooId: null, origenTipo: "compra" });
  await publicarEntrada(a.d, "ent-1", 1);
  a.set({ esPrueba: true, pickingIdPrevio: f.pickings[0].id });
  const r = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r.estado, "completado"); assertEquals(r.resultado?.omitido, "es_prueba_compensado");
  assertEquals(f.pickings.some((p) => p.origin === "SGC-TRAS-ent-1-A-D1"), true);
  const g = odooFake(); g.crearOc([[7, 10]]);
  const b = deps(g);
  await publicarEntrada(b.d, "ent-1", 1);
  b.set({ esPrueba: true, pickingIdPrevio: g.pickings[0].id });
  const r2 = await publicarEntrada(b.d, "ent-1", 1);
  assertEquals(r2.estado, "error"); // la OC ya recibida debe revertirla Compras: no se cambia nada
});

Deno.test("transporte caido: reintento con espera; tras 8 intentos queda incierto", async () => {
  const f = odooFake({ falla: () => new OdooError("odoo_no_disponible", "timeout") });
  const a = deps(f);
  const r1 = await publicarEntrada(a.d, "ent-1", 1);
  assertEquals(r1.estado, "reintento"); assertEquals(a.marcas.at(-1).estado, "pendiente");
  const r2 = await publicarEntrada(a.d, "ent-1", 8);
  assertEquals(r2.estado, "incierto");
});
