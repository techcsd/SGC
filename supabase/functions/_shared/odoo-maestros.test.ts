import { assertEquals } from "jsr:@std/assert@1";
import { type DepsMaestro, verificarMaestro } from "./odoo-maestros.ts";

const ev = (t: string) => ({ id: "e1", agregado_tipo: t, agregado_id: "x", accion: "upsert", revision: 1, payload: {} });
const deps = (o: Partial<DepsMaestro> & { m?: Awaited<ReturnType<DepsMaestro["cargar"]>> }): DepsMaestro => ({
  cargar: () => Promise.resolve(o.m === undefined ? { odooId: 7, nombre: "Cemento", esPrueba: false } : o.m),
  existe: o.existe ?? (() => Promise.resolve(true)),
});

Deno.test("vinculo vivo: completado con verificacion", async () => {
  const r = await verificarMaestro(deps({}), ev("articulo"));
  assertEquals([r.estado, r.resultado?.verificado, r.resultado?.modelo], ["completado", true, "product.product"]);
});
Deno.test("sin vinculo: error visible que manda a Homologacion", async () => {
  const r = await verificarMaestro(deps({ m: { odooId: null, nombre: "Cemento", esPrueba: false } }), ev("articulo"));
  assertEquals(r.estado, "error"); assertEquals(String(r.error).includes("Homologación"), true);
});
Deno.test("vinculo roto: error; Odoo caido: reintento; prueba/inexistente: omitido", async () => {
  assertEquals((await verificarMaestro(deps({ existe: () => Promise.resolve(false) }), ev("unidad"))).estado, "error");
  assertEquals((await verificarMaestro(deps({ existe: () => Promise.reject(new Error("x")) }), ev("categoria_inventario"))).estado, "reintento");
  assertEquals((await verificarMaestro(deps({ m: { odooId: 1, nombre: "a", esPrueba: true } }), ev("articulo"))).resultado?.omitido, "es_prueba");
  assertEquals((await verificarMaestro(deps({ m: null }), ev("proveedor"))).resultado?.omitido, "ya_no_existe");
  assertEquals((await verificarMaestro(deps({}), ev("otro"))).estado, "error");
});
