import { describe, it, expect } from 'vitest';
import { detectarObra, norm, resolverCargoTexto, tokensCargo, valorDeEtiqueta, type CargoMin } from './personal-import.util';

const CAT: CargoMin[] = [
  { id: 'ING', codigo: 'ING', nombre: 'Ingeniero' },
  { id: 'VAR', codigo: 'VAR', nombre: 'Varillero' },
  { id: 'AYU', codigo: 'AYU', nombre: 'Ayudante' },
  { id: 'AVAR', codigo: 'AYVAR', nombre: 'Ayudante de varillero' },
  { id: 'CARP', codigo: 'CARP', nombre: 'Carpintero' },
];
const exacto = (xs: CargoMin[]) => {
  const m = new Map<string, string>();
  for (const c of xs) { m.set(norm(c.codigo), c.id); m.set(norm(c.nombre), c.id); }
  return m;
};

describe('valorDeEtiqueta', () => {
  it('encuentra PROYECTO en cualquier columna y toma la 1ª celda no vacía a la derecha', () => {
    const rows = [[null, null], ['x', 'y', 'PROYECTO:', null, null, 'TORRE ALPHA CORPORATIVA']];
    expect(valorDeEtiqueta(rows, ['PROYECTO', 'OBRA'])).toBe('TORRE ALPHA CORPORATIVA');
  });
  it('ignora filas después de la 20', () => {
    const rows = Array.from({ length: 25 }, (_, i) => (i === 22 ? ['PROYECTO', 'X'] : [null]));
    expect(valorDeEtiqueta(rows, ['PROYECTO'])).toBe('');
  });
});

describe('detectarObra', () => {
  const obras = [
    { id: '1', nombre: 'Torre Alpha' },
    { id: '2', nombre: 'Torre Alpha Adicional' },
    { id: '3', nombre: 'Poseidonia' },
  ];
  it('igualdad normalizada', () => expect(detectarObra('torre ALPHA', obras).obra?.id).toBe('1'));
  it('texto vacío → NO propone la primera obra (bug includes(""))', () => {
    expect(detectarObra('', obras)).toEqual({ obra: null, motivo: 'sin_texto' });
  });
  it('contención ambigua → vacío', () => {
    expect(detectarObra('ALPHA', obras)).toEqual({ obra: null, motivo: 'ambigua' });
  });
  it('contención única → la propone', () => {
    expect(detectarObra('PROYECTO POSEIDONIA CANA BAY', obras).obra?.id).toBe('3');
  });
  it('sin coincidencia → ninguna', () => expect(detectarObra('Otra', obras).motivo).toBe('ninguna'));
});

describe('cargos', () => {
  it('plurales, CSD y «DE» no estorban', () => {
    expect(tokensCargo('AYUDANTES DE VARILLEROS CSD')).toEqual(['AYUDANTE', 'VARILLERO']);
  });
  it('VARILLERO e INGENIERO resuelven; AYUDANTE DE VARILLERO ≠ VARILLERO', () => {
    const m = exacto(CAT);
    expect(resolverCargoTexto('VARILLERO', m, CAT).id).toBe('VAR');
    expect(resolverCargoTexto('Varilleros', m, CAT).id).toBe('VAR');
    expect(resolverCargoTexto('AYUDANTE DE VARILLERO', m, CAT).id).toBe('AVAR');
    expect(resolverCargoTexto('INGENIERO CSD', m, CAT).id).toBe('ING');
  });
  it('sin resolver → sugiere el más parecido en vez de «Sin cargo»', () => {
    const cat = CAT.filter((c) => c.id !== 'AVAR');
    const r = resolverCargoTexto('VARILLEROS ESPECIALES', exacto(cat), cat);
    expect(r.id).toBeNull();
    expect(r.sugerencia?.id).toBe('VAR');
  });
  it('58 filas con los cargos del archivo → 0 «Sin cargo» innecesarios', () => {
    const textos = ['VARILLERO', 'INGENIERO', 'AYUDANTE', 'CARPINTERO', 'AYUDANTE DE VARILLERO', 'OBRERO CSD'];
    const cat: CargoMin[] = [...CAT, { id: 'OBR', codigo: 'OBRCSD', nombre: 'Obrero CSD' }];
    const m = exacto(cat);
    const sin = Array.from({ length: 58 }, (_, i) => textos[i % textos.length]).filter((t) => !resolverCargoTexto(t, m, cat).id);
    expect(sin).toEqual([]);
  });
});
