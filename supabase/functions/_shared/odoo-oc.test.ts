// Tests de los adaptadores REALES de OC y de la escritura de OdooClient (CY24 Fase C).
// fetch simulado: no se llama a Odoo. Correr con:
//   deno test --no-check --node-modules-dir=none supabase/functions/_shared/odoo-oc.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { encodeValue, OdooClient, OdooError } from "./odoo-client.ts";
import { crearAdaptadoresOcReales, escrituraOdooHabilitada, seleccionarAdaptadoresOc } from "./odoo-oc.ts";

type Valor = unknown;
interface Llamada { model: string; method: string; cuerpo: string }

const respuesta = (v: Valor) => `<methodResponse><params><param>${encodeValue(v)}</param></params></methodResponse>`;
const fault = (txt: string) =>
  `<methodResponse><fault><value><struct><member><name>faultString</name><value><string>${txt}</string></value></member></struct></value></fault></methodResponse>`;

/** Odoo simulado: `responder` decide por (model, method, cuerpo); devuelve un valor o `{ fault }`. */
function odooSimulado(responder: (c: Llamada) => Valor | { fault: string } | Promise<never>, llamadas: Llamada[] = []) {
  const fetchFn = (async (_u: unknown, init?: RequestInit) => {
    const cuerpo = String(init?.body);
    if (cuerpo.includes("<methodName>authenticate</methodName>")) return new Response(respuesta(7), { status: 200 });
    // execute_kw: strings en orden = db, apiKey, model, method (uid va como int)
    const s = [...cuerpo.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    const call = { model: s[2], method: s[3], cuerpo };
    llamadas.push(call);
    const r = await responder(call);
    if (r && typeof r === "object" && "fault" in r) return new Response(fault((r as { fault: string }).fault), { status: 200 });
    return new Response(respuesta(r), { status: 200 });
  }) as typeof fetch;
  const cliente = new OdooClient({ url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1, fetchFn });
  return { cliente, llamadas, adaptadores: crearAdaptadoresOcReales(() => cliente) };
}

const ESCRITURAS = new Set(["create", "write", "button_confirm", "button_cancel"]);
const escrituras = (ll: Llamada[]) => ll.filter((c) => ESCRITURAS.has(c.method));

const PUBLICAR = {
  orden_id: "11111111-1111-1111-1111-111111111111", numero: "OC-0042", odoo_proveedor_id: 55,
  fecha: "2026-11-01", fecha_entrega_esperada: "2026-11-10", notas: "Entregar <temprano>",
  lineas: [
    { odoo_product_id: 4821, odoo_uom_id: 1, cantidad: 10, precio_unitario: 250.5, descripcion: "Cemento" },
    { odoo_product_id: 4822, cantidad: 2, precio_unitario: 10, aplica_impuesto: false },
  ],
};
const oc = (estado: string, total = 100, picking_ids: number[] = []) =>
  [{ id: 900, name: "P00900", state: estado, amount_total: total, currency_id: [2, "DOP"], picking_ids }];

Deno.test("crear: OC nueva -- busca por origin, crea con líneas y relee el total", async () => {
  let creada = false;
  const { adaptadores, llamadas } = odooSimulado((c) => {
    if (c.method === "create") { creada = true; return 900; }
    if (c.model === "purchase.order" && c.method === "search_read") return creada ? oc("draft", 2905) : [];
    throw new Error(`inesperada ${c.model}.${c.method}`);
  });
  const r = await adaptadores.crear(PUBLICAR);

  assertEquals(r.estado, "completado");
  assertEquals(r.resultado, { modelo: "purchase.order", odoo_id: 900, nombre: "P00900", estado_odoo: "draft", total: 2905, moneda: "DOP", ya_existia: false });
  assertEquals(llamadas[0].method, "search_read");
  assert(llamadas[0].cuerpo.includes("SGC:OC-0042:11111111-1111-1111-1111-111111111111"));
  const creacion = llamadas.find((c) => c.method === "create")!;
  assertEquals(creacion.model, "purchase.order");
  assertEquals(escrituras(llamadas).length, 1); // una sola escritura: cabecera + líneas en la misma transacción
  assert(creacion.cuerpo.includes("&amp;lt;temprano&amp;gt;")); // notas escapadas como HTML (y luego como XML)
  assert(creacion.cuerpo.includes("2026-11-10 12:00:00")); // date_planned de línea
  // Lo fiscal vive en Odoo: SGC no manda impuestos (ignora aplica_impuesto), ni totales, ni moneda.
  for (const campo of ["taxes_id", "amount_total", "amount_untaxed", "currency_id", "price_subtotal"]) {
    assert(!creacion.cuerpo.includes(`<name>${campo}</name>`), campo);
  }
});

Deno.test("crear: idempotente por origin -- si ya existe devuelve esa OC y NO escribe", async () => {
  const { adaptadores, llamadas } = odooSimulado(() => oc("draft", 500));
  const r = await adaptadores.crear(PUBLICAR);

  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.odoo_id, 900);
  assertEquals(r.resultado?.ya_existia, true);
  assertEquals(escrituras(llamadas).length, 0);
});

