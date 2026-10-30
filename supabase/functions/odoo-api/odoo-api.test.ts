// Tests del cliente XML-RPC y del gateway odoo-api. Correr con:
//   deno test supabase/functions/odoo-api/odoo-api.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { encodeCall, OdooClient, OdooError, parseResponse } from "../_shared/odoo-client.ts";
import { type Deps, manejar } from "./handler.ts";
import { ACCIONES, type Accion, escapaLike } from "./acciones.ts";
import { CacheOdoo } from "../_shared/odoo-cache.ts";
import { LimitePorUsuario } from "../_shared/odoo-limite.ts";
import { CircuitoOdoo } from "../_shared/odoo-circuito.ts";
import { SemaforoOdoo } from "../_shared/odoo-semaforo.ts";
import { validarUrl } from "../_shared/odoo-client.ts";

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

const cachesNuevos = (ttl: number) => Object.fromEntries(ACCIONES.map((a) => [a, new CacheOdoo(ttl)])) as Record<Accion, CacheOdoo>;

function deps(over: Partial<Deps> & { calls?: string[]; respuesta?: string } = {}): Deps {
  const calls = over.calls ?? [];
  const f = fakeFetch((b) => b.includes("authenticate") ? xmlInt(2) : (over.respuesta ?? xmlStruct("")), calls);
  return {
    autenticar: over.autenticar ?? (() => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["inventario"] })),
    odoo: over.odoo ?? (() => new OdooClient(cfg(f))),
    caches: over.caches ?? cachesNuevos(0),
    limite: over.limite ?? new LimitePorUsuario(),
    circuito: over.circuito ?? new CircuitoOdoo(100, 30_000), // umbral alto: no interfiere con tests que no prueban el breaker
    semaforo: over.semaforo ?? new SemaforoOdoo(100),
    origenes: over.origenes ?? ["https://app.test"],
    adaptadorOc: over.adaptadorOc,
    // deno-lint-ignore no-explicit-any
    admin: over.admin ?? ((() => ({ rpc: () => Promise.resolve({ data: null, error: null }) })) as any),
  };
}

Deno.test("gateway: sin Authorization → 401", async () => {
  assertEquals((await manejar(req({ accion: "stock.consultar" }, null), deps())).status, 401);
});

Deno.test("gateway: usuario sin módulo inventario → 403 y NO llama a Odoo", async () => {
  const calls: string[] = [];
  const d = deps({ calls, autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }) });
  const r = await manejar(req({ accion: "stock.consultar", params: {} }), d);
  assertEquals(r.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("gateway: admin sin módulo explícito pasa", async () => {
  const d = deps({ autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: true, modulos: [] }) });
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
  assertEquals((await r1.json()).error_code, "odoo_timeout");
  const caido = (() => Promise.reject(new TypeError("down"))) as typeof fetch;
  const r2 = await manejar(req({ accion: "ubicaciones.listar" }), deps({ odoo: () => new OdooClient(cfg(caido)) }));
  assertEquals(r2.status, 502);
});

Deno.test("gateway: CY23 circuito — tras el umbral de fallos, falla rápido SIN volver a llamar a Odoo", async () => {
  const circuito = new CircuitoOdoo(2, 60_000); // umbral bajo para no esperar de más
  const caido = (() => Promise.reject(new TypeError("down"))) as typeof fetch;
  let llamadasOdoo = 0;
  const odooQueCuenta = () => {
    llamadasOdoo++;
    return new OdooClient(cfg(caido));
  };
  // 2 fallos reales consecutivos (cada uno con su cache fresca para no pegarle al single-flight).
  const r1 = await manejar(req({ accion: "ubicaciones.listar" }), deps({ circuito, odoo: odooQueCuenta, caches: cachesNuevos(0) }));
  assertEquals(r1.status, 502);
  const r2 = await manejar(req({ accion: "ubicaciones.listar" }), deps({ circuito, odoo: odooQueCuenta, caches: cachesNuevos(0) }));
  assertEquals(r2.status, 502);
  const llamadasTrasAbrir = llamadasOdoo;

  // Tercera petición: el circuito ya debe estar abierto -> NO debe tocar Odoo de nuevo.
  const r3 = await manejar(req({ accion: "ubicaciones.listar" }), deps({ circuito, odoo: odooQueCuenta, caches: cachesNuevos(0) }));
  assertEquals(r3.status, 503);
  assertEquals((await r3.json()).error_code, "odoo_circuito_abierto");
  assertEquals(llamadasOdoo, llamadasTrasAbrir, "no debió volver a invocar deps.odoo() con el circuito abierto");
});

