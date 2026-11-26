// EA1 — normalización de nombres de proveedor. ESPEJO EXACTO de
// sgc.tec_normalizar_proveedor / sgc.tec_prov_motivo_dudoso / sgc.tec_norm_busqueda
// (sql/2026-11-24-ea1-tec-proveedores.sql). Si cambias una, cambia la otra (hay spec).

const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const SIN_ACENTOS = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';

function quitarAcentos(txt: string): string {
  let out = '';
  for (const ch of txt) {
    const i = ACENTOS.indexOf(ch);
    out += i >= 0 ? SIN_ACENTOS[i] : ch;
  }
  return out;
}

const SUFIJO_SOCIETARIO = /(\s+(SRL|S R L|EIRL|E I R L|SAS|S A S|SA|S A|LTD|LLC|INC|CORP|CXA|CIA))+$/g;

/** Sin tildes, MAYÚSCULAS, sin puntuación y sin sufijo societario (SRL/SA/EIRL…). */
export function normalizarProveedor(txt: string | null | undefined): string {
  const base = quitarAcentos(txt ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.replace(SUFIJO_SOCIETARIO, '').trim();
}

/** Para búsqueda: minúsculas sin tildes (conserva puntuación, como la función SQL). */
export function normalizarBusqueda(txt: string | null | undefined): string {
  return quitarAcentos(txt ?? '').toLowerCase();
}

export type MotivoDudoso = 'vacio' | 'muy_corto' | 'solo_numeros' | 'varios_proveedores';

/** null = texto confiable para autovincular; si no, el motivo por el que va a «por revisar». */
export function motivoDudoso(raw: string | null | undefined): MotivoDudoso | null {
  const norm = normalizarProveedor(raw);
  const txt = raw ?? '';
  if (norm === '') return 'vacio';
  if (norm.length < 3) return 'muy_corto';
  if (/^[0-9 ]+$/.test(norm)) return 'solo_numeros';
  if (/[/;,+&]/.test(txt) || /\s(y|e|o)\s/i.test(txt)) return 'varios_proveedores';
  return null;
}

/** Dos normalizados son «similares» si uno es prefijo de palabras del otro (ALTICE / ALTICE DOMINICANA). */
export function sonSimilares(a: string, b: string): boolean {
  return a !== b && (b.startsWith(a + ' ') || a.startsWith(b + ' '));
}

export interface GrupoProveedor {
  norm: string;
  nombre: string;
  dudoso: boolean;
  usos: number;
}

/**
 * Agrupa textos libres por nombre normalizado y marca los dudosos (varios proveedores en uno,
 * muy cortos o similares entre sí). Es la lógica del backfill de la migración, en puro.
 */
export function agruparProveedores(textos: readonly string[]): GrupoProveedor[] {
  const grupos = new Map<string, { frec: Map<string, number>; dudoso: boolean; usos: number }>();
  for (const t of textos) {
    const raw = t.trim();
    if (!raw) continue;
    const norm = normalizarProveedor(raw);
    const g = grupos.get(norm) ?? { frec: new Map<string, number>(), dudoso: false, usos: 0 };
    g.frec.set(raw, (g.frec.get(raw) ?? 0) + 1);
    g.usos++;
    if (motivoDudoso(raw) !== null) g.dudoso = true;
    grupos.set(norm, g);
  }
  const normas = [...grupos.keys()];
  return normas.map((norm) => {
    const g = grupos.get(norm)!;
    const nombre = [...g.frec.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const similar = normas.some((o) => sonSimilares(norm, o));
    return { norm, nombre, dudoso: g.dudoso || similar || norm === '', usos: g.usos };
  });
}
