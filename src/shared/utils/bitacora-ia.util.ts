/**
 * DF1-A — helpers puros del "Modo rápido" de bitácora (parser/emparejador de
 * campos propuestos por IA). Espejo client-side del filtrado que ya hace la
 * edge `bitacora-ia` (defensa en profundidad: nunca confiar ciegamente en lo
 * que devuelve un servicio externo, aunque ya venga filtrado).
 */

export type FuenteCampo = 'voz' | 'foto' | 'ambas';

export interface CampoPropuesto<T = unknown> {
  valor: T | null;
  confianza: number;
  fuente: FuenteCampo;
}

export type ClasificacionConfianza = 'alta' | 'dudosa' | 'vacia';

export const UMBRAL_CONFIANZA_BAJA = 0.7;

/** Quita acentos/diacríticos y pasa a minúsculas, para comparar texto "tal cual suena". */
export function normalizarTexto(s: string): string {
  return Array.from(s.normalize('NFD'))
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return !(c >= 0x0300 && c <= 0x036f); // quita marcas diacríticas combinantes
    })
    .join('')
    .trim()
    .toLowerCase();
}

/**
 * Empareja `valor` contra el catálogo real por coincidencia EXACTA (normalizada).
 * Nunca fuzzy-match: si el valor es parecido a más de una entrada del catálogo
 * pero no coincide exacto con ninguna, se considera ambiguo y devuelve null en
 * vez de adivinar cuál quiso decir.
 */
export function emparejarExacto(valor: string, catalogo: readonly string[]): string | null {
  const buscado = normalizarTexto(valor);
  if (!buscado) return null;
  const exacto = catalogo.find((c) => normalizarTexto(c) === buscado);
  return exacto ?? null;
}

/** ¿El campo tiene valor y su confianza alcanza el umbral para mostrarse "resuelto" (verde)? */
export function clasificarConfianza(valor: unknown, confianza: number): ClasificacionConfianza {
  if (valor === null || valor === undefined || valor === '') return 'vacia';
  return confianza >= UMBRAL_CONFIANZA_BAJA ? 'alta' : 'dudosa';
}

/** ¿Hay transcripción real que valga la pena mandar a interpretar? (no solo espacios). */
export function esTranscripcionUtilizable(texto: string | null | undefined): boolean {
  return !!texto && texto.trim().length > 0;
}

export interface ActividadPropuesta {
  estructura: string;
  actividad: string;
  cantidad: number | null;
  unidad: string | null;
  confianza: number;
  fuente: FuenteCampo;
}

/**
 * Filtra renglones de actividad contra los catálogos REALES de estructuras y
 * actividades de la obra. Un renglón que no calza exacto con ambos catálogos
 * se descarta (nunca se inventa ni se adivina una estructura/actividad "fuera
 * de la obra" — p. ej. si una foto no tiene relación con esta obra).
 */
export function filtrarActividadesContraCatalogo(
  filas: readonly ActividadPropuesta[],
  estructuras: readonly string[],
  actividades: readonly string[],
): ActividadPropuesta[] {
  const out: ActividadPropuesta[] = [];
  for (const fila of filas) {
    const estructura = emparejarExacto(fila.estructura, estructuras);
    const actividad = emparejarExacto(fila.actividad, actividades);
    if (!estructura || !actividad) continue;
    out.push({ ...fila, estructura, actividad });
  }
  return out;
}

/** Cuenta cuántos campos (de un mapa de CampoPropuesto) quedaron "dudosos" (ámbar). */
export function contarDudosos(campos: Record<string, CampoPropuesto>): number {
  return Object.values(campos).filter((c) => clasificarConfianza(c.valor, c.confianza) === 'dudosa').length;
}
