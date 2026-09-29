// ════════════════════════════════════════════════════════════════════════════
//  estado-tono.ts — CB v2. Mapa ÚNICO estado→tono para el status-pill.
//  Usado por conduces, requisiciones, echadas, órdenes de trabajo, bitácoras,
//  compras… así un mismo estado se pinta igual en todo el sistema (Regla 2:
//  punto + palabra + fondo suave; nunca solo color). El CSS vive en
//  `src/styles/_components.scss` (.status-pill / .status-pill--<tono>).
// ════════════════════════════════════════════════════════════════════════════

export type Tono = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' | 'brand';

// Normaliza: minúsculas, sin acentos, espacios/guiones → '_'.
function norm(estado: string | null | undefined): string {
  return (estado ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_');
}

// Palabras clave por tono. Se evalúan como "contiene" tras normalizar, en orden:
// danger gana a warning gana a success, etc. (un estado como "rechazado_pendiente"
// se pinta como danger). El fallback es neutral.
const REGLAS: ReadonlyArray<readonly [Tono, RegExp]> = [
  ['danger', /(rechaz|anul|cancel|atasc|vencid|rebot|error|fallid|denegad|bloquead|inactiv|suspendid|expirad|no_conform|incident|accident|mora)/],
  ['success', /(aprobad|complet|entregad|firmad|recibid|confirmad|finaliz|cerrad|resuelt|pagad|conciliad|disponible|activ|al_dia|ok|exitos|liberad|atendid)/],
  ['warning', /(pendiente|revision|espera|proceso|curso|borrador|cuarentena|parcial|por_|abierto|programad|reprogramad|retras|advertenci|preliminar|tramite)/],
  ['info', /(en_ruta|en_uso|nuevo|creado|asignad|enviad|despachad|transito|iniciad|planificad|generad|importad|reprogram)/],
  ['brand', /(cerrada_obra|principal|maestro)/],
];

/** Devuelve el tono semántico de un estado (fallback: neutral). */
export function tonoDeEstado(estado: string | null | undefined): Tono {
  const n = norm(estado);
  if (!n) return 'neutral';
  for (const [tono, re] of REGLAS) {
    if (re.test(n)) return tono;
  }
  return 'neutral';
}

/** Clase(s) para un `<span>` de status-pill: `status-pill status-pill--<tono>`. */
export function clasePill(estado: string | null | undefined): string {
  return `status-pill status-pill--${tonoDeEstado(estado)}`;
}
