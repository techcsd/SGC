import { Node, mergeAttributes } from '@tiptap/core';

/**
 * CO14 — nodo TipTap "campo": una ficha NARANJA no editable que representa un
 * dato de la plantilla. Serializa a `{{key}}` (texto plano dentro del span) para
 * ser 100% compatible con `camposDesdeHtml()` y `plantilla-merge.util.ts` (la
 * app), que escanean el HTML buscando literalmente `{{clave}}` — nada más
 * cambia del lado del servidor ni del merge existente (CF7/CE7).
 */
export const CampoNode = Node.create({
  name: 'campo',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-campo-key]',
        getAttrs: (el) => ({ key: (el as HTMLElement).getAttribute('data-campo-key') ?? '' }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const key = String(node.attrs['key'] ?? '');
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'campo-chip', 'data-campo-key': key, contenteditable: 'false' }),
      `{{${key}}}`,
    ];
  },
});

/** Envuelve cada `{{clave}}` plano del HTML existente en un span reconocible por
 *  el nodo `campo` de arriba, para que al cargar una plantilla ya guardada sus
 *  variables aparezcan como fichas (no como texto suelto editable). */
export function envolverCamposEnHtml(html: string): string {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) =>
    `<span data-campo-key="${key}" class="campo-chip" contenteditable="false">{{${key}}}</span>`,
  );
}
