import { assertEquals } from "jsr:@std/assert@1";
import { armarPendientes, tipoDeOperacion } from "./odoo-pendientes.ts";

Deno.test("tipo de operacion de Odoo -> tipo de pendiente", () => {
  assertEquals(["incoming", "outgoing", "internal", "mrp"].map(tipoDeOperacion), ["recepcion", "entrega", "interno", "otro"]);
});
Deno.test("arma filas con almacen, tipo, hora UTC y OC conocida por nombre", () => {
  const filas = armarPendientes(
    [{ id: 5, name: "WH/IN/00005", origin: "P00050", state: "assigned", picking_type_id: [1, "X: Recepciones"], scheduled_date: "2026-01-16 21:48:18" },
     { id: 6, name: "WH/OUT/1", origin: false, state: "draft", picking_type_id: [2, "X: Entregas"], scheduled_date: false }],
    [{ id: 1, code: "incoming", warehouse_id: [9, "RIVIERA BAY"] }, { id: 2, code: "outgoing", warehouse_id: [8, "ALMACEN PRINCIPAL"] }],
    new Map([["P00050", 77]]),
  );
  assertEquals(filas[0], { picking_id: 5, nombre: "WH/IN/00005", origin: "P00050", tipo: "recepcion", estado: "assigned", programada: "2026-01-16T21:48:18Z", almacen: "RIVIERA BAY", odoo_warehouse_id: 9, oc_odoo_id: 77 });
  assertEquals([filas[1].origin, filas[1].programada, filas[1].oc_odoo_id, filas[1].tipo], ["", null, null, "entrega"]);
});
