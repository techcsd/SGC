import { describe, it, expect } from 'vitest';
import { dispositivoLabel } from './dispositivo-label.util';

describe('dispositivoLabel', () => {
  it('reconoce Chrome en Windows', () => {
    expect(dispositivoLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'))
      .toBe('Chrome en Windows');
  });

  it('reconoce Safari en iPhone', () => {
    expect(dispositivoLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari en iPhone');
  });

  it('reconoce Android (navegador genérico Chrome)', () => {
    expect(dispositivoLabel('Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'))
      .toBe('Chrome en Android');
  });

  it('nulo/vacío → "Dispositivo desconocido"', () => {
    expect(dispositivoLabel(null)).toBe('Dispositivo desconocido');
    expect(dispositivoLabel('')).toBe('Dispositivo desconocido');
    expect(dispositivoLabel('   ')).toBe('Dispositivo desconocido');
  });

  it('user_agent de script/servidor sin match → "Dispositivo desconocido"', () => {
    expect(dispositivoLabel('node')).toBe('Dispositivo desconocido');
  });
});
