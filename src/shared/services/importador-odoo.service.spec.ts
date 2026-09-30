// CC4 (#87) — perfiles de Odoo del importador: auto-mapeo de encabezados
// (español/inglés/técnicos), transformaciones (RNC, relacional hoja, UoM,
// booleanos) y fusión de filas de continuación. Fixtures reales en
// qa/fixtures/odoo/. No toca Supabase → instancia por prototipo.
import { describe, it, expect } from 'vitest';
import { ImportadorService, ENTIDADES, EntidadImportable } from './importador.service';

// Instancia sin correr el inicializador de campo (evita inject(SupabaseService)).
const svc = Object.create(ImportadorService.prototype) as ImportadorService;
const prov = ENTIDADES.find((e) => e.key === 'proveedores') as EntidadImportable;
const art = ENTIDADES.find((e) => e.key === 'articulos') as EntidadImportable;
const campo = (e: EntidadImportable, t: string) => e.campos.find((c) => c.t === t)!;

describe('Importador — perfil Odoo res.partner (proveedores)', () => {
  it('auto-mapea encabezados de Odoo en ESPAÑOL', () => {
    const headers = ['ID', 'Nombre', 'NIF/RNC', 'Teléfono', 'Correo electrónico', 'Calle', 'Es una compañía', 'Activo'];
    const m = svc.autoMapeo(prov, headers);
    expect(m['odoo_ref']).toBe('ID');
    expect(m['nombre']).toBe('Nombre');
    expect(m['rnc']).toBe('NIF/RNC');
    expect(m['telefono']).toBe('Teléfono');
    expect(m['email']).toBe('Correo electrónico');
    expect(m['is_company']).toBe('Es una compañía');
  });

  it('auto-mapea encabezados de Odoo en INGLÉS y técnicos', () => {
    const headers = ['External ID', 'Name', 'Tax ID', 'Phone', 'Email', 'Street', 'Is a Company', 'Active'];
    const m = svc.autoMapeo(prov, headers);
    expect(m['odoo_ref']).toBe('External ID');
    expect(m['nombre']).toBe('Name');
    expect(m['rnc']).toBe('Tax ID');
    expect(m['activo']).toBe('Active');
  });
});

describe('Importador — transformaciones Odoo', () => {
  it('RNC/cédula → solo dígitos, valida 9 u 11', () => {
    expect(svc.transformar(campo(prov, 'rnc'), '1-31-12345-6').valor).toBe('131123456');
    expect(svc.transformar(campo(prov, 'rnc'), '001-1234567-8').valor).toBe('00112345678');
  });
  it('relacional "A / B / C" → última hoja', () => {
    expect(svc.transformar(campo(art, 'categoria'), 'Todos / Materiales / Acero').valor).toBe('Acero');
  });
  it('UoM de Odoo → unidad SGC', () => {
    expect(svc.transformar(campo(art, 'unidad'), 'Unidades').valor).toBe('ud');
    expect(svc.transformar(campo(art, 'unidad'), 'Litro(s)').valor).toBe('l');
  });
  it('booleano "Es una compañía"', () => {
    expect(svc.transformar(campo(prov, 'is_company'), 'Verdadero').valor).toBe(true);
    expect(svc.transformar(campo(prov, 'is_company'), 'False').valor).toBe(false);
  });
});

describe('Importador — fusión de filas de continuación', () => {
  it('funde una fila con ID/nombre vacíos en la anterior', () => {
    const mapeo = { odoo_ref: 'ID', nombre: 'Nombre', direccion: 'Calle' };
    const rows = [
      { ID: '__export__.res_partner_1', Nombre: 'Acero SRL', Calle: 'Av. Duarte' },
      { ID: '', Nombre: '', Calle: 'Local 2' }, // continuación
      { ID: '__export__.res_partner_2', Nombre: 'Martillo', Calle: 'Calle 3ra' },
    ];
    const fusion = svc.fusionarContinuacion(prov, rows, mapeo);
    expect(fusion.length).toBe(2);
    expect(fusion[0]['Nombre']).toBe('Acero SRL');
  });

  it('aplicarMapeo pasa odoo_ref y aplica transformaciones', () => {
    const mapeo = { odoo_ref: 'ID', nombre: 'Nombre', rnc: 'RNC' };
    const rows = [{ ID: '__export__.res_partner_9', Nombre: 'Test', RNC: '1-31-99999-9' }];
    const out = svc.aplicarMapeo(prov, rows, mapeo);
    expect(out[0]['odoo_ref']).toBe('__export__.res_partner_9');
    expect(out[0]['rnc']).toBe('131999999');
  });
});
