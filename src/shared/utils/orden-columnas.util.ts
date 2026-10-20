// CS1 — orden por columna {clave, dirección} compartido entre Inventario ›
// Requisiciones e Ingeniería › Solicitudes de material (antes cada uno tenía
// su propio interruptor fijo: Inventario solo "Necesidad", Ingeniería nada).

export type Direccion = 'asc' | 'desc';

export interface OrdenColumna<K extends string = string> {
  clave: K;
  dir: Direccion;
}

/** Compara dos valores según la dirección elegida; null/undefined SIEMPRE al
 *  final, en cualquier dirección (nunca se invierten con asc/desc). */
export function compararConNulosAlFinal<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  dir: Direccion,
  cmp: (x: T, y: T) => number,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const base = cmp(a, b);
  return dir === 'asc' ? base : -base;
}

/** Lee el orden guardado en localStorage, migrando un valor "viejo" (string
 *  suelto tipo 'reciente'/'necesidad') al nuevo formato {clave,dir}. */
export function leerOrdenGuardado<K extends string>(
  key: string,
  migracionLegacy: Record<string, OrdenColumna<K>>,
  porDefecto: OrdenColumna<K>,
): OrdenColumna<K> {
  let raw: string | null = null;
  try { raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { raw = null; }
  if (!raw) return porDefecto;
  if (raw in migracionLegacy) return migracionLegacy[raw];
  try {
    const parsed = JSON.parse(raw) as Partial<OrdenColumna<K>>;
    if (parsed && typeof parsed === 'object' && typeof parsed.clave === 'string' && (parsed.dir === 'asc' || parsed.dir === 'desc')) {
      return { clave: parsed.clave as K, dir: parsed.dir };
    }
  } catch { /* valor corrupto: usa el default */ }
  return porDefecto;
}

export function guardarOrden<K extends string>(key: string, v: OrdenColumna<K>): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
