// Variante «Odoo directo» de Proveedores: lo fiscal va a Odoo, lo operativo a la fila local enlazada.
import { describe, it, expect, vi } from 'vitest';
import { ProveedoresOdooService } from './proveedores-odoo.service';
import { OdooProveedor } from '../models/odoo.model';
import { Proveedor } from '../models/proveedor.model';

const odooProv = (o: Partial<OdooProveedor> = {}): OdooProveedor => ({
  id: 7, nombre: 'Ferretería Sol', rnc: '131123456', email: null, telefono: null, direccion: null, activo: true, es_empresa: true, ...o,
});

/** Cadena mínima de supabase: from().select().in() / update().eq().select().single() y rpc(). */
function servicio(odoo: Record<string, unknown>, locales: Partial<Proveedor>[] = [], rpcId = 'uuid-local') {
  const actualizado: Record<string, unknown>[] = [];
  const chain = {
    select: () => chain,
    in: () => Promise.resolve({ data: locales, error: null }),
    update: (v: Record<string, unknown>) => { actualizado.push(v); return chain; },
    eq: () => chain,
    single: () => Promise.resolve({ data: { id: rpcId, odoo_id: 7, created_at: 'x', ...actualizado.at(-1) }, error: null }),
  };
  const rpc = vi.fn().mockResolvedValue({ data: rpcId, error: null });
  const svc = Object.create(ProveedoresOdooService.prototype) as ProveedoresOdooService;
  Object.assign(svc, { odoo, supabase: { client: { schema: () => ({ from: () => chain, rpc }) } } });
  return { svc, rpc, actualizado };
}

describe('ProveedoresOdooService', () => {
  it('lista desde Odoo y completa lo operativo con la fila local enlazada', async () => {
    const odoo = { buscarProveedores: vi.fn().mockResolvedValue({ proveedores: [odooProv(), odooProv({ id: 8, nombre: 'Sin fila' })], pagina: 1, tamano: 50, hay_mas: true }) };
    const { svc } = servicio(odoo, [{ id: 'loc-1', odoo_id: 7, tipos: ['ferreteria'], lat: 18.5, lng: -69.9, is_hardware_store: true }]);

    const r = await svc.getPagina({ termino: ' sol ', estado: 'activos', pagina: 1 });

    expect(odoo.buscarProveedores).toHaveBeenCalledWith({ termino: 'sol', estado: 'activos', pagina: 1 });
    expect(r.hayMas).toBe(true);
    expect(r.proveedores[0]).toMatchObject({ id: 'loc-1', odoo_id: 7, nombre: 'Ferretería Sol', tipos: ['ferreteria'], lat: 18.5 });
    expect(r.proveedores[1]).toMatchObject({ id: 'odoo:8', odoo_id: 8, tipos: [] }); // aún sin fila local
  });

  it('crear: primero Odoo, luego asegura la fila local y guarda lo operativo + el espejo', async () => {
    const orden: string[] = [];
    const odoo = { crearProveedor: vi.fn().mockImplementation(async () => { orden.push('odoo'); return { proveedor: odooProv(), ya_existia: false }; }) };
    const { svc, rpc, actualizado } = servicio(odoo);
    rpc.mockImplementation(async () => { orden.push('local'); return { data: 'uuid-local', error: null }; });

    const p = await svc.create({ nombre: 'Ferretería Sol', rnc: '131123456', contacto: 'Ana', tipos: ['ferreteria'], is_hardware_store: true, lat: 1, lng: 2, activo: false });

    expect(orden).toEqual(['odoo', 'local']);
    expect(odoo.crearProveedor).toHaveBeenCalledWith({ nombre: 'Ferretería Sol', rnc: '131123456' }); // sin nombre duplicado ni activo
    expect(rpc).toHaveBeenCalledWith('asegurar_proveedor_odoo', { p_odoo_id: 7, p_nombre: 'Ferretería Sol' });
    expect(actualizado[0]).toMatchObject({ nombre: 'Ferretería Sol', rnc: '131123456', contacto: 'Ana', is_hardware_store: true, lat: 1 });
    expect(p.id).toBe('uuid-local');
  });

  it('editar solo manda a Odoo lo fiscal que cambió; lo operativo no sale de SGC', async () => {
    const odoo = { actualizarProveedor: vi.fn().mockResolvedValue(odooProv({ telefono: '8095550000' })), obtenerProveedores: vi.fn() };
    const { svc } = servicio(odoo);
    const actual = { id: 'loc-1', odoo_id: 7, nombre: 'Ferretería Sol', rnc: '131123456', telefono: null, email: null, direccion: null, activo: true, created_at: 'x' } as Proveedor;

    await svc.update(actual, { nombre: 'Ferretería Sol', rnc: '131123456', telefono: '8095550000', contacto: 'Luis', lat: 3 });

    expect(odoo.actualizarProveedor).toHaveBeenCalledWith(7, { telefono: '8095550000' });
  });

  it('editar sin cambios fiscales no escribe en Odoo', async () => {
    const odoo = { actualizarProveedor: vi.fn(), obtenerProveedores: vi.fn().mockResolvedValue([odooProv()]) };
    const { svc } = servicio(odoo);
    const actual = { id: 'loc-1', odoo_id: 7, nombre: 'Ferretería Sol', rnc: '131123456', created_at: 'x' } as Proveedor;

    await svc.update(actual, { nombre: 'Ferretería Sol', contacto: 'Luis' });

    expect(odoo.actualizarProveedor).not.toHaveBeenCalled();
  });

  it('un proveedor sin vínculo con Odoo no se puede editar ni desactivar desde esta pantalla', async () => {
    const { svc } = servicio({});
    const sinVinculo = { id: 'loc-2', nombre: 'Local', created_at: 'x' } as Proveedor;
    await expect(svc.update(sinVinculo, { nombre: 'X' })).rejects.toThrow('no está vinculado a Odoo');
    await expect(svc.toggleActivo(sinVinculo, false)).rejects.toThrow('no está vinculado a Odoo');
  });

  it('desactivar escribe en Odoo y refleja el estado en la fila local', async () => {
    const odoo = { actualizarProveedor: vi.fn().mockResolvedValue(odooProv({ activo: false })) };
    const { svc, actualizado } = servicio(odoo);
    await svc.toggleActivo({ id: 'loc-1', odoo_id: 7, created_at: 'x' } as Proveedor, false);
    expect(odoo.actualizarProveedor).toHaveBeenCalledWith(7, { activo: false });
    expect(actualizado[0]).toEqual({ activo: false });
  });
});