Deno.test("gateway: CY23 semáforo — concurrencia simultánea por encima del máximo da 429 odoo_saturado", async () => {
  const semaforo = new SemaforoOdoo(1);
  let resolverPrimera!: () => void;
  const primeraEnCurso = new Promise<void>((res) => { resolverPrimera = res; });
  const lentoControlado = ((_url: unknown, init?: RequestInit) => {
    const body = String(init?.body);
    if (body.includes("authenticate")) return Promise.resolve(new Response(xmlInt(2), { status: 200 }));
    return new Promise<Response>((res) => {
      primeraEnCurso.then(() => res(new Response(xmlStruct(""), { status: 200 })));
    });
  }) as unknown as typeof fetch;

  const p1 = manejar(req({ accion: "ubicaciones.listar" }), deps({ semaforo, odoo: () => new OdooClient(cfg(lentoControlado)), caches: cachesNuevos(0) }));
  await new Promise((r) => setTimeout(r, 10)); // deja que p1 reserve el único cupo del semáforo
  const r2 = await manejar(req({ accion: "ubicaciones.listar" }), deps({ semaforo, odoo: () => new OdooClient(cfg(fakeFetch(() => xmlStruct("")))), caches: cachesNuevos(0) }));
  assertEquals(r2.status, 429);
  assertEquals((await r2.json()).error_code, "odoo_saturado");

  resolverPrimera();
  const r1 = await p1;
  assertEquals(r1.status, 200); // la primera sí tenía cupo y termina bien
});

Deno.test("gateway: falta configuración de Odoo → 500 odoo_config", async () => {
  const r = await manejar(req({ accion: "ubicaciones.listar" }), deps({ odoo: () => { throw new OdooError("odoo_config", "Falta configurar"); } }));
  assertEquals(r.status, 500);
  const b = await r.json();
  assertEquals(b.error_code, "odoo_config");
  assert(!JSON.stringify(b).includes("Falta configurar"), "no filtra el detalle de configuración");
});

Deno.test("gateway: un fault de Odoo NO llega crudo al cliente (BS2)", async () => {
  const fault = `<methodResponse><fault><value><struct><member><name>faultString</name><value><string>odoo.exceptions.AccessError: modelo stock.quant campo secreto_x</string></value></member></struct></value></fault></methodResponse>`;
  const r = await manejar(req({ accion: "ubicaciones.listar" }), deps({ respuesta: fault }));
  const txt = await r.text();
  assertEquals(r.status, 502);
  assert(!txt.includes("stock.quant") && !txt.includes("secreto_x"), "sin detalle técnico: " + txt);
  assert(txt.includes("error_code"));
});

Deno.test("gateway: body null/array/no-JSON → 400, no 500", async () => {
  for (const raw of ["null", "[1]", "42", "{no json"]) {
    const r = await manejar(new Request("https://x", { method: "POST", headers: { Authorization: "Bearer t" }, body: raw }), deps());
    assertEquals(r.status, 400, raw);
  }
});

Deno.test("gateway: caída de la autenticación → 503 (no 401)", async () => {
  const r = await manejar(req({ accion: "ubicaciones.listar" }), deps({ autenticar: () => Promise.reject(new Error("supabase down")) }));
  assertEquals(r.status, 503);
});

Deno.test("gateway: límite por usuario → 429 con Retry-After", async () => {
  const d = deps({ limite: new LimitePorUsuario(2, 60_000) });
  assertEquals((await manejar(req({ accion: "ubicaciones.listar" }), d)).status, 200);
  assertEquals((await manejar(req({ accion: "ubicaciones.listar" }), d)).status, 200);
  const r = await manejar(req({ accion: "ubicaciones.listar" }), d);
  assertEquals(r.status, 429);
  assert(Number(r.headers.get("Retry-After")) >= 1);
});

