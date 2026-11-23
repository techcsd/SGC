import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { clasificarErrorIA, envolverServe, ErrorIA, fetchAnthropic } from "./anthropic.ts";

const ok = () => new Response(JSON.stringify({ content: [{ type: "text", text: "hola" }] }), { status: 200 });
const err = (status: number, body = "{}", headers: Record<string, string> = {}) => new Response(body, { status, headers });
const RAPIDO = { esperaReintentoMs: 1 };

Deno.test("429 → reintenta una vez y funciona", async () => {
  let n = 0;
  const res = await fetchAnthropic("k", {}, { ...RAPIDO, fetchImpl: () => Promise.resolve(++n === 1 ? err(429) : ok()) });
  assertEquals(res.status, 200);
  assertEquals(n, 2);
});

Deno.test("429 persistente → ia_limite tras exactamente 2 intentos", async () => {
  let n = 0;
  const e = await assertRejects(() => fetchAnthropic("k", {}, { ...RAPIDO, fetchImpl: () => Promise.resolve((n++, err(429, "{}", { "request-id": "req_x" }))) }), ErrorIA);
  assertEquals(e.codigo, "ia_limite");
  assertEquals(e.requestId, "req_x");
  assertEquals(n, 2);
});

Deno.test("400 modelo inexistente → ia_modelo_no_disponible sin reintento", async () => {
  let n = 0;
  const e = await assertRejects(() => fetchAnthropic("k", {}, { ...RAPIDO, fetchImpl: () => Promise.resolve((n++, err(404, '{"error":{"type":"not_found_error","message":"model: x"}}'))) }), ErrorIA);
  assertEquals(e.codigo, "ia_modelo_no_disponible");
  assertEquals(n, 1);
});

Deno.test("saldo agotado → ia_sin_credito sin reintento", async () => {
  let n = 0;
  const e = await assertRejects(() => fetchAnthropic("k", {}, { ...RAPIDO, fetchImpl: () => Promise.resolve((n++, err(400, '{"error":{"message":"Your credit balance is too low"}}'))) }), ErrorIA);
  assertEquals(e.codigo, "ia_sin_credito");
  assertEquals(n, 1);
});

Deno.test("timeout → ia_tiempo_agotado (AbortSignal real)", async () => {
  const lento: typeof fetch = (_u, init) =>
    new Promise((_r, rej) => (init?.signal as AbortSignal).addEventListener("abort", () => rej((init!.signal as AbortSignal).reason)));
  const e = await assertRejects(() => fetchAnthropic("k", {}, { timeoutMs: 20, esperaReintentoMs: 1, fetchImpl: lento }), ErrorIA);
  assertEquals(e.codigo, "ia_tiempo_agotado");
});

Deno.test("clasificarErrorIA", () => {
  assertEquals(clasificarErrorIA(500, ""), "ia_error");
  assertEquals(clasificarErrorIA(529, ""), "ia_limite");
  assertEquals(clasificarErrorIA(401, ""), "ia_error");
});

Deno.test("envolverServe: excepción → JSON 500 con CORS (nunca respuesta sin cabeceras)", async () => {
  const h = envolverServe("t", () => { throw new Error("boom"); }, () => ({ "Access-Control-Allow-Origin": "https://x" }));
  const r = await h(new Request("https://e/"));
  assertEquals(r.status, 500);
  assertEquals(r.headers.get("access-control-allow-origin"), "https://x");
  assertEquals((await r.json()).error_code, "error_interno");
});
