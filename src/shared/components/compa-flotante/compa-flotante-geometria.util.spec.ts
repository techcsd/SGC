import { describe, it, expect } from 'vitest';
import {
  TAMANO_MIN,
  clamparPosicion,
  clamparTamano,
  moverConTeclado,
  posicionPorDefecto,
  tamanoMaximo,
} from './compa-flotante-geometria.util';

const VIEWPORT = { w: 1280, h: 800 };

describe('clamparTamano', () => {
  it('respeta el tamaño pedido si cabe dentro de los límites', () => {
    expect(clamparTamano({ w: 400, h: 500 }, VIEWPORT)).toEqual({ w: 400, h: 500 });
  });

  it('nunca baja del mínimo 320×380', () => {
    expect(clamparTamano({ w: 100, h: 100 }, VIEWPORT)).toEqual(TAMANO_MIN);
  });

  it('nunca supera el 90% del viewport', () => {
    const max = tamanoMaximo(VIEWPORT);
    expect(clamparTamano({ w: 5000, h: 5000 }, VIEWPORT)).toEqual(max);
  });

  it('en un viewport muy chico, gana el mínimo aunque sea mayor al 90%', () => {
    const viewportChico = { w: 300, h: 300 }; // 90% = 270×270, menor que el mínimo
    expect(clamparTamano({ w: 1000, h: 1000 }, viewportChico)).toEqual(TAMANO_MIN);
  });
});

describe('clamparPosicion', () => {
  const tam = { w: 380, h: 560 };

  it('respeta la posición si la ventana cabe dentro del viewport', () => {
    expect(clamparPosicion({ x: 100, y: 100 }, tam, VIEWPORT)).toEqual({ x: 100, y: 100 });
  });

  it('no deja arrastrar la ventana fuera por la izquierda/arriba', () => {
    expect(clamparPosicion({ x: -500, y: -500 }, tam, VIEWPORT)).toEqual({ x: 0, y: 0 });
  });

  it('no deja arrastrar la ventana fuera por la derecha/abajo', () => {
    const esperado = { x: VIEWPORT.w - tam.w, y: VIEWPORT.h - tam.h };
    expect(clamparPosicion({ x: 9999, y: 9999 }, tam, VIEWPORT)).toEqual(esperado);
  });
});

describe('posicionPorDefecto', () => {
  it('ancla la ventana a la esquina inferior derecha con margen', () => {
    const tam = { w: 380, h: 560 };
    const pos = posicionPorDefecto(tam, VIEWPORT);
    expect(pos.x).toBe(VIEWPORT.w - tam.w - 24);
    expect(pos.y).toBe(VIEWPORT.h - tam.h - 24);
  });

  it('nunca queda fuera de pantalla aunque el tamaño sea grande', () => {
    const tam = tamanoMaximo(VIEWPORT);
    const pos = posicionPorDefecto(tam, VIEWPORT);
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });
});

describe('moverConTeclado (Alt+flechas)', () => {
  const pos = { x: 100, y: 100 };

  it('ArrowUp sube', () => {
    expect(moverConTeclado(pos, 'ArrowUp', 24)).toEqual({ x: 100, y: 76 });
  });
  it('ArrowDown baja', () => {
    expect(moverConTeclado(pos, 'ArrowDown', 24)).toEqual({ x: 100, y: 124 });
  });
  it('ArrowLeft mueve a la izquierda', () => {
    expect(moverConTeclado(pos, 'ArrowLeft', 24)).toEqual({ x: 76, y: 100 });
  });
  it('ArrowRight mueve a la derecha', () => {
    expect(moverConTeclado(pos, 'ArrowRight', 24)).toEqual({ x: 124, y: 100 });
  });
});
