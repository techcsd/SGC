import { describe, it, expect } from 'vitest';
import {
  ING_CONFIG_DEFECTO,
  badgeEstado,
  configDesdeFilas,
  listaArchivos,
  porcentajePresupuesto,
  resumirVeredictos,
  validarConfigNumero,
} from './ingeniero.util';

describe('ingeniero.util (EA3)', () => {
  it('badgeEstado: prod verde, revertida/necesita persona rojo, desconocido neutro', () => {
    expect(badgeEstado('en_prod')).toBe('success');
    expect(badgeEstado('revertida')).toBe('danger');
    expect(badgeEstado('necesita_humano')).toBe('danger');
    expect(badgeEstado('en_dev')).toBe('warning');
    expect(badgeEstado('xyz')).toBe('neutral');
  });

  it('resumirVeredictos: pendiente sin datos, aprobó/rechazó con datos', () => {
    expect(resumirVeredictos(null)).toEqual([
      { clave: 'G1', texto: 'Pendiente', badge: 'neutral' },
      { clave: 'G2', texto: 'Pendiente', badge: 'neutral' },
    ]);
    const r = resumirVeredictos({ G1: { veredicto: 'aprueba' }, G2: { veredicto: 'rechaza' } });
    expect(r[0]).toMatchObject({ clave: 'G1', texto: 'Aprobó', badge: 'success' });
    expect(r[1]).toMatchObject({ clave: 'G2', texto: 'Rechazó', badge: 'danger' });
  });

  it('listaArchivos: acepta strings y objetos con ruta, ignora basura', () => {
    expect(listaArchivos(['a.ts', { ruta: 'b.ts' }, 5, null, { x: 1 }])).toEqual(['a.ts', 'b.ts']);
    expect(listaArchivos('no-array')).toEqual([]);
  });

  it('validarConfigNumero: rangos y enteros como el servidor', () => {
    expect(validarConfigNumero('max_prod_por_dia', '3')).toBe(3);
    expect(validarConfigNumero('max_prod_por_dia', 51)).toBeNull();
    expect(validarConfigNumero('max_prod_por_dia', 2.5)).toBeNull();
    expect(validarConfigNumero('max_intentos', 0)).toBeNull();
    expect(validarConfigNumero('presupuesto_ia_dia_usd', '7,5')).toBe(7.5);
    expect(validarConfigNumero('presupuesto_ia_dia_usd', '')).toBeNull();
    expect(validarConfigNumero('max_lineas', 2001)).toBeNull();
    expect(validarConfigNumero('clave_rara', 1)).toBeNull();
  });

  it('configDesdeFilas: defaults y tipos respetados', () => {
    expect(configDesdeFilas(null)).toEqual(ING_CONFIG_DEFECTO);
    const c = configDesdeFilas([
      { clave: 'agentes_pausa_total', valor: true },
      { clave: 'max_archivos', valor: 5 },
      { clave: 'max_lineas', valor: 'texto' },
      { clave: 'otra', valor: 1 },
    ]);
    expect(c.agentes_pausa_total).toBe(true);
    expect(c.max_archivos).toBe(5);
    expect(c.max_lineas).toBe(300);
  });

  it('porcentajePresupuesto: tope 0 = 0, nunca pasa de 100', () => {
    expect(porcentajePresupuesto(5, 0)).toBe(0);
    expect(porcentajePresupuesto(5, 10)).toBe(50);
    expect(porcentajePresupuesto(50, 10)).toBe(100);
  });
});
