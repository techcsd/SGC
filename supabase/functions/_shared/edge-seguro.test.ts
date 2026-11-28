import { assertEquals, assert } from "jsr:@std/assert@1";
import { edgeSeguro } from "./edge-seguro.ts";

Deno.test("edgeSeguro: una excepción llega como JSON 500 con CORS, error_code y correlación", async () => {
  const h = edgeSeguro({ nombre: "t" }, () => { throw new Error("ValueError: Invalid field 'x'"); });
  const r = await h(new Request("https://x/f", { method: "POST", headers: { Origin: "https://sgcconstructorasd.com" } }));
  assertEquals(r.status, 500);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "https://sgcconstructorasd.com");
  const b = await r.json();
  assertEquals(b.error_code, "error_interno");
  assert(typeof b.correlacion === "string" && b.correlacion.length === 8);
  assert(!JSON.stringify(b).includes("ValueError"), "el detalle técnico no viaja al cliente");
});

Deno.test("edgeSeguro: una respuesta normal pasa intacta", async () => {
  const h = edgeSeguro({ nombre: "t" }, () => new Response("ok", { status: 200 }));
  assertEquals((await h(new Request("https://x/f"))).status, 200);
});
