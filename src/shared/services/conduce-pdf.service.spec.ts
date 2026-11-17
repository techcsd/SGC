import { describe, it, expect } from 'vitest';
import { bloquesConduce } from './conduce-pdf.service';
import { SalidaInventario } from '../models/salida.model';

const salida = {
  id: '12345678-aaaa-bbbb-cccc-123456789012', fecha: '2026-11-16', estado: 'entregado', motivo: 'Obra',
  bodega: { nombre: 'Central' }, proyecto: { nombre: 'Torre' }, entrega_receptor: 'Juan',
  detalle_salidas: [{ id: 'd', salida_id: 's', articulo_id: 'a', cantidad: 5, cantidad_recibida: 4, articulo: { nombre: 'Cemento', codigo: 'C1', unidad: 'saco' } }],
} as unknown as SalidaInventario;

describe('bloquesConduce (DS-28)', () => {
  it('incluye renglones y solo las firmas con imagen', () => {
    const img = { jpeg: new Uint8Array([1]), ancho: 10, alto: 10 };
    const b = bloquesConduce(salida, [{ rol: 'emisor', nombre: 'A' }, { rol: 'receptor', nombre: 'Juan', cedula: '001' }], new Map([['receptor', img]]));
    const filas = b.filter((x) => x.tipo === 'fila');
    expect(filas.length).toBe(2);
    const im = b.find((x) => x.tipo === 'imagenes');
    expect(im && im.tipo === 'imagenes' ? im.items.map((i) => i.pie) : []).toEqual(['Recibe: Juan - 001']);
  });
  it('sin imágenes no agrega el bloque de firmas', () => {
    expect(bloquesConduce(salida, [], new Map()).some((x) => x.tipo === 'imagenes')).toBe(false);
  });
});
