import { describe, it, expect } from 'vitest';
import { ADJUNTO_MAX_BYTES, extensionDe, nombreSeguro, validarAdjunto } from './reporte-adjunto.util';

describe('reporte-adjunto.util (DX10)', () => {
  it('acepta PDF, Word, Excel, CSV y TXT', () => {
    for (const n of ['a.pdf', 'b.DOCX', 'c.xlsx', 'd.csv', 'e.txt', 'f.doc', 'g.xls']) {
      expect(validarAdjunto({ name: n, size: 1000 }, 0)).toBeNull();
    }
  });
  it('rechaza ejecutables, zip y archivos sin extensión', () => {
    for (const n of ['a.exe', 'b.zip', 'c.js', 'sinextension', 'd.pdf.exe']) {
      expect(validarAdjunto({ name: n, size: 1000 }, 0)).toBe('tipo');
    }
  });
  it('límite de 10 MB y archivo vacío', () => {
    expect(validarAdjunto({ name: 'a.pdf', size: ADJUNTO_MAX_BYTES }, 0)).toBeNull();
    expect(validarAdjunto({ name: 'a.pdf', size: ADJUNTO_MAX_BYTES + 1 }, 0)).toBe('tamano');
    expect(validarAdjunto({ name: 'a.pdf', size: 0 }, 0)).toBe('vacio');
  });
  it('máximo 5 por reporte', () => {
    expect(validarAdjunto({ name: 'a.pdf', size: 10 }, 4)).toBeNull();
    expect(validarAdjunto({ name: 'a.pdf', size: 10 }, 5)).toBe('cupo');
  });
  it('nombre seguro para storage conserva la extensión', () => {
    expect(nombreSeguro('Informe Final ñandú (v2).XLSX')).toBe('Informe-Final-nandu-v2.xlsx');
    expect(extensionDe('x.tar.GZ')).toBe('gz');
  });
});
