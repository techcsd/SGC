import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  ElementRef,
  viewChild,
} from '@angular/core';
import { Articulo } from '../../models/articulo.model';
import { Categoria } from '../../models/categoria.model';

/** Emitido al elegir un renglón del picker. */
export interface ArticuloPickerSelection {
  articuloId: string | null;
  esOtro: boolean;
}

interface Grupo {
  categoria: string;
  destacada: boolean;
  articulos: Articulo[];
}

/**
 * T13b — Selector de artículos compartido (Salidas, Requisición, OC). Reemplaza
 * los `<select>` nativos con optgroup: búsqueda por nombre/código, agrupación por
 * categoría (destacadas primero), stock visible por bodega cuando aplica y opción
 * explícita "Otro (escribir)". Teclado-friendly (↑/↓/Enter/Esc). Inspirado en el
 * selector de la app móvil.
 */
@Component({
  selector: 'app-articulo-picker',
  imports: [],
  templateUrl: './articulo-picker.html',
  styleUrl: './articulo-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticuloPicker {
  articulos = input<Articulo[]>([]);
  categorias = input<Categoria[]>([]);
  /** articulo_id seleccionado (uuid) o null. */
  value = input<string | null>(null);
  /** Si el renglón está en modo "Otro (texto libre)". */
  esOtro = input<boolean>(false);
  allowOtro = input<boolean>(true);
  /** Stock disponible por articulo_id en la bodega vigente (opcional). */
  stock = input<Record<string, number> | null>(null);
  placeholder = input<string>('Selecciona un artículo…');
  disabled = input<boolean>(false);

  selectionChange = output<ArticuloPickerSelection>();

  private searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  open = signal(false);
  query = signal('');
  highlighted = signal(0);

  /** Artículos activos agrupados por categoría (destacadas primero, luego "Otros"). */
  private grupos = computed<Grupo[]>(() => {
    const arts = this.articulos().filter((a) => a.activo);
    const cats = this.categorias();
    const byCat = new Map<number, Articulo[]>();
    for (const a of arts) {
      const list = byCat.get(a.categoria_id);
      if (list) list.push(a);
      else byCat.set(a.categoria_id, [a]);
    }
    const grupos: Grupo[] = [];
    const catIds = new Set<number>();
    for (const c of cats) {
      catIds.add(c.id);
      const list = byCat.get(c.id);
      if (list && list.length) grupos.push({ categoria: c.nombre, destacada: !!c.destacada, articulos: list });
    }
    const otros = arts.filter((a) => !catIds.has(a.categoria_id));
    if (otros.length) grupos.push({ categoria: 'Otros', destacada: false, articulos: otros });
    return grupos;
  });

  /** Grupos filtrados por la búsqueda (nombre/código/subgrupo). */
  gruposFiltrados = computed<Grupo[]>(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.grupos();
    return this.grupos()
      .map((g) => ({
        ...g,
        articulos: g.articulos.filter(
          (a) =>
            a.nombre.toLowerCase().includes(q) ||
            (a.codigo ?? '').toLowerCase().includes(q) ||
            (a.subgrupo ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.articulos.length > 0);
  });

  /** Lista plana de los artículos visibles (para navegación con teclado). */
  private planos = computed<Articulo[]>(() => this.gruposFiltrados().flatMap((g) => g.articulos));

  /** Texto del botón trigger. */
  etiqueta = computed(() => {
    if (this.esOtro()) return '✏️ Otro (escribir)…';
    const id = this.value();
    if (!id) return this.placeholder();
    const a = this.articulos().find((x) => x.id === id);
    if (!a) return this.placeholder();
    return `${a.subgrupo ? '[' + a.subgrupo + '] ' : ''}${a.nombre} (${a.codigo})`;
  });

  seleccionado = computed(() => !!this.value() || this.esOtro());

  stockDe(id: string): number | null {
    const s = this.stock();
    if (!s) return null;
    return s[id] ?? 0;
  }

  toggle() {
    if (this.disabled()) return;
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.query.set('');
      this.highlighted.set(0);
      // Autofocus al abrir.
      queueMicrotask(() => this.searchInput()?.nativeElement.focus());
    }
  }

  cerrar() {
    this.open.set(false);
  }

  onQuery(value: string) {
    this.query.set(value);
    this.highlighted.set(0);
  }

  elegir(a: Articulo) {
    this.selectionChange.emit({ articuloId: a.id, esOtro: false });
    this.cerrar();
  }

  elegirOtro() {
    this.selectionChange.emit({ articuloId: null, esOtro: true });
    this.cerrar();
  }

  limpiar() {
    this.selectionChange.emit({ articuloId: null, esOtro: false });
    this.cerrar();
  }

  /** Navegación con teclado dentro del buscador. */
  onKeydown(event: KeyboardEvent) {
    const planos = this.planos();
    const total = planos.length + (this.allowOtro() ? 1 : 0);
    if (total === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.highlighted.update((i) => (i + 1) % total);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.highlighted.update((i) => (i - 1 + total) % total);
        break;
      case 'Enter': {
        event.preventDefault();
        const i = this.highlighted();
        if (i < planos.length) this.elegir(planos[i]);
        else if (this.allowOtro()) this.elegirOtro();
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.cerrar();
        break;
    }
  }

  /** Índice plano de un artículo (para resaltar el activo por teclado). */
  indexDe(a: Articulo): number {
    return this.planos().findIndex((x) => x.id === a.id);
  }
  get otroIndex(): number {
    return this.planos().length;
  }
}
