// CS1 — orden por columna {clave,dir}: nulos siempre al final, ambos sentidos, estable.
import { describe, it, expect, beforeEach } from 'vitest';
import { compararConNulosAlFinal, leerOrdenGuardado, guardarOrden } from './orden-columnas.util';

// Entorno de tests = node (sin DOM): stub mínimo de localStorage en memoria.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

const cmpStr = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

describe('compararConNulosAlFinal', () => {
  it('ordena ascendente', () => {
    expect(compararConNulosAlFinal('a', 'b', 'asc', cmpStr)).toBeLessThan(0);
    expect(compararConNulosAlFinal('b', 'a', 'asc', cmpStr)).toBeGreaterThan(0);
  });

  it('invierte en descendente', () => {
    expect(compararConNulosAlFinal('a', 'b', 'desc', cmpStr)).toBeGreaterThan(0);
    expect(compararConNulosAlFinal('b', 'a', 'desc', cmpStr)).toBeLessThan(0);
  });

  it('los nulos quedan al final en AMBAS direcciones (nunca se invierten)', () => {
    expect(compararConNulosAlFinal('a', null, 'asc', cmpStr)).toBeLessThan(0);
    expect(compararConNulosAlFinal(null, 'a', 'asc', cmpStr)).toBeGreaterThan(0);
    expect(compararConNulosAlFinal('a', null, 'desc', cmpStr)).toBeLessThan(0);
    expect(compararConNulosAlFinal(null, 'a', 'desc', cmpStr)).toBeGreaterThan(0);
    expect(compararConNulosAlFinal(undefined, undefined, 'asc', cmpStr)).toBe(0);
  });

  it('un arreglo con nulos intercalados queda estable (nulos al fondo, orden relativo conservado)', () => {
    const rows = [{ k: 'b' }, { k: null }, { k: 'a' }, { k: null }, { k: 'c' }];
    const asc = [...rows].sort((a, b) => compararConNulosAlFinal(a.k, b.k, 'asc', cmpStr));
    expect(asc.map((r) => r.k)).toEqual(['a', 'b', 'c', null, null]);
    const desc = [...rows].sort((a, b) => compararConNulosAlFinal(a.k, b.k, 'desc', cmpStr));
    expect(desc.map((r) => r.k)).toEqual(['c', 'b', 'a', null, null]);
  });
});

describe('leerOrdenGuardado / guardarOrden', () => {
  beforeEach(() => localStorage.clear());

  it('sin nada guardado, devuelve el default', () => {
    expect(leerOrdenGuardado('k-test-1', {}, { clave: 'fecha', dir: 'desc' })).toEqual({ clave: 'fecha', dir: 'desc' });
  });

  it('migra un valor legacy (string suelto) al nuevo formato', () => {
    localStorage.setItem('k-test-2', 'reciente');
    const r = leerOrdenGuardado('k-test-2', { reciente: { clave: 'fecha', dir: 'desc' } }, { clave: 'necesidad', dir: 'asc' });
    expect(r).toEqual({ clave: 'fecha', dir: 'desc' });
  });

  it('lee un valor ya guardado en el formato nuevo', () => {
    guardarOrden('k-test-3', { clave: 'obra', dir: 'asc' });
    expect(leerOrdenGuardado('k-test-3', {}, { clave: 'fecha', dir: 'desc' })).toEqual({ clave: 'obra', dir: 'asc' });
  });

  it('un valor corrupto cae al default sin romper', () => {
    localStorage.setItem('k-test-4', '{not json');
    expect(leerOrdenGuardado('k-test-4', {}, { clave: 'fecha', dir: 'desc' })).toEqual({ clave: 'fecha', dir: 'desc' });
  });
});
