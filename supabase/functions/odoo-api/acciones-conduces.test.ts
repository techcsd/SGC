import { assertEquals } from "jsr:@std/assert@1";
import { OdooClient, OdooError } from "../_shared/odoo-client.ts";
import { ConduceStockError } from "../_shared/odoo-stock-directo.ts";
import { DEFINICIONES_CONDUCES, type AdminSgc } from "./acciones-conduces.ts";

const xmlInt = (n: number) => `<?xml version='1.0'?><methodResponse><params><param><value><int>${n}</int></value></param></params></methodResponse>`;
const xmlStruct = (items: string) => `<methodResponse><params><param><value><array><data>${items}</data></array></value></param></params></methodResponse>`;
const m2o = (id: number, n: string) => `<value><array><data><value><int>${id}</int></value><value><string>${n}</string></value></data></array></value>`;
const grupo = (id: number, nombre: string, qty: number, reserved = 0) =>
  `<value><struct><member><name>product_id</name>${m2o(id, nombre)}</member><member><name>quantity</name><value><double>${qty}</double></value></member><member><name>reserved_quantity</name><value><double>${reserved}</double></value></member></struct></value>`;

function fakeFetch(handler: (body: string) => string): typeof fetch {
  return (async (_u: string | URL | Request, init?: RequestInit) => new Response(await handler(String(init?.body)), { status: 200 })) as typeof fetch;
}

const odooConStock = (qty: number, reserved = 0) =>
  new OdooClient({
    url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1,
    entorno: (k) => k === "ODOO_HOSTS_ESCRITURA" ? "odoo.test" : undefined,
    fetchFn: fakeFetch((b) => b.includes("authenticate") ? xmlInt(2) : xmlStruct(grupo(7, "Cemento", qty, reserved))),
  });

const BODEGA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ART = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function adminFalso(over: Partial<{ fuente: boolean; contingencia: boolean; location: number | null; product: number | null; registrado?: string[]; degradado: boolean; marcados: string[] }> = {}): AdminSgc {
  const registrado: string[] = over.registrado ?? [];
  return {
    degradadoPermitido: () => Promise.resolve(over.degradado ?? false),
    registrarDegradado: (salidaId) => { over.marcados?.push(salidaId); return Promise.resolve(); },
    bodega: (id) => Promise.resolve({
      id, nombre: "Bodega Central", odoo_location_id: over.location === undefined ? 11 : over.location,
      odoo_warehouse_id: 3, codigo_odoo: "BA", fuente_odoo: over.fuente ?? true, contingencia: over.contingencia ?? false,
    }),
    articulos: () => Promise.resolve([{ id: ART, nombre: "Cemento gris", odoo_product_id: over.product === undefined ? 7 : over.product }]),
    registrarSalida: (args) => { registrado.push(args.modo); return Promise.resolve("cccccccc-cccc-4ccc-8ccc-cccccccccccc"); },
  };
}

const items = [{ articulo_id: ART, cantidad: 8 }];

Deno.test("stock.validar_salida: ok cuando Odoo tiene disponible", async () => {
  const r = await DEFINICIONES_CONDUCES["stock.validar_salida"].ejecutar(
    { odoo: odooConStock(10, 0), admin: adminFalso(), usuarioId: "u1" },
    { bodega_id: BODEGA, items },
  );
  assertEquals(r.ok, true);
  assertEquals(r.origen, "odoo");
});

Deno.test("stock.validar_salida: sin_stock lista solicitado y disponible", async () => {
  const e = await DEFINICIONES_CONDUCES["stock.validar_salida"].ejecutar(
    { odoo: odooConStock(3, 0), admin: adminFalso(), usuarioId: "u1" },
    { bodega_id: BODEGA, items },
  ).catch((x) => x);
  assertEquals(e instanceof ConduceStockError, true);
  assertEquals((e as ConduceStockError).codigo, "sin_stock");
  assertEquals((e as ConduceStockError).message.includes("solicitado 8, disponible 3"), true);
  assertEquals((e as ConduceStockError).faltantes[0].nombre, "Cemento gris");
});

Deno.test("stock.validar_salida: artículo no homologado", async () => {
  const e = await DEFINICIONES_CONDUCES["stock.validar_salida"].ejecutar(
    { odoo: odooConStock(10), admin: adminFalso({ product: null }), usuarioId: "u1" },
    { bodega_id: BODEGA, items },
  ).catch((x) => x);
  assertEquals((e as ConduceStockError).codigo, "no_homologado");
});

