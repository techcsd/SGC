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
});
