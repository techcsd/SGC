// EA2 — lógica PURA para sacar las imágenes incrustadas de un .xlsx (que es un ZIP):
// hoja 1 → su drawing → anclajes (fila) + relaciones (rId → xl/media/*). Sin DOMParser
// (regex tolerantes a prefijos de namespace) para que sea testeable en cualquier entorno.
// El ZIP en sí lo abre el servicio (JSZip); aquí solo se interpreta el XML.
import type { AnclaFilas } from './personal-import-fotos.util';

export const EXT_IMAGEN = /\.(jpe?g|png|webp|heic|heif)$/i;

/** Resuelve `target` (relativo o absoluto) contra la carpeta `baseDir` de un archivo del ZIP. */
export function resolverRuta(baseDir: string, target: string): string {
  const partes = (target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`).split('/');
  const out: string[] = [];
  for (const p of partes) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  return out.join('/');
}

const dirDe = (ruta: string) => ruta.slice(0, Math.max(0, ruta.lastIndexOf('/')));

export interface Relacion { id: string; target: string; tipo: string }

/** `<Relationship Id=".." Type=".." Target=".."/>` en cualquier orden de atributos. */
export function parsearRelaciones(xml: string): Relacion[] {
  const out: Relacion[] = [];
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bId="([^"]*)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    const tipo = /\bType="([^"]*)"/.exec(tag)?.[1] ?? '';
    if (id && target) out.push({ id, target, tipo });
  }
  return out;
}

/** Ruta del XML de la PRIMERA hoja (workbook.xml + sus relaciones). */
export function rutaPrimeraHoja(workbookXml: string, workbookRels: string): string | null {
  const m = /<(?:[\w-]+:)?sheet\b[^>]*>/.exec(workbookXml);
  if (!m) return null;
  const rid = /\b[\w]+:id="([^"]*)"/.exec(m[0])?.[1];
  if (!rid) return null;
  const rel = parsearRelaciones(workbookRels).find((r) => r.id === rid);
  return rel ? resolverRuta('xl', rel.target) : null;
}

/** Ruta del drawing de una hoja (su `_rels/<hoja>.rels`). */
export function rutaDrawingDeHoja(rutaHoja: string, sheetRels: string): string | null {
  const rel = parsearRelaciones(sheetRels).find((r) => /\/drawing$/.test(r.tipo));
  return rel ? resolverRuta(dirDe(rutaHoja), rel.target) : null;
}

export interface AnclajeImagen { rid: string; ancla: AnclaFilas }

/**
 * Anclajes de un drawing: por cada `<xdr:pic>` (twoCellAnchor / oneCellAnchor) su `r:embed` y las filas
 * (0-based) que ocupa. Una imagen que cruza varias filas devuelve el rango entero (desde..hasta); si el
 * borde inferior cae exactamente en el inicio de una fila (rowOff 0) esa fila no cuenta.
 */
export function parsearAnclajes(drawingXml: string): AnclajeImagen[] {
  const out: AnclajeImagen[] = [];
  const reAncla = /<(?:[\w-]+:)?(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:[\w-]+:)?\1>/g;
  for (const m of drawingXml.matchAll(reAncla)) {
    const bloque = m[0];
    if (!/<(?:[\w-]+:)?pic\b/.test(bloque)) continue; // gráficos/formas: no son imágenes
    const rid = /<(?:[\w-]+:)?blip\b[^>]*?\b[\w]+:embed="([^"]+)"/.exec(bloque)?.[1];
    if (!rid) continue;
    const fila = (marca: 'from' | 'to') => {
      const mm = new RegExp(`<(?:[\\w-]+:)?${marca}>([\\s\\S]*?)</(?:[\\w-]+:)?${marca}>`).exec(bloque)?.[1];
      if (!mm) return null;
      const row = /<(?:[\w-]+:)?row>(\d+)</.exec(mm)?.[1];
      const off = /<(?:[\w-]+:)?rowOff>(-?\d+)</.exec(mm)?.[1];
      return row == null ? null : { row: +row, off: off ? +off : 0 };
    };
    const desde = fila('from');
    if (!desde) continue;
    const hasta = fila('to');
    let h = hasta ? hasta.row : desde.row;
    if (hasta && hasta.row > desde.row && hasta.off === 0) h = hasta.row - 1;
    out.push({ rid, ancla: { desde: desde.row, hasta: Math.max(desde.row, h) } });
  }
  return out;
}

/** rId → ruta dentro del ZIP (xl/media/…) usando las relaciones del drawing. */
export function mapearRid(drawingRuta: string, drawingRels: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of parsearRelaciones(drawingRels)) {
    if (/\/image$/.test(r.tipo) || EXT_IMAGEN.test(r.target)) m.set(r.id, resolverRuta(dirDe(drawingRuta), r.target));
  }
  return m;
}

/** Ruta del archivo de relaciones de una parte (`xl/worksheets/sheet1.xml` → `xl/worksheets/_rels/sheet1.xml.rels`). */
export function rutaRels(ruta: string): string {
  const i = ruta.lastIndexOf('/');
  return `${ruta.slice(0, i)}/_rels/${ruta.slice(i + 1)}.rels`;
}

/** ¿Es una entrada de imagen aprovechable dentro de un ZIP de fotos? (ignora carpetas, basura de macOS y ocultos) */
export function esEntradaImagenZip(nombre: string): boolean {
  if (nombre.endsWith('/')) return false;
  if (/(^|\/)(__MACOSX|\.)/.test(nombre)) return false;
  return EXT_IMAGEN.test(nombre);
}

/** Tipo MIME según la extensión (los archivos del ZIP/xlsx llegan sin tipo). */
export function mimeDeNombre(nombre: string): string {
  const n = nombre.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}
