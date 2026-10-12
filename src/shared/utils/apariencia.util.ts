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

// CN — "Mostrar el logo al refrescar": reproduce el logo-reveal en cada recarga de
// página (no en la navegación interna del SPA). Preferencia POR DISPOSITIVO
// (localStorage), encendida por defecto. El usuario la apaga en Apariencia.
const LOGO_REFRESH_KEY = 'sgc_logo_al_refrescar';

export function leerLogoAlRefrescar(): boolean {
  try {
    // Default ON: solo está apagado si el usuario lo apagó explícitamente ('0').
    return localStorage.getItem(LOGO_REFRESH_KEY) !== '0';
  } catch {
    return true;
  }
}

export function guardarLogoAlRefrescar(mostrar: boolean): void {
  try {
    localStorage.setItem(LOGO_REFRESH_KEY, mostrar ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * ¿La carga actual del documento fue una RECARGA (F5/Ctrl-R), y no una primera
 * visita, un enlace o atrás/adelante? Usa la Navigation Timing API (estándar,
 * se marca una sola vez por carga de documento → nunca se dispara en la
 * navegación interna del router). Cae al API heredada si hiciera falta.
 */
export function esRecargaDePagina(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav && typeof nav.type === 'string') return nav.type === 'reload';
    // Fallback heredado (deprecado pero amplio): performance.navigation.type === 1 (reload).
    const legacy = (performance as unknown as { navigation?: { type?: number } }).navigation;
    return legacy?.type === 1;
  } catch {
    return false;
  }
}
