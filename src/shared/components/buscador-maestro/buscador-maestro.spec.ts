import { describe, it, expect } from 'vitest';
import { calcularSiguienteIndice } from './buscador-maestro';

describe('calcularSiguienteIndice (navegación ↑/↓ circular)', () => {
  it('↓ avanza un puesto', () => {
    expect(calcularSiguienteIndice(5, 0, 1)).toBe(1);
  });
  it('↑ retrocede un puesto', () => {
    expect(calcularSiguienteIndice(5, 2, -1)).toBe(1);
  });
  it('↓ en el último elemento da la vuelta al primero', () => {
    expect(calcularSiguienteIndice(5, 4, 1)).toBe(0);
  });
  it('↑ en el primer elemento da la vuelta al último', () => {
    expect(calcularSiguienteIndice(5, 0, -1)).toBe(4);
  });
  it('sin opciones (total 0) no revienta, devuelve 0', () => {
    expect(calcularSiguienteIndice(0, 0, 1)).toBe(0);
  });
  it('con una sola opción, se queda en ella', () => {
    expect(calcularSiguienteIndice(1, 0, 1)).toBe(0);
    expect(calcularSiguienteIndice(1, 0, -1)).toBe(0);
  });
});
