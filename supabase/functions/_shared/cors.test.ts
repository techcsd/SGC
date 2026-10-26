import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { corsHeaders, ORIGENES_SGC } from "./cors.ts";

const req = (origin: string | null) =>
  new Request("https://example.test", { headers: origin ? { Origin: origin } : {} });

Deno.test("origen permitido se refleja", () => {
  for (const o of ORIGENES_SGC) {
    const h = corsHeaders(req(o));
    assertEquals(h["Access-Control-Allow-Origin"], o);
  }
});

Deno.test("origen no permitido no se refleja", () => {
  const h = corsHeaders(req("https://evil.example"));
  assertEquals(h["Access-Control-Allow-Origin"], undefined);
});

Deno.test("sin Origin (servidor-a-servidor) no rompe, solo omite el header", () => {
  const h = corsHeaders(req(null));
  assertEquals(h["Access-Control-Allow-Origin"], undefined);
  assertNotEquals(h["Access-Control-Allow-Methods"], undefined);
});

Deno.test("Vary: Origin y Max-Age siempre presentes", () => {
  const h = corsHeaders(req("https://sgcconstructorasd.com"));
  assertEquals(h["Vary"], "Origin");
  assertEquals(h["Access-Control-Max-Age"], "86400");
});

Deno.test("headersExtra se agrega sin pisar los base", () => {
  const h = corsHeaders(req("http://localhost:4200"), { headersExtra: "x-sync-secret" });
  assertEquals(h["Access-Control-Allow-Headers"].includes("x-sync-secret"), true);
  assertEquals(h["Access-Control-Allow-Headers"].includes("authorization"), true);
});
