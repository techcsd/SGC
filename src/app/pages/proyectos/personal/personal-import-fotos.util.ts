// EA2 — lógica PURA del emparejamiento de fotos de cédula con las filas del Excel de
// personal de obra (testeable sin Angular ni red). La IA (edge leer-cedulas-lote)
// SOLO lee la imagen; quién es cada foto lo decide esta función, de forma
// DETERMINISTA y conservadora: ante la duda NO adivina, la deja «Sin asignar».
import { norm } from './personal-import.util';

export type TipoImagen = 'cedula_frente' | 'cedula_dorso' | 'pasaporte' | 'persona_con_documento' | 'otra';
/** Tipo de foto del expediente (personal_obra_fotos.tipo) al que se guarda. */
export type FotoTipoDestino = 'documento' | 'persona_carnet_cedula' | 'persona';

export const UMBRAL_CONFIANZA_DEFECTO = 0.85;
/** Costo aproximado por imagen leída (modelo pequeño con visión, ~1.5k tokens de entrada). Solo orientativo. */
export const COSTO_USD_POR_IMAGEN = 0.003;
export const MAX_IMAGENES_LOTE = 400;
export const CONCURRENCIA_LECTURA = 3;

export interface LecturaCedula {
  tipo_imagen: TipoImagen;
  documento_numero: string | null;
  nombre: string | null;
  apellido: string | null;
  nacionalidad?: string | null;
  confianza: number;
}

/** Rango de filas (0-based, de la hoja) sobre las que está anclada una imagen incrustada. */
export interface AnclaFilas { desde: number; hasta: number }

export interface FotoEntrada {
  id: string;
  origen: 'archivo' | 'zip' | 'xlsx';
  nombreArchivo: string;
  /** Solo imágenes incrustadas en el .xlsx: dónde está anclada. */
  ancla?: AnclaFilas | null;
  /** null = no se pudo leer (error) */
  lectura: LecturaCedula | null;
  error?: string | null;
}

export interface FilaFoto {
  /** Índice de la fila en la vista previa (clave estable). */
  indice: number;
  nombre: string;
  documento: string | null;
  /** Fila de la hoja (0-based) de la que salió, para el anclaje de imágenes incrustadas. */
  filaExcel?: number | null;
}

export type MotivoSinAsignar = 'error' | 'ilegible' | 'baja_confianza' | 'no_en_excel' | 'ambiguo' | 'otra';
export type ViaAsignacion = 'documento' | 'nombre' | 'anclaje' | 'manual';

export interface AsignacionFoto {
  fotoId: string;
  filaIndice: number | null;
  via: ViaAsignacion | null;
  tipoDestino: FotoTipoDestino | null;
  motivo: MotivoSinAsignar | null;
  /** Filas candidatas para el selector manual (mejor primero). */
  sugerencias: number[];
  /** El documento/nombre/anclaje apuntan a personas distintas: revisar. */
  conflicto: boolean;
  /** Hay otra foto mejor para el mismo cupo (fila + tipo): esta NO se sube salvo que el usuario la elija. */
  duplicada: boolean;
  confianza: number;
}

