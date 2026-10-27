// CV2/CV3 — validaciones puras de grupos de Dev notes.
import { describe, it, expect } from 'vitest';
import { validarNombreGrupo, profundidadDeGrupo, puedeMoverGrupo, puedeCrearSubgrupo, zonaDestinoDeFila, NotaGrupoLike } from './nota-grupos.util';

describe('validarNombreGrupo', () => {
  it('nombre vacío no es error (botón apagado, no mensaje)', () => {
    expect(validarNombreGrupo('   ', [])).toBeNull();
  });
  it('rechaza duplicado entre hermanos sin distinguir mayúsculas', () => {
    expect(validarNombreGrupo('Proyectos', ['proyectos'])).toBe('Ya tienes un grupo con ese nombre aquí.');
  });
  it('acepta nombre único', () => {
    expect(validarNombreGrupo('Imp Octubre', ['Proyectos'])).toBeNull();
  });
  it('rechaza más de 60 caracteres', () => {
    expect(validarNombreGrupo('x'.repeat(61), [])).toBe('El nombre no puede pasar de 60 caracteres.');
  });
});

// Árbol: A (raíz) -> B -> C -> D (4 niveles); E (raíz, sin hijos).
const ARBOL: NotaGrupoLike[] = [
  { id: 'A', parent_id: null, nombre: 'A' },
  { id: 'B', parent_id: 'A', nombre: 'B' },
  { id: 'C', parent_id: 'B', nombre: 'C' },
  { id: 'D', parent_id: 'C', nombre: 'D' },
  { id: 'E', parent_id: null, nombre: 'E' },
];

describe('profundidadDeGrupo', () => {
  it('raíz = 1, cada nivel +1', () => {
    expect(profundidadDeGrupo('A', ARBOL)).toBe(1);
    expect(profundidadDeGrupo('B', ARBOL)).toBe(2);
    expect(profundidadDeGrupo('D', ARBOL)).toBe(4);
  });
  it('null (raíz del árbol) = 0', () => {
    expect(profundidadDeGrupo(null, ARBOL)).toBe(0);
  });
});

describe('puedeMoverGrupo', () => {
  it('bloquea mover un grupo dentro de sí mismo', () => {
    expect(puedeMoverGrupo('B', 'B', ARBOL)).toBe(false);
  });
  it('bloquea mover un grupo dentro de un descendiente suyo', () => {
    expect(puedeMoverGrupo('B', 'D', ARBOL)).toBe(false);
  });
  it('bloquea si el resultado pasa de 4 niveles', () => {
    // E (hoja, altura 0) a D (profundidad 4) -> profundidad final 5.
    expect(puedeMoverGrupo('E', 'D', ARBOL)).toBe(false);
  });
  it('permite mover a la raíz (null)', () => {
    expect(puedeMoverGrupo('D', null, ARBOL)).toBe(true);
  });
  it('permite mover un grupo hoja a un destino con espacio', () => {
    expect(puedeMoverGrupo('E', 'A', ARBOL)).toBe(true);
  });
  it('considera la altura del subárbol que se mueve, no solo el grupo', () => {
    // Mover B (que arrastra C y D, altura 2) a E (profundidad 1) -> 1+1+2=4, justo al límite: permitido.
    expect(puedeMoverGrupo('B', 'E', ARBOL)).toBe(true);
    // Mover A (altura 3, todo el árbol) a E (profundidad 1) -> 1+1+3=5: bloqueado.
    expect(puedeMoverGrupo('A', 'E', ARBOL)).toBe(false);
  });
});

describe('puedeCrearSubgrupo', () => {
  it('permite subgrupo mientras no se pase de 4 niveles', () => {
    expect(puedeCrearSubgrupo('C', ARBOL)).toBe(true); // hijo quedaría en nivel 4
  });
  it('bloquea un subgrupo que quedaría en el nivel 5', () => {
    expect(puedeCrearSubgrupo('D', ARBOL)).toBe(false);
  });
});

// CZ5 — soltar una nota sobre el encabezado, una tarjeta dentro del grupo, o la
// zona vacía debe resolver todas al MISMO destino (el grupo); un seudogrupo
// (HOY/ANTES/mes) nunca es destino.
describe('zonaDestinoDeFila', () => {
  it('encabezado de un grupo real: destino = el propio grupo', () => {
    expect(zonaDestinoDeFila({ esGrupo: true, grupo: { id: 'A' } })).toBe('A');
  });
  it('tarjeta de nota dentro de ese mismo grupo: mismo destino (antes del fix no soltaba nada)', () => {
    expect(zonaDestinoDeFila({ esGrupo: true, grupo: { id: 'A' } })).toBe('A');
  });
  it('zona vacía de un grupo sin notas: mismo destino', () => {
    expect(zonaDestinoDeFila({ esGrupo: true, grupo: { id: 'E' } })).toBe('E');
  });
  it('seudogrupo (HOY/ANTES/mes, esGrupo=false): sin destino', () => {
    expect(zonaDestinoDeFila({ esGrupo: false })).toBeNull();
  });
  it('esGrupo=true sin grupo resuelto (defensivo): sin destino', () => {
    expect(zonaDestinoDeFila({ esGrupo: true, grupo: null })).toBeNull();
  });
});
