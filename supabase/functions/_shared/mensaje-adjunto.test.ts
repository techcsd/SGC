import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { AdjuntoError, MAX_ADJUNTO_BYTES, nombreSeguro, validarAdjunto } from "./mensaje-adjunto.ts";

const b64 = (s: string) => btoa(s);

Deno.test("adjunto: csv válido se decodifica con su tamaño", () => {
  const r = validarAdjunto({ nombre: "conduces.csv", mime: "text/csv", contenido_base64: b64("a,b\n1,2\n") });
  assertEquals(r.nombre, "conduces.csv"); assertEquals(r.size, 8); assertEquals(new TextDecoder().decode(r.bytes), "a,b\n1,2\n");
});

Deno.test("adjunto: tipo no permitido se rechaza", () => {
  assertThrows(() => validarAdjunto({ nombre: "x.exe", mime: "application/x-msdownload", contenido_base64: b64("MZ") }), AdjuntoError);
});

Deno.test("adjunto: base64 inválido o vacío se rechaza", () => {
  assertThrows(() => validarAdjunto({ nombre: "a.txt", mime: "text/plain", contenido_base64: "***" }), AdjuntoError);
  assertThrows(() => validarAdjunto({ nombre: "a.txt", mime: "text/plain", contenido_base64: "" }), AdjuntoError);
  assertThrows(() => validarAdjunto(null), AdjuntoError);
});

Deno.test("adjunto: más de 3 MB se rechaza", () => {
  const grande = btoa("a".repeat(MAX_ADJUNTO_BYTES + 10));
  assertThrows(() => validarAdjunto({ nombre: "g.txt", mime: "text/plain", contenido_base64: grande }), AdjuntoError);
});

Deno.test("adjunto: prefijo data: y saltos de línea se toleran", () => {
  const r = validarAdjunto({ nombre: "a.txt", mime: "TEXT/PLAIN", contenido_base64: "data:text/plain;base64," + b64("hola").replace(/(.{2})/g, "$1\n") });
  assertEquals(r.size, 4);
});

Deno.test("nombre seguro: sin carpetas ni caracteres raros", () => {
  assertEquals(nombreSeguro("../../etc/passwd"), "passwd");
  assertEquals(nombreSeguro("C:\\x\\Informe Año 2026?.pdf"), "Informe Ano 2026_.pdf");
  assertEquals(nombreSeguro("...."), "archivo");
});