Deno.test("salidas.emitir: Odoo caído sin contingencia bloquea y no registra", async () => {
  const caido = new OdooClient({
    url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1,
    timeoutMs: 30,
    entorno: (k) => k === "ODOO_HOSTS_ESCRITURA" ? "odoo.test" : undefined,
    fetchFn: ((_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("abort", "AbortError")));
    })) as typeof fetch,
  });
  const reg: string[] = [];
  const e = await DEFINICIONES_CONDUCES["salidas.emitir"].ejecutar(
    { odoo: caido, admin: adminFalso({ registrado: reg }), usuarioId: "u1" },
    DEFINICIONES_CONDUCES["salidas.emitir"].normalizar({ fecha: "2026-11-21", bodega_id: BODEGA, motivo: "uso_proyecto", items }),
  ).catch((x) => x);
  assertEquals((e as ConduceStockError).codigo, "odoo_caido");
  assertEquals(reg, []);
});

Deno.test("salidas.emitir: Odoo caído con contingencia registra en modo sgc", async () => {
  const caido = () => { throw new OdooError("odoo_no_disponible", "down"); };
  const odoo = { call: caido, companyId: 1 } as unknown as OdooClient;
  const reg: string[] = [];
  const r = await DEFINICIONES_CONDUCES["salidas.emitir"].ejecutar(
    { odoo, admin: adminFalso({ contingencia: true, registrado: reg }), usuarioId: "u1" },
    DEFINICIONES_CONDUCES["salidas.emitir"].normalizar({ fecha: "2026-11-21", bodega_id: BODEGA, motivo: "uso_proyecto", items }),
  );
  assertEquals(r.validacion, "sgc");
  assertEquals(reg, ["sgc"]);
});

Deno.test("stock.validar_salida: bodega sin fuente Odoo no consulta existencias", async () => {
  const r = await DEFINICIONES_CONDUCES["stock.validar_salida"].ejecutar(
    { odoo: odooConStock(0), admin: adminFalso({ fuente: false }), usuarioId: "u1" },
    { bodega_id: BODEGA, items },
  );
  assertEquals(r, { ok: true, origen: "sgc", faltantes: [] });
});


const odooCaido = () => ({ call: () => { throw new OdooError("odoo_no_disponible", "down"); }, companyId: 1 }) as unknown as OdooClient;

Deno.test("DU degradado: Odoo caído + sondeo reciente => emite en modo sgc, avisa y deja constancia", async () => {
  const reg: string[] = []; const marcados: string[] = [];
  const r = await DEFINICIONES_CONDUCES["salidas.emitir"].ejecutar(
    { odoo: odooCaido(), admin: adminFalso({ degradado: true, registrado: reg, marcados }), usuarioId: "u1" },
    DEFINICIONES_CONDUCES["salidas.emitir"].normalizar({ fecha: "2026-11-22", bodega_id: BODEGA, motivo: "uso_proyecto", items }),
  );
  assertEquals(reg, ["sgc"]); assertEquals(r.validacion, "sgc");
  assertEquals(typeof r.aviso, "string"); assertEquals(marcados.length, 1);
});

Deno.test("DU degradado: Odoo caído + sondeo viejo/apagado => bloquea (odoo_caido) y no registra", async () => {
  const reg: string[] = []; const marcados: string[] = [];
  const e = await DEFINICIONES_CONDUCES["salidas.emitir"].ejecutar(
    { odoo: odooCaido(), admin: adminFalso({ degradado: false, registrado: reg, marcados }), usuarioId: "u1" },
    DEFINICIONES_CONDUCES["salidas.emitir"].normalizar({ fecha: "2026-11-22", bodega_id: BODEGA, motivo: "uso_proyecto", items }),
  ).catch((x) => x);
  assertEquals((e as ConduceStockError).codigo, "odoo_caido"); assertEquals(reg, []); assertEquals(marcados, []);
});

Deno.test("DU degradado: 'sin stock' en Odoo NUNCA se degrada, aunque el modo esté permitido", async () => {
  const reg: string[] = []; const marcados: string[] = [];
  const e = await DEFINICIONES_CONDUCES["salidas.emitir"].ejecutar(
    { odoo: odooConStock(2), admin: adminFalso({ degradado: true, registrado: reg, marcados }), usuarioId: "u1" },
    DEFINICIONES_CONDUCES["salidas.emitir"].normalizar({ fecha: "2026-11-22", bodega_id: BODEGA, motivo: "uso_proyecto", items }),
  ).catch((x) => x);
  assertEquals((e as ConduceStockError).codigo, "sin_stock"); assertEquals(reg, []); assertEquals(marcados, []);
});
