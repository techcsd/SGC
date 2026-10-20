// CS2 — pegar capturas desde el portapapeles (Dev notes, Reportes) y copiar una
// imagen de vuelta al portapapeles (para pegarla en Claude Desktop, un correo…).
// Los navegadores solo aceptan PNG en ClipboardItem: convertimos si hace falta.

/** Extrae los archivos de imagen de un evento `paste` o `drop` (los no-imagen se ignoran). */
export function imagenesDePortapapeles(event: ClipboardEvent | DragEvent): File[] {
  const items: DataTransferItemList | undefined =
    'clipboardData' in event ? (event.clipboardData?.items ?? undefined) : undefined;
  const files: File[] = [];
  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  if (!files.length && 'dataTransfer' in event && event.dataTransfer?.files?.length) {
    for (const f of Array.from(event.dataTransfer.files)) {
      if (f.type.startsWith('image/')) files.push(f);
    }
  }
  return files;
}

/** Convierte un Blob a PNG (ClipboardItem solo acepta 'image/png' de forma fiable). */
async function aPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen.');
  ctx.drawImage(bitmap, 0, 0);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo convertir la imagen.'))), 'image/png');
  });
}

/**
 * Copia una imagen al portapapeles del sistema (para pegarla en Claude Desktop,
 * un correo, etc). Exige HTTPS + gesto del usuario (el clic ya lo da). Si el
 * navegador no lo permite, lanza un error — el llamador ofrece «Descargar» en su lugar.
 */
export async function copiarImagenAlPortapapeles(blob: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('Este navegador no permite copiar imágenes al portapapeles.');
  }
  const png = await aPng(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** Descarga una URL (típicamente firmada) como archivo — fallback cuando copiar
 *  al portapapeles no está disponible. */
export function descargarDesdeUrl(url: string, nombre: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
