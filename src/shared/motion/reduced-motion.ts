/** CL2 — ¿el usuario/dispositivo pidió menos movimiento? (ajuste `html.motion-reduced`
 *  de Configuración › Apariencia, o `prefers-reduced-motion`). Fuente única para las
 *  directivas y componentes de movimiento. */
export function movimientoReducido(): boolean {
  try {
    return (
      document.documentElement.classList.contains('motion-reduced') ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  } catch {
    return false;
  }
}
