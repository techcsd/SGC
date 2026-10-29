// DB5 — tests del lector de documento de personal (proveedor mockeado).
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { construirContenido, parsearLectura } from "./lector.ts";

Deno.test("contenido: 2 fotos numeradas + instrucción", () => {
  const c = construirContenido({ data: "A", mime: "image/jpeg" }, { data: "B", mime: "image/png" });
  assertEquals(c.length, 5);
  assertEquals(c[1].type, "image");
  assertEquals(c[3].source.media_type, "image/png");
});

Deno.test("rechaza mime no soportado o foto vacía", () => {
  assertThrows(() => construirContenido({ data: "A", mime: "application/pdf" }, { data: "B", mime: "image/png" }));
  assertThrows(() => construirContenido({ data: "", mime: "image/jpeg" }, { data: "B", mime: "image/png" }));
});

Deno.test("parsea lectura completa (cédula dominicana)", () => {
  const l = parsearLectura(`{
    "nombre": "JUAN ALBERTO", "apellido": "PEREZ GOMEZ", "tipo_documento": "cedula",
    "documento_numero": "001-1234567-8", "nacionalidad": "dominicano",
    "fecha_nacimiento": "1990-05-14", "sexo": "M", "coincide_rostro": "si",
    "confianza": { "nombre": 0.97, "documento_numero": 0.95, "coincide_rostro": 0.9 }
  }`)!;
  assertEquals(l.nombre, "JUAN ALBERTO");
  assertEquals(l.documento_numero, "001-1234567-8");
  assertEquals(l.coincide_rostro, "si");
});

Deno.test("valores fuera de catálogo se normalizan (tipo/nacionalidad null, coincide dudoso)", () => {
  const l = parsearLectura(`{"nombre":"ANA","tipo_documento":"visa","nacionalidad":"chileno","coincide_rostro":"maybe","fecha_nacimiento":"14/05/1990"}`)!;
  assertEquals(l.tipo_documento, null);
  assertEquals(l.nacionalidad, null);
  assertEquals(l.coincide_rostro, "dudoso");
  assertEquals(l.fecha_nacimiento, null);
});

Deno.test("respuesta no interpretable → null", () => {
  assertEquals(parsearLectura("la foto está muy borrosa"), null);
});