Deno.test("gateway: CORS solo para orígenes permitidos", async () => {
  const ok = await manejar(new Request("https://x", { method: "OPTIONS", headers: { Origin: "https://app.test" } }), deps());
  assertEquals(ok.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  const mal = await manejar(new Request("https://x", { method: "OPTIONS", headers: { Origin: "https://evil.test" } }), deps());
  assertEquals(mal.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("caché: TTL por tipo, single-flight y refrescar", async () => {
  const calls: string[] = [];
  const d = deps({ calls, caches: cachesNuevos(60_000) });
  const pedir = (params: Record<string, unknown> = {}) => manejar(req({ accion: "ubicaciones.listar", params }), d).then((r) => r.json());
  const [a, b] = await Promise.all([pedir(), pedir()]); // simultáneas → una sola llamada a Odoo
  assertEquals(calls.filter((c) => c.includes("stock.location")).length, 1);
  assert(a.consultado_en && b.consultado_en);
  const c = await pedir();
  assertEquals(c.cache, "hit");
  assertEquals(calls.filter((x) => x.includes("stock.location")).length, 1);
  const f = await pedir({ refrescar: true }); // salta el caché
  assertEquals(f.cache, "refresh");
  assertEquals(calls.filter((x) => x.includes("stock.location")).length, 2);
});

Deno.test("caché: un error de Odoo no se cachea ni se sirve dato viejo", async () => {
  let falla = false;
  const f = ((_u: unknown, _i?: RequestInit) => falla ? Promise.reject(new TypeError("down")) : Promise.resolve(new Response(String(_i?.body).includes("authenticate") ? xmlInt(2) : xmlStruct("")))) as typeof fetch;
  const d = deps({ caches: cachesNuevos(20), odoo: () => new OdooClient(cfg(f)) });
  assertEquals((await manejar(req({ accion: "ubicaciones.listar" }), d)).status, 200);
  await new Promise((r) => setTimeout(r, 80)); // vence el TTL
  falla = true;
  assertEquals((await manejar(req({ accion: "ubicaciones.listar" }), d)).status, 502); // sin stale-if-error
});

Deno.test("caché: clave distinta por parámetros normalizados", async () => {
  const calls: string[] = [];
  const d = deps({ calls, caches: cachesNuevos(60_000) });
  await manejar(req({ accion: "productos.buscar", params: { termino: "  cem   pvc " } }), d);
  await manejar(req({ accion: "productos.buscar", params: { termino: "cem pvc" } }), d);
  await manejar(req({ accion: "productos.buscar", params: { termino: "otro" } }), d);
  assertEquals(calls.filter((c) => c.includes("product.product")).length, 2);
});

Deno.test("cliente: uid caducado (AccessDenied) reautentica una vez; sigue fallando → odoo_auth", async () => {
  let auth = 0; let primera = true;
  const denied = `<methodResponse><fault><value><struct><member><name>faultString</name><value><string>Traceback\nodoo.exceptions.AccessDenied: Access Denied</string></value></member></struct></value></fault></methodResponse>`;
  const f = fakeFetch((b) => {
    if (b.includes("authenticate")) { auth++; return xmlInt(7); }
    if (primera) { primera = false; return denied; }
    return xmlStruct("");
  });
  const c = new OdooClient(cfg(f));
  await c.executeKw("m", "x", []);
  assertEquals(auth, 2); // reautenticó
  const siempre = new OdooClient(cfg(fakeFetch((b) => b.includes("authenticate") ? xmlInt(7) : denied)));
  assertEquals(((await siempre.executeKw("m", "x", []).catch((x) => x)) as OdooError).codigo, "odoo_auth");
});

Deno.test("cliente: autenticaciones concurrentes comparten una sola llamada", async () => {
  const calls: string[] = [];
  const c = new OdooClient(cfg(fakeFetch((b) => b.includes("authenticate") ? xmlInt(3) : xmlStruct(""), calls)));
  await Promise.all([c.executeKw("m", "x", []), c.executeKw("m", "y", []), c.executeKw("m", "z", [])]);
  assertEquals(calls.filter((b) => b.includes("authenticate")).length, 1);
});

Deno.test("cliente: redirect=error y URL https obligatoria", () => {
  assertEquals(validarUrl("https://odoo.test/"), "https://odoo.test");
  assertEquals(validarUrl("http://localhost:8069"), "http://localhost:8069");
  for (const mala of ["http://odoo.test", "ftp://x", "no-url"]) {
    try { validarUrl(mala); throw new Error("no lanzó " + mala); } catch (e) { assert(e instanceof OdooError); }
  }
});

Deno.test("serializador: quita caracteres de control y surrogates sueltos", () => {
  const xml = encodeCall("m", ["a\u0001b\uD800c"]);
  assert(xml.includes("<string>abc</string>"));
});

Deno.test("parser: CDATA, entidades hex, numéricos inválidos", () => {
  const ok = `<methodResponse><params><param><value><string><![CDATA[a<b&c]]></string></value></param></params></methodResponse>`;
  assertEquals(parseResponse(ok), "a<b&c");
  const hex = `<methodResponse><params><param><value><string>&#x41;&#99999999;</string></value></param></params></methodResponse>`;
  assertEquals(parseResponse(hex), "A\uFFFD");
  for (const malo of ["<int>abc</int>", "<int></int>", "<double>x</double>"]) {
    try { parseResponse(`<methodResponse><params><param><value>${malo}</value></param></params></methodResponse>`); throw new Error("no lanzó " + malo); } catch (e) { assert(e instanceof OdooError); }
  }
});

Deno.test("acciones: redondea flotantes y avisa truncado de ubicaciones", async () => {
  const grupo = `<value><struct><member><name>product_id</name><value><array><data><value><int>1</int></value><value><string>P</string></value></data></array></value></member>
    <member><name>location_id</name><value><array><data><value><int>8</int></value><value><string>L</string></value></data></array></value></member>
    <member><name>quantity</name><value><double>0.30000000000000004</double></value></member>
    <member><name>reserved_quantity</name><value><double>0.1</double></value></member></struct></value>`;
  const r = await manejar(req({ accion: "stock.consultar" }), deps({ respuesta: xmlStruct(grupo) }));
  const f = (await r.json()).data.filas[0];
  assertEquals([f.cantidad_fisica, f.cantidad_reservada, f.cantidad_disponible], [0.3, 0.1, 0.2]);
});

Deno.test("acciones: los comodines de LIKE del usuario se escapan", async () => {
  assertEquals(escapaLike("50%_a\\b"), "50\\%\\_a\\\\b");
  const calls: string[] = [];
  await manejar(req({ accion: "productos.buscar", params: { termino: "a_%b" } }), deps({ calls }));
  assert(calls.some((c) => c.includes("a\\_\\%b")), "el término viaja escapado");
});

// ── CY24 Fase A — acciones de lectura para el piloto de OC ──────────────────
Deno.test("productos.buscar_compra: filtra por purchase_ok, NO por type='product' (criterio E2/E8)", async () => {
  const calls: string[] = [];
  await manejar(req({ accion: "productos.buscar_compra", params: { termino: "cemento" } }), deps({ calls }));
  const llamada = calls.find((c) => c.includes("search_read"));
  assert(llamada?.includes("purchase_ok"), "debe filtrar por purchase_ok");
  assert(!llamada?.includes("<string>product</string>"), "NO debe limitarse a type=product");
});

Deno.test("productos.buscar_compra: expone el id numérico de la UoM de compra (CY24 #24, D1)", async () => {
  const xml = xmlStruct(`<value><struct>
    <member><name>id</name><value><int>4821</int></value></member>
    <member><name>display_name</name><value><string>Cemento gris 42.5kg</string></value></member>
    <member><name>uom_po_id</name><value><array><data><value><int>55</int></value><value><string>Saco</string></value></data></array></value></member>
    </struct></value>`);
  const r = await manejar(req({ accion: "productos.buscar_compra", params: { termino: "cemento" } }), deps({ respuesta: xml }));
  const producto = (await r.json()).data.productos[0];
  assertEquals(producto.unidad_compra, "Saco");
  assertEquals(producto.unidad_compra_id, 55);
});

Deno.test("productos.obtener: producto_id obligatorio y válido", async () => {
  const sinId = await manejar(req({ accion: "productos.obtener", params: {} }), deps());
  assertEquals(sinId.status, 400);
  const r = await manejar(req({ accion: "productos.obtener", params: { producto_id: 42 } }),
    deps({ respuesta: xmlStruct(`<value><struct>
      <member><name>id</name><value><int>42</int></value></member>
      <member><name>display_name</name><value><string>CEMENTO GRIS</string></value></member>
      <member><name>active</name><value><boolean>1</boolean></value></member>
      <member><name>purchase_ok</name><value><boolean>1</boolean></value></member>
      </struct></value>`) }));
  const data = (await r.json()).data;
  assertEquals(data.producto.id, 42);
  assertEquals(data.producto.comprable, true);
});

Deno.test("proveedores.obtener: devuelve null si Odoo no encuentra el partner", async () => {
  const r = await manejar(req({ accion: "proveedores.obtener", params: { proveedor_id: 999 } }), deps({ respuesta: xmlStruct("") }));
  assertEquals((await r.json()).data.proveedor, null);
});

Deno.test("compras.obtener: mapea estado/total/proveedor de una purchase.order", async () => {
  const r = await manejar(req({ accion: "compras.obtener", params: { orden_id: 7 } }),
    deps({ respuesta: xmlStruct(`<value><struct>
      <member><name>id</name><value><int>7</int></value></member>
      <member><name>name</name><value><string>P00007</string></value></member>
      <member><name>state</name><value><string>purchase</string></value></member>
      <member><name>amount_total</name><value><double>1500.5</double></value></member>
      <member><name>partner_id</name><value><array><data><value><int>3</int></value><value><string>Proveedor X</string></value></data></array></value></member>
      </struct></value>`) }));
  const orden = (await r.json()).data.orden;
  assertEquals(orden.nombre, "P00007");
  assertEquals(orden.estado, "purchase");
  assertEquals(orden.total, 1500.5);
  assertEquals(orden.proveedor, { id: 3, nombre: "Proveedor X" });
});

Deno.test("CY24 acciones: allowlist sigue cerrada -- una acción de escritura no declarada es rechazada", async () => {
  const r = await manejar(req({ accion: "compras.editar", params: { orden_id: 1 } }), deps());
  assertEquals(r.status, 400);
});

// ── CY24 Fase C — compras.crear (escritura, mock) ───────────────────────────
const UUID = "11111111-1111-1111-1111-111111111111";

// deno-lint-ignore no-explicit-any
function fakeAdmin(rpc: (nombre: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null }): any {
  return { rpc: (nombre: string, args: Record<string, unknown>) => Promise.resolve(rpc(nombre, args)) };
}

const PARA_PUBLICAR_OK = { odoo_instancia_id: UUID, orden_id: UUID, lineas: [{ item_id: UUID, odoo_product_id: 4821 }] };

Deno.test("compras.crear: usuario sin módulo compras → 403, no llama a Odoo ni a RPCs", async () => {
  let llamado = false;
  const d = deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["inventario"] }),
    admin: () => fakeAdmin(() => { llamado = true; return { data: null }; }),
  });
  const r = await manejar(req({ accion: "compras.crear", params: { orden_id: UUID } }), d);
  assertEquals(r.status, 403);
  assertEquals(llamado, false);
});

