import { assertEquals } from "jsr:@std/assert@1";
import { OdooError } from "./odoo-client.ts";
import {
  enriquecerFaltantes, esOdooCaido, fallbackSgcHabilitado, listarAlmacenesOdoo,
  mensajeFaltantes, MENSAJE_ODOO_CAIDO, validarStockOdoo,
} from "./odoo-stock-directo.ts";
import type { LlamadorOdoo } from "./odoo-traslados.ts";

Deno.test("mensajeFaltantes lista producto, solicitado y disponible", () => {
  const m = mensajeFaltantes([
    { productId: 7, pedido: 10, disponible: 3.5, nombre: "Cemento gris" },
    { productId: 8, pedido: 2, disponible: 0, nombre: "Varilla 3/8" },
  ]);
  assertEquals(m.includes("Cemento gris: solicitado 10, disponible 3.5"), true);
  assertEquals(m.includes("Varilla 3/8: solicitado 2, disponible 0"), true);
  assertEquals(m.startsWith("No hay existencias suficientes en el almacén de origen."), true);
});

Deno.test("enriquecerFaltantes usa el nombre del mapa y redondea", () => {
  const r = enriquecerFaltantes(
    [{ productId: 1, pedido: 0.30000000000000004, disponible: 0.1 }],
    new Map([[1, { nombre: "Arena", articulo_id: "a1" }]]),
  );
  assertEquals(r, [{ productId: 1, pedido: 0.3, disponible: 0.1, nombre: "Arena", articulo_id: "a1" }]);
});

Deno.test("esOdooCaido distingue transporte de rechazo de negocio", () => {
  assertEquals(esOdooCaido(new OdooError("odoo_timeout", "t")), true);
  assertEquals(esOdooCaido(new OdooError("odoo_no_disponible", "n")), true);
  assertEquals(esOdooCaido(new OdooError("odoo_error", "fault", true)), false);
  assertEquals(esOdooCaido(new Error("x")), false);
});

Deno.test("fallbackSgcHabilitado solo con el interruptor en true", () => {
  assertEquals(fallbackSgcHabilitado(() => undefined), false);
  assertEquals(fallbackSgcHabilitado((k) => k === "ODOO_CONDUCE_FALLBACK_SGC" ? "true" : undefined), true);
  assertEquals(fallbackSgcHabilitado((k) => k === "ODOO_CONDUCE_FALLBACK_SGC" ? "1" : undefined), false);
});

function llamador(respuestas: Record<string, unknown>): LlamadorOdoo {
  return {
    call(model, method) {
      return Promise.resolve(respuestas[`${model}.${method}`]);
    },
  };
}

Deno.test("listarAlmacenesOdoo mapea warehouse + lot_stock_id", async () => {
  const c = llamador({
    "stock.warehouse.search_read": [
      { id: 3, code: "BA", name: "Bodega Central", lot_stock_id: [11, "BA/Stock"] },
      { id: 4, code: "OF", name: "Oficina", lot_stock_id: false },
    ],
  });
  assertEquals(await listarAlmacenesOdoo(c, 1), [
    { warehouse_id: 3, codigo: "BA", nombre: "Bodega Central", location_id: 11 },
    { warehouse_id: 4, codigo: "OF", nombre: "Oficina", location_id: null },
  ]);
});

Deno.test("validarStockOdoo: ok si hay disponible; faltante si no alcanza", async () => {
  const ok = llamador({
    "stock.quant.read_group": [{ product_id: [7, "Cemento"], quantity: 10, reserved_quantity: 2 }],
  });
  assertEquals(await validarStockOdoo(ok, 8, [
    { articulo_id: "a", cantidad: 8, nombre: "Cemento", odoo_product_id: 7 },
  ]), []);

  const corto = llamador({
    "stock.quant.read_group": [{ product_id: [7, "Cemento"], quantity: 10, reserved_quantity: 2 }],
  });
  const falta = await validarStockOdoo(corto, 8, [
    { articulo_id: "a", cantidad: 9, nombre: "Cemento", odoo_product_id: 7 },
  ]);
  assertEquals(falta, [{ productId: 7, pedido: 9, disponible: 8, nombre: "Cemento", articulo_id: "a" }]);
});

Deno.test("MENSAJE_ODOO_CAIDO es claro y no pide datos técnicos", () => {
  assertEquals(MENSAJE_ODOO_CAIDO.includes("Odoo no responde"), true);
});
