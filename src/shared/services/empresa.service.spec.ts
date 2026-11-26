import { describe, it, expect } from 'vitest';
import { validarLogo, LOGO_ERROR_FORMATO, LOGO_MAX_BYTES } from './empresa.service';

describe('validarLogo (EA4)', () => {
  it('acepta png/jpeg/webp dentro del límite', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validarLogo({ type, size: 1000 })).toBeNull();
    }
  });
  it('rechaza SVG, PDF y tipos desconocidos', () => {
    for (const type of ['image/svg+xml', 'application/pdf', '']) {
      expect(validarLogo({ type, size: 1000 })).toBe(LOGO_ERROR_FORMATO);
    }
  });
  it('rechaza más de 5 MB y acepta exactamente 5 MB', () => {
    expect(validarLogo({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toBe(LOGO_ERROR_FORMATO);
    expect(validarLogo({ type: 'image/png', size: LOGO_MAX_BYTES })).toBeNull();
  });
});