Deno.test("compras.crear: orden_id inválido → 400", async () => {
  const d = deps({ autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }) });
  const r = await manejar(req({ accion: "compras.crear", params: { orden_id: "no-es-uuid" } }), d);
  assertEquals(r.status, 400);
});

Deno.test("compras.crear: oc_para_publicar rechaza (E9/E10/criterio 6) → 400 con el mensaje de la RPC", async () => {
  const d = deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }),
    admin: () => fakeAdmin((nombre) =>
      nombre === "oc_para_publicar" ? { data: null, error: { message: "El proveedor de esta orden todavía no está vinculado a Odoo (X)" } } : { data: null }),
  });
  const r = await manejar(req({ accion: "compras.crear", params: { orden_id: UUID } }), d);
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "El proveedor de esta orden todavía no está vinculado a Odoo (X)");
});

Deno.test("compras.crear: camino feliz -- publica (mock) y registra el comando + la OC", async () => {
  const llamadas: string[] = [];
  const d = deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }),
    admin: () => fakeAdmin((nombre) => {
      llamadas.push(nombre);
      if (nombre === "oc_para_publicar") return { data: PARA_PUBLICAR_OK };
      if (nombre === "oc_comando_registrar_inicio") return { data: { ya_completado: false, comando_id: UUID } };
      return { data: true };
    }),
  });
  const r = await manejar(req({ accion: "compras.crear", params: { orden_id: UUID } }), d);
  assertEquals(r.status, 200);
  const data = (await r.json()).data;
  assertEquals(data.modelo, "purchase.order");
  assertEquals(data.repetido, false);
  assert(llamadas.includes("oc_comando_finalizar"));
  assert(llamadas.includes("registrar_publicacion_oc"));
});

