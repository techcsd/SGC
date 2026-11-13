// DO-06 — tests del lector de CV (proveedor mockeado: se prueba la lógica
// pura — construcción del mensaje y parseo de la respuesta). Payload
// válido/corrupto/sin texto extraíble, como pide el ticket de la ronda DO.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { construirContenidoCv, parsearCv } from "./lector.ts";

Deno.test("PDF: bloque document + instrucción", () => {
  const c = construirContenidoCv({ data: "AAA", mime: "application/pdf" });
  assertEquals(c[0].type, "document");
  // deno-lint-ignore no-explicit-any
  assertEquals((c[0] as any).source.media_type, "application/pdf");
  assertEquals(c[c.length - 1].type, "text");
});

Deno.test("imagen: bloque image + instrucción", () => {
  const c = construirContenidoCv({ data: "BBB", mime: "image/png" });
  assertEquals(c[0].type, "image");
  // deno-lint-ignore no-explicit-any
  assertEquals((c[0] as any).source.media_type, "image/png");
});

Deno.test("mime no soportado (payload corrupto) se rechaza", () => {
  assertThrows(() => construirContenidoCv({ data: "AAA", mime: "application/msword" }));
});

Deno.test("archivo sin data se rechaza", () => {
  assertThrows(() => construirContenidoCv({ data: "", mime: "application/pdf" }));
});

// Payload válido: respuesta bien formada del proveedor.
Deno.test("parsearCv: respuesta válida con texto alrededor del JSON", () => {
  const texto = `Aquí está el JSON:
  {
    "nombre": "Juan Pérez", "telefono": "809-555-1234", "email": "juan@correo.com",
    "experiencia_resumen": "5 años como ayudante de carpintero en obras residenciales.",
    "educacion": "Bachiller, Liceo Duarte",
    "cargos_previos": ["Ayudante de carpintero", "Peón de obra"]
  }`;
  const r = parsearCv(texto);
  assertEquals(r?.nombre, "Juan Pérez");
  assertEquals(r?.telefono, "809-555-1234");
  assertEquals(r?.cargos_previos, ["Ayudante de carpintero", "Peón de obra"]);
});

Deno.test("parsearCv: campos ausentes quedan null/[] sin inventar datos", () => {
  const r = parsearCv(`{ "nombre": null, "telefono": null, "email": null, "experiencia_resumen": null, "educacion": null, "cargos_previos": [] }`);
  assertEquals(r?.nombre, null);
  assertEquals(r?.cargos_previos, []);
});

// Sin texto extraíble / respuesta corrupta: no explota, devuelve null.
Deno.test("parsearCv: respuesta sin JSON interpretable devuelve null", () => {
  assertEquals(parsearCv("No se pudo leer el documento, perdón."), null);
});

Deno.test("parsearCv: JSON corrupto (llave sin cerrar) devuelve null", () => {
  assertEquals(parsearCv(`{ "nombre": "Juan"`), null);
});

Deno.test("parsearCv: cargos_previos con elementos no-string se filtran", () => {
  const r = parsearCv(`{ "nombre": "Ana", "telefono": null, "email": null, "experiencia_resumen": null, "educacion": null, "cargos_previos": ["Albañil", 5, null, "Capataz"] }`);
  assertEquals(r?.cargos_previos, ["Albañil", "Capataz"]);
});
