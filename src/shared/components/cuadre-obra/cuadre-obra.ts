import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { CuadreService } from '../../services/cuadre.service';
import { ToastService } from '../../services/toast.service';
import {
  CuadreObra,
  CuadreItem,
  CuadreItemFormData,
  CUADRE_CATEGORIAS,
  FASES_CUADRE,
} from '../../models/cuadre.model';

type CellField = 'cantidad_total' | 'est_f1' | 'est_f2' | 'est_f3' | 'est_f4';

interface CuadreGrupo {
  value: string;
  label: string;
  items: CuadreItem[];
}

/**
 * A3.1 — Editor del cuadre inicial por fases con kit de inicio.
 * Interno de gerencia: el ingeniero de obra no ve estos límites.
 */
@Component({
  selector: 'app-cuadre-obra',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './cuadre-obra.html',
  styleUrl: './cuadre-obra.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CuadreObraComponent {
  proyectoId = input.required<string>();
  bodegas = input<{ id: string; nombre: string }[]>([]);
  articulos = input<{ id: string; nombre: string; codigo: string }[]>([]);

  private cuadreService = inject(CuadreService);
  private toast = inject(ToastService);

  readonly CUADRE_CATEGORIAS = CUADRE_CATEGORIAS;
  readonly FASES_CUADRE = FASES_CUADRE;

  // ── Data state ──────────────────────────────────────────
  cuadre = signal<CuadreObra | null>(null);
  items = signal<CuadreItem[]>([]);
  consumo = signal<Record<string, number>>({});
  loading = signal(true);
  saving = signal(false);
  error = signal('');

  // Empty-state warehouse pick
  initBodegaId = signal<string | null>(null);

  // ── Add-material inline form ─────────────────────────────
  showAddForm = signal(false);
  fArticuloId = signal<string | null>(null);
  fDescripcion = signal('');
  fUnidad = signal('');
  fCantidadTotal = signal<number | null>(null);
  fF1 = signal<number>(0);
  fF2 = signal<number>(0);
  fF3 = signal<number>(0);
  fF4 = signal<number>(0);
  fBase = signal<number | null>(null);
  fFactor = signal<number | null>(null);
  fEsMinStock = signal(false);
  addError = signal('');

  // ── Grouped items (ordered, non-empty only) ──────────────
  grupos = computed<CuadreGrupo[]>(() => {
    const list = this.items();
    return CUADRE_CATEGORIAS.map((cat) => ({
      value: cat.value,
      label: cat.label,
      items: list.filter((it) => it.categoria === cat.value),
    })).filter((g) => g.items.length > 0);
  });

  constructor() {
    effect(() => {
      const id = this.proyectoId();
      if (id) this.load(id);
    });
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [cuadre, items, consumo] = await Promise.all([
        this.cuadreService.getCuadre(id),
        this.cuadreService.getItems(id),
        this.cuadreService.getConsumoPorArticulo(id),
      ]);
      this.cuadre.set(cuadre);
      this.items.set(items);
      this.consumo.set(consumo);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el cuadre.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Empty state — initialize + copy kit ──────────────────
  async inicializar() {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const n = await this.cuadreService.inicializar(this.proyectoId(), this.initBodegaId());
      await this.load(this.proyectoId());
      this.toast.success('Cuadre inicializado', `Kit copiado (${n} renglones).`);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al inicializar el cuadre.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Header — fase activa / almacén ───────────────────────
  async onFaseChange(value: string) {
    const fase_activa = Number(value);
    const previo = this.cuadre();
    if (!previo || fase_activa === previo.fase_activa) return;
    // Cambiar la fase a mano desactiva el avance automático.
    this.cuadre.update((c) => (c ? { ...c, fase_activa, fase_auto: false } : c));
    try {
      await this.cuadreService.setBodegaYFase(this.proyectoId(), { fase_activa, fase_auto: false });
    } catch (e: unknown) {
      this.cuadre.set(previo);
      this.toast.error('No se pudo cambiar la fase', e instanceof Error ? e.message : undefined);
    }
  }

  /** Reactiva el avance automático de la fase según el % del proyecto. */
  async toggleFaseAuto() {
    const previo = this.cuadre();
    if (!previo) return;
    const fase_auto = !(previo.fase_auto ?? true);
    this.cuadre.update((c) => (c ? { ...c, fase_auto } : c));
    try {
      await this.cuadreService.setBodegaYFase(this.proyectoId(), { fase_auto });
      if (fase_auto) await this.load(this.proyectoId()); // el trigger recalcula la fase
    } catch (e: unknown) {
      this.cuadre.set(previo);
      this.toast.error('No se pudo cambiar el modo de fase', e instanceof Error ? e.message : undefined);
    }
  }

  async onBodegaChange(value: string) {
    const bodega_id = value || null;
    const previo = this.cuadre();
    if (!previo || bodega_id === previo.bodega_id) return;
    this.cuadre.update((c) => (c ? { ...c, bodega_id } : c));
    try {
      await this.cuadreService.setBodegaYFase(this.proyectoId(), { bodega_id });
    } catch (e: unknown) {
      this.cuadre.set(previo);
      this.toast.error('No se pudo cambiar el almacén', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Editable cells ───────────────────────────────────────
  async onCellChange(item: CuadreItem, field: CellField, value: string) {
    const num = Number(value);
    if (Number.isNaN(num) || num === item[field]) return;
    const previo = item[field];
    this.patchLocal(item.id, { [field]: num } as Partial<CuadreItem>);
    try {
      await this.cuadreService.updateItem(item.id, { [field]: num } as Partial<CuadreItemFormData>);
    } catch (e: unknown) {
      this.patchLocal(item.id, { [field]: previo } as Partial<CuadreItem>);
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    }
  }

  private patchLocal(id: string, patch: Partial<CuadreItem>) {
    this.items.update((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  consumido(item: CuadreItem): number {
    return item.articulo_id ? (this.consumo()[item.articulo_id] ?? 0) : 0;
  }

  disponible(item: CuadreItem): number {
    return item.cantidad_total - this.consumido(item);
  }

  sobreConsumido(item: CuadreItem): boolean {
    return !!item.articulo_id && this.consumido(item) > item.cantidad_total;
  }

  // ── Remove ───────────────────────────────────────────────
  async remove(item: CuadreItem) {
    if (item.es_kit && !confirm(`¿Quitar "${item.descripcion}" del kit del cuadre?`)) return;
    const previo = this.items();
    this.items.update((list) => list.filter((it) => it.id !== item.id));
    try {
      await this.cuadreService.removeItem(item.id);
    } catch (e: unknown) {
      this.items.set(previo);
      this.toast.error('No se pudo quitar', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Add-material form ────────────────────────────────────
  openAdd() {
    this.resetAddForm();
    this.showAddForm.set(true);
  }

  cancelAdd() {
    this.showAddForm.set(false);
  }

  private resetAddForm() {
    this.fArticuloId.set(null);
    this.fDescripcion.set('');
    this.fUnidad.set('');
    this.fCantidadTotal.set(null);
    this.fF1.set(0);
    this.fF2.set(0);
    this.fF3.set(0);
    this.fF4.set(0);
    this.fBase.set(null);
    this.fFactor.set(null);
    this.fEsMinStock.set(false);
    this.addError.set('');
  }

  /** Picking an article prefills the description from its name. */
  onArticuloPick(value: string) {
    const id = value || null;
    this.fArticuloId.set(id);
    if (id) {
      const art = this.articulos().find((a) => a.id === id);
      if (art) {
        this.fDescripcion.set(art.nombre);
      }
    }
  }

  /** Typing a total splits it evenly across the four phases (still editable). */
  onTotalInput(value: string) {
    const total = value === '' ? null : Number(value);
    this.fCantidadTotal.set(total);
    if (total != null && !Number.isNaN(total)) {
      const per = Math.round((total / 4) * 100) / 100;
      this.fF1.set(per);
      this.fF2.set(per);
      this.fF3.set(per);
      this.fF4.set(per);
    }
  }

  /** CEPOS method: base × factor = cantidad_total (recomputes phase split). */
  private applyBaseFactor() {
    const base = this.fBase();
    const factor = this.fFactor();
    if (base != null && factor != null && !Number.isNaN(base) && !Number.isNaN(factor)) {
      this.onTotalInput(String(Math.round(base * factor * 100) / 100));
    }
  }

  onBaseInput(value: string) {
    this.fBase.set(value === '' ? null : Number(value));
    this.applyBaseFactor();
  }

  onFactorInput(value: string) {
    this.fFactor.set(value === '' ? null : Number(value));
    this.applyBaseFactor();
  }

  async submitAdd() {
    if (this.saving()) return;
    const descripcion = this.fDescripcion().trim();
    if (!this.fArticuloId() && !descripcion) {
      this.addError.set('La descripción es obligatoria si no eliges un artículo.');
      return;
    }
    this.saving.set(true);
    this.addError.set('');
    const payload: CuadreItemFormData = {
      articulo_id: this.fArticuloId(),
      descripcion,
      unidad: this.fUnidad().trim() || null,
      categoria: 'material',
      es_min_stock: this.fEsMinStock(),
      cantidad_total: this.fCantidadTotal() ?? 0,
      est_f1: this.fF1(),
      est_f2: this.fF2(),
      est_f3: this.fF3(),
      est_f4: this.fF4(),
      factor_base: this.fBase(),
      factor: this.fFactor(),
    };
    try {
      const created = await this.cuadreService.addItem(this.proyectoId(), payload);
      this.items.update((list) => [...list, created]);
      this.showAddForm.set(false);
      this.toast.success('Material agregado', created.descripcion);
    } catch (e: unknown) {
      this.addError.set(e instanceof Error ? e.message : 'Error al agregar el material.');
    } finally {
      this.saving.set(false);
    }
  }
}
