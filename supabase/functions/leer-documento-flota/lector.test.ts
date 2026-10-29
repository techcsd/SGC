// DB3 — tests del lector de documentos de flota (proveedor mockeado: se prueba
// la lógica pura — construcción del mensaje y parseo de la respuesta).
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { construirContenido, parsearPaginas, MAX_IMAGENES } from "./lector.ts";

Deno.test("PDF: un solo bloque document + instrucción", () => {
  const c = construirContenido([{ data: "AAA", mime: "application/pdf" }]);
  assertEquals(c[0].type, "document");
  assertEquals(c[0].source.media_type, "application/pdf");
  assertEquals(c[c.length - 1].type, "text");
});

Deno.test("PDF + otra imagen en la misma llamada se rechaza", () => {
  assertThrows(() => construirContenido([
    { data: "AAA", mime: "application/pdf" },
    { data: "BBB", mime: "image/jpeg" },
  ]));
});

Deno.test("imágenes: numeradas en orden, tope 20", () => {
  const c = construirContenido([
    { data: "A", mime: "image/jpeg" },
    { data: "B", mime: "image/png" },
  ]);
  // text "Página 1:", image, text "Página 2:", image, text final
  assertEquals(c.length, 5);
  assertEquals(c[0].text, "Página 1:");
  assertEquals(c[3].type, "image");
  assertThrows(() => construirContenido(
    Array.from({ length: MAX_IMAGENES + 1 }, () => ({ data: "X", mime: "image/jpeg" })),
  ));
});

Deno.test("mime no soportado se rechaza", () => {
  assertThrows(() => construirContenido([{ data: "A", mime: "text/plain" }]));
});

// Respuesta mockeada del proveedor: 3 páginas reales del MARBETES.pdf —
// anverso SURA con placa exacta, su reverso de instrucciones, y una página con
// la placa leída A UN CARÁCTER de la real (L441680 vs L441660 en el sistema):
// el parser NO debe «corregirla» — la decisión es del emparejador (SQL) y de la
// persona (fila «Revisar»).
const RESPUESTA_MOCK = `Aquí está el JSON:
{
  "paginas": [
    { "pagina": 1, "tipo": "seguro",
      "campos": { "poliza": "AUTO-202041-3", "aseguradora": "SURA", "vigencia_desde": "2026-10-28",
                  "vigencia_hasta": "2027-10-28", "placa": "K2347567", "chasis": null, "marca": "HUSQVARNA",
                  "modelo": null, "anio": 2023, "numero_matricula": null, "marbete_numero": null },
      "confianza": { "poliza": 0.98, "placa": 0.97, "vigencia_hasta": 0.95 } },
    { "pagina": 2, "tipo": "reverso", "campos": {}, "confianza": {} },
    { "pagina": 3, "tipo": "seguro",
      "campos": { "poliza": "AUTO-202041-7", "aseguradora": "SURA", "vigencia_desde": "2026-10-28",
                  "vigencia_hasta": "2027-10-28", "placa": "L441680", "chasis": null, "marca": "Nissan",
                  "modelo": "Frontier", "anio": null, "numero_matricula": null, "marbete_numero": null },
      "confianza": { "poliza": 0.96, "placa": 0.72 } }
  ]
}`;

Deno.test("parsea la respuesta del modelo (texto alrededor tolerado)", () => {
  const p = parsearPaginas(RESPUESTA_MOCK)!;
  assertEquals(p.length, 3);
  assertEquals(p[0].tipo, "seguro");
  assertEquals(p[0].campos.placa, "K2347567");
  assertEquals(p[1].tipo, "reverso");
});

Deno.test("placa a 1 carácter se conserva TAL CUAL (no se corrige en el parser)", () => {
  const p = parsearPaginas(RESPUESTA_MOCK)!;
  assertEquals(p[2].campos.placa, "L441680"); // la real del sistema es L441660
  assertEquals(p[2].confianza.placa, 0.72);
});

Deno.test("tipo desconocido cae a 'otro' y pagina ausente se numera", () => {
  const p = parsearPaginas(`{"paginas":[{"tipo":"factura","campos":{"placa":"X"}}]}`)!;
  assertEquals(p[0].tipo, "otro");
  assertEquals(p[0].pagina, 1);
});

Deno.test("respuesta sin JSON → null", () => {
  assertEquals(parsearPaginas("no pude leer nada"), null);
});
