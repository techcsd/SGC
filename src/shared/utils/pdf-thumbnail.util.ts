// BX4 — Miniatura LIGERA de la página 1 de un PDF (para la ficha de factura de
// combustible). Renderiza con pdfjs a un canvas a ~96 dpi y exporta PNG; si el PNG
// pesa más de 150 KB, cae a JPEG q0.8. Solo en el navegador (usa document/canvas).
export async function generarMiniaturaPdf(data: Uint8Array): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const anyPdf = pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } };
    if (!anyPdf.GlobalWorkerOptions.workerSrc) {
      anyPdf.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
    }
    const doc = await (pdfjs as { getDocument: (a: unknown) => { promise: Promise<PdfDocLike> } })
      .getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
    const page = await doc.getPage(1);
    // 96 dpi sobre el PDF (72 dpi nativo) → escala 96/72 ≈ 1.33.
    const viewport = page.getViewport({ scale: 96 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (png && png.size <= 150 * 1024) return png;
    return await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
  } catch {
    return null; // la miniatura nunca bloquea; el PDF ya quedó guardado.
  }
}

interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}
interface PdfDocLike { getPage(n: number): Promise<PdfPageLike>; }
