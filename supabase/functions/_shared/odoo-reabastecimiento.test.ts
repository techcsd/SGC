import { assertEquals } from "jsr:@std/assert@1";
import type { LlamadorOdoo } from "./odoo-traslados.ts";
import { aplicarReglas, planificarReglas } from "./odoo-reabastecimiento.ts";

const art = (id: string, min: number, max = min) => ({ articuloId: id, productId: 7, minimo: min, maximo: max });
const regla = (id: string, o: Partial<{ minimo: number; maximo: number; activa: boolean; protegida: boolean }> = {}) => ({ articuloId: id, orderpointId: 50, productId: 7, minimo: 5, maximo: 5, activa: true, ...o });

Deno.test("plan: crea las que faltan, actualiza las que cambiaron, reactiva y archiva", () => {
  const p = planificarReglas([art("a", 5), art("b", 8, 20), art("c", 3)], [regla("b"), regla("c", { activa: false, minimo: 3, maximo: 3 }), regla("z")]);
  assertEquals(p.map((x) => `${x.op}:${x.articuloId}`), ["crear:a", "actualizar:b", "reactivar:c", "archivar:z"]);
});
Deno.test("plan: sin cambios no hace nada; el maximo nunca queda bajo el minimo", () => {
  assertEquals(planificarReglas([art("a", 5)], [regla("a")]), []);
  assertEquals(planificarReglas([art("a", 5, 2)], [])[0], { op: "crear", articuloId: "a", productId: 7, minimo: 5, maximo: 5 });
});
Deno.test("aplicar: crea con disparador manual, adopta una regla existente y archiva sin borrar", async () => {
  const log: string[] = [];
  let existe = false;
  const c = {
    // deno-lint-ignore require-await
    async call(model: string, method: string, args: unknown[]) {
      log.push(`${model}.${method} ${JSON.stringify(args)}`);
      if (method === "search_read") return existe ? [{ id: 99 }] : [];
      if (method === "create") return 123;
      return true;
    },
  } as unknown as LlamadorOdoo;
  const destino = { warehouseId: 1, locationId: 8 };
  const r1 = await aplicarReglas(c, destino, [{ op: "crear", articuloId: "a", productId: 7, minimo: 5, maximo: 5 }]);
  assertEquals([r1[0].orderpointId, log[1].includes('"trigger":"manual"'), log[1].includes('"location_id":8')], [123, true, true]);
  existe = true;
  const r2 = await aplicarReglas(c, destino, [{ op: "crear", articuloId: "b", productId: 7, minimo: 2, maximo: 2 }]);
  assertEquals(r2[0].orderpointId, 99);
  const r3 = await aplicarReglas(c, destino, [{ op: "archivar", articuloId: "z", orderpointId: 50 }]);
  assertEquals([r3[0].activa, log.at(-1)?.includes('"active":false')], [false, true]);
});

Deno.test("plan: una regla protegida (editada en Odoo) no se actualiza ni se archiva", () => {
  const p = planificarReglas(
    [art("a", 9, 20), art("b", 3)],
    [regla("a", { minimo: 5, maximo: 5, protegida: true }), regla("z", { protegida: true })],
  );
  assertEquals(p.map((x) => `${x.op}:${x.articuloId}`), ["crear:b"]);
});
