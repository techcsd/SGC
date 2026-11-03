import { describe, it, expect } from 'vitest';
import {
  normalizarTexto,
  distanciaEdicion,
  evaluarCoincidencia,
  buscarEnIndice,
} from './buscador-coincidencia.util';
import { construirIndiceMenu, NavItem } from '../shell/menu-index.util';
import type { IndiceMenuEntry } from '../shell/menu-index.util';

function entrada(over: Partial<IndiceMenuEntry>): IndiceMenuEntry {
  return {
    id: 'x',
    titulo: 'X',
    ruta: '/x',
    camino: 'X',
    palabrasClave: [],
    esModulo: false,
    ...over,
  };
}

describe('normalizarTexto', () => {
  it('quita acentos y pasa a minúsculas', () => {
    expect(normalizarTexto('Condúce')).toBe('conduce');
    expect(normalizarTexto('REQUISICIÓN')).toBe('requisicion');
    expect(normalizarTexto('  Mantenimiento  ')).toBe('mantenimiento');
  });
});

describe('distanciaEdicion (Damerau-Levenshtein acotada)', () => {
  it('0 para strings iguales', () => {
    expect(distanciaEdicion('conduce', 'conduce')).toBe(0);
  });
  it('1 para una sustitución', () => {
    expect(distanciaEdicion('conduce', 'condece')).toBe(1);
  });
  it('1 para una transposición adyacente (Damerau)', () => {
    expect(distanciaEdicion('conduce', 'conduec')).toBe(1);
  });
  it('2 para dos ediciones', () => {
    expect(distanciaEdicion('vehiculos', 'vehiclos')).toBeLessThanOrEqual(2);
  });
  it('se corta en maxDist+1 cuando la distancia real es mayor (no sigue calculando de más)', () => {
    expect(distanciaEdicion('flota', 'legal', 2)).toBe(3);
  });
});

describe('evaluarCoincidencia — ranking', () => {
  const inventarioConduces = entrada({
    id: 'a',
    titulo: 'Conduces',
    camino: 'Inventario › Conduces',
    palabrasClave: ['conduces', 'inventario'],
  });
  const conducesExternos = entrada({
    id: 'b',
    titulo: 'Conduces externos',
    camino: 'Inventario › Conduces externos',
    palabrasClave: ['conduces', 'externos', 'inventario'],
  });

  it('exacta de título > prefijo > todas-las-palabras > aproximada', () => {
    const exacta = evaluarCoincidencia('Conduces', inventarioConduces)!;
    const prefijo = evaluarCoincidencia('Condu', inventarioConduces)!;
    const porPalabras = evaluarCoincidencia('conduce inventario', inventarioConduces)!;
    expect(exacta.puntaje).toBeGreaterThan(prefijo.puntaje);
    expect(prefijo.puntaje).toBeGreaterThan(porPalabras.puntaje);
  });

  it('matchea palabras en cualquier orden ("conduce inventario" encuentra "Inventario › Conduces")', () => {
    const r = evaluarCoincidencia('conduce inventario', inventarioConduces);
    expect(r).not.toBeNull();
  });

  it('tolera 1-2 letras de diferencia ("conduse" ~ "conduces")', () => {
    const r = evaluarCoincidencia('conduse', inventarioConduces);
    expect(r).not.toBeNull();
  });

  it('no matchea una palabra totalmente ajena', () => {
    const r = evaluarCoincidencia('mantenimiento', inventarioConduces);
    expect(r).toBeNull();
  });

  it('buscarEnIndice ordena de mejor a peor puntaje y limita resultados', () => {
    const resultados = buscarEnIndice('conduces', [conducesExternos, inventarioConduces], 10);
    // "Conduces" es prefijo/exacto de título para ambas candidatas, pero la que
    // tiene el título EXACTO ("Conduces") debe ir primero.
    expect(resultados[0].entrada.id).toBe('a');
  });

  it('respeta el límite de resultados', () => {
    const muchas = Array.from({ length: 20 }, (_, i) =>
      entrada({ id: `e${i}`, titulo: 'Conduces', camino: `Inventario › Conduces ${i}`, palabrasClave: ['conduces'] }),
    );
    expect(buscarEnIndice('conduces', muchas, 8)).toHaveLength(8);
  });
});

describe('integración: el buscador NUNCA muestra lo que el índice ya excluyó por permisos', () => {
  const arbol: NavItem[] = [
    {
      label: 'Developer',
      icon: 'developer',
      soloTecnologia: true,
      children: [{ label: 'Dev notes', route: '/tecnologia/dev-notes' }],
    },
  ];

  it('un usuario sin acceso a Developer no encuentra "Dev notes" aunque escriba el nombre exacto', () => {
    const indiceSinPermiso = construirIndiceMenu(arbol, {
      canAccess: () => false, // usuario SIN el rol/módulo de plataforma
      canAccessChild: () => true,
    });
    expect(buscarEnIndice('dev notes', indiceSinPermiso)).toEqual([]);
  });

  it('un usuario CON acceso sí lo encuentra', () => {
    const indiceConPermiso = construirIndiceMenu(arbol, {
      canAccess: () => true,
      canAccessChild: () => true,
    });
    const r = buscarEnIndice('dev notes', indiceConPermiso);
    expect(r).toHaveLength(1);
    expect(r[0].entrada.ruta).toBe('/tecnologia/dev-notes');
  });
});
