// DS-08: pruebas de la biblioteca de traslados con un Odoo simulado en memoria. Contrato real: scripts/odoo-contrato-traslados-staging.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { OdooError } from "./odoo-client.ts";
import {
  cancelarTraslado, crearTraslado, devolverTraslado, faltantesDeStock, type LlamadorOdoo, originTraslado, publicarNotaPicking,
  resolverAutorOdoo, textoChatter, TrasladoError, validarTraslado,
} from "./odoo-traslados.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
interface Opciones { stock?: number; usage?: string; backorder?: boolean; falla?: (m: string, mt: string) => Error | null }

function odooFalso(o: Opciones = {}) {
  const pickings: Any[] = []; const moves: Any[] = []; const llamadas: string[] = []; const notas: Any[] = [];
  const c: LlamadorOdoo = {
    // deno-lint-ignore require-await
    async call(model, method, args = [], kw = {}) {
      llamadas.push(`${model}.${method}`);
      const f = o.falla?.(model, method); if (f) throw f;
      if (model === "stock.picking" && method === "search_read") {
        const origin = args[0].find((d: Any) => d[0] === "origin")[2];
        return pickings.filter((p) => (args[0].some((d: Any) => d[1] === "=like") ? p.origin.startsWith(origin.replace("%", "")) : p.origin === origin)).map((p) => ({ id: p.id, name: p.name, state: p.state, origin: p.origin }));
      }
      if (model === "stock.picking" && method === "create") {
        const v = args[0]; const id = pickings.length + 1; const ids: number[] = [];
        for (const [, , m] of v.move_ids_without_package) { const mid = moves.length + 1; moves.push({ id: mid, ...m, state: "draft", quantity: 0 }); ids.push(mid); }
        pickings.push({ id, name: `WH/INT/${id}`, state: "draft", origin: v.origin, location_id: [v.location_id, "x"], location_dest_id: [v.location_dest_id, "y"], picking_type_id: [v.picking_type_id, "t"], move_ids: ids });
        return id;
      }
      if (model === "stock.picking" && method === "read") return args[0].map((id: number) => pickings.find((p) => p.id === id)).filter(Boolean);
      if (model === "stock.picking" && method === "action_confirm") { pickings.find((p) => p.id === args[0][0]).state = "confirmed"; return true; }
      if (model === "stock.picking" && method === "action_assign") return true;
      if (model === "stock.move" && method === "read") return args[0].map((id: number) => { const m = moves.find((x) => x.id === id); return { ...m, product_id: [m.product_id, "p"], product_uom: [1, "u"] }; });
      if (model === "stock.move" && method === "write") { moves.find((m) => m.id === args[0][0]).quantity = args[1].quantity; return true; }
      if (model === "stock.picking" && method === "button_validate") {
        if (o.backorder) return { res_model: "stock.backorder.confirmation" };
        pickings.find((p) => p.id === args[0][0]).state = "done"; return true;
      }
      if (model === "stock.picking" && method === "action_cancel") { pickings.find((p) => p.id === args[0][0]).state = "cancel"; return true; }
      if (model === "stock.picking" && method === "message_post") { notas.push(kw); return 1; }
      if (model === "stock.location") return [{ usage: o.usage ?? "internal" }];
      if (model === "stock.quant") return [{ product_id: [7, "p"], quantity: o.stock ?? 100, reserved_quantity: 0 }];
      if (model === "product.product" && method === "search_read") return [{ id: 7, display_name: "Cemento" }];
      if (model === "res.users") return (kw.limit && args[0][0][2] === "uno@csd.com") ? [{ partner_id: [55, "Uno"] }] : [];
      if (model === "hr.employee") return args[0][0][2] === "00112345678" ? [{ work_contact_id: [66, "Emp"], name: "Emp" }] : [];
      throw new Error(`no simulado ${model}.${method}`);
    },
  };
  return { c, pickings, moves, llamadas, notas };
}
const base = { salidaId: "uuid-1", paso: "A" as const, origenLocationId: 8, destinoLocationId: 13, pickingTypeId: 5, companyId: 1, items: [{ productId: 7, cantidad: 3 }] };

