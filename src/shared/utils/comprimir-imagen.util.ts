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

/** CE6 — ¿es HEIC/HEIF? (iPhone de Sonia). `createImageBitmap` no los decodifica en
 * la mayoría de navegadores → canvas vacío = JPEG negro. Se convierten antes. */
function esHeic(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  const n = (file.name || '').toLowerCase();
  return t.includes('heic') || t.includes('heif') || n.endsWith('.heic') || n.endsWith('.heif');
}

/** CE6 — convierte un HEIC/HEIF a un File JPEG usando heic2any (carga diferida). */
async function convertirHeic(file: File): Promise<File> {
  const mod = await import('heic2any');
  const heic2any = (mod as unknown as { default: (o: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]> }).default;
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/** CE6 — ¿el canvas quedó monocromo (un solo color)? Síntoma de un decode fallido:
 * una foto real nunca es de un único color. Se muestrean pocos píxeles por rendimiento. */
function esMonocromo(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(4, Math.floor(data.length / 4 / 2000) * 4); // ~2000 muestras
    let r0 = -1, g0 = -1, b0 = -1;
    for (let i = 0; i < data.length; i += step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r0 < 0) { r0 = r; g0 = g; b0 = b; continue; }
      if (Math.abs(r - r0) > 6 || Math.abs(g - g0) > 6 || Math.abs(b - b0) > 6) return false;
    }
    return true; // todas las muestras casi idénticas → monocromo
  } catch {
    return false; // ante la duda, no bloquear
  }
}

/**
 * Comprime una imagen según el perfil de destino (por defecto 'evidencia').
 * CE6 — procesado ÚNICO para toda foto (incl. las 5 de personal de obra):
 *   convierte HEIC, decodifica de verdad, rellena fondo BLANCO antes de exportar JPEG
 *   (si no, lo transparente se aplana a negro) y, si el resultado sale monocromo,
 *   conserva el original en vez de guardar una imagen negra.
 * Devuelve el original si no es imagen o si falla la recodificación (nunca bloquea).
 */
export async function comprimirImagen(
  file: File,
  perfil: PerfilCompresion = 'evidencia',
): Promise<File> {
  const esImagen = file.type.startsWith('image/') || esHeic(file);
  if (!esImagen) return file;
  const { maxLado, calidad } = PERFILES[perfil] ?? PERFILES.evidencia;
  try {
    let fuente: Blob = file;
    if (esHeic(file)) {
      try { fuente = await convertirHeic(file); } catch { /* sigue con el original */ }
    }

    const bitmap = await createImageBitmap(fuente);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // CE6 — fondo blanco ANTES de dibujar: lo transparente ya no se vuelve negro.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // CE6 — si salió monocromo (decode fallido), conservar el original intacto.
    if (esMonocromo(ctx, w, h) && !esHeic(file)) return file;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', calidad),
    );
    if (!blob) return file;

    // Si la "compresión" salió más pesada (imágenes ya muy optimizadas), conserva
    // el original — nunca subir más bytes de los que llegaron. (No aplica a HEIC: el
    // original no se puede mostrar, así que siempre nos quedamos con el JPEG.)
    if (blob.size >= file.size && !esHeic(file)) return file;

    const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
