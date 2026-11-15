// DP-11 (CONTEXTO-72) — el pipe `fecha` reemplaza `| date`: reacciona al
// idioma activo y usa nombres de mes en Kreyòl (tabla propia, no CLDR/Intl
// porque ningún motor tiene datos reales para `ht`).
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { FechaPipe } from './fecha.pipe';
import { I18nService } from './i18n.service';
import { SupabaseService } from '../../app/core/services/supabase.service';

function fakeSupabase() {
  return { client: { rpc: async () => ({ data: null, error: null }) } } as unknown as SupabaseService;
}

describe('FechaPipe — DP-11', () => {
  const fecha = new Date(2026, 0, 15, 9, 5); // 15-ene-2026, 09:05

  function crear() {
    TestBed.configureTestingModule({
      providers: [FechaPipe, { provide: SupabaseService, useValue: fakeSupabase() }],
    });
    return { i18n: TestBed.inject(I18nService), pipe: TestBed.inject(FechaPipe) };
  }

  it('es (default): "d MMM" en español', () => {
    const { pipe } = crear();
    expect(pipe.transform(fecha, 'd MMM')).toBe('15 ene');
  });

  it('en: "d MMM" en inglés', async () => {
    const { i18n, pipe } = crear();
    await i18n.setIdioma('en');
    expect(pipe.transform(fecha, 'd MMM')).toBe('15 Jan');
  });

  it('ht: "d MMM" usa la tabla propia (nunca francés/CLDR)', async () => {
    const { i18n, pipe } = crear();
    await i18n.setIdioma('ht');
    expect(pipe.transform(fecha, 'd MMM')).toBe('15 jan');
  });

  it('ht: "d MMM, HH:mm" incluye la hora', async () => {
    const { i18n, pipe } = crear();
    await i18n.setIdioma('ht');
    expect(pipe.transform(fecha, 'd MMM, HH:mm')).toBe('15 jan, 09:05');
  });

  it('ht: un patrón numérico puro (sin MMM) no usa la tabla, igual que antes', async () => {
    const { i18n, pipe } = crear();
    await i18n.setIdioma('ht');
    expect(pipe.transform(fecha, 'dd/MM/yyyy')).toBe('15/01/2026');
  });

  it('valor nulo/vacío devuelve null', () => {
    const { pipe } = crear();
    expect(pipe.transform(null)).toBeNull();
    expect(pipe.transform('')).toBeNull();
  });
});
