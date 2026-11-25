import { describe, it, expect } from 'vitest';
import { agruparProveedores, motivoDudoso, normalizarBusqueda, normalizarProveedor, sonSimilares } from './proveedor-normalizacion.util';

describe('normalizarProveedor', () => {
  it('quita tildes, mayúsculas y sufijos societarios', () => {
    expect(normalizarProveedor('Cerraduras Inteligentes S.R.L.')).toBe('CERRADURAS INTELIGENTES');
    expect(normalizarProveedor('  Cámaras  Díaz, SRL ')).toBe('CAMARAS DIAZ');
    expect(normalizarProveedor('Altice Dominicana S.A.')).toBe('ALTICE DOMINICANA');
    expect(normalizarProveedor('Tecno Pro EIRL')).toBe('TECNO PRO');
  });
  it('variantes del mismo proveedor dan la misma clave', () => {
    const a = normalizarProveedor('Puertas Seguras, SRL');
    expect(normalizarProveedor('PUERTAS SEGURAS')).toBe(a);
    expect(normalizarProveedor('puertas seguras s.r.l')).toBe(a);
  });
  it('un nombre que es solo un sufijo no se vacía', () => {
    expect(normalizarProveedor('SA')).toBe('SA');
  });
  it('null/undefined → vacío', () => {
    expect(normalizarProveedor(null)).toBe('');
    expect(normalizarProveedor(undefined)).toBe('');
  });
});

describe('normalizarBusqueda', () => {
  it('minúsculas sin tildes', () => {
    expect(normalizarBusqueda('Cerradura ELÉCTRICA Ñandú')).toBe('cerradura electrica nandu');
  });
});

describe('motivoDudoso', () => {
  it('detecta varios proveedores en un texto', () => {
    expect(motivoDudoso('Altice / Claro')).toBe('varios_proveedores');
    expect(motivoDudoso('Dell y HP')).toBe('varios_proveedores');
    expect(motivoDudoso('Dell, HP')).toBe('varios_proveedores');
  });
  it('muy corto, solo números y vacío', () => {
    expect(motivoDudoso('HP')).toBe('muy_corto');
    expect(motivoDudoso('12345')).toBe('solo_numeros');
    expect(motivoDudoso('   ')).toBe('vacio');
  });
  it('un nombre normal es confiable', () => {
    expect(motivoDudoso('Cerraduras Inteligentes SRL')).toBeNull();
  });
});

describe('sonSimilares', () => {
  it('prefijo de palabras', () => {
    expect(sonSimilares('ALTICE', 'ALTICE DOMINICANA')).toBe(true);
    expect(sonSimilares('ALTI', 'ALTICE DOMINICANA')).toBe(false);
    expect(sonSimilares('X', 'X')).toBe(false);
  });
});

describe('agruparProveedores (backfill)', () => {
  const grupos = agruparProveedores([
    'Cerraduras Inteligentes SRL',
    'cerraduras inteligentes s.r.l.',
    'Cerraduras Inteligentes SRL',
    'Altice',
    'Altice Dominicana',
    'Dell / HP',
    'Ubiquiti',
    '',
  ]);
  const por = (n: string) => grupos.find((g) => g.norm === n);

  it('une variantes y elige el nombre más frecuente', () => {
    const g = por('CERRADURAS INTELIGENTES')!;
    expect(g.usos).toBe(3);
    expect(g.nombre).toBe('Cerraduras Inteligentes SRL');
    expect(g.dudoso).toBe(false);
  });
  it('marca dudosos: similares entre sí y varios proveedores', () => {
    expect(por('ALTICE')!.dudoso).toBe(true);
    expect(por('ALTICE DOMINICANA')!.dudoso).toBe(true);
    expect(por('DELL HP')!.dudoso).toBe(true);
  });
  it('lo limpio queda confiable y los vacíos se ignoran', () => {
    expect(por('UBIQUITI')!.dudoso).toBe(false);
    expect(grupos.length).toBe(5);
  });
});