Deno.test("compras.crear: comando ya completado -- idempotente, no vuelve a publicar", async () => {
  const llamadas: string[] = [];
  const d = deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }),
    admin: () => fakeAdmin((nombre) => {
      llamadas.push(nombre);
      if (nombre === "oc_para_publicar") return { data: PARA_PUBLICAR_OK };
      if (nombre === "oc_comando_registrar_inicio") {
        return { data: { ya_completado: true, resultado: { modelo: "purchase.order", odoo_id: 1 }, comando_id: UUID } };
      }
      return { data: true };
    }),
  });
  const r = await manejar(req({ accion: "compras.crear", params: { orden_id: UUID } }), d);
  assertEquals(r.status, 200);
  const data = (await r.json()).data;
  assertEquals(data.repetido, true);
  assert(!llamadas.includes("oc_comando_finalizar")); // nunca vuelve a tocar Odoo ni cierra un comando nuevo
});

const PARA_COMANDO_OK = { odoo_instancia_id: UUID, orden_id: UUID, odoo_id: 999002, odoo_sync_estado_actual: "publicada" };

Deno.test("compras.confirmar: oc_para_comando rechaza (ya confirmada) → 400 con el mensaje de la RPC", async () => {
  const d = deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }),
    admin: () => fakeAdmin((nombre) =>
      nombre === "oc_para_comando" ? { data: null, error: { message: "Esta orden ya está confirmada en Odoo" } } : { data: null }),
  });
  const r = await manejar(req({ accion: "compras.confirmar", params: { orden_id: UUID } }), d);
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "Esta orden ya está confirmada en Odoo");
});

