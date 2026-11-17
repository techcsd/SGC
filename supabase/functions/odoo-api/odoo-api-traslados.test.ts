// DS-08: acciones traslados.* del gateway odoo-api (Odoo y BD simulados; hosts ficticios, repo público).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Deps, manejar } from "./handler.ts";
import { ACCIONES_TRASLADOS_ESCRITURA, ACCIONES_TRASLADOS_LECTURA } from "./acciones-traslados.ts";
import { ACCIONES, type Accion } from "./acciones.ts";
import { CacheOdoo } from "../_shared/odoo-cache.ts";
import { LimitePorUsuario } from "../_shared/odoo-limite.ts";
import { CircuitoOdoo } from "../_shared/odoo-circuito.ts";
import { SemaforoOdoo } from "../_shared/odoo-semaforo.ts";
import { OdooError, type OdooClient } from "../_shared/odoo-client.ts";
import { odooFake } from "../_shared/odoo-fake-util.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const SALIDA = "11111111-2222-3333-4444-555555555555";
const req = (body: unknown) => new Request("https://x/odoo-api", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify(body) });

/** Odoo simulado + ubicación de tránsito y tipo interno con los campos que las acciones consultan. */
function odooTraslados(falla?: (m: string, mt: string) => Error | null) {
  const f = odooFake({ falla });
  const llamar = f.c.call.bind(f.c);
  const escrituras: string[] = [];
  const odoo = {
    companyId: 1,
    // deno-lint-ignore require-await
    async call(model: string, method: string, args: Any[] = [], kw: Any = {}) {
      if (model === "stock.location" && method === "search_read" && JSON.stringify(args[0]).includes("transit")) return [{ id: 13 }];
      if (model === "stock.warehouse") return [{ int_type_id: [5, "Internal"] }];
      if (["create", "write", "action_confirm", "button_validate", "action_cancel"].includes(method)) escrituras.push(`${model}.${method}`);
      return llamar(model, method, args, kw);
    },
  };
  return { odoo: odoo as unknown as OdooClient, f, escrituras };
}

/** BD simulada: tablas de una fila / lista, con el encadenado mínimo de supabase-js. */
function adminFalso(over: { salida?: Any; detalle?: Any[]; bodegas?: Record<string, Any> } = {}) {
  const tablas: Record<string, Any> = {
    salidas_inventario: over.salida === undefined ? { id: SALIDA, folio: "CND-1", estado: "despachado", es_prueba: false, bodega_id: "b1", destino_almacen_id: "b2", proyecto_id: null } : over.salida,
    detalle_salidas: over.detalle ?? [{ cantidad: 4, cantidad_recibida: null, articulos: { nombre: "Cemento", odoo_product_id: 7 } }],
    bodegas: over.bodegas ?? { b1: { odoo_location_id: 8, odoo_warehouse_id: 1 }, b2: { odoo_location_id: 10, odoo_warehouse_id: 2 } },
  };
  const from = (t: string) => {
    let id: string | null = null;
    const q: Any = {
      select: () => q, eq: (c: string, v: string) => { if (c === "id") id = v; return q; }, limit: () => q,
      maybeSingle: () => Promise.resolve({ data: t === "bodegas" ? (tablas.bodegas[id ?? ""] ?? null) : tablas[t] }),
      // deno-lint-ignore no-thenable
      then: (r: Any) => Promise.resolve({ data: t === "detalle_salidas" ? tablas[t] : [tablas[t]] }).then(r),
    };
    return q;
  };
  return { from, rpc: () => Promise.resolve({ data: null, error: null }) } as Any;
}

interface Extra { modulos?: string[]; adminDb?: () => Any; sinPolitica?: boolean; politica?: () => string | null }
function deps(odoo?: () => OdooClient, x: Extra = {}): Deps {
  const d: Any = {
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: x.modulos ?? ["inventario"] }),
    odoo: odoo ?? (() => odooTraslados().odoo),
    caches: Object.fromEntries(ACCIONES.map((a) => [a, new CacheOdoo(0)])) as Record<Accion, CacheOdoo>,
    limite: new LimitePorUsuario(), circuito: new CircuitoOdoo(100, 30_000), semaforo: new SemaforoOdoo(100),
    origenes: [], admin: x.adminDb ?? (() => adminFalso()),
  };
  if (!x.sinPolitica) d.bloqueoEscrituraTraslados = x.politica ?? (() => null);
  return d as Deps;
}
const cuerpo = async (r: Response) => await r.json() as Any;
const crearA = (d: Deps) => manejar(req({ accion: "traslados.crear", params: { salida_id: SALIDA, paso: "A" } }), d);

Deno.test("traslados: las 6 acciones existen (2 lecturas + 4 escrituras)", () => {
  assertEquals([...ACCIONES_TRASLADOS_LECTURA, ...ACCIONES_TRASLADOS_ESCRITURA].sort(),
    ["traslados.cancelar", "traslados.crear", "traslados.devolver", "traslados.listar", "traslados.obtener", "traslados.validar"]);
});