Deno.test("origin canonico SGC-TRAS-<salida>-A|B", () => {
  assertEquals(originTraslado("abc", "A"), "SGC-TRAS-abc-A");
  assertEquals(originTraslado("abc", "B"), "SGC-TRAS-abc-B");
});

Deno.test("crear: picking con el origin y las lineas; idempotente (no duplica)", async () => {
  const { c, pickings } = odooFalso();
  const r1 = await crearTraslado(c, base);
  const r2 = await crearTraslado(c, base);
  assertEquals([r1.reutilizado, r2.reutilizado, pickings.length, r2.pickingId], [false, true, 1, r1.pickingId]);
  assertEquals(pickings[0].origin, "SGC-TRAS-uuid-1-A");
});

Deno.test("crear: valida datos (mismo origen y destino, sin items, cantidad <= 0, producto sin homologar)", async () => {
  const { c } = odooFalso();
  for (const m of [{ destinoLocationId: 8 }, { items: [] }, { items: [{ productId: 7, cantidad: 0 }] }, { items: [{ productId: 0, cantidad: 1 }] }]) {
    const e = await assertRejects(() => crearTraslado(c, { ...base, ...m }), TrasladoError);
    assertEquals((e as TrasladoError).codigo, "datos");
  }
});

Deno.test("validar: confirma, fija quantity = demanda y valida (sin asistente inmediato)", async () => {
  const { c, pickings, moves, llamadas } = odooFalso();
  const r = await crearTraslado(c, base);
  const v = await validarTraslado(c, r.pickingId);
  assertEquals([v.estado, pickings[0].state, moves[0].quantity], ["done", "done", 3]);
  assertEquals(llamadas.includes("stock.immediate.transfer.process"), false);
});

Deno.test("validar: ya validado = idempotente y no vuelve a escribir", async () => {
  const { c, llamadas } = odooFalso();
  const r = await crearTraslado(c, base);
  await validarTraslado(c, r.pickingId);
  const antes = llamadas.filter((l) => l === "stock.picking.button_validate").length;
  const v = await validarTraslado(c, r.pickingId);
  assertEquals([v.reutilizado, llamadas.filter((l) => l === "stock.picking.button_validate").length], [true, antes]);
});

Deno.test("validar: backorder (parcial) se rechaza", async () => {
  const { c } = odooFalso({ backorder: true });
  const r = await crearTraslado(c, base);
  const e = await assertRejects(() => validarTraslado(c, r.pickingId), TrasladoError);
  assertEquals((e as TrasladoError).codigo, "parcial_no_permitido");
});

Deno.test("validar: sin stock en origen interno -> sin_stock y NO llama button_validate (Odoo permite negativos)", async () => {
  const { c, llamadas } = odooFalso({ stock: 1 });
  const r = await crearTraslado(c, base);
  const e = await assertRejects(() => validarTraslado(c, r.pickingId), TrasladoError);
  assertEquals([(e as TrasladoError).codigo, llamadas.includes("stock.picking.button_validate")], ["sin_stock", false]);
});

Deno.test("validar: desde transito (paso B) no exige stock", async () => {
  const { c } = odooFalso({ stock: 0, usage: "transit" });
  const r = await crearTraslado(c, { ...base, paso: "B", origenLocationId: 13, destinoLocationId: 9 });
  assertEquals((await validarTraslado(c, r.pickingId)).estado, "done");
});

Deno.test("faltantesDeStock suma lo pedido por producto y compara con lo disponible", async () => {
  const { c } = odooFalso({ stock: 5 });
  assertEquals(await faltantesDeStock(c, 8, [{ productId: 7, cantidad: 3 }, { productId: 7, cantidad: 2 }]), []);
  assertEquals(await faltantesDeStock(c, 8, [{ productId: 7, cantidad: 3 }, { productId: 7, cantidad: 3 }]), [{ productId: 7, pedido: 6, disponible: 5 }]);
});

