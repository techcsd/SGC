// Tests del cliente XML-RPC y del gateway odoo-api. Correr con:
//   deno test supabase/functions/odoo-api/odoo-api.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { encodeCall, OdooClient, OdooError, parseResponse } from "../_shared/odoo-client.ts";
import { type Deps, manejar } from "./handler.ts";

const xmlInt = (n: number) => `<?xml version='1.0'?><methodResponse><params><param><value><int>${n}</int></value></param></params></methodResponse>`;
const xmlStruct = (items: string) => `<methodResponse><params><param><value><array><data>${items}</data></array></value></param></params></methodResponse>`;

function fakeFetch(handler: (body: string) => string | Promise<string>, calls: string[] = []): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body);
    calls.push(body);
    return new Response(await handler(body), { status: 200 });
  }) as typeof fetch;
}

const cfg = (fetchFn: typeof fetch, extra = {}) => ({ url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1, fetchFn, ...extra });

Deno.test("parseResponse: struct/array/int/bool/nil/many2one", () => {
  const xml = xmlStruct(`<value><struct>
    <member><name>id</name><value><int>7</int></value></member>
    <member><name>product_id</name><value><array><data><value><int>3</int></value><value><string>Cemento &amp; Co</string></value></data></array></value></member>
    <member><name>activo</name><value><boolean>1</boolean></value></member>
    <member><name>x</name><value><nil/></value></member>
    <member><name>q</name><value><double>2.5</double></value></member></struct></value>`);
  assertEquals(parseResponse(xml), [{ id: 7, product_id: [3, "Cemento & Co"], activo: true, x: null, q: 2.5 }]);
});

Deno.test("parseResponse: fault se traduce a OdooError corto", () => {
  const xml = `<methodResponse><fault><value><struct><member><name>faultString</name><value><string>Traceback\n  File x\nodoo.exceptions.AccessError: sin permiso</string></value></member></struct></value></fault></methodResponse>`;
  try { parseResponse(xml); throw new Error("no lanzó"); } catch (e) {
    assert(e instanceof OdooError);
    assertEquals(e.message, "odoo.exceptions.AccessError: sin permiso");
  }
});

Deno.test("encodeCall escapa XML", () => {
  assert(encodeCall("m", ["a<b&c"]).includes("a&lt;b&amp;c"));
});

Deno.test("OdooClient: autentica una vez y reutiliza uid", async () => {
  const calls: string[] = [];
  const f = fakeFetch((b) => b.includes("authenticate") ? xmlInt(9) : xmlStruct(""), calls);
  const c = new OdooClient(cfg(f));
  await c.executeKw("stock.quant", "read_group", [[]]);
  await c.executeKw("stock.quant", "read_group", [[]]);
  assertEquals(calls.filter((b) => b.includes("authenticate")).length, 1);
  assertEquals(calls.length, 3);
});

Deno.test("OdooClient: credenciales rechazadas → odoo_auth", async () => {
  const c = new OdooClient(cfg(fakeFetch(() => `<methodResponse><params><param><value><boolean>0</boolean></value></param></params></methodResponse>`)));
  const e = await c.executeKw("m", "x", []).catch((x) => x);
  assertEquals((e as OdooError).codigo, "odoo_auth");
});

Deno.test("OdooClient: timeout → odoo_timeout", async () => {
  const lento = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(new DOMException("abort", "AbortError")));
  })) as typeof fetch;
  const c = new OdooClient(cfg(lento, { timeoutMs: 30 }));
  const e = await c.executeKw("m", "x", []).catch((x) => x);
  assertEquals((e as OdooError).codigo, "odoo_timeout");
});

Deno.test("OdooClient: Odoo caído (red) y HTTP 502 → odoo_no_disponible", async () => {
  const caido = (() => Promise.reject(new TypeError("conn refused"))) as typeof fetch;
  assertEquals(((await new OdooClient(cfg(caido)).executeKw("m", "x", []).catch((x) => x)) as OdooError).codigo, "odoo_no_disponible");
  const http = (() => Promise.resolve(new Response("bad", { status: 502 }))) as typeof fetch;
  assertEquals(((await new OdooClient(cfg(http)).executeKw("m", "x", []).catch((x) => x)) as OdooError).codigo, "odoo_no_disponible");
});

// ── Gateway ────────────────────────────────────────────────────────────────
const req = (body: unknown, auth: string | null = "Bearer t") =>
  new Request("https://x/odoo-api", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) });

