import { assertEquals } from "jsr:@std/assert@1";
import {
  normalizarTelefono, verificarFirmaMeta, markdownAWhatsapp, dividirEnChunks, conReintentoHttp,
} from "./whatsapp.ts";

Deno.test("normalizarTelefono — toma los últimos 10 dígitos, ignora símbolos", () => {
  assertEquals(normalizarTelefono("8299663040"), "8299663040");
  assertEquals(normalizarTelefono("18299663040"), "8299663040");
  assertEquals(normalizarTelefono("+1 (829) 966-3040"), "8299663040");
});

Deno.test("verificarFirmaMeta — firma válida pasa, inválida no", async () => {
  const secreto = "mi-secreto-de-prueba";
  const cuerpo = JSON.stringify({ hola: "mundo" });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(cuerpo));
  const hex = Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, "0")).join("");

  assertEquals(await verificarFirmaMeta(cuerpo, `sha256=${hex}`, secreto), true);
  assertEquals(await verificarFirmaMeta(cuerpo, `sha256=${hex}0`, secreto), false);
  assertEquals(await verificarFirmaMeta(cuerpo, null, secreto), false);
  assertEquals(await verificarFirmaMeta(cuerpo, "sin-prefijo", secreto), false);
  assertEquals(await verificarFirmaMeta('{"hola":"otro"}', `sha256=${hex}`, secreto), false);
});

Deno.test("markdownAWhatsapp — negrita, encabezados, enlaces y tablas", () => {
  assertEquals(markdownAWhatsapp("Esto es **importante**"), "Esto es *importante*");
  assertEquals(markdownAWhatsapp("## Título\nTexto"), "*Título*\nTexto");
  assertEquals(markdownAWhatsapp("Mira [el enlace](https://sgc.com)"), "Mira el enlace: https://sgc.com");
  const tabla = "| Obra | Estado |\n| --- | --- |\n| Torre A | Activa |";
  const resultado = markdownAWhatsapp(tabla);
  assertEquals(resultado.includes("_Obra · Estado_"), true);
  assertEquals(resultado.includes("• Torre A — Activa"), true);
});

Deno.test("markdownAWhatsapp — quita HTML suelto", () => {
  assertEquals(markdownAWhatsapp("Hola <b>mundo</b>"), "Hola mundo");
});

Deno.test("dividirEnChunks — texto corto no se parte", () => {
  assertEquals(dividirEnChunks("hola", 4000), ["hola"]);
});

Deno.test("dividirEnChunks — texto largo se parte en borde de párrafo", () => {
  const parrafo1 = "a".repeat(30);
  const parrafo2 = "b".repeat(30);
  const texto = `${parrafo1}\n\n${parrafo2}`;
  const chunks = dividirEnChunks(texto, 35);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0], parrafo1);
  assertEquals(chunks[1], parrafo2);
});

Deno.test("dividirEnChunks — ningún chunk excede el máximo", () => {
  const texto = Array.from({ length: 50 }, (_, i) => `línea número ${i} con algo de texto de relleno`).join("\n");
  const chunks = dividirEnChunks(texto, 200);
  for (const c of chunks) assertEquals(c.length <= 200, true);
  assertEquals(chunks.join("\n").replace(/\n+/g, "\n"), texto.replace(/\n+/g, "\n"));
});

Deno.test("conReintentoHttp — 200 no reintenta", async () => {
  let llamadas = 0;
  const res = await conReintentoHttp(async () => { llamadas++; return new Response("ok", { status: 200 }); }, { dormir: async () => {}, azar: () => 0 });
  assertEquals(res.status, 200);
  assertEquals(llamadas, 1);
});

Deno.test("conReintentoHttp — 429 reintenta y se recupera", async () => {
  let llamadas = 0;
  const res = await conReintentoHttp(async () => {
    llamadas++;
    return llamadas < 3 ? new Response("rate limited", { status: 429 }) : new Response("ok", { status: 200 });
  }, { intentos: 3, dormir: async () => {}, azar: () => 0 });
  assertEquals(res.status, 200);
  assertEquals(llamadas, 3);
});

Deno.test("conReintentoHttp — 400 (negocio) NO reintenta", async () => {
  let llamadas = 0;
  const res = await conReintentoHttp(async () => { llamadas++; return new Response("bad", { status: 400 }); }, { intentos: 3, dormir: async () => {}, azar: () => 0 });
  assertEquals(res.status, 400);
  assertEquals(llamadas, 1);
});

Deno.test("conReintentoHttp — agota intentos y devuelve la última respuesta", async () => {
  let llamadas = 0;
  const res = await conReintentoHttp(async () => { llamadas++; return new Response("down", { status: 503 }); }, { intentos: 3, dormir: async () => {}, azar: () => 0 });
  assertEquals(res.status, 503);
  assertEquals(llamadas, 3);
});
