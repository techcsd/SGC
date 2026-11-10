// DL5 — pdf-recap.ts es la parte genérica extraída de resumen-semanal-operaciones
// (BE1/BB9); ambos (ese edge y wa-recap) deben seguir produciendo un PDF válido.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { construirPdfSecciones } from "./pdf-recap.ts";

Deno.test("construirPdfSecciones — produce un PDF válido con al menos 1 página", async () => {
  const pdf = await construirPdfSecciones(
    { tituloPortada: "Título", subtituloPortada: "Subtítulo" },
    [{ titulo: "Sección 1", cols: ["A", "B"], rows: [["1", "2"]] }],
  );
  assert(pdf.length > 100);
  const doc = await PDFDocument.load(pdf);
  assertEquals(doc.getPageCount(), 1);
});

Deno.test("construirPdfSecciones — sección sin filas muestra el texto 'vacío' sin lanzar", async () => {
  const pdf = await construirPdfSecciones(
    { tituloPortada: "T", subtituloPortada: "S", vacioTexto: "Nada por aquí." },
    [{ titulo: "Vacía", cols: ["X"], rows: [] }],
  );
  const doc = await PDFDocument.load(pdf);
  assertEquals(doc.getPageCount(), 1);
});

Deno.test("construirPdfSecciones — muchas filas fuerzan paginado (más de 1 página)", async () => {
  const filas = Array.from({ length: 80 }, (_, i) => [`fila ${i}`, "x"]);
  const pdf = await construirPdfSecciones(
    { tituloPortada: "T", subtituloPortada: "S" },
    [{ titulo: "Larga", cols: ["Col1", "Col2"], rows: filas }],
  );
  const doc = await PDFDocument.load(pdf);
  assert(doc.getPageCount() > 1);
});

Deno.test("construirPdfSecciones — piePagina=false no añade error ni rompe nada (resumen-semanal-operaciones)", async () => {
  const pdf = await construirPdfSecciones(
    { tituloPortada: "T", subtituloPortada: "S", piePagina: false },
    [{ titulo: "Sección", cols: ["A"], rows: [["1"]] }],
  );
  const doc = await PDFDocument.load(pdf);
  assertEquals(doc.getPageCount(), 1);
});