function deps(over: Partial<Deps> & { calls?: string[]; respuesta?: string } = {}): Deps {
  const calls = over.calls ?? [];
  const f = fakeFetch((b) => b.includes("authenticate") ? xmlInt(2) : (over.respuesta ?? xmlStruct("")), calls);
  return {
    autenticar: over.autenticar ?? (() => Promise.resolve({ es_admin: false, modulos: ["inventario"] })),
    odoo: over.odoo ?? (() => new OdooClient(cfg(f))),
  };
}

Deno.test("gateway: sin Authorization → 401", async () => {
  assertEquals((await manejar(req({ accion: "stock.consultar" }, null), deps())).status, 401);
});

Deno.test("gateway: usuario sin módulo inventario → 403 y NO llama a Odoo", async () => {
  const calls: string[] = [];
  const d = deps({ calls, autenticar: () => Promise.resolve({ es_admin: false, modulos: ["compras"] }) });
  const r = await manejar(req({ accion: "stock.consultar", params: {} }), d);
  assertEquals(r.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("gateway: admin sin módulo explícito pasa", async () => {
  const d = deps({ autenticar: () => Promise.resolve({ es_admin: true, modulos: [] }) });
  assertEquals((await manejar(req({ accion: "ubicaciones.listar" }), d)).status, 200);
});

Deno.test("gateway: allowlist — acción/modelo libre rechazado con 400 sin tocar Odoo", async () => {
  const calls: string[] = [];
  for (const accion of ["stock.quant.unlink", "execute_kw", "", 5, null]) {
    const r = await manejar(req({ accion, params: { model: "res.users", method: "unlink" } }), deps({ calls }));
    assertEquals(r.status, 400);
  }
  assertEquals(calls.length, 0);
});

Deno.test("gateway: stock.consultar usa UNA llamada read_group agrupada y mapea filas", async () => {
  const calls: string[] = [];
  const grupo = (p: number, l: number, q: number, r: number) => `<value><struct>
    <member><name>product_id</name><value><array><data><value><int>${p}</int></value><value><string>P${p}</string></value></data></array></value></member>
    <member><name>location_id</name><value><array><data><value><int>${l}</int></value><value><string>WH/Stock</string></value></data></array></value></member>
    <member><name>quantity</name><value><double>${q}</double></value></member>
    <member><name>reserved_quantity</name><value><double>${r}</double></value></member></struct></value>`;
  const respuesta = xmlStruct(grupo(1, 8, 10, 2.5) + grupo(2, 8, 4, 0));
  const r = await manejar(req({ accion: "stock.consultar", params: { tamano: 1, pagina: 1 } }), deps({ calls, respuesta }));
  assertEquals(r.status, 200);
  const { data } = await r.json();
  assertEquals(data.hay_mas, true);
  assertEquals(data.filas.length, 1);
  assertEquals(data.filas[0], { producto: { id: 1, nombre: "P1" }, ubicacion: { id: 8, nombre: "WH/Stock" }, cantidad_fisica: 10, cantidad_reservada: 2.5, cantidad_disponible: 7.5 });
  const rg = calls.filter((b) => b.includes("read_group"));
  assertEquals(rg.length, 1);
  assert(rg[0].includes("<string>stock.quant</string>"));
});

Deno.test("gateway: parámetros inválidos → 400 (ID no entero seguro, tamaño excesivo)", async () => {
  for (const params of [{ producto_id: "1; drop" }, { producto_id: 2 ** 60 }, { ubicacion_id: -3 }, { tamano: 5000 }, { pagina: 0 }]) {
    assertEquals((await manejar(req({ accion: "stock.consultar", params }), deps())).status, 400);
  }
  assertEquals((await manejar(req({ accion: "productos.buscar", params: { termino: "a" } }), deps())).status, 400);
});

Deno.test("gateway: timeout de Odoo → 504 sin fallback; Odoo caído → 502", async () => {
  const lento = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(new DOMException("abort", "AbortError")));
  })) as typeof fetch;
  const r1 = await manejar(req({ accion: "ubicaciones.listar" }), deps({ odoo: () => new OdooClient(cfg(lento, { timeoutMs: 30 })) }));
  assertEquals(r1.status, 504);
  assertEquals((await r1.json()).codigo, "odoo_timeout");
  const caido = (() => Promise.reject(new TypeError("down"))) as typeof fetch;
  const r2 = await manejar(req({ accion: "ubicaciones.listar" }), deps({ odoo: () => new OdooClient(cfg(caido)) }));
  assertEquals(r2.status, 502);
});

Deno.test("gateway: falta configuración de Odoo → 500 odoo_config", async () => {
  const r = await manejar(req({ accion: "ubicaciones.listar" }), deps({ odoo: () => { throw new OdooError("odoo_config", "Falta configurar"); } }));
  assertEquals(r.status, 500);
  assertEquals((await r.json()).codigo, "odoo_config");
});
