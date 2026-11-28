import { describe, it, expect } from 'vitest';
import { renglonesCubiertos } from './cobertura-renglones.util';

describe('renglonesCubiertos (EB8 · caso ARNES)', () => {
  const stockCentral = { SEGURIDAD: 0, WADFOW: 26 };
  const stockObra = { WADFOW: 4 };

  it('usa el artículo elegido para despachar, no el de origen', () => {
    const r = [{ articulo_id: 'SEGURIDAD', articulo_despacho_id: 'WADFOW', cantidad: 1 }];
    expect(renglonesCubiertos(r, stockCentral)).toBe(1);
  });
  it('sin artículo elegido se mantiene el de origen', () => {
    expect(renglonesCubiertos([{ articulo_id: 'SEGURIDAD', cantidad: 1 }], stockCentral)).toBe(0);
  });
  it('no cubre si el stock no alcanza la cantidad pedida', () => {
    expect(renglonesCubiertos([{ articulo_id: 'WADFOW', articulo_despacho_id: 'WADFOW', cantidad: 15 }], stockObra)).toBe(0);
  });
  it('renglón sin artículo del catálogo no cuenta', () => {
    expect(renglonesCubiertos([{ cantidad: 1 }], stockCentral)).toBe(0);
  });
});
