// DG — Reglas del atajo de teclado del buscador maestro, como funciones PURAS
// (sin `KeyboardEvent`/DOM reales) para poder probarlas con vitest sin montar el
// Shell. `Shell.onKeydownGlobal` es solo el "cableado" fino que les pasa el evento
// real.

/** Forma mínima de un `KeyboardEvent` que necesitamos (facilita el mock en tests). */
export interface TeclaComoEvento {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Ctrl+K (Windows/Linux) o Cmd+K (Mac) — abre el buscador desde CUALQUIER pantalla,
 *  sin importar dónde esté el foco (es la convención de las paletas de comandos). */
export function esAtajoCtrlK(e: TeclaComoEvento): boolean {
  return !!(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
}

/** ¿El elemento con foco es un campo de texto? (input/textarea/select/contenteditable).
 *  Acepta cualquier objeto con esa forma — no exige un `HTMLElement` real. */
export function esCampoDeTexto(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

/** "/" abre el buscador, pero SOLO si no está ya abierto y el foco no está en un
 *  campo de texto (si no, escribir "precio/u" en cualquier input lo abriría solo). */
export function esAtajoBarra(
  e: TeclaComoEvento,
  opciones: { buscadorYaAbierto: boolean; focoEnCampoDeTexto: boolean },
): boolean {
  return e.key === '/' && !opciones.buscadorYaAbierto && !opciones.focoEnCampoDeTexto;
}
