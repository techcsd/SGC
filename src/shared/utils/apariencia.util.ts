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
