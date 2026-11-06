// Tests de los adaptadores de proveedores (res.partner). Sin Odoo real: fetch simulado.
//   deno test --no-check --allow-env --node-modules-dir=none _shared
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { OdooClient, OdooError } from "./odoo-client.ts";
import {
  proveedorActualizarMock, proveedorActualizarReal, proveedorCrearMock, proveedorCrearReal, ProveedorError,
  proveedorDesdeFila, seleccionarAdaptadoresProveedores,
} from "./odoo-proveedores.ts";

const xmlInt = (n: number) => `<methodResponse><params><param><value><int>${n}</int></value></param></params></methodResponse>`;
const xmlBool = (b: boolean) => `<methodResponse><params><param><value><boolean>${b ? 1 : 0}</boolean></value></param></params></methodResponse>`;
const xmlFault = (msg: string) => `<methodResponse><fault><value><struct><member><name>faultString</name><value><string>${msg}</string></value></member></struct></value></fault></methodResponse>`;
const miembro = (k: string, v: unknown) => `<member><name>${k}</name><value>${
  typeof v === "number" ? `<int>${v}</int>` : typeof v === "boolean" ? `<boolean>${v ? 1 : 0}</boolean>` : `<string>${v}</string>`
}</value></member>`;
/** Fila de res.partner como la devuelve Odoo (campo vacío = false). */
const fila = (o: Record<string, unknown>) => `<value><struct>${Object.entries(o).map(([k, v]) => miembro(k, v)).join("")}</struct></value>`;
const lista = (...filas: string[]) => `<methodResponse><params><param><value><array><data>${filas.join("")}</data></array></value></param></params></methodResponse>`;

const PARTNER = { id: 5, name: "Ferretería X", vat: "131-12345-6", email: false, phone: "809-555-0100", street: "Av. 27", city: "Santo Domingo", active: true, is_company: true, supplier_rank: 1 };

/** Cliente con fetch simulado: `responder` decide por cuerpo; todo queda en `calls`. */
function cliente(responder: (body: string) => string | Promise<string>, calls: string[] = []) {
  const fetchFn = (async (_u: unknown, init?: RequestInit) => {
    const body = String(init?.body);
    calls.push(body);
    return new Response(body.includes("authenticate") ? xmlInt(2) : await responder(body), { status: 200 });
  }) as typeof fetch;
  return () => new OdooClient({ url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1, fetchFn });
}
const metodos = (calls: string[], m: string) => calls.filter((c) => c.includes(`<string>${m}</string>`));

Deno.test("proveedorDesdeFila: false -> null, dirección = solo la calle (lo que se escribe de vuelta)", () => {
  assertEquals(proveedorDesdeFila(PARTNER), {
    id: 5, nombre: "Ferretería X", rnc: "131-12345-6", email: null, telefono: "809-555-0100",
    direccion: "Av. 27", activo: true, es_empresa: true,
  });
  assertEquals(proveedorDesdeFila({ id: 1, name: "A", street: false, city: "SD" }).direccion, null);
  assertEquals(proveedorDesdeFila({ id: 1, name: "A", street: false, city: false }).direccion, null);
});

Deno.test("mock: determinista, sin llamar a Odoo, con nota MOCK", async () => {
  const a = await proveedorCrearMock({ nombre: "Acme", rnc: "131123456" });
  const b = await proveedorCrearMock({ nombre: "Otro nombre", rnc: "131123456" });
  assertEquals(a.proveedor.id, b.proveedor.id); // id a partir del rnc
  assertEquals(a.ya_existia, false);
  assertEquals(a.proveedor.es_empresa, true);
  assert(a.nota?.startsWith("MOCK"));
  const u = await proveedorActualizarMock({ proveedor_id: 7, activo: false });
  assertEquals([u.proveedor.id, u.proveedor.activo], [7, false]);
});

Deno.test("seleccionarAdaptadoresProveedores: sin flag = mock (no toca Odoo)", async () => {
  const calls: string[] = [];
  const ad = seleccionarAdaptadoresProveedores(false, cliente(() => lista(), calls));
  assert((await ad.proveedorCrear({ nombre: "X" })).nota?.startsWith("MOCK"));
  assertEquals(calls.length, 0);
});

Deno.test("real crear: proveedor nuevo -> create con supplier_rank, company_id, is_company (RNC de 9) y relectura", async () => {
  const calls: string[] = [];
  const f = cliente((b) => b.includes("<string>create</string>") ? xmlInt(42) : b.includes("=ilike") ? lista() : lista(fila({ ...PARTNER, id: 42, name: "Nuevo" })), calls);
  const r = await proveedorCrearReal(f)({ nombre: "Nuevo", rnc: "131123456", telefono: "809" });
  assertEquals([r.ya_existia, r.proveedor.id, r.proveedor.nombre], [false, 42, "Nuevo"]);
  const create = metodos(calls, "create");
  assertEquals(create.length, 1);
  for (const esperado of ["supplier_rank", "company_id", "is_company", "<string>131123456</string>", "phone"]) assert(create[0].includes(esperado), esperado);
});

Deno.test("real crear: RNC de 11 dígitos no marca is_company; sin RNC no busca duplicados", async () => {
  const calls: string[] = [];
  const f = cliente((b) => b.includes("<string>create</string>") ? xmlInt(43) : lista(fila({ ...PARTNER, id: 43 })), calls);
  await proveedorCrearReal(f)({ nombre: "Juan", rnc: "00112345678" });
  assert(!metodos(calls, "create")[0].includes("is_company"));
  calls.length = 0;
  await proveedorCrearReal(f)({ nombre: "Sin RNC" });
  assertEquals(metodos(calls, "search_read").length, 1); // solo la relectura
});