Deno.test("compras.confirmar: camino feliz -- confirma (mock) y registra confirmada, sin tocar identidad", async () => {
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
  const d = deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }),
    admin: () => fakeAdmin((nombre, args) => {
      llamadas.push({ nombre, args });
      if (nombre === "oc_para_comando") return { data: PARA_COMANDO_OK };
      if (nombre === "oc_comando_registrar_inicio") return { data: { ya_completado: false, comando_id: UUID } };
      return { data: true };
    }),
  });
  const r = await manejar(req({ accion: "compras.confirmar", params: { orden_id: UUID } }), d);
  assertEquals(r.status, 200);
  const data = (await r.json()).data;
  assertEquals(data.estado_odoo, "purchase");
  const registrar = llamadas.find((l) => l.nombre === "registrar_publicacion_oc")!.args;
  assertEquals(registrar.p_odoo_sync_estado, "confirmada");
  assertEquals(registrar.p_odoo_instancia_id, null); // confirmar no toca la identidad (ya se fijó al crear)
  assertEquals(registrar.p_odoo_id, null);
});

Deno.test("compras.cancelar: camino feliz -- cancela (mock) y registra cancelada", async () => {
  const d = deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }),
    admin: () => fakeAdmin((nombre) => {
      if (nombre === "oc_para_comando") return { data: PARA_COMANDO_OK };
      if (nombre === "oc_comando_registrar_inicio") return { data: { ya_completado: false, comando_id: UUID } };
      return { data: true };
    }),
  });
  const r = await manejar(req({ accion: "compras.cancelar", params: { orden_id: UUID } }), d);
  assertEquals(r.status, 200);
  assertEquals((await r.json()).data.estado_odoo, "cancel");
});

