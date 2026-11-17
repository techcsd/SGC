// DS-02: guardia de host de escritura. Hosts ficticios (el repo es público).
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { OdooClient, OdooError, verificarHostEscritura } from "./odoo-client.ts";

const envDe = (m: Record<string, string>) => (k: string) => m[k];
const XML_OK = (v: string) => `<?xml version="1.0"?><methodResponse><params><param><value>${v}</value></param></params></methodResponse>`;

// fetch simulado: autentica (uid 7) y devuelve un id/lista vacía; cuenta llamadas
function fetchSim(llamadas: string[]): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    llamadas.push(String(url));
    const body = String(init?.body ?? "");
    const v = body.includes("authenticate") ? "<int>7</int>" : "<array><data></data></array>";
    return Promise.resolve(new Response(XML_OK(v), { status: 200 }));
  }) as typeof fetch;
}

const cfg = (url: string, env: Record<string, string>, llamadas: string[]) => ({
  url, db: "d", user: "u", apiKey: "k", companyId: 1, fetchFn: fetchSim(llamadas), entorno: envDe(env),
});

Deno.test("escritura a host no listado falla con odoo_config y no envía nada", async () => {
  const llamadas: string[] = [];
  const c = new OdooClient(cfg("https://otro.example.com", { ODOO_HOSTS_ESCRITURA: "stg.example.com" }, llamadas));
  const e = await assertRejects(() => c.call("purchase.order", "create", [{}]), OdooError);
  assertEquals((e as OdooError).codigo, "odoo_config");
  assertEquals(llamadas.length, 0);
});

Deno.test("sin ODOO_HOSTS_ESCRITURA no se escribe a ningún host (falla cerrado)", async () => {
  const llamadas: string[] = [];
  const c = new OdooClient(cfg("https://stg.example.com", {}, llamadas));
  await assertRejects(() => c.call("res.partner", "write", [[1], {}]), OdooError, "no está autorizado");
  assertEquals(llamadas.length, 0);
});

Deno.test("lectura a host no listado SÍ pasa", async () => {
  const llamadas: string[] = [];
  const c = new OdooClient(cfg("https://otro.example.com", { ODOO_HOSTS_ESCRITURA: "stg.example.com" }, llamadas));
  assertEquals(await c.call("stock.quant", "read_group", [[], [], []]), []);
  assertEquals(llamadas.length, 2); // authenticate + execute_kw
});

Deno.test("escritura a host listado pasa", async () => {
  const llamadas: string[] = [];
  const c = new OdooClient(cfg("https://stg.example.com", { ODOO_HOSTS_ESCRITURA: "a.example.com, STG.example.com" }, llamadas));
  await c.call("purchase.order", "create", [{}]);
  assertEquals(llamadas.length, 2);
});

Deno.test("host de producción exige ODOO_PERMITIR_PROD=true", () => {
  const base = { ODOO_HOSTS_ESCRITURA: "prod.example.com", ODOO_HOSTS_PROD: "prod.example.com" };
  try {
    verificarHostEscritura("https://prod.example.com", envDe(base));
    throw new Error("debió fallar");
  } catch (e) {
    assertEquals((e as OdooError).codigo, "odoo_config");
  }
  verificarHostEscritura("https://prod.example.com", envDe({ ...base, ODOO_PERMITIR_PROD: "true" }));
});
