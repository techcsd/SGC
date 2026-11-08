import { describe, it, expect } from 'vitest';
import { resaltarFragmentoHtml } from './wa-fragmento.util';

describe('wa-fragmento.util', () => {
  it('convierte los marcadores ** en <mark>', () => {
    expect(resaltarFragmentoHtml('el **cemento** llega mañana')).toBe('el <mark>cemento</mark> llega mañana');
  });

  it('escapa HTML del propio mensaje (nunca se confía en texto de terceros)', () => {
    expect(resaltarFragmentoHtml('<script>alert(1)</script> **cemento**')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; <mark>cemento</mark>',
    );
  });

  it('sin marcadores, devuelve el texto escapado tal cual', () => {
    expect(resaltarFragmentoHtml('sin resaltado')).toBe('sin resaltado');
  });

  it('entrada vacía o nula no revienta', () => {
    expect(resaltarFragmentoHtml('')).toBe('');
  });
});
