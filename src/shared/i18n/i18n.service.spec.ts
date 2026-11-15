// DP-07 (CONTEXTO-72) — <html lang> sigue al idioma activo y las claves sin
// traducir se avisan una sola vez por clave+idioma (solo en dev).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { I18nService } from './i18n.service';
import { SupabaseService } from '../../app/core/services/supabase.service';

function fakeSupabase() {
  return { client: { rpc: async () => ({ data: null, error: null }) } } as unknown as SupabaseService;
}

describe('I18nService — DP-07', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en'; // simula el lang="en" incorrecto previo
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: fakeSupabase() }],
    });
  });

  it('setIdioma actualiza document.documentElement.lang', async () => {
    const svc = TestBed.inject(I18nService);
    await svc.setIdioma('en');
    expect(document.documentElement.lang).toBe('en');
    await svc.setIdioma('es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('adoptFromServer también actualiza document.documentElement.lang', async () => {
    const svc = TestBed.inject(I18nService);
    await svc.adoptFromServer('ht');
    expect(document.documentElement.lang).toBe('ht');
  });

  it('avisa en consola (dev) UNA sola vez por clave sin traducir', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = TestBed.inject(I18nService);
    await svc.setIdioma('en');

    svc.t('Texto sin traducir de prueba');
    svc.t('Texto sin traducir de prueba');
    svc.t('Texto sin traducir de prueba');

    const avisos = warn.mock.calls.filter((c) => String(c[0]).includes('Texto sin traducir de prueba'));
    expect(avisos.length).toBe(1);
    warn.mockRestore();
  });

  it('no avisa en español (idioma base, no necesita catálogo)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = TestBed.inject(I18nService);

    svc.t('Cualquier texto en español');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