Deno.test("traslados: sin módulo inventario → 403 y no llama a Odoo ni a la política", async () => {
  let llamado = false;
  const d = deps(() => { llamado = true; return odooTraslados().odoo; }, { modulos: ["compras"], politica: () => { llamado = true; return null; } });
  for (const a of ["traslados.listar", "traslados.crear"]) assertEquals((await manejar(req({ accion: a, params: { salida_id: SALIDA, paso: "A" } }), d)).status, 403);
  assertEquals(llamado, false);
});

Deno.test("traslados.crear: política bloqueada → 403 escritura_bloqueada y NO se escribe en Odoo", async () => {
  const o = odooTraslados();
  const r = await crearA(deps(() => o.odoo, { politica: () => "El servidor Odoo configurado no está autorizado para escritura." }));
  assertEquals(r.status, 403);
  assertEquals((await cuerpo(r)).error_code, "escritura_bloqueada");
  assertEquals(o.escrituras, []);
});

Deno.test("traslados.*: sin dependencia de política (no configurada) NO escribe", async () => {
  const o = odooTraslados();
  assertEquals((await crearA(deps(() => o.odoo, { sinPolitica: true }))).status, 403);
  assertEquals(o.escrituras, []);
});

Deno.test("traslados.crear: valida parámetros antes de nada (uuid, paso)", async () => {
  for (const p of [{}, { salida_id: "x", paso: "A" }, { salida_id: SALIDA }, { salida_id: SALIDA, paso: "C" }]) {
    assertEquals((await manejar(req({ accion: "traslados.crear", params: p }), deps())).status, 400);
  }
});

Deno.test("traslados.crear: A crea SGC-TRAS-<salida>-A origen→tránsito leyendo todo de la BD; repetir es idempotente", async () => {
  const o = odooTraslados();
  const d = deps(() => o.odoo);
  const r1 = await crearA(d);
  assertEquals(r1.status, 200);
  const b1 = (await cuerpo(r1)).data;
  assertEquals([b1.repetido, b1.estado], [false, "draft"]);
  const p = o.f.pickings[0];
  assertEquals(p.origin, `SGC-TRAS-${SALIDA}-A`);
  assertEquals([p.location_id[0], p.location_dest_id[0], p.picking_type_id[0]], [8, 13, 5]);
  const b2 = (await cuerpo(await crearA(d))).data;
  assertEquals([b2.repetido, o.f.pickings.length], [true, 1]);
});

Deno.test("traslados.crear: B usa lo recibido (tránsito→destino)", async () => {
  const o = odooTraslados();
  const admin = adminFalso({ detalle: [{ cantidad: 4, cantidad_recibida: 3, articulos: { nombre: "Cemento", odoo_product_id: 7 } }] });
  const r = await manejar(req({ accion: "traslados.crear", params: { salida_id: SALIDA, paso: "B" } }), deps(() => o.odoo, { adminDb: () => admin }));
  assertEquals(r.status, 200);
  assertEquals([o.f.moves[0].product_uom_qty, o.f.pickings[0].location_id[0], o.f.pickings[0].location_dest_id[0]], [3, 13, 10]);
});

Deno.test("traslados.crear: rechaza salida inexistente, de prueba, anulada, sin vínculo o con almacén sin homologar", async () => {
  const casos: Array<[string, Any]> = [
    ["no existe", { salida: null }],
    ["prueba", { salida: { id: SALIDA, estado: "despachado", es_prueba: true, bodega_id: "b1", destino_almacen_id: "b2" } }],
    ["anulada", { salida: { id: SALIDA, estado: "anulado", es_prueba: false, bodega_id: "b1", destino_almacen_id: "b2" } }],
    ["sin vínculo", { detalle: [{ cantidad: 1, cantidad_recibida: null, articulos: { nombre: "X", odoo_product_id: null } }] }],
    ["origen sin homologar", { bodegas: { b1: { odoo_location_id: null, odoo_warehouse_id: null }, b2: { odoo_location_id: 10 } } }],
    ["destino sin homologar", { bodegas: { b1: { odoo_location_id: 8, odoo_warehouse_id: 1 }, b2: { odoo_location_id: null } } }],
  ];
  for (const [motivo, over] of casos) {
    const o = odooTraslados();
    const r = await crearA(deps(() => o.odoo, { adminDb: () => adminFalso(over) }));
    assertEquals(r.status, 400, motivo);
    assertEquals(o.escrituras, [], motivo);
  }
});

