import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
  ElementRef,
  viewChild,
} from '@angular/core';
import { SupabaseService } from '../../../app/core/services/supabase.service';
import { Articulo, propiedadLabel, propiedadBadge } from '../../models/articulo.model';
import { Categoria } from '../../models/categoria.model';

/** Emitido al elegir un renglón del picker. */
export interface ArticuloPickerSelection {
  articuloId: string | null;
  esOtro: boolean;
}

/** Z16 — subgrupo por propiedad dentro de una categoría (CSD vs Alquilados). */
interface SubGrupo {
  propiedad: string;
  label: string;
  badge: string;
  articulos: Articulo[];
}

interface Grupo {
  categoria: string;
  destacada: boolean;
  articulos: Articulo[];
  subgrupos: SubGrupo[];
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
  /** AP3 — oculta artículos con existencia 0 (selectores de conduce/salida). */
  ocultarSinStock = input<boolean>(false);
  placeholder = input<string>('Selecciona un artículo…');
  disabled = input<boolean>(false);

  selectionChange = output<ArticuloPickerSelection>();

  private supabase = inject(SupabaseService);
  private searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  open = signal(false);
  query = signal('');
  highlighted = signal(0);
  // AW6 — sugerencias fuzzy del servidor ("¿Quisiste decir…?") cuando el filtro
  // local no encuentra nada (tolera errores de tipeo). Se mapean a la lista real.
  sugerencias = signal<Articulo[]>([]);
  buscandoSug = signal(false);
  private debTimer: ReturnType<typeof setTimeout> | null = null;

  readonly propiedadLabel = propiedadLabel;
  readonly propiedadBadge = propiedadBadge;

  /** Z16 — divide una lista de artículos en subgrupos CSD / Alquilados (propios
   *  primero). Devuelve solo los subgrupos no vacíos; `articulos` queda ordenado. */
  private dividirPorPropiedad(list: Articulo[]): { articulos: Articulo[]; subgrupos: SubGrupo[] } {
    const csd = list.filter((a) => (a.propiedad ?? 'propio_csd') !== 'alquilado');
    const alq = list.filter((a) => (a.propiedad ?? 'propio_csd') === 'alquilado');
    const subgrupos: SubGrupo[] = [];
    if (csd.length) subgrupos.push({ propiedad: 'propio_csd', label: 'CSD (propios)', badge: 'success', articulos: csd });
    if (alq.length) subgrupos.push({ propiedad: 'alquilado', label: 'Alquilados', badge: 'warning', articulos: alq });
    return { articulos: [...csd, ...alq], subgrupos };
  }

  /** Artículos activos agrupados por categoría (destacadas primero, luego "Otros"). */
  private grupos = computed<Grupo[]>(() => {
    const stockMap = this.stock();
    const ocultarCero = this.ocultarSinStock() && !!stockMap;
    // AP3 — en selectores de salida ocultamos existencias en 0 (antes se deshabilitaban).
    const arts = this.articulos()
      .filter((a) => a.activo)
      .filter((a) => !ocultarCero || (stockMap?.[a.id] ?? 0) > 0);
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
      if (list && list.length) {
        const { articulos, subgrupos } = this.dividirPorPropiedad(list);
        grupos.push({ categoria: c.nombre, destacada: !!c.destacada, articulos, subgrupos });
      }
    }
    const otros = arts.filter((a) => !catIds.has(a.categoria_id));
    if (otros.length) {
      const { articulos, subgrupos } = this.dividirPorPropiedad(otros);
      grupos.push({ categoria: 'Otros', destacada: false, articulos, subgrupos });
    }
    return grupos;
  });

  /** AW6 — normaliza (minúsculas + sin acentos) para búsqueda amigable. */
  private norm(s: string | null | undefined): string {
    return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /**
   * AW6 — grupos filtrados por búsqueda amigable: insensible a acentos e
   * independiente del orden de palabras (cada token debe aparecer en
   * nombre/código/subgrupo/categoría). La tolerancia a errores de tipeo la
   * cubre la sugerencia server-side ("¿Quisiste decir…?").
   */
  gruposFiltrados = computed<Grupo[]>(() => {
    const raw = this.query().trim();
    if (!raw) return this.grupos();
    const tokens = this.norm(raw).split(/\s+/).filter(Boolean);
    return this.grupos()
      .map((g) => {
        const catN = this.norm(g.categoria);
        const filtrados = g.articulos.filter((a) => {
          const text = `${this.norm(a.nombre)} ${this.norm(a.codigo)} ${this.norm(a.subgrupo)} ${catN}`;
          return tokens.every((t) => text.includes(t));
        });
        const { articulos, subgrupos } = this.dividirPorPropiedad(filtrados);
        return { ...g, articulos, subgrupos };
      })
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
    this.sugerencias.set([]);
    if (this.debTimer) clearTimeout(this.debTimer);
    const q = value.trim();
    if (q.length < 3) return;
    // AW6 — debounce + solo consulta el servidor si el filtro local no dio nada.
    this.debTimer = setTimeout(() => void this.buscarSugerencias(q), 280);
  }

  /** AW6 — pide sugerencias fuzzy al servidor y las mapea a la lista precargada. */
  private async buscarSugerencias(q: string) {
    if (this.planos().length > 0) {
      this.sugerencias.set([]);
      return;
    }
    this.buscandoSug.set(true);
    try {
      const { data } = await this.supabase.client.rpc('buscar_articulos', { p_query: q, p_limit: 8 });
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      const byId = new Map(this.articulos().map((a) => [a.id, a]));
      const visibles = new Set(this.grupos().flatMap((g) => g.articulos.map((a) => a.id)));
      const arts = ids
        .map((id) => byId.get(id))
        .filter((a): a is Articulo => !!a && visibles.has(a.id));
      // Ignora respuestas obsoletas (la query cambió mientras tanto).
      if (this.query().trim() === q) this.sugerencias.set(arts);
    } catch {
      this.sugerencias.set([]);
    } finally {
      this.buscandoSug.set(false);
    }
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
