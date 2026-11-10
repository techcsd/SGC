// _shared/pdf-recap.ts — DL5 — parte GENÉRICA de "tablas con título + columnas
// + filas, paginado, A4 apaisado" que ya usaba resumen-semanal-operaciones
// (BE1/BB9). Se extrae aquí para no copiar ~40 líneas en wa-recap; ambos
// (resumen-semanal-operaciones y wa-recap) la reusan — mismo pdf-lib@1.17.1.
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export interface SeccionPdf { titulo: string; cols: string[]; rows: string[][]; nota?: string }

export interface EstiloPdfRecap {
  ancho?: number;
  alto?: number;
  margen?: number;
  colorPrimario?: [number, number, number];
  colorOscuro?: [number, number, number];
  colorMuted?: [number, number, number];
  tituloPortada: string;
  subtituloPortada: string;
  vacioTexto?: string;
  /** DL-20 — "sin emojis ni símbolos fuera de WinAnsi" (StandardFonts.Helvetica). */
  piePagina?: boolean;
}

/** Construye un PDF de "título + N secciones de tabla", con paginado automático
 *  cuando una página se llena (y repite el encabezado de columnas). */
export async function construirPdfSecciones(estilo: EstiloPdfRecap, secciones: SeccionPdf[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = estilo.ancho ?? 842, H = estilo.alto ?? 595, M = estilo.margen ?? 40;
  const [pr, pg, pb] = estilo.colorPrimario ?? [1, 0.37, 0];
  const [dr, dg, db] = estilo.colorOscuro ?? [0.12, 0.15, 0.18];
  const [mr, mg, mb] = estilo.colorMuted ?? [0.4, 0.45, 0.5];
  const primary = rgb(pr, pg, pb), dark = rgb(dr, dg, db), muted = rgb(mr, mg, mb);
  const clip = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1) + "…" : t);

  const paginas: Array<ReturnType<typeof doc.addPage>> = [];
  let page = doc.addPage([W, H]);
  paginas.push(page);
  let y = H - M;

  page.drawText(estilo.tituloPortada, { x: M, y, size: 16, font: bold, color: primary }); y -= 20;
  page.drawText(estilo.subtituloPortada, { x: M, y, size: 10, font, color: muted }); y -= 26;

  const nuevaPagina = () => {
    page = doc.addPage([W, H]);
    paginas.push(page);
    y = H - M;
  };

  for (const sec of secciones) {
    if (y < M + 60) nuevaPagina();
    page.drawText(sec.titulo, { x: M, y, size: 12, font: bold, color: dark }); y -= 16;
    if (sec.nota) { page.drawText(clip(sec.nota, 150), { x: M, y, size: 8.5, font, color: muted }); y -= 13; }
    const colW = (W - 2 * M) / Math.max(1, sec.cols.length);
    const maxChars = Math.max(8, Math.floor(colW / 5.2));
    const header = () => {
      sec.cols.forEach((c, i) => page.drawText(clip(c, maxChars), { x: M + i * colW, y, size: 8.5, font: bold, color: dark }));
      y -= 13;
    };
    header();
    if (!sec.rows.length) { page.drawText(estilo.vacioTexto ?? "Sin datos.", { x: M, y, size: 8.5, font, color: muted }); y -= 12; }
    for (const row of sec.rows) {
      if (y < M + 20) { nuevaPagina(); header(); }
      row.forEach((cell, i) => page.drawText(clip(cell ?? "", maxChars), { x: M + i * colW, y, size: 8, font, color: dark }));
      y -= 11;
    }
    y -= 16;
  }

  if (estilo.piePagina !== false) {
    paginas.forEach((p, i) => {
      p.drawText(`${i + 1} / ${paginas.length}`, { x: W - M - 40, y: M - 24, size: 8, font, color: muted });
    });
  }

  return await doc.save();
}
