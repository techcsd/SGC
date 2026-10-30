// CY24 (#24, D4) — confirmar/cancelar: Odoo primero, SGC después. Si Odoo rechaza, el
// estado SGC no cambia. Instancia por prototipo para no inyectar Supabase real.
import { describe, it, expect, vi } from 'vitest';
import { OdooOrdenesCompraService } from './odoo-ordenes-compra.service';
import { OdooSyncEstado } from '../models/odoo-orden-compra.model';

function servicio(odoo: Record<string, unknown>, rpcError: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ error: rpcError });
  const svc = Object.create(OdooOrdenesCompraService.prototype) as OdooOrdenesCompraService;
  Object.assign(svc, { odoo, supabase: { client: { schema: () => ({ rpc }) } } });
  return { svc, rpc };
}

const orden = (odoo_sync_estado: OdooSyncEstado) => ({ id: 'oc-1', odoo_sync_estado });

describe('OdooOrdenesCompraService.updateEstado', () => {
  it('aprobar confirma en Odoo ANTES de cambiar el estado SGC', async () => {
    const orden_ = vi.fn();
    const odoo = { confirmarOrden: vi.fn().mockImplementation(async () => { orden_('odoo'); }) };
    const { svc, rpc } = servicio(odoo);
    rpc.mockImplementation(async () => { orden_('sgc'); return { error: null }; });

    await svc.updateEstado(orden('publicada'), 'aprobada');

    expect(odoo.confirmarOrden).toHaveBeenCalledWith('oc-1');
    expect(orden_.mock.calls.map((c) => c[0])).toEqual(['odoo', 'sgc']);
  });

  it('si Odoo rechaza, el estado SGC NO cambia', async () => {
    const odoo = { confirmarOrden: vi.fn().mockRejectedValue(new Error('Odoo no respondió a tiempo.')) };
    const { svc, rpc } = servicio(odoo);

    await expect(svc.updateEstado(orden('publicada'), 'aprobada')).rejects.toThrow('Odoo no respondió');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('no aprueba una OC que todavía no está publicada en Odoo', async () => {
    const odoo = { confirmarOrden: vi.fn() };
    const { svc, rpc } = servicio(odoo);

    await expect(svc.updateEstado(orden('pendiente'), 'aprobada')).rejects.toThrow('Publica la orden en Odoo');
    expect(odoo.confirmarOrden).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('una OC ya confirmada en Odoo no se confirma otra vez', async () => {
    const odoo = { confirmarOrden: vi.fn() };
    const { svc, rpc } = servicio(odoo);

    await svc.updateEstado(orden('confirmada'), 'aprobada');
    expect(odoo.confirmarOrden).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('cancelar una OC publicada cancela en Odoo; una local sin publicar solo cambia SGC', async () => {
    const odoo = { cancelarOrden: vi.fn().mockResolvedValue(undefined) };
    const a = servicio(odoo);
    await a.svc.updateEstado(orden('publicada'), 'cancelada');
    expect(odoo.cancelarOrden).toHaveBeenCalledWith('oc-1');

    const b = servicio(odoo);
    odoo.cancelarOrden.mockClear();
    await b.svc.updateEstado(orden('pendiente'), 'cancelada');
    expect(odoo.cancelarOrden).not.toHaveBeenCalled();
    expect(b.rpc).toHaveBeenCalledTimes(1);
  });

  it('recibida y recibida_parcial no tocan Odoo (la recepción sigue en SGC)', async () => {
    const odoo = { confirmarOrden: vi.fn(), cancelarOrden: vi.fn() };
    const { svc, rpc } = servicio(odoo);

    await svc.updateEstado(orden('confirmada'), 'recibida_parcial');
    await svc.updateEstado(orden('confirmada'), 'recibida');
    expect(odoo.confirmarOrden).not.toHaveBeenCalled();
    expect(odoo.cancelarOrden).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('un error del RPC de SGC tras confirmar en Odoo se propaga (la conciliación lo repara)', async () => {
    const odoo = { confirmarOrden: vi.fn().mockResolvedValue(undefined) };
    const { svc } = servicio(odoo, { message: 'transición inválida' });

    await expect(svc.updateEstado(orden('publicada'), 'aprobada')).rejects.toThrow('transición inválida');
  });
});