// ── Normalización ───────────────────────────────────────────────────────────
/** Documento comparable: mayúsculas y SIN guiones/espacios/puntos (cédula con o sin guiones, pasaporte). */
export function normalizarDocumento(d: unknown): string {
  return String(d ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y']);

/** Palabras significativas del nombre (sin acentos, sin partículas), en un Set. */
export function tokensNombre(...partes: (string | null | undefined)[]): Set<string> {
  const t = norm(partes.filter(Boolean).join(' '))
    .replace(/[^A-Z ]/g, ' ')
    .split(' ')
    .filter((x) => x.length > 0 && !PARTICULAS.has(x));
  return new Set(t);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const igualesSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const subconjunto = (chico: Set<string>, grande: Set<string>) => chico.size >= 2 && chico.size < grande.size && [...chico].every((x) => grande.has(x));

/** Distancia de Levenshtein (docs cortos; para detectar «un dígito mal leído»). */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// ── Tipo de imagen → tipo de foto del expediente ──────────────────────────────
export function destinoDeTipoImagen(t: TipoImagen): FotoTipoDestino | null {
  switch (t) {
    case 'cedula_frente':
    case 'cedula_dorso':
    case 'pasaporte':
      return 'documento';
    case 'persona_con_documento':
      return 'persona_carnet_cedula';
    default:
      return null;
  }
}

/** Prioridad para el mismo cupo (fila + tipo): el frente/pasaporte gana al reverso. */
function prioridadTipo(t: TipoImagen | null | undefined): number {
  return t === 'cedula_dorso' ? 1 : 2;
}
const prioridadVia = (v: ViaAsignacion | null) => (v === 'manual' ? 4 : v === 'documento' ? 3 : v === 'nombre' ? 2 : v === 'anclaje' ? 1 : 0);

// ── Anclaje (imágenes incrustadas) ───────────────────────────────────────────
/** Fila del Excel sobre la que está la imagen: la contenida en el rango; si hay varias, la más cercana al centro; empate → ninguna. */
export function filaPorAnclaje(ancla: AnclaFilas | null | undefined, filas: FilaFoto[]): number | null {
  if (!ancla) return null;
  const dentro = filas.filter((f) => f.filaExcel != null && f.filaExcel >= ancla.desde && f.filaExcel <= ancla.hasta);
  if (dentro.length === 0) return null;
  if (dentro.length === 1) return dentro[0].indice;
  const centro = (ancla.desde + ancla.hasta) / 2;
  const ord = [...dentro].sort((a, b) => Math.abs((a.filaExcel as number) - centro) - Math.abs((b.filaExcel as number) - centro));
  const d0 = Math.abs((ord[0].filaExcel as number) - centro);
  const d1 = Math.abs((ord[1].filaExcel as number) - centro);
  return d0 < d1 ? ord[0].indice : null;
}

// ── Candidatos por nombre ───────────────────────────────────────────────────
/** Filas cuyo nombre coincide EXACTO (mismo conjunto de palabras) o, si no hay, contiene todas las palabras (≥2) del leído. */
export function candidatosPorNombre(nombre: string, filas: FilaFoto[]): FilaFoto[] {
  const t = tokensNombre(nombre);
  if (t.size < 2) return []; // una sola palabra no basta para identificar a nadie
  const exactos = filas.filter((f) => igualesSet(tokensNombre(f.nombre), t));
  if (exactos.length) return exactos;
  return filas.filter((f) => {
    const tf = tokensNombre(f.nombre);
    return subconjunto(t, tf) || subconjunto(tf, t);
  });
}

/** Sugerencias para el selector manual: documento a 1 carácter de distancia (mala lectura) y/o nombre parecido. Mejor primero, máx. 3. */
export function sugerirFilas(doc: string, nombre: string, filas: FilaFoto[]): number[] {
  const t = tokensNombre(nombre);
  const puntuadas: { i: number; p: number }[] = [];
  for (const f of filas) {
    let p = 0;
    const fd = normalizarDocumento(f.documento);
    if (doc.length >= 6 && fd.length >= 6 && lev(doc, fd) <= 1) p = 1;
    const j = jaccard(t, tokensNombre(f.nombre));
    if (j >= 0.34) p = Math.max(p, j * 0.95);
    if (p > 0) puntuadas.push({ i: f.indice, p });
  }
  return puntuadas.sort((a, b) => b.p - a.p).slice(0, 3).map((x) => x.i);
}

// ── Emparejamiento ──────────────────────────────────────────────────────────
function vacia(foto: FotoEntrada): AsignacionFoto {
  return {
    fotoId: foto.id, filaIndice: null, via: null, tipoDestino: null, motivo: null,
    sugerencias: [], conflicto: false, duplicada: false, confianza: foto.lectura?.confianza ?? 0,
  };
}

function nombreLeido(l: LecturaCedula): string {
  return [l.nombre, l.apellido].filter(Boolean).join(' ').trim();
}

/**
 * Empareja cada foto con UNA fila del Excel (o la deja «Sin asignar» con motivo).
 * Orden de evidencia: 1) número de documento exacto (sin guiones) → 2) nombre exacto / muy alto
 * (único) → 3) anclaje de la imagen incrustada. Ambiguo = NO adivina. Confianza < umbral = Sin asignar
 * (salvo que el anclaje de una imagen incrustada diga a qué fila pertenece).
 */
export interface OpcionesEmparejar {
  /** Asignación MANUAL del usuario (fotoId → fila). Manda sobre cualquier otra evidencia. */
  manual?: Map<string, number>;
  /** Fotos que el usuario eligió como la buena de su cupo (ganan el desempate de duplicadas). */
  preferidas?: Set<string>;
}

export function emparejarFotos(filas: FilaFoto[], fotos: FotoEntrada[], umbral = UMBRAL_CONFIANZA_DEFECTO, opts: OpcionesEmparejar = {}): AsignacionFoto[] {
  const porIndice = new Map(filas.map((f) => [f.indice, f] as const));
  const asignaciones: AsignacionFoto[] = fotos.map((foto) => {
    const a = vacia(foto);
    const anc = filaPorAnclaje(foto.ancla, filas);
    const L = foto.lectura;

    const asignar = (idx: number, via: ViaAsignacion, destino: FotoTipoDestino | null) => {
      a.filaIndice = idx; a.via = via; a.tipoDestino = destino; a.motivo = null;
      return a;
    };
    const sin = (motivo: MotivoSinAsignar, sugerencias: number[] = []) => {
      a.motivo = motivo; a.sugerencias = sugerencias;
      return a;
    };

    // Manual: el usuario decidió. Tipo = el de la lectura, o «persona» si la imagen no era un documento.
    const man = opts.manual?.get(foto.id);
    if (man != null && porIndice.has(man)) {
      return asignar(man, 'manual', (L && !foto.error ? destinoDeTipoImagen(L.tipo_imagen) : null) ?? 'persona');
    }

    if (!L || foto.error) return sin('error', anc != null ? [anc] : []);

    const destino = destinoDeTipoImagen(L.tipo_imagen);
    // Imagen que no es documento: solo una foto de la persona incrustada junto a su fila tiene dónde ir.
    if (!destino) return anc != null ? asignar(anc, 'anclaje', 'persona') : sin('otra');

    const doc = normalizarDocumento(L.documento_numero);
    const nombre = nombreLeido(L);
    if (L.confianza < umbral) {
      return anc != null ? asignar(anc, 'anclaje', destino) : sin('baja_confianza', sugerirFilas(doc, nombre, filas));
    }

    // 1) Documento exacto
    const porDoc = doc ? filas.filter((f) => normalizarDocumento(f.documento) === doc) : [];
    if (porDoc.length === 1) {
      const f = porDoc[0];
      asignar(f.indice, 'documento', destino);
      // El número apunta a una persona pero el nombre leído o el anclaje dicen otra: se marca para revisar.
      const tn = tokensNombre(nombre);
      const choqueNombre = tn.size >= 2 && jaccard(tn, tokensNombre(f.nombre)) < 0.5;
      a.conflicto = choqueNombre || (anc != null && anc !== f.indice);
      return a;
    }
    if (porDoc.length > 1) return sin('ambiguo', porDoc.map((f) => f.indice));

    // 2) Nombre (único)
    let cands = nombre ? candidatosPorNombre(nombre, filas) : [];
    if (doc) cands = cands.filter((f) => !normalizarDocumento(f.documento)); // leyó un número que NO está en el Excel: solo vale una fila sin documento
    if (cands.length === 1) {
      asignar(cands[0].indice, 'nombre', destino);
      a.conflicto = anc != null && anc !== cands[0].indice;
      return a;
    }
    if (cands.length > 1) {
      if (anc != null && cands.some((f) => f.indice === anc)) return asignar(anc, 'anclaje', destino);
      return sin('ambiguo', cands.map((f) => f.indice));
    }

    // 3) Anclaje de la imagen incrustada (solo si el número leído no desmiente a esa fila)
    if (anc != null && !doc) return asignar(anc, 'anclaje', destino);
    if (anc != null && doc && !normalizarDocumento(porIndice.get(anc)?.documento)) return asignar(anc, 'anclaje', destino);

    if (!doc && !nombre) return sin('ilegible');
    return sin('no_en_excel', sugerirFilas(doc, nombre, filas));
  });

  marcarDuplicadas(asignaciones, fotos, opts.preferidas);
  return asignaciones;
}

/** Entre varias fotos del mismo cupo (fila + tipo) gana la de mejor prioridad/evidencia/confianza; el resto queda `duplicada`. */
function marcarDuplicadas(asig: AsignacionFoto[], fotos: FotoEntrada[], preferidas?: Set<string>): void {
  const porFoto = new Map(fotos.map((f) => [f.id, f] as const));
  const grupos = new Map<string, AsignacionFoto[]>();
  for (const a of asig) {
    if (a.filaIndice == null || !a.tipoDestino) continue;
    const k = `${a.filaIndice}|${a.tipoDestino}`;
    const g = grupos.get(k);
    if (g) g.push(a); else grupos.set(k, [a]);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    g.sort((x, y) =>
      Number(preferidas?.has(y.fotoId) ?? false) - Number(preferidas?.has(x.fotoId) ?? false)
      || prioridadTipo(porFoto.get(y.fotoId)?.lectura?.tipo_imagen) - prioridadTipo(porFoto.get(x.fotoId)?.lectura?.tipo_imagen)
      || prioridadVia(y.via) - prioridadVia(x.via)
      || y.confianza - x.confianza
      || x.fotoId.localeCompare(y.fotoId));
    g.forEach((a, i) => { if (i > 0) a.duplicada = true; });
  }
}

/** Resumen para la UI. */
export function resumenAsignaciones(asig: AsignacionFoto[]): { asignadas: number; sinAsignar: number; duplicadas: number; conflictos: number } {
  let asignadas = 0, sinAsignar = 0, duplicadas = 0, conflictos = 0;
  for (const a of asig) {
    if (a.filaIndice == null) sinAsignar++;
    else if (a.duplicada) duplicadas++;
    else asignadas++;
    if (a.conflicto && a.filaIndice != null) conflictos++;
  }
  return { asignadas, sinAsignar, duplicadas, conflictos };
}

export function estimarCosto(n: number): { imagenes: number; usd: number } {
  return { imagenes: n, usd: Math.round(n * COSTO_USD_POR_IMAGEN * 100) / 100 };
}

// ── Concurrencia limitada con reintento ───────────────────────────────────────
/** Reintenta `fn` hasta `intentos` veces con espera `esperaMs * intento` entre fallos. */
export async function conReintento<T>(fn: () => Promise<T>, intentos = 2, esperaMs = 800): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      if (i < intentos - 1 && esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs * (i + 1)));
    }
  }
  throw ultimo;
}

