// DB3 — renderiza cada página de un PDF a PNG (dataURL) con pdfjs-dist.
// Mismo patrón de carga perezosa + worker local que parse-pdf-totalenergies.util
// (el worker se copia como asset en angular.json; nada se baja de un CDN).

export interface PaginaImagen {
  pagina: number; // 1-based
  dataUrl: string; // image/png
}

function configurarWorker(pdfjs: { GlobalWorkerOptions: { workerSrc: string } }) {
  const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (hasWindow && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
  }
}

/** Renderiza todas las páginas de un PDF a PNG. `escala` ~1.5 da buena lectura
 *  sin inflar el peso (una página carta ≈ 1275×1650 px). */
export async function pdfAImagenes(archivo: ArrayBuffer, escala = 1.5): Promise<PaginaImagen[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  configurarWorker(pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } });
  const doc = await pdfjs.getDocument({ data: archivo }).promise;
  const out: PaginaImagen[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear el lienzo para renderizar el PDF.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({ pagina: n, dataUrl: canvas.toDataURL('image/png') });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

/** dataURL → Blob (para subir la página como imagen al bucket de documentos). */
export function dataUrlABlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/data:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
