// BS3 — aplica las preferencias de apariencia (densidad, tamaño de letra) al DOM.
// El tamaño de letra ajusta el `font-size` raíz (todo el diseño usa rem → escala
// de forma global); la densidad pone un atributo que styles.scss honra.

export type Densidad = 'compacta' | 'normal' | 'comoda';
export type TamanoLetra = 'pequena' | 'normal' | 'grande';

const FONT_PX: Record<TamanoLetra, string> = {
  pequena: '15px',
  normal: '16px',
  grande: '18px',
};

export function aplicarDensidad(d: Densidad | null | undefined): void {
  try {
    document.documentElement.setAttribute('data-densidad', d ?? 'normal');
  } catch {
    /* SSR/entorno sin DOM */
  }
}

export function aplicarTamanoLetra(t: TamanoLetra | null | undefined): void {
  try {
    document.documentElement.style.fontSize = FONT_PX[t ?? 'normal'] ?? FONT_PX.normal;
  } catch {
    /* SSR/entorno sin DOM */
  }
}

// CJ1 — "Animaciones: completas / reducidas". Preferencia POR DISPOSITIVO (localStorage),
// no por cuenta: añade/quita `html.motion-reduced` (styles.scss anula transiciones).
const MOTION_KEY = 'sgc_motion_reduced';

export function aplicarMovimiento(reducido: boolean): void {
  try {
    document.documentElement.classList.toggle('motion-reduced', !!reducido);
  } catch {
    /* SSR/entorno sin DOM */
  }
}

export function leerMovimientoReducido(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) === '1';
  } catch {
    return false;
  }
}

export function guardarMovimientoReducido(reducido: boolean): void {
  try {
    localStorage.setItem(MOTION_KEY, reducido ? '1' : '0');
  } catch {
    /* ignore */
  }
  aplicarMovimiento(reducido);
}
