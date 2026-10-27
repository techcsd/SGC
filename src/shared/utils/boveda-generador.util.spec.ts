// CZ9 — generador de claves del Vault.
import { describe, it, expect } from 'vitest';
import {
  generarPassword,
  generarPassphrase,
  generarLlaveApi,
  generarSemilla2fa,
  etiquetaFortaleza,
} from './boveda-generador.util';

describe('generarPassword', () => {
  it('respeta el largo pedido (dentro de 8-64)', () => {
    expect(generarPassword({ largo: 20 }).valor).toHaveLength(20);
    expect(generarPassword({ largo: 4 }).valor).toHaveLength(8); // se sube al mínimo
    expect(generarPassword({ largo: 200 }).valor).toHaveLength(64); // se baja al máximo
  });
  it('nunca incluye caracteres ambiguos (0 O l 1 I)', () => {
    for (let i = 0; i < 20; i++) {
      const { valor } = generarPassword({ largo: 40 });
      expect(valor).not.toMatch(/[0OlI1]/);
    }
  });
  it('dos generaciones seguidas no son iguales (aleatorio real)', () => {
    const a = generarPassword({ largo: 24 }).valor;
    const b = generarPassword({ largo: 24 }).valor;
    expect(a).not.toBe(b);
  });
  it('solo minúsculas cuando se desactivan las demás clases', () => {
    const { valor } = generarPassword({ largo: 30, mayusculas: false, numeros: false, simbolos: false });
    expect(valor).toMatch(/^[a-z]+$/);
  });
  it('la entropía crece con el largo', () => {
    expect(generarPassword({ largo: 30 }).bitsEntropia).toBeGreaterThan(generarPassword({ largo: 10 }).bitsEntropia);
  });
});

describe('generarPassphrase', () => {
  it('5 palabras por defecto, separadas por guion', () => {
    const { valor } = generarPassphrase();
    expect(valor.split('-')).toHaveLength(5);
  });
  it('respeta un número distinto de palabras (acotado 3-10)', () => {
    expect(generarPassphrase(3).valor.split('-')).toHaveLength(3);
    expect(generarPassphrase(1).valor.split('-')).toHaveLength(3); // piso
    expect(generarPassphrase(20).valor.split('-')).toHaveLength(10); // techo
  });
});

describe('generarLlaveApi', () => {
  it('hex: 32 bytes = 64 caracteres hexadecimales', () => {
    const { valor, bitsEntropia } = generarLlaveApi('hex', 32);
    expect(valor).toMatch(/^[0-9a-f]{64}$/);
    expect(bitsEntropia).toBe(256);
  });
  it('base64url: sin +, / ni = de relleno', () => {
    const { valor } = generarLlaveApi('base64url', 32);
    expect(valor).not.toMatch(/[+/=]/);
  });
});

describe('generarSemilla2fa', () => {
  it('devuelve solo caracteres base32 válidos', () => {
    const { valor } = generarSemilla2fa();
    expect(valor).toMatch(/^[A-Z2-7]+$/);
  });
  it('160 bits (20 bytes) por defecto', () => {
    expect(generarSemilla2fa().bitsEntropia).toBe(160);
  });
});

describe('etiquetaFortaleza', () => {
  it('clasifica por rangos de bits', () => {
    expect(etiquetaFortaleza(20)).toBe('débil');
    expect(etiquetaFortaleza(50)).toBe('aceptable');
    expect(etiquetaFortaleza(75)).toBe('fuerte');
    expect(etiquetaFortaleza(100)).toBe('muy fuerte');
  });
});
