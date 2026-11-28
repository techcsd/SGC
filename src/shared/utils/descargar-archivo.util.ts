/** EB-18 — extensión del archivo según la URL (sin query) o el tipo MIME; 'jpg' por defecto. */
export function extensionDe(url: string, mime?: string): string {
  const m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(url.split('#')[0]);
  if (m) return m[1].toLowerCase();
  if (mime?.startsWith('image/')) return mime.slice(6).replace('jpeg', 'jpg').replace('+xml', '');
  return 'jpg';
}

/** EB-18 — nombre de archivo seguro: letras, números, guion y punto. */
export function nombreArchivoSeguro(base: string, ext: string): string {
  const limpio = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${limpio || 'archivo'}.${ext}`;
}

/**
 * EB-18 — descarga REAL de un archivo de otro origen (URL firmada de Storage). El atributo `download` de un enlace
 * se ignora entre orígenes y el navegador abría la imagen en otra ventana; aquí se baja como Blob y se guarda con nombre.
 * Devuelve false si no se pudo (p. ej. CORS): el llamador decide el respaldo.
 */
export async function descargarUrl(url: string, nombreBase: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    const blob = await r.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = nombreArchivoSeguro(nombreBase, extensionDe(url, blob.type));
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return true;
  } catch {
    return false;
  }
}
