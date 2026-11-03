import { describe, it, expect } from 'vitest';
import { compaFlotanteVisible } from './compa-flotante-visibilidad.util';

describe('compaFlotanteVisible', () => {
  it('visible cuando la preferencia está encendida y no hay nada que la oculte', () => {
    expect(compaFlotanteVisible({ prefActiva: true, enPantallaAsistente: false, practicaActiva: false })).toBe(true);
  });

  it('oculta si la persona apagó la preferencia en Configuración', () => {
    expect(compaFlotanteVisible({ prefActiva: false, enPantallaAsistente: false, practicaActiva: false })).toBe(false);
  });

  it('oculta en la pantalla completa /asistente (sería redundante)', () => {
    expect(compaFlotanteVisible({ prefActiva: true, enPantallaAsistente: true, practicaActiva: false })).toBe(false);
  });

  it('oculta durante una misión de práctica activa', () => {
    expect(compaFlotanteVisible({ prefActiva: true, enPantallaAsistente: false, practicaActiva: true })).toBe(false);
  });

  it('con la preferencia apagada, ningún otro factor la hace reaparecer', () => {
    expect(compaFlotanteVisible({ prefActiva: false, enPantallaAsistente: true, practicaActiva: true })).toBe(false);
  });
});
