// CK6 — esUuid: validación de UUID antes de enviar a un parámetro uuid del servidor.
import { describe, it, expect } from 'vitest';
import { esUuid } from './uuid.util';

describe('esUuid', () => {
  it('acepta un UUID canónico', () => {
    expect(esUuid('63ab6be8-2638-4788-bbe9-739f19dce36a')).toBe(true);
    expect(esUuid('  63AB6BE8-2638-4788-BBE9-739F19DCE36A  ')).toBe(true);
  });

  it('rechaza el string "undefined" (el bug de transferir conduce)', () => {
    expect(esUuid('undefined')).toBe(false);
  });

  it('rechaza null, vacío, no-string y basura', () => {
    expect(esUuid(null)).toBe(false);
    expect(esUuid(undefined)).toBe(false);
    expect(esUuid('')).toBe(false);
    expect(esUuid('123')).toBe(false);
    expect(esUuid(42)).toBe(false);
    expect(esUuid('63ab6be8-2638-4788-bbe9')).toBe(false);
  });
});
