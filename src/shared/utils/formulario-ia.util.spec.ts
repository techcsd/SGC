import { describe, it, expect } from 'vitest';
import {
  emparejarProveedorSugerido,
  emparejarItemsPropuestos,
  emparejarVehiculoSugerido,
  filtrarRespuestasChecklist,
  type ItemPropuesto,
  type RespuestaChecklistPropuesta,
} from './formulario-ia.util';

describe('formulario-ia.util — conduce externo', () => {
  const proveedores = [
    { id: 'p1', nombre: 'Ferretería Popular' },
    { id: 'p2', nombre: 'Bloques del Este' },
  ];
  const articulos = [
    { id: 'a1', nombre: 'Cemento gris 42.5kg' },
    { id: 'a2', nombre: 'Varilla 3/8' },
  ];

  it('sin sugerencia (entrada vacía) no empareja nada', () => {
    expect(emparejarProveedorSugerido(null, proveedores)).toBeNull();
    expect(emparejarProveedorSugerido('', proveedores)).toBeNull();
  });

  it('empareja un proveedor por coincidencia exacta normalizada (acentos/mayúsculas)', () => {
    expect(emparejarProveedorSugerido('ferreteria popular', proveedores)).toEqual(proveedores[0]);
  });

  it('nombre ambiguo/no exacto no empareja (nunca adivina)', () => {
    expect(emparejarProveedorSugerido('Ferretería', proveedores)).toBeNull();
    expect(emparejarProveedorSugerido('Bloques del Norte', proveedores)).toBeNull();
  });

  it('items sin match contra el catálogo se descartan', () => {
    const items: ItemPropuesto[] = [{ articulo: 'Madera aserrada', cantidad: 5, unidad: null, confianza: 0.9 }];
    expect(emparejarItemsPropuestos(items, articulos)).toEqual([]);
  });

  it('items con match pero cantidad dudosa (0 o negativa) se descartan', () => {
    const items: ItemPropuesto[] = [{ articulo: 'Cemento gris 42.5kg', cantidad: 0, unidad: null, confianza: 0.9 }];
    expect(emparejarItemsPropuestos(items, articulos)).toEqual([]);
  });

  it('items con match exacto y cantidad válida se incluyen', () => {
    const items: ItemPropuesto[] = [
      { articulo: 'cemento gris 42.5kg', cantidad: 20, unidad: 'saco', confianza: 0.95 },
      { articulo: 'Varilla 3/8', cantidad: 10, unidad: null, confianza: 0.8 },
    ];
    expect(emparejarItemsPropuestos(items, articulos)).toEqual([
      { articuloId: 'a1', cantidad: 20 },
      { articuloId: 'a2', cantidad: 10 },
    ]);
  });

  it('lista de items vacía (foto sin relación con la obra) no produce renglones', () => {
    expect(emparejarItemsPropuestos([], articulos)).toEqual([]);
  });
});

describe('formulario-ia.util — mantenimiento (F2b)', () => {
  const vehiculos = [
    { id: 'v1', placa: 'A123456', alias: 'Camión 5' },
    { id: 'v2', placa: 'B987654', alias: 'Retroexcavadora 1' },
  ];

  it('sin sugerencia (transcripción vacía) no empareja nada', () => {
    expect(emparejarVehiculoSugerido(null, vehiculos)).toBeNull();
    expect(emparejarVehiculoSugerido('', vehiculos)).toBeNull();
  });

  it('empareja por alias exacto normalizado', () => {
    expect(emparejarVehiculoSugerido('camion 5', vehiculos)).toEqual({ id: 'v1' });
  });

  it('empareja por placa exacta', () => {
    expect(emparejarVehiculoSugerido('B987654', vehiculos)).toEqual({ id: 'v2' });
  });

  it('nombre ambiguo entre dos equipos parecidos no empareja (nunca adivina)', () => {
    expect(emparejarVehiculoSugerido('Retroexcavadora', vehiculos)).toBeNull();
  });

  it('vehículo sin match en el catálogo no empareja', () => {
    expect(emparejarVehiculoSugerido('Camión 99', vehiculos)).toBeNull();
  });
});

describe('formulario-ia.util — checklist de vehículos (F2b)', () => {
  const itemsVisibles = [{ id: 'i1' }, { id: 'i2' }];

  it('respuesta de un ítem que ya no está visible (cambió de plantilla) se descarta', () => {
    const respuestas: RespuestaChecklistPropuesta[] = [
      { id: 'i-de-otra-plantilla', respuesta: 'no', comentario: 'algo', confianza: 0.9 },
    ];
    expect(filtrarRespuestasChecklist(respuestas, itemsVisibles)).toEqual([]);
  });

  it('respuesta de un ítem visible se conserva', () => {
    const respuestas: RespuestaChecklistPropuesta[] = [
      { id: 'i1', respuesta: 'ok', comentario: null, confianza: 0.95 },
    ];
    expect(filtrarRespuestasChecklist(respuestas, itemsVisibles)).toEqual(respuestas);
  });

  it('arreglo vacío (nota de voz sin hallazgos) no produce nada', () => {
    expect(filtrarRespuestasChecklist([], itemsVisibles)).toEqual([]);
  });
});
