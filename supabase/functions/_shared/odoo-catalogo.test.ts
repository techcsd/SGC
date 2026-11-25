import { assertEquals } from "jsr:@std/assert@1";
import { aFilaImportacion, leerProductosParaImportar, productosDesconocidos } from "./odoo-catalogo.ts";

Deno.test("aFilaImportacion mapea un producto de Odoo 19", () => {
  assertEquals(
    aFilaImportacion({ id: 835, name: " 1-1/2″  X4 FILLER ", default_code: false, uom_id: [1, "Unidades"], product_tmpl_id: [700, "x"] }),
    { product_id: 835, template_id: 700, codigo: null, nombre: "1-1/2″ X4 FILLER", unidad: "Unidades" },
  );
});

Deno.test("aFilaImportacion descarta productos sin nombre o sin plantilla", () => {
  assertEquals(aFilaImportacion({ id: 1, name: "", product_tmpl_id: [2, "x"] }), null);
  assertEquals(aFilaImportacion({ id: 1, name: "A", product_tmpl_id: false }), null);
});

Deno.test("productosDesconocidos no repite ni incluye conocidos", () => {
  assertEquals(productosDesconocidos([1, 2, 2, 3], new Set([1])), [2, 3]);
});

Deno.test("leerProductosParaImportar pide por lotes de 200 e incluye archivados", async () => {
  const llamadas: unknown[][] = [];
  const c = {
    call: (_m: string, _x: string, args: unknown[]) => {
      llamadas.push(args);
      const ids = ((args[0] as unknown[][])[0][2]) as number[];
      return Promise.resolve(ids.map((id) => ({ id, name: `P${id}`, default_code: "", uom_id: [1, "Unidades"], product_tmpl_id: [id + 1000, "t"] })));
    },
  };
  const ids = Array.from({ length: 450 }, (_, i) => i + 1);
  const filas = await leerProductosParaImportar(c as never, ids);
  assertEquals(filas.length, 450);
  assertEquals(llamadas.length, 3);
  assertEquals((llamadas[0][0] as unknown[][])[1], ["active", "in", [true, false]]);
});
