import { describe, it, expect, vi } from 'vitest';
import { Injector } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { IngenieroService } from './ingeniero.service';

function crear(rpc = vi.fn().mockResolvedValue({ error: null })) {
  const fake = { client: { rpc } };
  const inj = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: fake },
      { provide: IngenieroService, useClass: IngenieroService, deps: [] },
    ],
  });
  return { svc: inj.get(IngenieroService), rpc };
}

describe('IngenieroService (EA3)', () => {
  it('guardarBooleano llama ing_config_guardar y actualiza la señal', async () => {
    const { svc, rpc } = crear();
    await svc.guardarBooleano('agentes_pausa_total', true);
    expect(rpc).toHaveBeenCalledWith('ing_config_guardar', { p_clave: 'agentes_pausa_total', p_valor: true });
    expect(svc.config().agentes_pausa_total).toBe(true);
  });

  it('guardarNumero valida antes de ir a la red', async () => {
    const { svc, rpc } = crear();
    await expect(svc.guardarNumero('max_prod_por_dia', 999)).rejects.toThrow('valor_invalido');
    expect(rpc).not.toHaveBeenCalled();
    await svc.guardarNumero('max_prod_por_dia', '5');
    expect(rpc).toHaveBeenCalledWith('ing_config_guardar', { p_clave: 'max_prod_por_dia', p_valor: 5 });
    expect(svc.config().max_prod_por_dia).toBe(5);
  });

  it('un error del RPC se propaga y no cambia la señal', async () => {
    const { svc } = crear(vi.fn().mockResolvedValue({ error: { message: 'sin_permiso' } }));
    await expect(svc.guardarBooleano('agentes_auto_prod', false)).rejects.toBeTruthy();
    expect(svc.config().agentes_auto_prod).toBe(true);
  });

  it('accion llama ing_tarea_admin_accion', async () => {
    const { svc, rpc } = crear();
    await svc.accion('abc', 'rechazar');
    expect(rpc).toHaveBeenCalledWith('ing_tarea_admin_accion', { p_id: 'abc', p_accion: 'rechazar' });
  });
});
