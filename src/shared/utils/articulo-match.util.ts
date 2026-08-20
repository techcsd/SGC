/**
 * AT7 — Coincidencia difusa de texto de renglón ↔ artículo del catálogo.
 *
 * Se usa al APROBAR una requisición: el renglón puede traer `articulo_id` del
 * origen (la app/creador ya eligió del catálogo) — ese es el camino ideal — o
 * ser texto libre escrito por el ingeniero. Para el texto libre, en vez de dejar
 * el renglón "Sin artículo (comprar)" (que dispara una compra innecesaria), se
 * sugiere el mejor artículo del catálogo con un puntaje de confianza.
 *
 * Local y síncrono (opera sobre los artículos ya cargados en memoria); no hace
 * ida-y-vuelta al servidor. El servidor tiene su propia búsqueda difusa
 * (`buscar_articulos`, pg_trgm+unaccent, AW6) para el buscador interactivo.
 */

/** Referencia mínima de artículo para el matcher (compatible con Articulo). */
export interface ArticuloMatchRef {
  id: string;
  nombre: string;
  codigo: string;
  subgrupo?: string | null;
}

export interface CoincidenciaArticulo<T extends ArticuloMatchRef> {
  articulo: T;
  /** 0..1 — 1 = coincidencia perfecta. */
  score: number;
}

/**
 * Normaliza texto de artículo para comparar:
 *  - minúsculas y sin acentos
 *  - quita prefijo entre corchetes `[CSD]` y el código final entre paréntesis
 *  - homologa comillas de pulgada/pie (" ' ” “ ’ ‘ → nada) y la `x`/`×` de medidas
 *  - colapsa espacios y quita puntuación suelta
 */
export function normalizarTextoArticulo(input: string | null | undefined): string {
  if (!input) return '';
  let t = input.toLowerCase();
  // sin acentos (rango de marcas diacríticas combinantes)
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // quita prefijo [xxx] al inicio
  t = t.replace(/^\s*\[[^\]]*\]\s*/, '');
  // quita el código final entre paréntesis: "(csd-05-001)"
  t = t.replace(/\([^)]*\)\s*$/, '');
  // homologa comillas de medidas y la x de "24x8"
  t = t.replace(/[”“"’‘']/g, '').replace(/×/g, 'x');
  // separa números pegados a letras (24x8 -> 24 x 8) para tokenizar medidas
  t = t.replace(/(\d)\s*x\s*(\d)/g, '$1 x $2');
  // deja solo alfanumérico y espacios
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  // colapsa espacios
  return t.replace(/\s+/g, ' ').trim();
}

/** Tokens únicos (>=1 char) del texto normalizado. */
function tokens(t: string): string[] {
  return t ? Array.from(new Set(t.split(' ').filter(Boolean))) : [];
}

/**
 * Puntaje 0..1 entre el texto del renglón y un artículo. Combina:
 *  - coincidencia exacta de código (peso alto)
 *  - solapamiento de tokens (Dice) entre nombre normalizado y el texto
 *  - bonus si un texto contiene al otro (substring)
 */
export function scoreArticulo(descripcion: string, articulo: ArticuloMatchRef): number {
  const d = normalizarTextoArticulo(descripcion);
  if (!d) return 0;
  const codigo = (articulo.codigo || '').toLowerCase().trim();
  const dRaw = (descripcion || '').toLowerCase().trim();
  // Código citado literalmente en el texto → match fuerte.
  if (codigo && (dRaw === codigo || dRaw.includes(codigo))) return 1;

  const nombre = normalizarTextoArticulo(
    (articulo.subgrupo ? articulo.subgrupo + ' ' : '') + articulo.nombre,
  );
  if (!nombre) return 0;
  if (nombre === d) return 1;

  const dt = tokens(d);
  const nt = tokens(nombre);
  if (!dt.length || !nt.length) return 0;
  const nset = new Set(nt);
  const inter = dt.filter((x) => nset.has(x)).length;
  const dice = (2 * inter) / (dt.length + nt.length);

  // Bonus por contención (uno es prefijo/substring del otro).
  let bonus = 0;
  if (nombre.includes(d) || d.includes(nombre)) bonus = 0.2;

  return Math.min(1, dice + bonus);
}

/**
 * Devuelve la mejor coincidencia (o null) para el texto dado sobre el catálogo.
 * @param umbral puntaje mínimo para considerar una sugerencia (default 0.5).
 */
export function mejorCoincidenciaArticulo<T extends ArticuloMatchRef>(
  descripcion: string,
  articulos: readonly T[],
  umbral = 0.5,
): CoincidenciaArticulo<T> | null {
  let best: CoincidenciaArticulo<T> | null = null;
  for (const a of articulos) {
    const score = scoreArticulo(descripcion, a);
    if (!best || score > best.score) best = { articulo: a, score };
  }
  if (best && best.score >= umbral) return best;
  return null;
}