Deno.test("traslados.validar/cancelar/devolver: sobre un picking SGC funcionan; sobre uno ajeno → 400 sin escribir", async () => {
  const o = odooTraslados();
  const d = deps(() => o.odoo);
  await crearA(d);
  const pid = o.f.pickings[0].id;
  const v = await manejar(req({ accion: "traslados.validar", params: { picking_id: pid } }), d);
  assertEquals([v.status, (await cuerpo(v)).data.estado], [200, "done"]);
  const v2 = (await cuerpo(await manejar(req({ accion: "traslados.validar", params: { picking_id: pid } }), d))).data;
  assertEquals(v2.repetido, true);
  assertEquals((await manejar(req({ accion: "traslados.cancelar", params: { picking_id: pid } }), d)).status, 400); // validado: se devuelve, no se cancela
  assertEquals((await manejar(req({ accion: "traslados.devolver", params: { picking_id: pid } }), d)).status, 200);
  assertEquals(o.f.pickings[1].origin, `SGC-TRAS-${SALIDA}-A-D1`);
  assertEquals(o.f.pickings[1].location_id[0], 13); // inverso: tránsito → origen
  o.f.pickings.push({ id: 99, name: "AJENO", state: "draft", origin: "P00001", move_ids: [], location_id: [1, "x"], location_dest_id: [8, "y"] });
  const antes = o.escrituras.length;
  for (const a of ["traslados.validar", "traslados.cancelar", "traslados.devolver"]) {
    assertEquals((await manejar(req({ accion: a, params: { picking_id: 99 } }), d)).status, 400, a);
  }
  assertEquals(o.escrituras.length, antes);
});

Deno.test("traslados.cancelar: un borrador se cancela", async () => {
  const o = odooTraslados();
  const d = deps(() => o.odoo);
  await crearA(d);
  const r = await manejar(req({ accion: "traslados.cancelar", params: { picking_id: o.f.pickings[0].id } }), d);
  assertEquals([r.status, (await cuerpo(r)).data.estado], [200, "cancel"]);
});

Deno.test("traslados.validar: sin existencias → 400 con mensaje por rol (sin detalle de Odoo); picking inexistente → 400", async () => {
  const o = odooTraslados((m, mt) => (m === "stock.picking" && mt === "button_validate" ? new OdooError("odoo_error", "Not enough inventory SECRETO", true) : null));
  const d = deps(() => o.odoo);
  await crearA(d);
  const r = await manejar(req({ accion: "traslados.validar", params: { picking_id: o.f.pickings[0].id } }), d);
  const b = await cuerpo(r);
  assertEquals([r.status, b.error_code], [400, "sin_stock"]);
  assert(!JSON.stringify(b).includes("SECRETO"));
  assertEquals((await manejar(req({ accion: "traslados.validar", params: { picking_id: 12345 } }), d)).status, 400);
});

Deno.test("traslados.validar: timeout de Odoo → odoo_reintentar (504), sin reintento automático", async () => {
  let n = 0;
  const o = odooTraslados((_m, mt) => { if (mt === "action_assign") { n++; return new OdooError("odoo_timeout", "t"); } return null; });
  const d = deps(() => o.odoo);
  await crearA(d);
  const r = await manejar(req({ accion: "traslados.validar", params: { picking_id: o.f.pickings[0].id } }), d);
  assertEquals([r.status, (await cuerpo(r)).error_code, n], [504, "odoo_reintentar", 1]);
});

Deno.test("traslados.obtener/listar: solo traslados SGC, formato y validación", async () => {
  const o = odooTraslados();
  const d = deps(() => o.odoo);
  await crearA(d);
  o.f.pickings.push({ id: 99, name: "AJENO", state: "draft", origin: "P00001", move_ids: [], location_id: [1, "x"], location_dest_id: [8, "y"] });
  const ob = await cuerpo(await manejar(req({ accion: "traslados.obtener", params: { picking_id: o.f.pickings[0].id } }), d));
  assertEquals([ob.data.traslado.origin, ob.data.traslado.estado, ob.data.traslado.movimientos], [`SGC-TRAS-${SALIDA}-A`, "draft", 1]);
  assertEquals((await manejar(req({ accion: "traslados.obtener", params: { picking_id: 99 } }), d)).status, 400);
  assertEquals((await cuerpo(await manejar(req({ accion: "traslados.obtener", params: { picking_id: 777 } }), d))).data.traslado, null);
  const l = await cuerpo(await manejar(req({ accion: "traslados.listar", params: { salida_id: SALIDA } }), d));
  assertEquals(l.data.traslados.length, 1);
  for (const p of [{ salida_id: "x" }, { limite: 0 }, { limite: 9999 }, { desde: "ayer" }]) {
    assertEquals((await manejar(req({ accion: "traslados.listar", params: p }), d)).status, 400, JSON.stringify(p));
  }
  assertEquals((await manejar(req({ accion: "traslados.obtener", params: { picking_id: "abc" } }), d)).status, 400);
});

Deno.test("traslados.listar: la lectura no exige política de escritura (funciona con el bloqueo activo)", async () => {
  const o = odooTraslados();
  const r = await manejar(req({ accion: "traslados.listar", params: {} }), deps(() => o.odoo, { politica: () => "bloqueado" }));
  assertEquals(r.status, 200);
});
