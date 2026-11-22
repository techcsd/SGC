// _shared/mensaje-adjunto.ts — DU: adjunto de un mensaje directo preparado desde el conector (proponer_mensaje).
// Valida y decodifica el archivo ANTES de subirlo al bucket `sgc-mensajes`. Mismos tipos que admite el bucket.

export const MAX_ADJUNTO_BYTES = 3 * 1024 * 1024; // el base64 viaja en los parámetros del borrador
export const MIMES_ADJUNTO = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export interface AdjuntoEntrada { nombre?: unknown; mime?: unknown; contenido_base64?: unknown }
export interface AdjuntoValido { nombre: string; mime: string; bytes: Uint8Array; size: number }

export class AdjuntoError extends Error {}

/** Nombre seguro para usar en la ruta del bucket: sin carpetas, sin caracteres raros, máx. 120. */
export function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? "archivo";
  const limpio = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").trim();
  return (limpio || "archivo").slice(0, 120);
}

export function validarAdjunto(a: AdjuntoEntrada | null | undefined): AdjuntoValido {
  if (!a || typeof a !== "object") throw new AdjuntoError("Falta el archivo adjunto.");
  const nombre = typeof a.nombre === "string" ? nombreSeguro(a.nombre) : "";
  const mime = typeof a.mime === "string" ? a.mime.trim().toLowerCase() : "";
  const b64 = typeof a.contenido_base64 === "string" ? a.contenido_base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "") : "";
  if (!nombre) throw new AdjuntoError("El adjunto necesita un nombre.");
  if (!(MIMES_ADJUNTO as readonly string[]).includes(mime)) {
    throw new AdjuntoError("Ese tipo de archivo no se puede adjuntar (usa pdf, word, excel, csv, txt o imagen).");
  }
  if (!b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new AdjuntoError("El contenido del adjunto no es válido.");
  // Tamaño decodificado sin decodificar todo primero.
  const size = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
  if (size <= 0) throw new AdjuntoError("El archivo está vacío.");
  if (size > MAX_ADJUNTO_BYTES) throw new AdjuntoError("El archivo pesa más de 3 MB; compártelo por otro medio.");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { nombre, mime, bytes, size: bytes.length };
}
