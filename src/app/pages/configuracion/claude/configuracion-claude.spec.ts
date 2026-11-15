// DP-03 (CONTEXTO-72) — embebido dentro de Claude › Inicio no debe conservar
// el padding/max-width de página completa (quedaba con sangría ~54px vs la
// tarjeta contenedora). El root recibe la clase modificadora `--embebido`.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect } from 'vitest';
import { ConfiguracionClaude } from './configuracion-claude';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

function fakeSupabase() {
  const chain = { select: () => chain, order: () => chain, limit: async () => ({ data: [] }) };
  return {
    client: {
      from: () => chain,
      rpc: async () => ({ data: null }),
    },
  } as unknown as SupabaseService;
}

async function crear() {
  await TestBed.configureTestingModule({
    imports: [ConfiguracionClaude],
    providers: [
      provideRouter([]),
      { provide: SupabaseService, useValue: fakeSupabase() },
      { provide: ToastService, useValue: { error: () => {}, success: () => {}, errorFrom: () => {} } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ConfiguracionClaude);
  await fixture.whenStable();
  return fixture;
}

describe('ConfiguracionClaude — DP-03 embebido', () => {
  it('por default (no embebido) NO trae la clase --embebido', async () => {
    const fixture = await crear();
    const root = fixture.nativeElement.querySelector('.perfil-claude');
    expect(root.classList.contains('perfil-claude--embebido')).toBe(false);
  });

  it('embebido=true agrega la clase --embebido (sin padding/max-width de página)', async () => {
    const fixture = await crear();
    fixture.componentRef.setInput('embebido', true);
    await fixture.whenStable();
    const root = fixture.nativeElement.querySelector('.perfil-claude');
    expect(root.classList.contains('perfil-claude--embebido')).toBe(true);
  });
});
