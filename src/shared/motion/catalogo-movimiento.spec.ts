import { describe, it, expect } from 'vitest';
import { CATALOGO_MOVIMIENTO, MOTION_IDS } from './catalogo-movimiento';

/**
 * CL2 — integridad del registro de movimiento: todo id que el código usa (MOTION_IDS,
 * la ÚNICA forma de referenciar una animación) está registrado, y todo id del registro
 * se usa. Así no hay animación "suelta" ni entrada muerta en el catálogo (CL5).
 */
describe('catalogo-movimiento', () => {
  const registrados = CATALOGO_MOVIMIENTO.map((e) => e.id);
  const usados = Object.values(MOTION_IDS);

  it('no tiene ids duplicados en el registro', () => {
    expect(new Set(registrados).size).toBe(registrados.length);
  });

  it('todo id usado (MOTION_IDS) está registrado', () => {
    const faltan = usados.filter((id) => !registrados.includes(id));
    expect(faltan).toEqual([]);
  });

  it('todo id del registro se usa (está en MOTION_IDS)', () => {
    const muertos = registrados.filter((id) => !usados.includes(id as (typeof usados)[number]));
    expect(muertos).toEqual([]);
  });

  it('cada entrada tiene los campos que consume el catálogo CL5', () => {
    for (const e of CATALOGO_MOVIMIENTO) {
      expect(e.nombre, e.id).toBeTruthy();
      expect(['grande', 'mediano', 'base'], e.id).toContain(e.nivel);
      expect(['web', 'app'], e.id).toContain(e.sistema);
      expect(e.duracionMs, e.id).toBeGreaterThan(0);
      expect(e.curva, e.id).toBeTruthy();
      expect(e.reducido, e.id).toBeTruthy();
      expect(e.desdeVersion, e.id).toBeTruthy();
      expect(e.previewKey, e.id).toBeTruthy();
    }
  });
});
