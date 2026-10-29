// DB4 — test del PDF del descargo (texto, cédula y firma embebida).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { construirPdfPagos } from "./pdf.ts";

// PNG de firma de prueba, generado en memoria (un lienzo pdf-lib no sirve aquí;
// usamos un PNG 1×1 mínimo, suficiente para probar el embed).
const PNG_1x1 = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (c) => c.charCodeAt(0));

const BASE = {
  obra: "OBRA DEMO",
  desde: "20/10/2026",
  hasta: "26/10/2026",
  empresa: "Constructora SD",
  textoDescargo:
    "<p>Yo, <strong>{{nombre}}</strong>, portador del documento {{documento}}, recibí de {{empresa}} RD$ {{monto}} por {{concepto}} en {{obra}}, semana del {{desde}} al {{hasta}}.</p>",
  esComplemento: false,
};

async function extraerTexto(pdf: Uint8Array): Promise<{ paginas: number }> {
  const doc = await PDFDocument.load(pdf);
  return { paginas: doc.getPageCount() };
}

Deno.test("resumen + una hoja por persona FIRMADA (la sin firma no genera hoja)", async () => {
  const pdf = await construirPdfPagos({
    ...BASE,
    lineas: [
      { nombre: "JUAN PEREZ", documento: "001-1234567-8", cargo: "Albañil", monto: 8500, concepto: "semana", firmaPng: PNG_1x1 },
      { nombre: "PEDRO GOMEZ", documento: "002-7654321-0", cargo: "Ayudante", monto: 6000, concepto: "semana", firmaPng: null },
    ],
  });
  const { paginas } = await extraerTexto(pdf);
  assertEquals(paginas, 2); // 1 resumen + 1 descargo firmado (Pedro sin firma no lleva hoja)
  assert(pdf.length > 1000);
});

Deno.test("firma embebida: el PDF contiene una imagen (XObject)", async () => {
  const pdf = await construirPdfPagos({
    ...BASE,
    lineas: [{ nombre: "JUAN PEREZ", documento: "001-1234567-8", cargo: "Albañil", monto: 8500, concepto: "semana", firmaPng: PNG_1x1 }],
  });
  const texto = new TextDecoder("latin1").decode(pdf);
  assert(texto.includes("/XObject") || texto.includes("/Image"), "el PDF debe embeber la imagen de la firma");
});

Deno.test("sin ninguna firma: solo hoja resumen", async () => {
  const pdf = await construirPdfPagos({
    ...BASE,
    lineas: [{ nombre: "ANA", documento: "", cargo: "", monto: null, concepto: "", firmaPng: null }],
  });
  const { paginas } = await extraerTexto(pdf);
  assertEquals(paginas, 1);
});