/**
 * Ejecuta `fn` sobre cada ítem con a lo sumo `limite` en vuelo. Un fallo de un ítem NO corta el lote:
 * el resultado de ese ítem es `{ error }`. `parar()` permite cancelar (los pendientes no arrancan).
 */
export async function procesarConConcurrencia<T, R>(
  items: T[],
  limite: number,
  fn: (item: T, i: number) => Promise<R>,
  opts: { onProgreso?: (hechos: number, total: number) => void; parar?: () => boolean } = {},
): Promise<({ ok: R } | { error: unknown } | { omitido: true })[]> {
  const out: ({ ok: R } | { error: unknown } | { omitido: true })[] = new Array(items.length);
  let siguiente = 0;
  let hechos = 0;
  const worker = async () => {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      if (opts.parar?.()) { out[i] = { omitido: true }; continue; }
      try { out[i] = { ok: await fn(items[i], i) }; } catch (error) { out[i] = { error }; }
      hechos++;
      opts.onProgreso?.(hechos, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, worker));
  return out;
}

// ── Vínculo fila → persona ya creada en el import ────────────────────────────
export interface PersonalMin { id: string; nombre: string; documento_numero?: string | null; lote_import?: string | null }

/**
 * Tras importar: a qué persona (id) corresponde cada fila. Primero por documento (sin guiones); si la fila no
 * tiene documento, por nombre EXACTO normalizado entre las creadas en ESTE lote y solo si es único.
 */
export function vincularFilasConPersonal(
  filas: { indice: number; nombre: string; documento: string | null }[],
  personal: PersonalMin[],
  lote: string,
): Map<number, string> {
  const out = new Map<number, string>();
  const porDoc = new Map<string, string[]>();
  for (const p of personal) {
    const d = normalizarDocumento(p.documento_numero);
    if (d) porDoc.set(d, [...(porDoc.get(d) ?? []), p.id]);
  }
  const delLote = personal.filter((p) => p.lote_import === lote && !normalizarDocumento(p.documento_numero));
  for (const f of filas) {
    const d = normalizarDocumento(f.documento);
    if (d) {
      const ids = porDoc.get(d);
      if (ids?.length === 1) out.set(f.indice, ids[0]);
      continue;
    }
    const n = norm(f.nombre);
    const c = delLote.filter((p) => norm(p.nombre) === n);
    if (c.length === 1) out.set(f.indice, c[0].id);
  }
  return out;
}