// ── CY24 Fase C — escrituras: SIN reintento automático (D3 / #23) ───────────
function depsEscritura(adaptadorOc: Deps["adaptadorOc"], llamadas: { nombre: string; args: Record<string, unknown> }[]): Deps {
  return deps({
    autenticar: () => Promise.resolve({ usuario_id: "u1", es_admin: false, modulos: ["compras"] }),
    adaptadorOc,
    admin: () => fakeAdmin((nombre, args) => {
      llamadas.push({ nombre, args });
      if (nombre === "oc_para_publicar") return { data: PARA_PUBLICAR_OK };
      if (nombre === "oc_comando_registrar_inicio") return { data: { ya_completado: false, comando_id: UUID } };
      return { data: true };
    }),
  });
}

Deno.test("compras.crear: timeout de Odoo NO se reintenta -- 1 sola llamada, comando y OC quedan 'incierto'", async () => {
  let intentos = 0;
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
  const d = depsEscritura({
    crear: () => { intentos++; return Promise.reject(new OdooError("odoo_timeout", "timeout")); },
  }, llamadas);

  const r = await manejar(req({ accion: "compras.crear", params: { orden_id: UUID } }), d);

  assertEquals(intentos, 1); // la regla de la casa: nunca reintentar una escritura a ciegas
  assertEquals(r.status, 504);
  const cuerpo = await r.json();
  assert(String(cuerpo.error).includes("No la reenvíes"), cuerpo.error);
  assertEquals(llamadas.find((c) => c.nombre === "oc_comando_finalizar")?.args.p_estado, "incierto");
  assertEquals(llamadas.find((c) => c.nombre === "registrar_publicacion_oc")?.args.p_odoo_sync_estado, "incierto");
});

Deno.test("compras.confirmar: Odoo caído tampoco se reintenta y deja el comando incierto", async () => {
  let intentos = 0;
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
  const d = depsEscritura({
    confirmar: () => { intentos++; return Promise.reject(new OdooError("odoo_no_disponible", "caído")); },
  }, llamadas);
  // oc_para_comando devuelve lo mínimo que usa el flujo
  const base = d.admin;
  d.admin = () => {
    const a = base();
    const rpc = a.rpc.bind(a);
    a.rpc = (nombre: string, args: Record<string, unknown>) =>
      nombre === "oc_para_comando" ? Promise.resolve({ data: { ...PARA_PUBLICAR_OK, odoo_id: 77 }, error: null }) : rpc(nombre, args);
    return a;
  };

  const r = await manejar(req({ accion: "compras.confirmar", params: { orden_id: UUID } }), d);

  assertEquals(intentos, 1);
  assertEquals(r.status, 502);
  assertEquals(llamadas.find((c) => c.nombre === "oc_comando_finalizar")?.args.p_estado, "incierto");
});

Deno.test("compras.crear: un error de negocio de Odoo queda 'error' (no incierto) y tampoco se reintenta", async () => {
  let intentos = 0;
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
  const d = depsEscritura({
    crear: () => { intentos++; return Promise.resolve({ estado: "error" as const, error: "Odoo rechazó la orden" }); },
  }, llamadas);

  const r = await manejar(req({ accion: "compras.crear", params: { orden_id: UUID } }), d);

  assertEquals(intentos, 1);
  assertEquals(r.status, 400);
  assertEquals(llamadas.find((c) => c.nombre === "oc_comando_finalizar")?.args.p_estado, "error");
});
