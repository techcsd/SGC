import { describe, it, expect } from 'vitest';
import { imagenesDePortapapeles } from './clipboard-imagen.util';

function fakePasteEvent(items: { kind: string; type: string; file: File | null }[]): ClipboardEvent {
  const clipboardData = {
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file })),
  };
  return { clipboardData } as unknown as ClipboardEvent;
}

describe('imagenesDePortapapeles', () => {
  it('extrae archivos de imagen de un paste', () => {
    const file = new File(['x'], 'captura.png', { type: 'image/png' });
    const ev = fakePasteEvent([{ kind: 'file', type: 'image/png', file }]);
    const out = imagenesDePortapapeles(ev);
    expect(out).toEqual([file]);
  });

  it('ignora items que no son imagen (texto)', () => {
    const ev = fakePasteEvent([{ kind: 'string', type: 'text/plain', file: null }]);
    expect(imagenesDePortapapeles(ev)).toEqual([]);
  });

  it('sin clipboardData/dataTransfer, devuelve vacío sin romper', () => {
    expect(imagenesDePortapapeles({} as ClipboardEvent)).toEqual([]);
  });

  it('lee de dataTransfer.files cuando no hay items (drop)', () => {
    const file = new File(['x'], 'captura.png', { type: 'image/png' });
    const ev = { dataTransfer: { files: [file] } } as unknown as DragEvent;
    expect(imagenesDePortapapeles(ev)).toEqual([file]);
  });
});
