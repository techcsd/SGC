// DX10 — validación de documentos adjuntos a un reporte (cliente). El servidor y el bucket re-validan lo mismo.

export const ADJUNTO_MAX_BYTES = 10 * 1024 * 1024;
export const ADJUNTO_MAX_POR_REPORTE = 5;
export const ADJUNTO_EXTENSIONES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'] as const;
/** Valor para `accept` del input de archivos. */
export const ADJUNTO_ACCEPT = ADJUNTO_EXTENSIONES.map((e) => '.' + e).join(',');

export type ErrorAdjunto = 'tipo' | 'tamano' | 'vacio' | 'cupo';

export function extensionDe(nombre: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(nombre ?? '');
  return m ? m[1].toLowerCase() : '';
}

/** `null` si es válido; si no, el motivo. `yaAgregados` = documentos ya en la lista (para el cupo). */
export function validarAdjunto(f: { name: string; size: number }, yaAgregados: number): ErrorAdjunto | null {
  if (yaAgregados >= ADJUNTO_MAX_POR_REPORTE) return 'cupo';
  if (!(ADJUNTO_EXTENSIONES as readonly string[]).includes(extensionDe(f.name))) return 'tipo';
  if (f.size <= 0) return 'vacio';
  if (f.size > ADJUNTO_MAX_BYTES) return 'tamano';
  return null;
}

/** Nombre seguro para la ruta de storage (el nombre original se guarda aparte para descargar). */
export function nombreSeguro(nombre: string): string {
  const ext = extensionDe(nombre);
  const base = (nombre ?? 'archivo').replace(/\.[A-Za-z0-9]+$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'archivo';
  return ext ? `${base}.${ext}` : base;
}

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
