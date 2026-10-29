// CT2 — «Quitar» existía pero solo al hover y sin confirmación (Xaviel no la
// vio). Esta prueba ejerce el NodeView real (addNodeView de nota-imagen.extension.ts)
// montado por un Editor de TipTap sin DOM real (mismo patrón que markdown-roundtrip.spec.ts):
// confirma que el botón «Quitar» pide confirmación, borra el nodo del documento,
// y avisa al consumidor (onQuitar) para que borre el archivo de Storage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensionesNotasRicas } from './rich-editor';

describe('NotaImagen — quitar imagen', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm');
  });
  afterEach(() => {
    confirmSpy.mockRestore();
  });

  function crearEditorConImagen(onQuitar: (src: string) => void) {
    // El editor interpreta `content` como Markdown (extensión `Markdown`), no HTML
    // — mismo formato en que se guardan las notas: `![](nota-img:ruta)`.
    return new Editor({
      extensions: extensionesNotasRicas({ onQuitar }),
      content: 'Antes\n\n![](nota-img:ruta/prueba.png)\n\nDespués',
    });
  }

  it('pide confirmación antes de borrar', () => {
    confirmSpy.mockReturnValue(false);
    const onQuitar = vi.fn();
    const editor = crearEditorConImagen(onQuitar);
    try {
      const btn = editor.view.dom.querySelector<HTMLButtonElement>('.nota-img__btn--danger');
      expect(btn).toBeTruthy();
      btn!.click();
      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(onQuitar).not.toHaveBeenCalled();
      // Si cancela, la imagen sigue en el documento.
      expect(editor.getHTML()).toContain('nota-img:ruta/prueba.png');
    } finally {
      editor.destroy();
    }
  });

  it('al confirmar: borra el nodo del documento y avisa a onQuitar con la ruta', () => {
    confirmSpy.mockReturnValue(true);
    const onQuitar = vi.fn();
    const editor = crearEditorConImagen(onQuitar);
    try {
      const btn = editor.view.dom.querySelector<HTMLButtonElement>('.nota-img__btn--danger');
      btn!.click();
      expect(onQuitar).toHaveBeenCalledWith('nota-img:ruta/prueba.png');
      expect(editor.getHTML()).not.toContain('nota-img:ruta/prueba.png');
      expect(editor.getText()).toContain('Antes');
      expect(editor.getText()).toContain('Después');
    } finally {
      editor.destroy();
    }
  });

  // ── DB2 — barra debajo + galería de consecutivas ───────────────────────────
  it('imagen suelta: la barra va DEBAJO de la miniatura, con iconos accesibles', () => {
    const editor = crearEditorConImagen(() => {});
    try {
      const wrapper = editor.view.dom.querySelector('.nota-img')!;
      const hijos = Array.from(wrapper.children).map((c) => c.className);
      // el <img> aparece antes que la barra (nada tapa la miniatura)
      expect(hijos.indexOf('nota-img__img')).toBeLessThan(hijos.findIndex((c) => c.includes('nota-img__barra')));
      // los 3 botones son de icono con aria-label (AW12: SVG, no texto flotante)
      const labels = Array.from(wrapper.querySelectorAll('.nota-img__btn')).map((b) => b.getAttribute('aria-label'));
      expect(labels).toEqual(['Pantalla completa', 'Copiar imagen', 'Quitar']);
      expect(wrapper.querySelectorAll('.nota-img__btn svg').length).toBe(3);
      // y el nombre del archivo se muestra en la meta
      expect(wrapper.querySelector('.nota-img__meta')?.textContent).toContain('prueba.png');
    } finally {
      editor.destroy();
    }
  });

  it('galería: 3 imágenes consecutivas crean 3 NodeViews hermanos (el CSS :has las compacta)', () => {
    const editor = new Editor({
      extensions: extensionesNotasRicas({ onQuitar: () => {} }),
      content: '![](nota-img:a.png)\n\n![](nota-img:b.png)\n\n![](nota-img:c.png)',
    });
    try {
      const imgs = editor.view.dom.querySelectorAll('.nota-img');
      expect(imgs.length).toBe(3);
      // consecutivas = hermanas directas en el DOM (la regla `.nota-img + .nota-img`
      // del SCSS es la que las pinta como galería de 150 px)
      expect(imgs[0].nextElementSibling).toBe(imgs[1]);
      expect(imgs[1].nextElementSibling).toBe(imgs[2]);
      // el Markdown guardado NO cambia (DB2: sin tocar el formato)
      const md = (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? '';
      expect(md).toContain('![](nota-img:a.png)');
      expect(md).toContain('![](nota-img:c.png)');
    } finally {
      editor.destroy();
    }
  });
});
