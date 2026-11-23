import { assertEquals } from "jsr:@std/assert@1";
import { acotarFilas, ejecutarHerramientaOdoo, MAX_FILAS_ODOO_IA } from "./herramientas-odoo.ts";
import { toolsParaUsuario, TOOLS } from "./herramientas.ts";

// deno-lint-ignore no-explicit-any
const fake = (activo: boolean, respuestas: Record<string, any> = {}) => ({
  schema: () => ({ rpc: async () => ({ data: activo }) }),
  functions: { invoke: async (_n: string, o: { body: { accion: string } }) => ({ data: respuestas[o.body.accion] ?? { data: {} }, error: null }) },
});

Deno.test("interruptor apagado → mensaje claro, sin llamar a Odoo", async () => {
  const r = await ejecutarHerramientaOdoo(fake(false), "consultar_stock_odoo", { articulo: "ties" });
  assertEquals(r.data, null);
  assertEquals(r.error!.message.includes("desactivadas"), true);
});

Deno.test("stock: tope de 50 filas y filtro por almacén", async () => {
  const filas = Array.from({ length: 80 }, (_, i) => ({ ubicacion: { nombre: i % 2 ? "Central/Stock" : "Obra/Stock" }, cantidad_fisica: 1, cantidad_reservada: 0, cantidad_disponible: 1 }));
  const sb = fake(true, { "productos.buscar": { data: { productos: [{ id: 1, nombre: "Ties 25cm", codigo: "T25", unidad: "UND" }] } }, "stock.consultar": { data: { filas } } });
  const todo = await ejecutarHerramientaOdoo(sb, "consultar_stock_odoo", { articulo: "ties" });
  // deno-lint-ignore no-explicit-any
  assertEquals((todo.data as any).filas.length, MAX_FILAS_ODOO_IA);
  // deno-lint-ignore no-explicit-any
  assertEquals((todo.data as any).truncado, true);
  const cen = await ejecutarHerramientaOdoo(sb, "consultar_stock_odoo", { articulo: "ties", almacen: "central" });
  // deno-lint-ignore no-explicit-any
  assertEquals((cen.data as any).filas.length, 40);
});

Deno.test("OC: id inválido se rechaza; no devuelve líneas de costo", async () => {
  assertEquals((await ejecutarHerramientaOdoo(fake(true), "consultar_oc_odoo", { orden_id: "P00919" })).error!.message.includes("ID numérico"), true);
  const sb = fake(true, { "compras.obtener": { data: { orden: { id: 5, nombre: "P00005", estado: "purchase", total: 10, proveedor: { nombre: "X" }, lineas: [{ costo: 1 }] } } } });
  // deno-lint-ignore no-explicit-any
  const d = (await ejecutarHerramientaOdoo(sb, "consultar_oc_odoo", { orden_id: 5 })).data as any;
  assertEquals(d.nombre, "P00005");
  assertEquals("lineas" in d, false);
});

Deno.test("permisos: sin módulo no ve las tools; con inventario ve stock/OC; Tecnología ve estado", () => {
  const base = { usuario_id: "u", nombre: "n", es_admin: false, roles: [] as string[] };
  const nombres = (modulos: string[]) => toolsParaUsuario({ ...base, modulos }, "mcp").map((t) => t.name);
  assertEquals(nombres(["bitacora"]).some((n) => n.endsWith("_odoo")), false);
  assertEquals(nombres(["inventario"]).includes("consultar_stock_odoo"), true);
  assertEquals(nombres(["inventario"]).includes("estado_sincronizacion_odoo"), false);
  assertEquals(nombres(["tecnologia"]).includes("estado_sincronizacion_odoo"), true);
  assertEquals(TOOLS.filter((t) => t.odoo).length, 3);
});

Deno.test("acotarFilas", () => assertEquals(acotarFilas([1, 2, 3], 2), { filas: [1, 2], truncado: true }));
