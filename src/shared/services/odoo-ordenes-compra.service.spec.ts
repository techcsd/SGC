// CY24 (#24, D4) — confirmar/cancelar: Odoo primero, SGC después. Si Odoo rechaza, el
// estado SGC no cambia. Instancia por prototipo para no inyectar Supabase real.
import { describe, it, expect, vi } from 'vitest';
import { OdooOrdenesCompraService } from './odoo-ordenes-compra.service';

function servicio(odoo: Record<string, unknown>, rpcError: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ error: rpcError });
  const svc = Object.create(OdooOrdenesCompraService.prototype) as OdooOrdenesCompraService;
  Object.assign(svc, { odoo, supabase: { client: { schema: () => ({ rpc }) } } });
  return { svc, rpc };
}

type Vivo = 'draft' | 'to approve' | 'purchase' | 'cancel';
/** OC con vínculo a Odoo (`vinculada`) y su estado VIVO; sin vínculo = nunca publicada. */
const orden = (vinculada: boolean, vivo: Vivo | null = null) => ({
  id: 'oc-1',
  odoo_id: vinculada ? 77 : null,
  odoo_vivo: vivo ? { id: 77, nombre: 'P00077', estado: vivo, total: 100, moneda: 'DOP', recibida_en_odoo: false, recepciones_hechas: 0, recepciones_total: 0 } : null,
});
const OK = { estado_odoo: 'purchase' };

describe('OdooOrdenesCompraService.updateEstado', () => {
  it('aprobar confirma en Odoo ANTES de cambiar el estado SGC', async () => {
    const orden_ = vi.fn();
    const odoo = { confirmarOrden: vi.fn().mockImplementation(async () => { orden_('odoo'); return OK; }) };
    const { svc, rpc } = servicio(odoo);
    rpc.mockImplementation(async () => { orden_('sgc'); return { error: null }; });

    await svc.updateEstado(orden(true, 'draft'), 'aprobada');

    expect(odoo.confirmarOrden).toHaveBeenCalledWith('oc-1');
    expect(orden_.mock.calls.map((c) => c[0])).toEqual(['odoo', 'sgc']);
  });

  it('si Odoo deja la OC en "to approve", SGC espera: no cambia su estado y avisa', async () => {
    const odoo = { confirmarOrden: vi.fn().mockResolvedValue({ estado_odoo: 'to approve' }) };
    const { svc, rpc } = servicio(odoo);

    expect(await svc.updateEstado(orden(true, 'draft'), 'aprobada')).toBe('por_aprobar');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('aprobar una OC vinculada sin estado vivo (Odoo no respondió antes) confirma en Odoo', async () => {
    const odoo = { confirmarOrden: vi.fn().mockResolvedValue(OK) };
    const { svc, rpc } = servicio(odoo);

    expect(await svc.updateEstado(orden(true), 'aprobada')).toBe('aplicado');
    expect(odoo.confirmarOrden).toHaveBeenCalledWith('oc-1');
    expect(rpc).toHaveBeenCalled();
  });

  it('con error y sin id de Odoo, primero hay que publicar', async () => {
    const { svc } = servicio({});
    await expect(svc.updateEstado(orden(false), 'aprobada')).rejects.toThrow('Publica la orden en Odoo');
  });

  it('si Odoo rechaza, el estado SGC NO cambia', async () => {
    const odoo = { confirmarOrden: vi.fn().mockRejectedValue(new Error('Odoo no respondió a tiempo.')) };
    const { svc, rpc } = servicio(odoo);

    await expect(svc.updateEstado(orden(true, 'draft'), 'aprobada')).rejects.toThrow('Odoo no respondió');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('no aprueba una OC que todavía no está publicada en Odoo', async () => {
    const odoo = { confirmarOrden: vi.fn() };
    const { svc, rpc } = servicio(odoo);

    await expect(svc.updateEstado(orden(false), 'aprobada')).rejects.toThrow('Publica la orden en Odoo');
    expect(odoo.confirmarOrden).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('una OC ya confirmada en Odoo no se confirma otra vez', async () => {
    const odoo = { confirmarOrden: vi.fn() };
    const { svc, rpc } = servicio(odoo);

    await svc.updateEstado(orden(true, 'purchase'), 'aprobada');
    expect(odoo.confirmarOrden).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('cancelar una OC publicada cancela en Odoo; una local sin publicar solo cambia SGC', async () => {
    const odoo = { cancelarOrden: vi.fn().mockResolvedValue(undefined) };
    const a = servicio(odoo);
    await a.svc.updateEstado(orden(true, 'draft'), 'cancelada');
    expect(odoo.cancelarOrden).toHaveBeenCalledWith('oc-1');

    const b = servicio(odoo);
    odoo.cancelarOrden.mockClear();
    await b.svc.updateEstado(orden(false), 'cancelada');
    expect(odoo.cancelarOrden).not.toHaveBeenCalled();
    expect(b.rpc).toHaveBeenCalledTimes(1);
  });

  it('recibida y recibida_parcial no tocan Odoo (la recepción sigue en SGC)', async () => {
    const odoo = { confirmarOrden: vi.fn(), cancelarOrden: vi.fn() };
    const { svc, rpc } = servicio(odoo);

    await svc.updateEstado(orden(true, 'purchase'), 'recibida_parcial');
    await svc.updateEstado(orden(true, 'purchase'), 'recibida');
    expect(odoo.confirmarOrden).not.toHaveBeenCalled();
    expect(odoo.cancelarOrden).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('un error del RPC de SGC tras confirmar en Odoo se propaga', async () => {
    const odoo = { confirmarOrden: vi.fn().mockResolvedValue(OK) };
    const { svc } = servicio(odoo, { message: 'transición inválida' });

    await expect(svc.updateEstado(orden(true, 'draft'), 'aprobada')).rejects.toThrow('transición inválida');
  });

  it('si Odoo ya la tiene en "to approve" no vuelve a confirmar: queda esperando', async () => {
    const odoo = { confirmarOrden: vi.fn() };
    const { svc, rpc } = servicio(odoo);

    expect(await svc.updateEstado(orden(true, 'to approve'), 'aprobada')).toBe('por_aprobar');
    expect(odoo.confirmarOrden).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('OdooOrdenesCompraService estado vivo', () => {
  const base = { id: 'oc-1', odoo_id: 77 } as never;
  const conEstado = (svc: OdooOrdenesCompraService, ordenes: unknown[]) =>
    (svc as unknown as { conEstadoOdoo(o: unknown[]): Promise<Record<string, unknown>[]> }).conEstadoOdoo(ordenes);

  it('adjunta el estado leído de Odoo y no consulta si no hay OC vinculadas', async () => {
    const odoo = { obtenerOrdenes: vi.fn().mockResolvedValue([{ id: 77, nombre: 'P00077', estado: 'purchase' }]) };
    const { svc } = servicio(odoo);

    const [r] = await conEstado(svc, [base]);
    expect(r['odoo_consulta']).toBe('ok');
    expect((r['odoo_vivo'] as { estado: string }).estado).toBe('purchase');

    await conEstado(svc, [{ id: 'oc-2', odoo_id: null }]);
    expect(odoo.obtenerOrdenes).toHaveBeenCalledTimes(1);
  });

  it('si Odoo no responde marca consulta=error y no deja datos viejos', async () => {
    const odoo = { obtenerOrdenes: vi.fn().mockRejectedValue(new Error('caído')) };
    const { svc } = servicio(odoo);

    const [r] = await conEstado(svc, [base]);
    expect(r['odoo_consulta']).toBe('error');
    expect(r['odoo_vivo']).toBeNull();
  });
});
