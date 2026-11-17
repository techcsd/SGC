import { describe, it, expect } from 'vitest';
import { construirPdf } from './pdf-simple.util';

const txt = (u: Uint8Array) => new TextDecoder('latin1').decode(u);

describe('construirPdf', () => {
  it('genera un PDF válido con cabecera, xref y EOF', () => {
    const pdf = construirPdf([
      { tipo: 'titulo', texto: 'Conduce CND-1' },
      { tipo: 'texto', texto: 'Recibí (conforme) ñ' },
    ]);
    const s = txt(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Count 1');
    expect(s).toContain('Recib\\355 \\(conforme\\) \\361');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('el offset de startxref apunta a la tabla xref', () => {
    const s = txt(construirPdf([{ tipo: 'texto', texto: 'x' }]));
    const off = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(off, off + 4)).toBe('xref');
  });

  it('incrusta imágenes JPEG y pagina cuando el contenido excede la hoja', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bloques = Array.from({ length: 90 }, (_, i) => ({ tipo: 'texto' as const, texto: 'línea ' + i }));
    const pdf = construirPdf([...bloques, { tipo: 'imagenes', items: [{ jpeg, ancho: 100, alto: 50, pie: 'Firma' }] }]);
    const s = txt(pdf);
    expect(s).toContain('/DCTDecode');
    expect(/\/Count (\d+)/.exec(s)![1]).not.toBe('1');
  });
});
