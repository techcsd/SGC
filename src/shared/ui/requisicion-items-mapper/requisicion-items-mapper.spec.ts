// Reporte «Errores en inventario» (agente) — al «Cambiar artículo» de un renglón al
// producto que sí hay, volver a abrir Aprobar/Despachar preseleccionaba el artículo
// de ORIGEN (sin stock) en vez del elegido (`articulo_despacho_id`): la cantidad
// disponible mostrada era la del artículo equivocado.
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { RequisicionItemsMapper } from './requisicion-items-mapper';
import { Articulo } from '../../models/articulo.model';
import { SolicitudMaterial, SolicitudMaterialItem } from '../../models/solicitud.model';

const art = (id: string, nombre: string) => ({ id, nombre, activo: true }) as Articulo;
const arts = [art('A', 'Cemento gris tipo I'), art('B', 'Varilla corrugada 3/8')];

const req = (item: Partial<SolicitudMaterialItem>): SolicitudMaterial =>
  ({
    id: 'req-1',
    items: [{ id: 'it-1', solicitud_id: 'req-1', descripcion: 'Cemento gris tipo I', cantidad: 10, unidad: 'saco', articulo_id: 'A', ...item }],
  }) as SolicitudMaterial;

function montar(s: SolicitudMaterial) {
  const fixture = TestBed.createComponent(RequisicionItemsMapper);
  fixture.componentRef.setInput('solicitud', s);
  fixture.componentRef.setInput('articulos', arts);
  fixture.componentRef.setInput('stock', { A: 0, B: 50 });
  fixture.detectChanges();
  return fixture.componentInstance;
}

describe('RequisicionItemsMapper — artículo elegido al despachar', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [RequisicionItemsMapper] }));

  it('preselecciona articulo_despacho_id (el que se cambió) y su stock', () => {
    const c = montar(req({ articulo_despacho_id: 'B' }));
    const it0 = c.items()[0];
    expect(it0.articulo_id).toBe('B');
    expect(it0.match_source).toBe('manual');
    expect(c.stockOf(it0.articulo_id)).toBe(50);
  });

  it('sin articulo_despacho_id se mantiene el artículo de origen', () => {
    const c = montar(req({ articulo_despacho_id: null }));
    const it0 = c.items()[0];
    expect(it0.articulo_id).toBe('A');
    expect(it0.match_source).toBe('origen');
  });
});
