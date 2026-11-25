// EA1 — servicio de proveedores de tecnología. Instancia por prototipo para no inyectar Supabase real.
import { describe, it, expect, vi } from 'vitest';
import { TecProveedoresService, enlaceCorreo, enlaceLlamar, enlaceWhatsapp } from './tec-proveedores.service';

function servicio(client: Record<string, unknown>) {
  const svc = Object.create(TecProveedoresService.prototype) as TecProveedoresService;
  Object.assign(svc, { supabase: { client } });
  return svc;
}

describe('enlaces de contacto', () => {
  it('llamar conserva el + y limpia separadores', () => {
    expect(enlaceLlamar('(809) 555-1234')).toBe('tel:8095551234');
    expect(enlaceLlamar('+1 829 555 0000')).toBe('tel:+18295550000');
    expect(enlaceLlamar('')).toBeNull();
    expect(enlaceLlamar(null)).toBeNull();
  });
  it('whatsapp antepone 1 a números RD de 10 dígitos', () => {
    expect(enlaceWhatsapp('809-555-1234')).toBe('https://wa.me/18095551234');
    expect(enlaceWhatsapp('+1 829 555 0000')).toBe('https://wa.me/18295550000');
    expect(enlaceWhatsapp('abc')).toBeNull();
  });
  it('correo exige @', () => {
    expect(enlaceCorreo(' ventas@proveedor.do ')).toBe('mailto:ventas@proveedor.do');
    expect(enlaceCorreo('sin-arroba')).toBeNull();
  });
});

describe('TecProveedoresService', () => {
  it('buscar llama al RPC único con q normalizada a null cuando está vacía', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null });
    const svc = servicio({ rpc });
    expect(await svc.buscar('  ')).toEqual([{ id: 'p1' }]);
    expect(rpc).toHaveBeenCalledWith('buscar_tec_proveedores', { p_q: null, p_incluir_inactivos: false });
    await svc.buscar(' cerradura ', true);
    expect(rpc).toHaveBeenLastCalledWith('buscar_tec_proveedores', { p_q: 'cerradura', p_incluir_inactivos: true });
  });

  it('propaga el mensaje de error del RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'No autorizado' } });
    await expect(servicio({ rpc }).buscar('x')).rejects.toThrow('No autorizado');
  });

  it('crearDesdeCotizacion manda el nombre solo si viene', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'prov-9', error: null });
    const svc = servicio({ rpc });
    expect(await svc.crearDesdeCotizacion('cot-1')).toBe('prov-9');
    expect(rpc).toHaveBeenCalledWith('tec_proveedor_crear_desde_cotizacion', { p_cotizacion_id: 'cot-1', p_nombre: null });
  });

  it('crearProveedor descarta claves que no son columnas (BN3)', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'nuevo' }, error: null });
    const insert = vi.fn().mockReturnValue({ select: () => ({ single }) });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({ insert }),
    };
    const id = await servicio(client).crearProveedor({
      nombre: 'X', nombre_comercial: null, rnc: null, categoria_id: null, servicio: null, etiquetas: [],
      direccion: null, ciudad: null, web: null, notas: null, estado: 'activo', valoracion: null,
      ...({ uiOnly: true } as object),
    });
    expect(id).toBe('nuevo');
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row['uiOnly']).toBeUndefined();
    expect(row['creado_por']).toBe('u1');
  });

  it('guardarContacto principal baja el principal anterior antes de guardar', async () => {
    const orden: string[] = [];
    const chain = (tag: string) => {
      const o: Record<string, unknown> = {};
      o['eq'] = () => o;
      o['neq'] = () => { orden.push(tag); return Promise.resolve({ error: null }); };
      return o;
    };
    const client = {
      from: () => ({
        update: () => chain('baja-principal'),
        insert: () => { orden.push('insert'); return Promise.resolve({ error: null }); },
      }),
    };
    await servicio(client).guardarContacto('p1', {
      nombre: 'Al', cargo: null, telefono: '809', whatsapp: null, correo: null, principal: true, notas: null,
    });
    expect(orden).toEqual(['baja-principal', 'insert']);
  });
});
