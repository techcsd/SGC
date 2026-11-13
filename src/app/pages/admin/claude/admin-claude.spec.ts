// DO-09 (ronda DO) — AdminClaude embebido en Claude › Auditoría › Conexiones no
// debe repetir su propio <h1> (el <h2>Conexiones</h2> del padre ya lo cubre),
// igual que ConfiguracionClaude ya hace con su input `embebido`.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect } from 'vitest';
import { AdminClaude } from './admin-claude';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

function fakeSupabase() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { valor: 'true' } }),
  };
  return {
    client: {
      from: () => chain,
      rpc: async (nombre: string) => {
        switch (nombre) {
          case 'claude_admin_resumen':
            return { data: { personas_conectadas: 0, consultas_7d: 0, borradores_preparados: 0, borradores_confirmados: 0, con_error_7d: 0 } };
          case 'claude_conexiones_listado':
            return { data: [] };
          case 'claude_llamadas_filtros_disponibles':
            return { data: { herramientas: [], personas: [] } };
          case 'claude_llamadas_recientes':
            return { data: [] };
          default:
            return { data: null };
        }
      },
    },
  } as unknown as SupabaseService;
}

async function crear() {
  await TestBed.configureTestingModule({
    imports: [AdminClaude],
    providers: [
      provideRouter([]),
      { provide: SupabaseService, useValue: fakeSupabase() },
      { provide: ToastService, useValue: { errorFrom: () => {}, success: () => {} } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminClaude);
  await fixture.whenStable();
  return fixture;
}

describe('AdminClaude — DO-09 embebido', () => {
  it('por default (no embebido) muestra su propio h1', async () => {
    const fixture = await crear();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Claude conectado');
  });

  it('embebido oculta el h1 (no duplica el encabezado del padre)', async () => {
    const fixture = await crear();
    fixture.componentRef.setInput('embebido', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1')).toBeFalsy();
    // El resto del contenido (switch, resumen) se mantiene.
    expect(fixture.nativeElement.querySelector('.admin-claude__switch-box')).toBeTruthy();
  });
});