Deno.test("cancelar: borrador ok, validado se rechaza", async () => {
  const { c } = odooFalso();
  const a = await crearTraslado(c, base);
  assertEquals((await cancelarTraslado(c, a.pickingId)).estado, "cancel");
  const b = await crearTraslado(c, { ...base, salidaId: "uuid-2" });
  await validarTraslado(c, b.pickingId);
  const e = await assertRejects(() => cancelarTraslado(c, b.pickingId), TrasladoError);
  assertEquals((e as TrasladoError).codigo, "estado_invalido");
});

Deno.test("devolver: traslado inverso con origin propio, idempotente", async () => {
  const { c, pickings } = odooFalso({ usage: "transit" });
  const a = await crearTraslado(c, base);
  await validarTraslado(c, a.pickingId);
  const d1 = await devolverTraslado(c, a.pickingId, { salidaId: "uuid-1", paso: "A", companyId: 1 });
  const d2 = await devolverTraslado(c, a.pickingId, { salidaId: "uuid-1", paso: "A", companyId: 1 });
  assertEquals([d1.estado, d2.reutilizado, pickings.length, pickings[1].origin], ["done", true, 2, "SGC-TRAS-uuid-1-A-D1"]);
  assertEquals([pickings[1].location_id[0], pickings[1].location_dest_id[0]], [13, 8]);
});

Deno.test("devolver: solo un movimiento validado", async () => {
  const { c } = odooFalso();
  const a = await crearTraslado(c, base);
  await assertRejects(() => devolverTraslado(c, a.pickingId, { salidaId: "uuid-1", paso: "A", companyId: 1 }), TrasladoError);
});

Deno.test("errores de Odoo (fault) se traducen sin traza; fallas de transporte se relanzan tal cual", async () => {
  const fault = odooFalso({ falla: (_m, mt) => (mt === "create" ? new OdooError("odoo_error", "Traceback ... ValidationError: raro", true) : null) });
  const e = await assertRejects(() => crearTraslado(fault.c, base), TrasladoError);
  assertEquals([(e as TrasladoError).codigo, (e as TrasladoError).message.includes("Traceback")], ["odoo", false]);
  const caido = odooFalso({ falla: (_m, mt) => (mt === "create" ? new OdooError("odoo_timeout", "Odoo no respondió a tiempo.") : null) });
  const e2 = await assertRejects(() => crearTraslado(caido.c, base), OdooError);
  assertEquals((e2 as OdooError).codigo, "odoo_timeout");
});

Deno.test("resolverAutorOdoo: usuario interno -> empleado por cedula -> cuenta tecnica", async () => {
  const { c } = odooFalso();
  assertEquals((await resolverAutorOdoo(c, { correo: "Uno@csd.com", tecnicoPartnerId: 1 })).via, "usuario_interno");
  assertEquals((await resolverAutorOdoo(c, { correo: "x@y.z", cedula: "001-1234567-8", tecnicoPartnerId: 1 })).via, "empleado");
  assertEquals(await resolverAutorOdoo(c, { correo: null, cedula: null, tecnicoPartnerId: 1 }), { partnerId: 1, via: "cuenta_tecnica" });
});

Deno.test("chatter: texto plano (sin HTML), firma «vía SGC» y email_from si el autor no tiene correo", async () => {
  assertEquals(textoChatter("Despacho <b>listo</b>", { nombre: "Ana" }), "Despacho listo\n— vía SGC (Ana)");
  const { c, notas } = odooFalso();
  await publicarNotaPicking(c, 1, "Hola <i>x</i>", { partnerId: 9, via: "empleado", sinCorreo: true }, "sgc@csd.test");
  assertEquals([notas[0].body.includes("<"), notas[0].author_id, notas[0].email_from, notas[0].subtype_xmlid], [false, 9, "sgc@csd.test", "mail.mt_note"]);
});
