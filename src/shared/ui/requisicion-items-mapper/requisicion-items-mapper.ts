import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Articulo } from '../../models/articulo.model';
import { Categoria } from '../../models/categoria.model';
import { SolicitudMaterial } from '../../models/solicitud.model';
import { ArticuloPicker, ArticuloPickerSelection } from '../articulo-picker/articulo-picker';
import { QtyStepper } from '../qty-stepper/qty-stepper';
import { Icon } from '../icon/icon';
import { mejorCoincidenciaArticulo } from '../../utils/articulo-match.util';

/** AT7 — un renglón de la requisición mapeado al catálogo durante la aprobación.
 *  `match_source`: 'origen' (venía del catálogo desde la app), 'sugerido' (fuzzy —
 *  verificar), 'manual' (lo cambió el aprobador), 'agregado' (renglón añadido),
 *  null (sin artículo → compra). `score` = confianza de la sugerencia. */
export interface ReqItemMap {
  descripcion: string;
  unidad: string | null;
  articulo_id: string | null;
  cantidad: number;
  talla: string | null;
  match_source: 'origen' | 'sugerido' | 'manual' | 'agregado' | null;
  score: number;
}

/** AT7 — mapea los renglones de una requisición al catálogo, con preselección del
 *  `articulo_id` que trae la app, sugerencia difusa del texto libre y edición del
 *  aprobador (cambiar artículo, cantidad, agregar/quitar renglón). "Sin artículo
 *  (comprar)" es el último recurso, nunca el default cuando hay coincidencia.
 *
 *  Componente COMPARTIDO por las dos superficies de aprobación (bandeja global de
 *  Requisiciones y Salidas › atender), para que el mapeo y AS8 (nombres largos vía
 *  el picker) sean idénticos en ambas. Emite `itemsChange` en cada cambio; el padre
 *  guarda la última lista y la envía a `aprobar_requisicion`. */
@Component({
  selector: 'app-requisicion-items-mapper',
  imports: [DecimalPipe, ArticuloPicker, QtyStepper, Icon],
  templateUrl: './requisicion-items-mapper.html',
  styleUrl: './requisicion-items-mapper.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequisicionItemsMapper {
  solicitud = input<SolicitudMaterial | null>(null);
  articulos = input<Articulo[]>([]);
  categorias = input<Categoria[]>([]);
  /** Stock disponible por articulo_id en el almacén elegido (para decidir despacho vs compra). */
  stock = input<Record<string, number>>({});

  itemsChange = output<ReqItemMap[]>();

  items = signal<ReqItemMap[]>([]);
  private seededKey: string | null = null;

  constructor() {
    // (Re)construye el mapeo cuando cambia la requisición o cuando el catálogo
    // termina de cargar (la key incluye el nº de artículos para reseedear una vez
    // que llegan). No re-siembra en cada tick, para no pisar las ediciones.
    effect(() => {
      const s = this.solicitud();
      const arts = this.articulos();
      const key = s ? `${s.id}:${arts.length}` : null;
      if (key === this.seededKey) return;
      this.seededKey = key;
      const built = this.construir(s, arts);
      this.items.set(built);
      this.itemsChange.emit(built);
    });
  }

  private construir(s: SolicitudMaterial | null, arts: Articulo[]): ReqItemMap[] {
    if (!s) return [];
    const activos = arts.filter((a) => a.activo);
    const byId = new Map(activos.map((a) => [a.id, a] as const));
    return (s.items ?? []).map((i) => {
      const base = { descripcion: i.descripcion, unidad: i.unidad ?? null, cantidad: i.cantidad, talla: i.talla ?? null };
      // 1) el renglón ya trae el artículo del catálogo desde el origen (lo eligió
      //    quien creó la requisición en la app): se preselecciona tal cual.
      if (i.articulo_id && byId.has(i.articulo_id)) {
        return { ...base, articulo_id: i.articulo_id, match_source: 'origen' as const, score: 1 };
      }
      // 2) texto libre: coincidencia difusa (>=0.5). "Sin artículo" es el último recurso.
      const best = mejorCoincidenciaArticulo(i.descripcion, activos, 0.5);
      if (best) {
        return { ...base, articulo_id: best.articulo.id, match_source: 'sugerido' as const, score: best.score };
      }
      return { ...base, articulo_id: null, match_source: null, score: 0 };
    });
  }

  private commit(next: ReqItemMap[]) {
    this.items.set(next);
    this.itemsChange.emit(next);
  }

  updateArticulo(index: number, sel: ArticuloPickerSelection) {
    const art = sel.articuloId ? this.articulos().find((a) => a.id === sel.articuloId) : null;
    this.commit(
      this.items().map((it, i) => {
        if (i !== index) return it;
        // En un renglón agregado por el aprobador, la descripción es solo una etiqueta:
        // al elegir el artículo se refleja su nombre real.
        const descripcion = it.match_source === 'agregado' && art ? art.nombre : it.descripcion;
        return {
          ...it,
          descripcion,
          articulo_id: sel.articuloId,
          match_source: (sel.articuloId
            ? it.match_source === 'agregado' ? 'agregado' : 'manual'
            : it.match_source === 'agregado' ? 'agregado' : null) as ReqItemMap['match_source'],
          score: sel.articuloId ? 1 : 0,
        };
      }),
    );
  }

  updateCantidad(index: number, value: number | string) {
    const cantidad = Number(value);
    this.commit(this.items().map((it, i) => (i === index ? { ...it, cantidad } : it)));
  }

  /** El aprobador agrega un renglón que la obra no pidió pero hace falta. */
  add() {
    this.commit([
      ...this.items(),
      { descripcion: 'Renglón agregado por el aprobador', unidad: null, articulo_id: null, cantidad: 1, talla: null, match_source: 'agregado', score: 0 },
    ]);
  }

  remove(index: number) {
    this.commit(this.items().filter((_, i) => i !== index));
  }

  /** Stock disponible del artículo mapeado en el almacén elegido. */
  stockOf(articuloId: string | null): number | null {
    if (!articuloId) return null;
    const m = this.stock();
    return articuloId in m ? m[articuloId] : null;
  }
}
