// DX9 — lógica PURA de la importación de personal (testeable sin Angular).

/** Mayúsculas, sin acentos y con espacios colapsados. */
export function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export interface ObraMin { id: string; nombre: string }
export interface CargoMin { id: string; codigo: string; nombre: string }

/**
 * Busca una etiqueta (PROYECTO / OBRA / UBICACIÓN / ENC…) en CUALQUIER columna de las
 * primeras `maxFilas` filas; el valor es la primera celda NO vacía a su derecha
 * (soporta celdas combinadas y etiquetas fuera de la columna B). Acepta «PROYECTO:».
 */
export function valorDeEtiqueta(rows: unknown[][], etiquetas: string[], maxFilas = 20, prefijo = false): string {
  const set = new Set(etiquetas.map(norm));
  for (const r of rows.slice(0, maxFilas)) {
    for (let c = 0; c < r.length; c++) {
      const lab = norm(r[c]).replace(/[:.\s]+$/, '');
      const hit = prefijo ? [...set].some((e) => lab.startsWith(e)) : set.has(lab);
      if (!hit) continue;
      for (let k = c + 1; k < r.length; k++) {
        const v = String(r[k] ?? '').trim();
        if (v) return v;
      }
    }
  }
  return '';
}

export type MotivoObra = 'sin_texto' | 'ninguna' | 'ambigua' | null;

/**
 * Obra por nombre: igualdad normalizada primero; luego contención SOLO si es única.
 * 0 o >1 coincidencias → null (el usuario elige). Arregla el bug de `includes('')`
 * que proponía la primera obra del directorio cuando no se detectaba el nombre.
 */
export function detectarObra(texto: string, obras: ObraMin[]): { obra: ObraMin | null; motivo: MotivoObra } {
  const t = norm(texto);
  if (!t) return { obra: null, motivo: 'sin_texto' };
  const exactas = obras.filter((o) => norm(o.nombre) === t);
  if (exactas.length === 1) return { obra: exactas[0], motivo: null };
  if (exactas.length > 1) return { obra: null, motivo: 'ambigua' };
  const contiene = obras.filter((o) => {
    const n = norm(o.nombre);
    return n.length >= 3 && (n.includes(t) || t.includes(n));
  });
  if (contiene.length === 1) return { obra: contiene[0], motivo: null };
  return { obra: null, motivo: contiene.length > 1 ? 'ambigua' : 'ninguna' };
}

const RUIDO = new Set(['DE', 'DEL', 'LA', 'EL', 'Y', 'CSD']);

/** Palabras significativas: sin ruido («CSD», «DE»…) y en singular («VARILLEROS» → «VARILLERO»). */
export function tokensCargo(s: unknown): string[] {
  return norm(s)
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((t) => !RUIDO.has(t))
    .map((t) => {
      // ALBANILES → ALBANIL, OPERADORES → OPERADOR; pero AYUDANTES → AYUDANTE (solo se quita la S).
      if (t.length > 4 && /[LRNZD]ES$/.test(t)) return t.slice(0, -2);
      if (t.length > 3 && t.endsWith('S')) return t.slice(0, -1);
      return t;
    });
}

const mismoConjunto = (a: string[], b: string[]) => a.length === b.length && a.every((t) => b.includes(t));

export interface ResolucionCargo { id: string | null; sugerencia: CargoMin | null }

/**
 * Cargo por texto crudo. Orden: mapa exacto (alias + catálogo + diccionario) → mismo
 * conjunto de palabras significativas (`AYUDANTE DE VARILLERO` ≠ `VARILLERO`) → sin
 * resolver, con la SUGERENCIA más parecida (Jaccard ≥ 0.5) para «¿Varillero?».
 */
export function resolverCargoTexto(raw: unknown, exacto: Map<string, string>, catalogo: CargoMin[]): ResolucionCargo {
  const key = norm(raw);
  if (!key) return { id: null, sugerencia: null };
  const directo = exacto.get(key);
  if (directo) return { id: directo, sugerencia: null };
  const tk = tokensCargo(raw);
  if (!tk.length) return { id: null, sugerencia: null };
  for (const c of catalogo) {
    if (mismoConjunto(tk, tokensCargo(c.nombre)) || mismoConjunto(tk, tokensCargo(c.codigo))) return { id: c.id, sugerencia: null };
  }
  let mejor: CargoMin | null = null;
  let mejorPuntaje = 0;
  for (const c of catalogo) {
    const tc = tokensCargo(c.nombre);
    const inter = tk.filter((t) => tc.includes(t)).length;
    const uni = new Set([...tk, ...tc]).size;
    const p = uni ? inter / uni : 0;
    if (p > mejorPuntaje) { mejorPuntaje = p; mejor = c; }
  }
  return { id: null, sugerencia: mejorPuntaje >= 0.5 ? mejor : null };
}