Deno.test("crear: payload inválido o sin líneas -> error sin tocar Odoo", async () => {
  const { adaptadores, llamadas } = odooSimulado(() => []);
  assertEquals((await adaptadores.crear({ ...PUBLICAR, lineas: [] })).estado, "error");
  assertEquals((await adaptadores.crear({ ...PUBLICAR, lineas: [{ odoo_product_id: 1, cantidad: 0, precio_unitario: 1 }] })).estado, "error");
  assertEquals(llamadas.length, 0);
});

Deno.test("crear: rechazo de negocio (UserError) -> estado error saneado, sin traza", async () => {
  const { adaptadores } = odooSimulado((c) =>
    c.method === "create" ? { fault: "Traceback\n File x\nodoo.exceptions.UserError: El proveedor está bloqueado" } : []
  );
  const r = await adaptadores.crear(PUBLICAR);
  assertEquals(r.estado, "error");
  assertEquals(r.error, "Odoo rechazó la operación: El proveedor está bloqueado");
  assert(!String(r.error).includes("Traceback"));
});

Deno.test("confirmar: con una recepción 'done' NO escribe y devuelve oc_ya_recibida", async () => {
  const { adaptadores, llamadas } = odooSimulado((c) =>
    c.model === "stock.picking" ? [{ id: 1, name: "WH/IN/1", state: "done" }, { id: 2, name: "WH/IN/2", state: "assigned" }] : oc("purchase", 100, [1, 2]).map((o) => ({ ...o, state: "draft" }))
  );
  const r = await adaptadores.confirmar({ odoo_id: 900, total: 100 });
  assertEquals(r.estado, "error");
  assertEquals(r.codigo, "oc_ya_recibida");
  assert(String(r.error).includes("ya fue recibida en Odoo"));
  assertEquals(escrituras(llamadas).length, 0);
});

Deno.test("confirmar: Odoo deja 'to approve' -> éxito parcial (completado), un solo button_confirm y sin button_approve", async () => {
  let confirmada = false;
  const { adaptadores, llamadas } = odooSimulado((c) => {
    if (c.method === "button_confirm") { confirmada = true; return true; }
    return oc(confirmada ? "to approve" : "draft", 118);
  });
  const r = await adaptadores.confirmar({ odoo_id: 900, total: 1 }); // el total de SGC no se compara
  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.estado_odoo, "to approve");
  assertEquals(r.resultado?.total, 118);
  assertEquals(escrituras(llamadas).map((c) => c.method), ["button_confirm"]);
});

Deno.test("confirmar: draft -> purchase llama a button_confirm una vez; el total de SGC no bloquea", async () => {
  let confirmada = false;
  const { adaptadores, llamadas } = odooSimulado((c) => {
    if (c.method === "button_confirm") { confirmada = true; return true; }
    return oc(confirmada ? "purchase" : "draft", 100.004);
  });
  const r = await adaptadores.confirmar({ odoo_id: 900, total: 5000 });
  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.estado_odoo, "purchase");
  assertEquals(escrituras(llamadas).map((c) => c.method), ["button_confirm"]);
});

Deno.test("confirmar: ya en 'to approve' -> éxito idempotente, no vuelve a confirmar", async () => {
  const { adaptadores, llamadas } = odooSimulado(() => oc("to approve"));
  const r = await adaptadores.confirmar({ odoo_id: 900 });
  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.idempotente, true);
  assertEquals(escrituras(llamadas).length, 0);
});

