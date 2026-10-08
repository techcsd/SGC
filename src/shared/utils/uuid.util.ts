/**
 * Helpers para uuid opcionales que vienen de <select> nativos.
 *
 * Un `<option [value]="null">` dentro de un select con `formControlName` guarda
 * el string literal `"null"` (no el valor null real) cuando se selecciona. Si ese
 * valor llega a una columna uuid de Postgres, revienta con
 * `invalid input syntax for type uuid: "null"`. Estas funciones lo normalizan.
 */

/** Normaliza un valor de <select> a un uuid válido o null. */
export function cleanUuid(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === 'null' || s === 'undefined' ? null : s;
}

/**
 * Devuelve una copia del payload con `cleanUuid` aplicado a las claves indicadas.
 * Solo toca las claves presentes en el objeto (útil para updates parciales).
 */
export function sanitizeUuidFields<T extends object>(
  payload: T,
  fields: readonly (keyof T)[],
): T {
  const out = { ...payload } as T;
  const rec = out as Record<string, unknown>;
  for (const f of fields) {
    const key = f as string;
    if (key in rec) rec[key] = cleanUuid(rec[key]);
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CK6 — true si `v` es un UUID canónico (no null, no "undefined"/"null", no vacío).
 * Para validar la elección de un <select> ANTES de mandarla a un parámetro uuid del
 * servidor y dar un mensaje humano en vez del error técnico de Postgres.
 */
export function esUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}
