// pagos-descargo-enviar/pdf.ts — DB4 — armado del PDF (lógica separada para el test).
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// deno-lint-ignore no-explicit-any
export type Any = any;

export interface LineaPdf {
  nombre: string;
  documento: string;
  cargo: string;
  monto: number | null;
  concepto: string;
  firmaPng: Uint8Array | null;
}

export interface DatosPdf {
  obra: string;
  desde: string; // DD/MM/YYYY
  hasta: string;
  empresa: string;
  textoDescargo: string; // plantilla ya con {{placeholders}} (se resuelven por línea)
  lineas: LineaPdf[];
  esComplemento: boolean;
}

const nf = (n: number | null) =>
  n == null ? "—" : Number(n).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function resolver(plantilla: string, l: LineaPdf, d: DatosPdf): string {
  const limpio = plantilla.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return limpio
    .replaceAll("{{nombre}}", l.nombre)
    .replaceAll("{{documento}}", l.documento || "sin documento")
    .replaceAll("{{empresa}}", d.empresa)
    .replaceAll("{{desde}}", d.desde)
    .replaceAll("{{hasta}}", d.hasta)
    .replaceAll("{{monto}}", nf(l.monto))
    .replaceAll("{{concepto}}", l.concepto || "trabajos de la semana")
    .replaceAll("{{obra}}", d.obra);
}

/** Hoja resumen + una hoja de descargo por persona firmada. */
export async function construirPdfPagos(d: DatosPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.12, 0.15, 0.18);
  const naranja = rgb(0.98, 0.45, 0.09);
  const margin = 48;
  const ancho = 595 - margin * 2;

  const wrap = (page: Any, text: string, x: number, yStart: number, size: number, f: Any, color: Any): number => {
    let y = yStart;
    const words = (text ?? "").split(/\s+/);
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > ancho) {
        page.drawText(cur, { x, y, size, font: f, color });
        y -= size + 4;
        cur = w;
      } else cur = test;
    }
    if (cur) { page.drawText(cur, { x, y, size, font: f, color }); y -= size + 4; }
    return y;
  };

  // ── Hoja resumen ──
  let page = doc.addPage([595, 842]);
  let y = 790;
  page.drawText(`Pagos de la semana${d.esComplemento ? " (complemento)" : ""}`, { x: margin, y, size: 16, font: bold, color: naranja });
  y -= 22;
  y = wrap(page, `${d.obra} - Semana del ${d.desde} al ${d.hasta}`, margin, y, 11, font, dark);
  y -= 10;
  const firmadas = d.lineas.filter((l) => l.firmaPng);
  const total = firmadas.reduce((s, l) => s + Number(l.monto ?? 0), 0);
  y = wrap(page, `Descargos firmados: ${firmadas.length} de ${d.lineas.length} - Total pagado (firmado): RD$ ${nf(total)}`, margin, y, 10.5, bold, dark);
  y -= 8;
  for (const l of d.lineas) {
    if (y < margin + 30) { page = doc.addPage([595, 842]); y = 790; }
    const estado = l.firmaPng ? "FIRMADO" : "sin firma";
    y = wrap(page, `- ${l.nombre} (${l.documento || "sin doc."}) - ${l.cargo || "sin cargo"} - RD$ ${nf(l.monto)} - ${estado}`, margin, y, 10, font, dark);
  }

  // ── Una hoja por persona FIRMADA ──
  for (const l of firmadas) {
    const p = doc.addPage([595, 842]);
    let py = 780;
    p.drawText("DESCARGO DE PAGO", { x: margin, y: py, size: 15, font: bold, color: naranja });
    py -= 26;
    py = wrap(p, `${d.obra} - Semana del ${d.desde} al ${d.hasta}`, margin, py, 10.5, font, dark);
    py -= 14;
    py = wrap(p, `Nombre: ${l.nombre}`, margin, py, 11, bold, dark);
    py = wrap(p, `Identificacion: ${l.documento || "sin documento"}`, margin, py, 11, bold, dark);
    py = wrap(p, `Cargo: ${l.cargo || "-"}`, margin, py, 11, font, dark);
    py = wrap(p, `Monto: RD$ ${nf(l.monto)}`, margin, py, 11, bold, dark);
    py -= 12;
    py = wrap(p, resolver(d.textoDescargo, l, d), margin, py, 10.5, font, dark);
    py -= 36;
    if (l.firmaPng) {
      try {
        const img = await doc.embedPng(l.firmaPng);
        const w = Math.min(190, img.width);
        const h = (img.height / img.width) * w;
        p.drawImage(img, { x: margin, y: Math.max(margin + 30, py - h), width: w, height: h });
        py = Math.max(margin + 26, py - h - 6);
      } catch { /* firma ilegible: la línea de firma igual queda abajo */ }
    }
    p.drawLine({ start: { x: margin, y: py }, end: { x: margin + 220, y: py }, thickness: 1, color: dark });
    p.drawText("Firma", { x: margin, y: py - 14, size: 9.5, font, color: dark });
  }

  return await doc.save();
}
