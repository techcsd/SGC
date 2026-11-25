import { describe, it, expect } from 'vitest';
import { previewNota } from './nota-preview.util';

describe('previewNota (EA8)', () => {
  it('reemplaza Markdown de imagen por [imagen]', () => {
    expect(previewNota('Hola ![image.png](nota-img:4b19cc4b/abc.png) mundo')).toBe('Hola [imagen] mundo');
  });
  it('maneja imagen cortada por un recorte y rutas nota-img sueltas', () => {
    expect(previewNota('texto ![{598D1869-')).toBe('texto [imagen]');
    expect(previewNota('nota-img:abc/def.png')).toBe('[imagen]');
  });
  it('colapsa imágenes consecutivas y espacios', () => {
    expect(previewNota('![a](x)\n\n![b](y)')).toBe('[imagen]');
  });
  it('recorta y tolera null', () => {
    expect(previewNota('a'.repeat(200), 10)).toBe('aaaaaaaaaa…');
    expect(previewNota(null)).toBe('');
  });
});
