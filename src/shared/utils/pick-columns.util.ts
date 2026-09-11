/**
 * BN3 (regla 10 del checklist de migraciones) — filtra un objeto a las columnas
 * REALES de una tabla antes de mandarlo a PostgREST. Un control de UI (estado de
 * pantalla: un toggle que maneja un @if, un par select+"Otro", un preview) que se
 * cuele en el payload haría que PostgREST **rechace la fila entera** (HTTP 400) y
 * rompa el guardado — exactamente el bug de `heredar_ubicacion` en bodegas.
 *
 * `allowed` = el conjunto de columnas reales de la tabla (verificadas contra prod),
 * así que este filtro **nunca dropea una columna legítima** (incluye las que el
 * servicio agrega explícitamente: `updated_at`, `codigo`, `creado_por`, etc.) —
 * sólo descarta claves que no son columnas. Es la red de seguridad de servicio que
 * pide la regla 10 ("el servicio que recibe el objeto también filtra"), para no
 * depender de que cada componente recuerde mantener su estado UI fuera del form.
 */
export function pickColumns<T extends object>(input: T, allowed: ReadonlySet<string>): Partial<T> {
  const out: Record<string, unknown> = {};
  const src = input as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (allowed.has(key) && src[key] !== undefined) out[key] = src[key];
  }
  return out as Partial<T>;
}
