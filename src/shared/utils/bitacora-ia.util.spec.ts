import { describe, it, expect } from 'vitest';
import {
  normalizarTexto,
  emparejarExacto,
  clasificarConfianza,
  esTranscripcionUtilizable,
  filtrarActividadesContraCatalogo,
  contarDudosos,
} from './bitacora-ia.util';

describe('bitacora-ia.util', () => {
  it('audio vacío → no se considera una transcripción utilizable', () => {
    expect(esTranscripcionUtilizable('')).toBe(false);
    expect(esTranscripcionUtilizable('   ')).toBe(false);
    expect(esTranscripcionUtilizable(null)).toBe(false);
    expect(esTranscripcionUtilizable(undefined)).toBe(false);
    expect(esTranscripcionUtilizable('se vació el concreto en la columna C4')).toBe(true);
  });

  it('nombre ambiguo (dos equipos parecidos) → no adivina, devuelve null', () => {
    const catalogo = ['Retroexcavadora 1', 'Retroexcavadora 2'];
    // "Retroexcavadora" a secas no es EXACTO a ninguna de las dos: nunca se
    // inventa cuál de las dos quiso decir.
    expect(emparejarExacto('Retroexcavadora', catalogo)).toBeNull();
    // Pero si coincide exacto (con acentos/mayúsculas distintas), sí resuelve.
    expect(emparejarExacto('retroexcavadora 1', catalogo)).toBe('Retroexcavadora 1');
    expect(emparejarExacto('RETROEXCAVADORA 2', catalogo)).toBe('Retroexcavadora 2');
  });

  it('normalizarTexto ignora acentos y mayúsculas', () => {
    expect(normalizarTexto('Columna')).toBe(normalizarTexto('cólumna'));
    expect(normalizarTexto('  Viga  ')).toBe('viga');
  });

  it('número dudoso → confianza baja se marca "dudosa", no "alta"', () => {
    expect(clasificarConfianza(12, 0.4)).toBe('dudosa');
    expect(clasificarConfianza(12, 0.95)).toBe('alta');
    expect(clasificarConfianza(12, 0.7)).toBe('alta'); // umbral inclusivo
    expect(clasificarConfianza(null, 0.9)).toBe('vacia'); // sin valor, no importa la confianza
  });

  it('foto sin relación con la obra → la actividad se descarta, no se inventa', () => {
    const estructuras = ['Columna', 'Viga'];
    const actividades = ['Encofrado', 'Vaciado de concreto'];
    const filas = [
      { estructura: 'Columna', actividad: 'Encofrado', cantidad: 3, unidad: 'und', confianza: 0.9, fuente: 'foto' as const },
      // Esta fila viene de una foto de OTRA obra (piscina) — no existe en el catálogo de esta obra.
      { estructura: 'Piscina', actividad: 'Pintura', cantidad: 1, unidad: 'und', confianza: 0.8, fuente: 'foto' as const },
    ];
    const out = filtrarActividadesContraCatalogo(filas, estructuras, actividades);
    expect(out).toHaveLength(1);
    expect(out[0].estructura).toBe('Columna');
  });

  it('contarDudosos cuenta solo los campos con valor y confianza baja', () => {
    const campos = {
      a: { valor: 'x', confianza: 0.3, fuente: 'voz' as const },
      b: { valor: 'y', confianza: 0.95, fuente: 'foto' as const },
      c: { valor: null, confianza: 0.1, fuente: 'voz' as const }, // vacío, no cuenta como dudoso
    };
    expect(contarDudosos(campos)).toBe(1);
  });
});