Deno.test("confirmar: ya confirmada en Odoo -> éxito idempotente sin botón", async () => {
  const { adaptadores, llamadas } = odooSimulado(() => oc("purchase"));
  const r = await adaptadores.confirmar({ odoo_id: 900, total: 100 });
  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.idempotente, true);
  assertEquals(escrituras(llamadas).length, 0);
});

Deno.test("cancelar: ya cancelada -> éxito idempotente sin botón", async () => {
  const { adaptadores, llamadas } = odooSimulado(() => oc("cancel"));
  const r = await adaptadores.cancelar({ odoo_id: 900 });
  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.estado_odoo, "cancel");
  assertEquals(r.resultado?.idempotente, true);
  assertEquals(escrituras(llamadas).length, 0);
});

Deno.test("cancelar: camino feliz y con recepción 'done' se rechaza", async () => {
  let cancelada = false;
  const ok = odooSimulado((c) => {
    if (c.method === "button_cancel") { cancelada = true; return true; }
    return oc(cancelada ? "cancel" : "purchase");
  });
  assertEquals((await ok.adaptadores.cancelar({ odoo_id: 900 })).resultado?.estado_odoo, "cancel");
  assertEquals(escrituras(ok.llamadas).map((c) => c.method), ["button_cancel"]);

  const recibida = odooSimulado((c) => c.model === "stock.picking" ? [{ id: 1, name: "IN/1", state: "done" }] : oc("purchase", 100, [1]));
  const r = await recibida.adaptadores.cancelar({ odoo_id: 900 });
  assertEquals(r.codigo, "oc_ya_recibida");
  assertEquals(escrituras(recibida.llamadas).length, 0);
});

Deno.test("escritura: timeout -> OdooError odoo_timeout y UN solo intento (sin reintento)", async () => {
  let envios = 0;
  const fetchFn = (async (_u: unknown, init?: RequestInit) => {
    const cuerpo = String(init?.body);
    if (cuerpo.includes("authenticate")) return new Response(respuesta(7), { status: 200 });
    envios++;
    return await new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("abort", "AbortError"))));
  }) as typeof fetch;
  const c = new OdooClient({ url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1, fetchFn, timeoutMs: 20 });
  const e = await c.call("purchase.order", "create", [{ partner_id: 1 }]).catch((x) => x);
  assert(e instanceof OdooError);
  assertEquals(e.codigo, "odoo_timeout");
  assertEquals(envios, 1);
});

Deno.test("escritura: caída (red) y respuesta ilegible -> odoo_no_disponible, un solo envío", async () => {
  let envios = 0;
  const mk = (resp: () => Promise<Response>) =>
    new OdooClient({
      url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1,
      fetchFn: (async (_u: unknown, init?: RequestInit) => {
        if (String(init?.body).includes("authenticate")) return new Response(respuesta(7));
        envios++;
        return await resp();
      }) as typeof fetch,
    });
  const e1 = await mk(() => Promise.reject(new TypeError("red"))).call("purchase.order", "button_confirm", [[1]]).catch((x) => x);
  assertEquals(e1.codigo, "odoo_no_disponible");
  const e2 = await mk(() => Promise.resolve(new Response("<basura/>"))).call("purchase.order", "button_confirm", [[1]]).catch((x) => x);
  assertEquals(e2.codigo, "odoo_no_disponible"); // ilegible tras enviar: no se sabe si aplicó; reintento seguro
  assertEquals(envios, 2);
});

Deno.test("escritura: AccessDenied no reenvía (sin segundo intento) y devuelve odoo_auth", async () => {
  const { cliente, llamadas } = odooSimulado(() => ({ fault: "odoo.exceptions.AccessDenied: Access Denied" }));
  const e = await cliente.call("purchase.order", "create", [{}]).catch((x) => x);
  assertEquals(e.codigo, "odoo_auth");
  assertEquals(llamadas.length, 1);
});

