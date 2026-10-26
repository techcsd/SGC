import { assertEquals } from "jsr:@std/assert@1";
import { publicarMock } from "./odoo-inventario.ts";

const evento = (agregado_tipo: string, payload: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  agregado_tipo,
  agregado_id: "1",
  accion: "crear",
  revision: 1,
  payload,
});

Deno.test("agregado_tipo sin modelo mapeado -> error, nunca cuelga", async () => {
  const r = await publicarMock(evento("algo_no_mapeado"));
  assertEquals(r.estado, "error");
});

Deno.test("exito simulado trae modelo y odoo_id_simulado, nunca llama a Odoo real", async () => {
  const r = await publicarMock(evento("categoria_inventario"));
  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.modelo, "product.category");
  assertEquals(typeof r.resultado?.odoo_id_simulado, "number");
});

Deno.test("_mock_forzar permite simular error/incierto/reintento para probar el procesador", async () => {
  assertEquals((await publicarMock(evento("proveedor", { _mock_forzar: "error" }))).estado, "error");
  assertEquals((await publicarMock(evento("proveedor", { _mock_forzar: "incierto" }))).estado, "incierto");
  const r = await publicarMock(evento("proveedor", { _mock_forzar: "reintento" }));
  assertEquals(r.estado, "reintento");
  assertEquals(typeof r.reintentarEnMs, "number");
});

Deno.test("es determinista (mismo evento -> mismo resultado) -- no usa Math.random", async () => {
  const a = await publicarMock(evento("unidad"));
  const b = await publicarMock(evento("unidad"));
  assertEquals(a.resultado?.odoo_id_simulado, b.resultado?.odoo_id_simulado);
});
