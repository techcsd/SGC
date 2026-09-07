// BJ1 — Compresor ÚNICO de imágenes con perfiles por destino. Reemplaza los
// números sueltos que había regados (web 1600/0.8, app 1280/0.7, avatar 0.9…).
// Redimensiona al lado máximo del perfil y recodifica a JPEG antes de subir, para
// no mandar fotos de 5–10 MB desde el navegador. Si el archivo no es imagen o algo
// falla, devuelve el original (nunca bloquea la subida).
//
// ⚠️ FIRMAS: NO pasar por aquí. Son trazo sobre fondo transparente (PNG); pasarlas
// a JPEG mata la transparencia. Las firmas se suben tal cual (PNG).
//
// Paridad: los MISMOS perfiles viven en csd-app (camera.service). Si cambias un
// número, cámbialo en ambos repos (lección BH5).

export type PerfilCompresion = 'evidencia' | 'documento' | 'avatar' | 'sticker';

interface PerfilConfig {
  maxLado: number; // px del lado mayor
  calidad: number; // 0..1 JPEG
}

// Números de la propuesta BJ1 (§F). Un solo lugar para tunear.
// evidencia: decisión Xaviel (BJ1 §F, ronda BJ móvil) = MÁXIMO AHORRO → 1280/0.72
// en AMBOS repos (antes 1600/0.75). Paridad con csd-app (camera.service). Si cambias
// evidencia, cámbialo también allá.
const PERFILES: Record<PerfilCompresion, PerfilConfig> = {
  evidencia: { maxLado: 1280, calidad: 0.72 }, // fotos de obra/conduce/checklist
  documento: { maxLado: 2000, calidad: 0.8 },  // legibilidad de documentos escaneados
  avatar:    { maxLado: 512,  calidad: 0.8 },  // foto de perfil
  sticker:   { maxLado: 512,  calidad: 0.8 },  // stickers propios
};

/**
 * Comprime una imagen según el perfil de destino (por defecto 'evidencia').
 * Devuelve el original si no es imagen o si falla la recodificación.
 */
export async function comprimirImagen(
  file: File,
  perfil: PerfilCompresion = 'evidencia',
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  const { maxLado, calidad } = PERFILES[perfil] ?? PERFILES.evidencia;
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
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
      canvas.toBlob((b) => resolve(b), 'image/jpeg', calidad),
    );
    if (!blob) return file;

    // Si la "compresión" salió más pesada (imágenes ya muy optimizadas), conserva
    // el original — nunca subir más bytes de los que llegaron.
    if (blob.size >= file.size) return file;

    const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
