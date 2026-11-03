// DG — Compa flotante: geometría pura (posición/tamaño) de la ventana arrastrable y
// redimensionable. Funciones SIN estado ni DOM, para poder probarlas sin montar el
// componente (igual que `calcularSiguienteIndice` en buscador-maestro.ts).

export interface Punto {
  x: number;
  y: number;
}

export interface Tamano {
  w: number;
  h: number;
}

/** Tarea — mínimo 320×380px. */
export const TAMANO_MIN: Tamano = { w: 320, h: 380 };

/** Tamaño por defecto al abrir por primera vez (sin posición guardada). */
export const TAMANO_DEFECTO: Tamano = { w: 380, h: 560 };

/** Margen desde el borde para la posición por defecto (esquina inferior derecha). */
const MARGEN_DEFECTO = 24;

/** Paso de movimiento con teclado (Alt + flechas), en píxeles. */
export const PASO_TECLADO = 24;

/** Tarea — máximo 90% del viewport. */
export function tamanoMaximo(viewport: Tamano): Tamano {
  return { w: Math.round(viewport.w * 0.9), h: Math.round(viewport.h * 0.9) };
}

/** Ajusta un tamaño deseado a los límites [mínimo, 90% del viewport]. Si el viewport
 *  es tan chico que su 90% es menor que el mínimo, gana el mínimo (nunca se hace la
 *  ventana más pequeña que lo usable). */
export function clamparTamano(deseado: Tamano, viewport: Tamano): Tamano {
  const max = tamanoMaximo(viewport);
  return {
    w: Math.min(Math.max(deseado.w, TAMANO_MIN.w), Math.max(max.w, TAMANO_MIN.w)),
    h: Math.min(Math.max(deseado.h, TAMANO_MIN.h), Math.max(max.h, TAMANO_MIN.h)),
  };
}

/** Ajusta una posición deseada para que la ventana (del tamaño dado) quede siempre
 *  dentro del viewport — nunca se puede arrastrar/redimensionar fuera de pantalla. */
export function clamparPosicion(deseada: Punto, tamano: Tamano, viewport: Tamano): Punto {
  const maxX = Math.max(0, viewport.w - tamano.w);
  const maxY = Math.max(0, viewport.h - tamano.h);
  return {
    x: Math.min(Math.max(deseada.x, 0), maxX),
    y: Math.min(Math.max(deseada.y, 0), maxY),
  };
}

/** Posición inicial: esquina inferior derecha, como la burbuja (patrón elegido por Xaviel). */
export function posicionPorDefecto(tamano: Tamano, viewport: Tamano): Punto {
  return clamparPosicion(
    { x: viewport.w - tamano.w - MARGEN_DEFECTO, y: viewport.h - tamano.h - MARGEN_DEFECTO },
    tamano,
    viewport,
  );
}

export type TeclaMovimiento = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** Mueve un punto un paso fijo en la dirección de la tecla (Alt+flechas, con foco en
 *  la barra de la ventana). Pura: el caller debe clampear el resultado después. */
export function moverConTeclado(pos: Punto, tecla: TeclaMovimiento, paso = PASO_TECLADO): Punto {
  switch (tecla) {
    case 'ArrowUp':
      return { x: pos.x, y: pos.y - paso };
    case 'ArrowDown':
      return { x: pos.x, y: pos.y + paso };
    case 'ArrowLeft':
      return { x: pos.x - paso, y: pos.y };
    case 'ArrowRight':
      return { x: pos.x + paso, y: pos.y };
  }
}
