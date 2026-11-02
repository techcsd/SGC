import { describe, it, expect } from 'vitest';
import { rumboEntre, distanciaMetros } from './geo.util';

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
