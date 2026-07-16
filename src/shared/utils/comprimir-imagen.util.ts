// Comprime una imagen (cámara/archivo) antes de subirla, igual que hace la app
// de campo: redimensiona al lado máximo y recodifica a JPEG. Evita subir fotos
// de 5–10 MB desde el navegador. Si el archivo no es imagen o algo falla, se
// devuelve el original (nunca bloquea la subida).

const MAX_LADO = 1600; // px
const CALIDAD = 0.8;

export async function comprimirImagen(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', CALIDAD),
    );
    if (!blob) return file;

    const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