Deno.test("real crear: ya existe un partner con ese RNC (vat con guiones) -> ya_existia:true y NO crea", async () => {
  const calls: string[] = [];
  const f = cliente(() => lista(fila({ ...PARTNER, vat: "131-12345-6" })), calls);
  const r = await proveedorCrearReal(f)({ nombre: "Otro nombre", rnc: "131123456" });
  assertEquals([r.ya_existia, r.proveedor.id], [true, 5]);
  assertEquals(metodos(calls, "create").length, 0);
  assertEquals(metodos(calls, "write").length, 0); // ya era proveedor: no se toca
  assert(calls.some((c) => c.includes("active_test"))); // busca también entre archivados
});

Deno.test("real crear: un candidato con dígitos parecidos pero distintos NO cuenta como duplicado", async () => {
  const f = cliente((b) => b.includes("<string>create</string>") ? xmlInt(44) : lista(fila({ ...PARTNER, vat: "1-3-1-1-2-3-4-5-6-7", id: 9 })));
  assertEquals((await proveedorCrearReal(f)({ nombre: "N", rnc: "131123456" })).ya_existia, false);
});

Deno.test("real crear: partner existente que era solo cliente se marca como proveedor", async () => {
  const calls: string[] = [];
  const f = cliente(() => lista(fila({ ...PARTNER, supplier_rank: 0 })), calls);
  const r = await proveedorCrearReal(f)({ nombre: "N", rnc: "131123456" });
  assertEquals(r.ya_existia, true);
  assertEquals(metodos(calls, "write").length, 1);
  assert(metodos(calls, "write")[0].includes("supplier_rank"));
});

Deno.test("real crear: vat duplicado en Odoo no se trata como error (create normal, sin chequeo extra)", async () => {
  // Sin RNC no hay búsqueda previa: dos altas con el mismo nombre crean dos partners (Odoo lo permite).
  const calls: string[] = [];
  const f = cliente((b) => b.includes("<string>create</string>") ? xmlInt(50) : lista(fila({ ...PARTNER, id: 50 })), calls);
  await proveedorCrearReal(f)({ nombre: "Dup" });
  await proveedorCrearReal(f)({ nombre: "Dup" });
  assertEquals(metodos(calls, "create").length, 2);
});

Deno.test("real actualizar: parcial -> write solo con los campos enviados y relee", async () => {
  const calls: string[] = [];
  const f = cliente((b) => b.includes("<string>write</string>") ? xmlBool(true) : lista(fila(PARTNER)), calls);
  const r = await proveedorActualizarReal(f)({ proveedor_id: 5, telefono: "809-000-0000" });
  assertEquals(r.proveedor.id, 5);
  const w = metodos(calls, "write")[0];
  assert(w.includes("phone") && !w.includes("<name>name</name>") && !w.includes("vat"));
  assertEquals(metodos(calls, "search_read").length, 2); // lee antes y después
});

Deno.test("real actualizar: null vacía el campo (false en Odoo) y activo:false archiva", async () => {
  const calls: string[] = [];
  const f = cliente((b) => b.includes("<string>write</string>") ? xmlBool(true) : lista(fila({ ...PARTNER, active: false })), calls);
  const r = await proveedorActualizarReal(f)({ proveedor_id: 5, email: null, activo: false });
  assertEquals(r.proveedor.activo, false); // la relectura incluye archivados (active_test:false)
  const w = metodos(calls, "write")[0];
  assert(w.includes("<name>email</name><value><boolean>0</boolean>") && w.includes("<name>active</name><value><boolean>0</boolean>"));
  assert(metodos(calls, "search_read").every((c) => c.includes("active_test")));
});

Deno.test("real actualizar: partner inexistente -> ProveedorError claro y NO escribe", async () => {
  const calls: string[] = [];
  const f = cliente(() => lista(), calls);
  const e = await assertRejects(() => proveedorActualizarReal(f)({ proveedor_id: 999, nombre: "X" }), ProveedorError);
  assertEquals(e.message, "El proveedor no existe en Odoo.");
  assertEquals(metodos(calls, "write").length, 0);
});

Deno.test("real: fault de negocio saneado (sin traza); timeout/caída se relanzan como OdooError y no se reintentan", async () => {
  const f = cliente((b) => b.includes("<string>write</string>") ? xmlFault("Traceback File x odoo.exceptions.ValidationError: RNC inválido") : lista(fila(PARTNER)));
  const e = await assertRejects(() => proveedorActualizarReal(f)({ proveedor_id: 5, rnc: "131123456" }), ProveedorError);
  assertEquals(e.message, "Odoo rechazó la operación.");
  const f2 = cliente((b) => b.includes("<string>write</string>") ? xmlFault("odoo.exceptions.ValidationError: RNC inválido") : lista(fila(PARTNER)));
  assertEquals((await assertRejects(() => proveedorActualizarReal(f2)({ proveedor_id: 5, rnc: "131123456" }), ProveedorError)).message, "Odoo rechazó la operación: RNC inválido");

  const calls: string[] = [];
  const caido = () => new OdooClient({
    url: "https://odoo.test", db: "db", user: "u", apiKey: "k", companyId: 1,
    fetchFn: (async (_u: unknown, init?: RequestInit) => {
      calls.push(String(init?.body));
      if (String(init?.body).includes("authenticate")) return new Response(xmlInt(2));
      throw new TypeError("conn refused");
    }) as typeof fetch,
  });
  const ex = await assertRejects(() => proveedorCrearReal(caido)({ nombre: "X" }), OdooError);
  assertEquals(ex.codigo, "odoo_no_disponible");
  assertEquals(metodos(calls, "create").length, 1); // sin reintento
});
