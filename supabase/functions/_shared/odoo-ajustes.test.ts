// DS-22: conteos / ajustes / apertura -> accion de negocio de Odoo (nunca quantity directo). Contrato real: scripts/odoo-contrato-circuito2-staging.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ajustarArticulo, compensarAjuste, type DatosConteo, type DepsConteo, publicarConteo, refAjuste } from "./odoo-ajustes.ts";
import { odooFake } from "./odoo-fake-util.ts";
import { TrasladoError } from "./odoo-traslados.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const conteo: DatosConteo = { id: "c1", tipo: "conteo_fisico", estado: "aplicado", esPrueba: false, bodegaLocationId: 8, lineas: [{ nombre: "Cemento", odooProductId: 7, cantidadContada: 12 }] };
function deps(f: ReturnType<typeof odooFake>, k: Partial<DatosConteo> = {}) {
  const marcas: Any[] = []; let dato = { ...conteo, ...k };
  const d: DepsConteo = { c: f.c, cargar: () => Promise.resolve(dato), marcar: (_i, m) => { marcas.push(m); return Promise.resolve(); } };
  return { d, marcas, set: (x: Partial<DatosConteo>) => { dato = { ...dato, ...x }; } };
}
const conSaldo = (cant: number) => { const f = odooFake(); f.quants.push({ id: 1, product_id: [7, "p"], location_id: [8, "l"], quantity: cant, inventory_quantity: 0 }); return f; };

Deno.test("ajustarArticulo: usa inventory_quantity + action_apply_inventory (nunca quantity directo) y verifica el saldo final", async () => {
  const f = conSaldo(10);
  const r = await ajustarArticulo(f.c, { nombre: "SGC-AJU-x", locationId: 8, productId: 7, objetivo: 12 });
  assertEquals(r, { productId: 7, antes: 10, despues: 12, delta: 2, estado: "aplicada" });
  assertEquals(f.llamadas.includes("stock.quant.action_apply_inventory"), true);
  assertEquals(f.moves.at(-1).name, "SGC-AJU-x");
});

Deno.test("ajustarArticulo: reintento = un solo efecto; sin diferencia = sin movimiento", async () => {
  const f = conSaldo(10);
  await ajustarArticulo(f.c, { nombre: "SGC-AJU-x", locationId: 8, productId: 7, objetivo: 12 });
  const n = f.moves.length;
  const r2 = await ajustarArticulo(f.c, { nombre: "SGC-AJU-x", locationId: 8, productId: 7, objetivo: 12 });
  assertEquals(r2.estado, "reutilizada"); assertEquals(f.moves.length, n);
  const g = conSaldo(5);
  assertEquals((await ajustarArticulo(g.c, { nombre: "SGC-AJU-y", locationId: 8, productId: 7, objetivo: 5 })).estado, "sin_cambio");
  assertEquals(g.llamadas.includes("stock.quant.action_apply_inventory"), false);
});

Deno.test("ajustarArticulo: sin quant previo lo crea; varios lotes = error; cantidad invalida = error", async () => {
  const f = odooFake();
  const r = await ajustarArticulo(f.c, { nombre: "SGC-AJU-z", locationId: 8, productId: 7, objetivo: 3 });
  assertEquals(r.despues, 3); assertEquals(f.llamadas.includes("stock.quant.create"), true);
  const g = odooFake(); g.quants.push({ id: 1, product_id: [7, "p"], location_id: [8, "l"], quantity: 1 }, { id: 2, product_id: [7, "p"], location_id: [8, "l"], quantity: 1 });
  await assertRejects(() => ajustarArticulo(g.c, { nombre: "n", locationId: 8, productId: 7, objetivo: 5 }), TrasladoError, "varios lotes");
  await assertRejects(() => ajustarArticulo(f.c, { nombre: "n", locationId: 8, productId: 7, objetivo: -1 }), TrasladoError);
});

Deno.test("publicarConteo: borrador/contado NO publican; aplicado si; resultados por linea", async () => {
  const f = conSaldo(10);
  for (const estado of ["borrador", "contado"]) {
    const a = deps(f, { estado }); const r = await publicarConteo(a.d, "c1", 1);
    assertEquals(r.resultado?.omitido, "no_aplicado");
  }
  assertEquals(f.llamadas.length, 0);
  const a = deps(f); const r = await publicarConteo(a.d, "c1", 1);
  assertEquals(r.estado, "completado"); assertEquals((r.resultado?.lineas as Any[])[0].delta, 2); assertEquals(a.marcas[0].estado, "sincronizado");
});

Deno.test("publicarConteo: repetir el lote no duplica el efecto; articulo sin vincular o prueba no publican", async () => {
  const f = conSaldo(10); const a = deps(f);
  await publicarConteo(a.d, "c1", 1); const n = f.moves.length;
  const r = await publicarConteo(a.d, "c1", 2);
  assertEquals(r.resultado?.aplicadas, 0); assertEquals(f.moves.length, n);
  const b = deps(f, { lineas: [{ nombre: "X", odooProductId: null, cantidadContada: 1 }] });
  assertEquals((await publicarConteo(b.d, "c1", 1)).estado, "error");
  const p = deps(f, { esPrueba: true });
  assertEquals((await publicarConteo(p.d, "c1", 1)).resultado?.omitido, "es_prueba");
});

Deno.test("deshacer: compensa SOLO el delta aplicado, no restaura un saldo antiguo (respeta movimientos posteriores)", async () => {
  const f = conSaldo(10); const a = deps(f);
  await publicarConteo(a.d, "c1", 1); // 10 -> 12 (delta +2)
  f.quants[0].quantity += 5; // movimiento POSTERIOR (entra mercancia): 17
  a.set({ estado: "cancelado" });
  const r = await publicarConteo(a.d, "c1", 1);
  assertEquals(r.estado, "completado");
  assertEquals(f.quants[0].quantity, 15); // 17 - 2: el +5 posterior se conserva (un rebase a ciegas habria dejado 10)
  const again = await compensarAjuste(f.c, { ref: refAjuste("c1"), locationId: 8 });
  assertEquals(again[0].estado, "reutilizada"); assertEquals(f.quants[0].quantity, 15);
});

Deno.test("cancelado sin efecto previo no toca Odoo; conteo con almacen sin vincular = error visible", async () => {
  const f = conSaldo(10);
  const a = deps(f, { estado: "cancelado" });
  assertEquals((await publicarConteo(a.d, "c1", 1)).resultado?.omitido, "sin_efecto_previo");
  const b = deps(f, { bodegaLocationId: null });
  assertEquals((await publicarConteo(b.d, "c1", 1)).estado, "error");
});
