// EA2 — tests del lector de cédulas por lote (proveedor mockeado: no hay red ni API key).
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { construirContenido, MAX_BYTES_IMAGEN, parsearLectura, validarImagen } from "./lector.ts";

// 1 KB de "imagen" sintética en base64 (no es una cédula real).
const B64_OK = btoa("x".repeat(1024));

Deno.test("contenido: 1 imagen + instrucción", () => {
  const c = construirContenido({ data: B64_OK, mime: "image/jpeg" });
  assertEquals(c.length, 2);
  assertEquals(c[0].type, "image");
  assertEquals(c[0].source.media_type, "image/jpeg");
});

Deno.test("rechaza mime no soportado, vacía, base64 inválido, enorme o diminuta", () => {
  assertThrows(() => construirContenido({ data: B64_OK, mime: "application/pdf" }));
  assertThrows(() => construirContenido({ data: B64_OK, mime: "image/heic" })); // el navegador convierte a JPEG antes
  assertThrows(() => construirContenido({ data: "", mime: "image/png" }));
  assertEquals(validarImagen({ data: "no es base64 !!", mime: "image/png" }), "La imagen no es válida.");
  assertEquals(validarImagen({ data: "QUJD", mime: "image/png" }), "La imagen está vacía o dañada.");
  const enorme = "A".repeat(Math.ceil(MAX_BYTES_IMAGEN * 4 / 3) + 8);
  assertEquals(validarImagen({ data: enorme, mime: "image/jpeg" }), "La imagen es demasiado grande (máximo 5 MB).");
  assertEquals(validarImagen({ data: B64_OK, mime: "image/webp" }), null);
});

Deno.test("parsea cédula (frente) con ruido alrededor del JSON", () => {
  const l = parsearLectura(`Aquí va: {
    "tipo_imagen": "cedula_frente", "documento_numero": "001-0000000-1",
    "nombre": "JUAN ALBERTO", "apellido": "PEREZ GOMEZ", "nacionalidad": "dominicano", "confianza": 0.93 } fin`);
  assertEquals(l?.tipo_imagen, "cedula_frente");
  assertEquals(l?.documento_numero, "001-0000000-1");
  assertEquals(l?.nombre, "JUAN ALBERTO");
  assertEquals(l?.nacionalidad, "dominicano");
  assertEquals(l?.confianza, 0.93);
});

Deno.test("tipo desconocido -> otra; confianza fuera de rango o ausente se acota; nada extra se conserva", () => {
  const l = parsearLectura(`{"tipo_imagen":"licencia","documento_numero":null,"nombre":null,"apellido":null,"confianza":7,"transcripcion":"texto largo"}`);
  assertEquals(l?.tipo_imagen, "otra");
  assertEquals(l?.confianza, 1);
  assertEquals(Object.keys(l!).sort(), ["apellido", "confianza", "documento_numero", "nacionalidad", "nombre", "tipo_imagen"]);
  assertEquals(parsearLectura(`{"tipo_imagen":"pasaporte"}`)?.confianza, 0);
  assertEquals(parsearLectura(`{"confianza":-3}`)?.confianza, 0);
});

Deno.test("sanea textos: control, longitud y numero de documento con basura", () => {
  const l = parsearLectura(JSON.stringify({
    tipo_imagen: "pasaporte", documento_numero: "<script>alert(1)</script>", nombre: "Pierre\nLouis\u0000", apellido: "x".repeat(500), confianza: 0.9,
  }));
  assertEquals(l?.documento_numero, null);
  assertEquals(l?.nombre, "Pierre Louis");
  assertEquals(l?.apellido?.length, 120);
  assertEquals(parsearLectura(`{"documento_numero":"AB1","confianza":0.9}`)?.documento_numero, null); // demasiado corto
  assertEquals(parsearLectura(`{"documento_numero":"HT-123456","confianza":0.9}`)?.documento_numero, "HT-123456");
});

Deno.test("sin JSON / JSON roto / arreglo -> null", () => {
  assertEquals(parsearLectura("no puedo leer esto"), null);
  assertEquals(parsearLectura("{ roto"), null);
  assertEquals(parsearLectura("[1,2]"), null);
});

// Flujo completo con el MODELO MOCKEADO (fetch falso): armar petición -> respuesta -> lectura validada.
import { llamarAnthropic } from "../_shared/anthropic.ts";
import { SYSTEM } from "./lector.ts";

Deno.test("modelo mockeado: la peticion lleva 1 imagen + SYSTEM y la respuesta se parsea", async () => {
  let cuerpo: any = null;
  const fetchFalso = ((_u: string, init: RequestInit) => {
    cuerpo = JSON.parse(String(init.body));
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: `{"tipo_imagen":"pasaporte","documento_numero":"HT123456","nombre":"Pierre","apellido":"Louis","nacionalidad":"haitiano","confianza":0.91}` }],
      usage: { input_tokens: 1500, output_tokens: 80 }, stop_reason: "end_turn",
    }), { status: 200 }));
  }) as unknown as typeof fetch;
  const content = construirContenido({ data: B64_OK, mime: "image/png" });
  const r = await llamarAnthropic("k", { model: "m", max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content }] }, { fetchImpl: fetchFalso });
  assertEquals(cuerpo.messages[0].content.filter((c: any) => c.type === "image").length, 1);
  assertEquals(cuerpo.system, SYSTEM);
  assertEquals(r.tokensIn, 1500);
  assertEquals(parsearLectura(r.texto)?.documento_numero, "HT123456");
});

Deno.test("modelo mockeado: error 429 no rompe, se tipifica (el front lo trata por imagen)", async () => {
  const fetchFalso = (() => Promise.resolve(new Response("{}", { status: 429 }))) as unknown as typeof fetch;
  let codigo = "";
  try {
    await llamarAnthropic("k", { model: "m" }, { fetchImpl: fetchFalso, esperaReintentoMs: 0 });
  } catch (e) { codigo = (e as { codigo: string }).codigo; }
  assertEquals(codigo, "ia_limite");
});