Deno.test("política: modelo/método fuera de la allowlist se rechaza sin llamar a Odoo", async () => {
  const { cliente, llamadas } = odooSimulado(() => true);
  const casos: [() => Promise<unknown>, string][] = [
    [() => cliente.call("res.partner", "unlink", [[1]]), "partner: nunca se borra"],
    [() => cliente.call("account.move", "write", [[1], {}]), "modelo"],
    [() => cliente.call("purchase.order", "unlink", [[1]]), "método"],
    [() => cliente.call("purchase.order", "button_approve", [[1]]), "SGC no aprueba"],
    [() => cliente.call("purchase.order.line", "create", [{}]), "línea suelta"],
    [() => cliente.call("purchase.order", "write", [[1], {}]), "write"],
  ];
  for (const [fn, que] of casos) {
    const e = await fn().catch((x) => x);
    assert(e instanceof OdooError, `${que} debía rechazarse`);
  }
  assertEquals(llamadas.length, 0);
});

Deno.test("política inyectada: la escritura se detecta por la política, no por el nombre del método", async () => {
  const llamadas: Llamada[] = [];
  let envios = 0;
  const fetchFn = (async (_u: unknown, init?: RequestInit) => {
    const cuerpo = String(init?.body);
    if (cuerpo.includes("authenticate")) return new Response(respuesta(7));
    envios++;
    llamadas.push({ model: "", method: "", cuerpo });
    return new Response("<basura/>"); // ilegible
  }) as typeof fetch;
  // "refrescar_x" declarado como escritura: ilegible => odoo_no_disponible (trato de escritura); como lectura sería odoo_error.
  const c = new OdooClient({
    url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1, fetchFn,
    politica: { lectura: { "m": ["leer"] }, escritura: { "m": ["refrescar_x"] } },
  });
  assertEquals((await c.call("m", "refrescar_x", []).catch((x) => x)).codigo, "odoo_no_disponible");
  assertEquals((await c.call("m", "leer", []).catch((x) => x)).codigo, "odoo_error");
  assertEquals(envios, 2);
});

Deno.test("transporte inyectable: OdooClient delega en TransporteOdoo (listo para JSON-2)", async () => {
  const vistas: unknown[][] = [];
  const c = new OdooClient({
    url: "https://x", db: "d", user: "u", apiKey: "k", companyId: 1,
    transporte: { call: (...a) => { vistas.push(a); return Promise.resolve(42); }, version: () => Promise.resolve({ server_version: "17.0" }) },
  });
  assertEquals(await c.call("purchase.order", "button_cancel", [[3]]), 42);
  assertEquals(vistas[0][4], true); // marcada como escritura por la política
  assertEquals(await c.call("stock.picking", "search_read", [[]]), 42);
  assertEquals(vistas[1][4], false);
  assertEquals((await c.version()).server_version, "17.0");
});

Deno.test("crear: timeout -> error; el reintento del usuario encuentra la OC por origin y crea UNA sola", async () => {
  let ocs = 0; // OCs que existen en el Odoo simulado
  let primera = true;
  const { adaptadores, llamadas } = odooSimulado((c) => {
    if (c.method === "create") {
      ocs++; // Odoo SÍ la creó pero la respuesta se perdió
      if (primera) { primera = false; return new Promise<never>((_, rej) => rej(new TypeError("red"))); }
      return 900;
    }
    return ocs > 0 ? oc("draft", 10) : [];
  });
  const e = await adaptadores.crear(PUBLICAR).catch((x) => x);
  assert(e instanceof OdooError);
  assertEquals(e.codigo, "odoo_no_disponible");

  const r = await adaptadores.crear(PUBLICAR); // reintento del usuario
  assertEquals(r.estado, "completado");
  assertEquals(r.resultado?.ya_existia, true);
  assertEquals(ocs, 1);
  assertEquals(escrituras(llamadas).length, 1); // no hubo un segundo create
});

Deno.test("selección: mock salvo ODOO_ESCRITURA_HABILITADA=true", async () => {
  assertEquals(escrituraOdooHabilitada(() => undefined), false);
  assertEquals(escrituraOdooHabilitada(() => "1"), false);
  assertEquals(escrituraOdooHabilitada(() => "true"), true);
  const mock = seleccionarAdaptadoresOc(false, () => { throw new Error("no debe pedir cliente"); });
  const r = await mock.crear(PUBLICAR);
  assertEquals(r.estado, "completado");
  assert(String(r.resultado?.nota).includes("MOCK"));
});
