// DS-21: retiros / cuarentena / disposicion. Contrato real: scripts/odoo-contrato-circuito2-staging.ts
import { assertEquals } from "jsr:@std/assert@1";
import { odooFake } from "./odoo-fake-util.ts";
import { type DatosRetiro, type DepsRetiro, originRetiro, publicarRetiro } from "./odoo-retiros.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const base: DatosRetiro = {
  id: "r1", estado: "en_cuarentena", esPrueba: false, disposicion: null, items: [{ nombre: "Tubo", cantidad: 3, odooProductId: 7 }],
  obraLocationId: 10, destinoWarehouseId: 1, destinoStockLocationId: 8, cuarentenaLocationId: 9, companyId: 1,
};
function deps(f: ReturnType<typeof odooFake>, r: Partial<DatosRetiro> = {}) {
  const marcas: Any[] = []; const dato = { ...base, ...r };
  const d: DepsRetiro = { c: f.c, cargar: () => Promise.resolve(dato), marcar: (_i, m) => { marcas.push(m); return Promise.resolve(); } };
  return { d, marcas };
}

Deno.test("solicitud / aprobacion / conduce de transporte NO publican (sin hecho fisico)", async () => {
  for (const estado of ["pendiente", "aprobada", "en_retiro", "rechazada", "cancelada"]) {
    const f = odooFake(); const a = deps(f, { estado });
    const r = await publicarRetiro(a.d, "r1", 1);
    assertEquals(r.resultado?.omitido, "sin_hecho_fisico"); assertEquals(f.llamadas.length, 0);
  }
});

Deno.test("recibido a cuarentena: obra -> ubicacion de cuarentena, idempotente; no es material nuevo (sale del origen)", async () => {
  const f = odooFake(); const a = deps(f);
  const r1 = await publicarRetiro(a.d, "r1", 1);
  assertEquals(r1.estado, "completado"); assertEquals(f.pickings.length, 1);
  assertEquals(f.pickings[0].origin, originRetiro("r1", "IN")); assertEquals(f.pickings[0].location_id[0], 10); assertEquals(f.pickings[0].location_dest_id[0], 9);
  const r2 = await publicarRetiro(a.d, "r1", 2);
  assertEquals(r2.estado, "completado"); assertEquals(f.pickings.length, 1); // reintento: no duplica cuarentena ni stock
});

Deno.test("sin ubicacion de cuarentena enlazada: queda pendiente con el motivo; NUNCA al stock disponible", async () => {
  const f = odooFake(); const a = deps(f, { cuarentenaLocationId: null });
  const r = await publicarRetiro(a.d, "r1", 1);
  assertEquals(r.resultado?.omitido, "sin_cuarentena"); assertEquals(f.pickings.length, 0); assertEquals(a.marcas[0].estado, "pendiente");
});

Deno.test("origen sin existencias en Odoo: error explicado y el borrador no queda huerfano", async () => {
  const f = odooFake({ stock: 0 }); const a = deps(f);
  const r = await publicarRetiro(a.d, "r1", 1);
  assertEquals(r.estado, "error"); assertEquals(a.marcas.at(-1).error.includes("sin respaldo"), true);
  assertEquals(f.pickings[0].state, "cancel");
});

Deno.test("disposicion: descarte -> scrap, devolucion -> proveedor, reparacion -> stock disponible; cada una idempotente", async () => {
  const destinos: Record<string, number> = { descarte: 5, devolucion: 1, reparacion: 8 };
  for (const [disp, destino] of Object.entries(destinos)) {
    const f = odooFake(); const a = deps(f, { estado: "dispuesta", disposicion: disp });
    const r = await publicarRetiro(a.d, "r1", 1);
    assertEquals(r.estado, "completado");
    const p = f.pickings.find((x) => x.origin === originRetiro("r1", "DISP"))!;
    assertEquals(p.location_id[0], 9); assertEquals(p.location_dest_id[0], destino);
    await publicarRetiro(a.d, "r1", 2);
    assertEquals(f.pickings.length, 2);
  }
});

Deno.test("material sin articulo vinculado, obra sin almacen en Odoo o prueba: no publican", async () => {
  const f = odooFake();
  assertEquals((await publicarRetiro(deps(f, { items: [{ nombre: "x", cantidad: 1, odooProductId: null }] }).d, "r1", 1)).estado, "error");
  assertEquals((await publicarRetiro(deps(f, { obraLocationId: null }).d, "r1", 1)).estado, "error");
  assertEquals((await publicarRetiro(deps(f, { esPrueba: true }).d, "r1", 1)).resultado?.omitido, "es_prueba");
  assertEquals(f.pickings.length, 0);
});

Deno.test("W3: real -> prueba DESPUES de publicar compensa disposicion y recepcion a cuarentena (idempotente)", async () => {
  const f = odooFake(); const a = deps(f, { estado: "dispuesta", disposicion: "descarte" });
  await publicarRetiro(a.d, "r1", 1);
  assertEquals(f.pickings.length, 2); // IN y DISP
  const d2 = deps(f, { estado: "dispuesta", disposicion: "descarte", esPrueba: true });
  const r = await publicarRetiro(d2.d, "r1", 2);
  assertEquals(r.estado, "completado"); assertEquals(r.resultado?.revertido, true);
  const orig = f.pickings.map((p) => p.origin);
  assertEquals(orig.includes(`${originRetiro("r1", "DISP")}-D1`), true); assertEquals(orig.includes(`${originRetiro("r1", "IN")}-D1`), true);
  const dispD = f.pickings.find((p) => p.origin === `${originRetiro("r1", "DISP")}-D1`)!;
  assertEquals([dispD.location_id[0], dispD.location_dest_id[0]], [5, 9]); // scrap -> cuarentena
  const inD = f.pickings.find((p) => p.origin === `${originRetiro("r1", "IN")}-D1`)!;
  assertEquals([inD.location_id[0], inD.location_dest_id[0]], [9, 10]); // cuarentena -> obra
  await publicarRetiro(d2.d, "r1", 3);
  assertEquals(f.pickings.length, 4); // reintento: no duplica la reversa
});

Deno.test("W3: una prueba que nunca se publico sigue sin tocar Odoo", async () => {
  const f = odooFake();
  assertEquals((await publicarRetiro(deps(f, { esPrueba: true, estado: "dispuesta", disposicion: "descarte" }).d, "r1", 1)).resultado?.omitido, "es_prueba");
  assertEquals(f.pickings.length, 0);
});
