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
const veh = ENTIDADES.find((e) => e.key === 'vehiculos') as EntidadImportable;
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

// CQ4-a — el bug real: "importar un archivo nuevo deja casi todo sin mapear".
// Causa: el mapeo recordado de una importación anterior pisaba el auto-mapeo
// fresco (incluso vacío, o con una columna que no existe en ESTE archivo).
describe('Importador — fusión del mapeo recordado (CQ4-a, el auto-mapeo manda)', () => {
  it('recordado vacío ({}) no afecta nada — gana el auto-mapeo', () => {
    const headers = ['Placa', 'Marca', 'Modelo'];
    const auto = svc.autoMapeo(veh, headers);
    const fusion = svc.fusionarMapeoRecordado(auto, {}, headers);
    expect(fusion).toEqual(auto);
    expect(fusion['placa']).toBe('Placa');
  });

  it('recordado de OTRO archivo (columna que no existe aquí) se ignora', () => {
    const headers = ['Placa', 'Marca']; // este archivo NO tiene "VIN"
    const auto = svc.autoMapeo(veh, headers);
    const recordado = { placa: 'Placa', vin: 'VIN' }; // 'VIN' no existe en este archivo
    const fusion = svc.fusionarMapeoRecordado(auto, recordado, headers);
    expect(fusion['vin']).toBeUndefined();
    expect(fusion['placa']).toBe('Placa');
  });

  it('columna renombrada en el archivo nuevo: el auto-mapeo gana sobre lo recordado', () => {
    // La sesión anterior tenía "Marca" mapeada a una columna distinta ("Fabricante",
    // que YA NO EXISTE); el archivo nuevo sí trae "Marca" tal cual — debe ganar el
    // auto-mapeo fresco, no la columna vieja/recordada.
    const headers = ['Placa', 'Marca', 'Modelo'];
    const auto = svc.autoMapeo(veh, headers);
    const recordado = { placa: 'Placa', marca: 'Fabricante' }; // "Fabricante" no existe ya
    const fusion = svc.fusionarMapeoRecordado(auto, recordado, headers);
    expect(fusion['marca']).toBe('Marca'); // gana el auto-mapeo, no 'Fabricante'
  });

  it('recordado SÍ rellena un campo que el auto-mapeo no pudo mapear, si la columna existe', () => {
    const headers = ['Placa', 'ColumnaRara'];
    const auto = svc.autoMapeo(veh, headers); // 'ColumnaRara' no automapea a nada
    const recordado = { color: 'ColumnaRara' }; // el usuario la había mapeado a mano antes
    const fusion = svc.fusionarMapeoRecordado(auto, recordado, headers);
    expect(fusion['color']).toBe('ColumnaRara');
  });

  it('autoMapeo reconoce su PROPIA plantilla (label verboso) al 100%', () => {
    // La plantilla SGC usa el label completo como encabezado — debe automapear
    // siempre, incluso para labels largos con texto entre paréntesis.
    const headers = veh.campos.filter((c) => c.t !== 'odoo_ref').map((c) => c.label);
    const auto = svc.autoMapeo(veh, headers);
    for (const c of veh.campos) {
      if (c.t === 'odoo_ref') continue;
      expect(auto[c.t], `campo "${c.t}" no automapeó su propio label "${c.label}"`).toBe(c.label);
    }
  });
});
