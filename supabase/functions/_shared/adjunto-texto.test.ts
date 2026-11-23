import { assertEquals } from "jsr:@std/assert@1";
import { acotar, MAX_CHARS_ADJUNTO, textoDeAdjunto, tipoDeAdjunto } from "./adjunto-texto.ts";

Deno.test("tipoDeAdjunto por extensión", () => {
  assertEquals(tipoDeAdjunto("a.PDF"), "pdf");
  assertEquals(tipoDeAdjunto("b.docx"), "docx");
  assertEquals(tipoDeAdjunto("c.doc"), "legacy");
  assertEquals(tipoDeAdjunto("d.exe"), "otro");
});

Deno.test("csv/txt se leen y se acotan", async () => {
  assertEquals(await textoDeAdjunto("x.csv", new TextEncoder().encode("a,b\n1,2")), "a,b\n1,2");
  const largo = "x".repeat(MAX_CHARS_ADJUNTO + 500);
  const t = await textoDeAdjunto("x.txt", new TextEncoder().encode(largo));
  assertEquals(t!.startsWith("x".repeat(MAX_CHARS_ADJUNTO)), true);
  assertEquals(t!.includes("recortado"), true);
});

Deno.test("binario antiguo (.doc) y desconocido no se leen; basura no lanza", async () => {
  assertEquals(await textoDeAdjunto("x.doc", new Uint8Array([1, 2, 3])), null);
  assertEquals(acotar("  hola  "), "hola");
});
