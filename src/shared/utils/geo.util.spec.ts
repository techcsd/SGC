import { describe, it, expect } from 'vitest';
import { rumboEntre, distanciaMetros, etaMinutos } from './geo.util';

// F6 (ronda DF, DF4-A) — geometría pura detrás del camión rotado en el mapa.
describe('rumboEntre', () => {
  it('norte puro → 0°', () => {
    expect(rumboEntre({ lat: 18.47, lng: -69.9 }, { lat: 18.48, lng: -69.9 })).toBeCloseTo(0, 0);
  });

  it('este puro → ~90°', () => {
    expect(rumboEntre({ lat: 18.47, lng: -69.9 }, { lat: 18.47, lng: -69.89 })).toBeCloseTo(90, 0);
  });

  it('sur puro → ~180°', () => {
    expect(rumboEntre({ lat: 18.48, lng: -69.9 }, { lat: 18.47, lng: -69.9 })).toBeCloseTo(180, 0);
  });

  it('oeste puro → ~270°', () => {
    expect(rumboEntre({ lat: 18.47, lng: -69.89 }, { lat: 18.47, lng: -69.9 })).toBeCloseTo(270, 0);
  });
});

describe('distanciaMetros', () => {
  it('mismo punto → 0', () => {
    expect(distanciaMetros({ lat: 18.47, lng: -69.9 }, { lat: 18.47, lng: -69.9 })).toBe(0);
  });

  it('un grado de latitud ≈ 111 km', () => {
    const d = distanciaMetros({ lat: 18.0, lng: -69.9 }, { lat: 19.0, lng: -69.9 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

// F6b (ronda DF, DF4-C) — ETA honesta del tablero multi-vehículo: nunca un
// número sin sustento (sin destino o sin velocidad real, debe dar null).
describe('etaMinutos', () => {
  const desde = { lat: 18.47, lng: -69.9 };
  const destino = { lat: 18.48, lng: -69.9 }; // ~111 km de un grado → ~1.11 km a 1/100°

  it('sin destino → null', () => {
    expect(etaMinutos(desde, null, 40)).toBeNull();
  });

  it('sin velocidad (ruta sin estimado real) → null', () => {
    expect(etaMinutos(desde, destino, null)).toBeNull();
  });

  it('velocidad cero o negativa → null (nunca divide por cero)', () => {
    expect(etaMinutos(desde, destino, 0)).toBeNull();
    expect(etaMinutos(desde, destino, -10)).toBeNull();
  });

  it('con destino y velocidad reales → minutos positivos y razonables', () => {
    const min = etaMinutos(desde, destino, 40);
    expect(min).not.toBeNull();
    expect(min as number).toBeGreaterThan(0);
    expect(min as number).toBeLessThan(10);
  });
});
