// DS-18: conduces externos. El externo no es dueno de ningun movimiento: enlaza, no duplica.
import { assertEquals } from "jsr:@std/assert@1";
import { type DatosConduceExterno, type DepsExterno, publicarConduceExterno } from "./odoo-externos.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const base: DatosConduceExterno = { id: "x1", numero: 123, estado: "emitido", afectaInventario: true, esPrueba: false, salidaId: null, entradaId: null, retiroId: null, salidaPickingA: null, salidaPickingB: null, entradaPicking: null };
function deps(x: Partial<DatosConduceExterno>) {
  const marcas: Any[] = []; const sal: string[] = []; const ent: string[] = [];
  const d: DepsExterno = {
    cargar: () => Promise.resolve({ ...base, ...x }), marcar: (_i, m) => { marcas.push(m); return Promise.resolve(); },
    encolarSalida: (s) => { sal.push(s); return Promise.resolve(); }, encolarEntrada: (e) => { ent.push(e); return Promise.resolve(); },
  };
  return { d, marcas, sal, ent };
}

Deno.test("conduce meramente logistico: no crea movimiento ni marca nada", async () => {
  const a = deps({ afectaInventario: false, salidaId: "s1" });
  const r = await publicarConduceExterno(a.d, "x1", 1);
  assertEquals(r.resultado?.omitido, "logistico"); assertEquals(a.sal.length + a.ent.length + a.marcas.length, 0);
});

Deno.test("transporte de un RETIRO: lo publica el retiro, no el conduce (sin duplicar)", async () => {
  const a = deps({ retiroId: "r1", salidaId: "s1" });
  assertEquals((await publicarConduceExterno(a.d, "x1", 1)).resultado?.omitido, "retiro"); assertEquals(a.sal.length, 0);
});

Deno.test("enlaza una salida existente: re-encola ESA salida (misma transicion canonica), no descuenta de nuevo", async () => {
  const a = deps({ salidaId: "s1", salidaPickingA: 55 });
  const r = await publicarConduceExterno(a.d, "x1", 1);
  assertEquals(r.estado, "completado"); assertEquals(a.sal, ["s1"]); assertEquals(a.ent, []); assertEquals(a.marcas[0].picking, 55);
});

Deno.test("entrante a almacen propio: pendiente hasta confirmar; al recibir re-encola la entrada", async () => {
  const a = deps({ entradaId: "e1", estado: "emitido" });
  await publicarConduceExterno(a.d, "x1", 1);
  assertEquals(a.ent, []); assertEquals(a.marcas[0].error.includes("pendiente"), true);
  const b = deps({ entradaId: "e1", estado: "recibido" });
  await publicarConduceExterno(b.d, "x1", 1);
  assertEquals(b.ent, ["e1"]);
});

Deno.test("anulado: reevalua salida y entrada para que compensen por su documento; prueba nunca publica", async () => {
  const a = deps({ salidaId: "s1", entradaId: "e1", estado: "anulado" });
  const r = await publicarConduceExterno(a.d, "x1", 1);
  assertEquals(r.estado, "completado"); assertEquals(a.sal, ["s1"]); assertEquals(a.ent, ["e1"]); assertEquals(a.marcas[0].error.includes("Anulado"), true);
  const p = deps({ esPrueba: true, salidaId: "s1" });
  assertEquals((await publicarConduceExterno(p.d, "x1", 1)).resultado?.omitido, "es_prueba"); assertEquals(p.sal.length, 0);
});

Deno.test("afecta inventario sin salida ni entrada: error visible (no se calla)", async () => {
  const a = deps({});
  await publicarConduceExterno(a.d, "x1", 1);
  assertEquals(a.marcas[0].estado, "error");
});
