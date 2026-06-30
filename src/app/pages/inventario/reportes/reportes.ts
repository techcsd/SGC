import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DecimalPipe, DatePipe, CurrencyPipe } from '@angular/common';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { StockService } from '../../../../shared/services/stock.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Articulo } from '../../../../shared/models/articulo.model';
import { StockPorBodega } from '../../../../shared/models/stock.model';
import { Categoria } from '../../../../shared/models/categoria.model';

interface EntradaRow {
  id: string;
  created_at: string;
  cantidad: number;
  articulo: { nombre: string; codigo: string } | null;
  bodega: { nombre: string } | null;
}

interface SalidaRow {
  id: string;
  created_at: string;
  cantidad: number;
  articulo: { nombre: string; codigo: string } | null;
  bodega: { nombre: string } | null;
}

interface CategoriaStat {
  nombre: string;
  articulosCount: number;
  stockTotal: number;
}

interface ArticuloCritico {
  codigo: string;
  nombre: string;
  stockMinimo: number;
  stockActual: number;
  diferencia: number;
}

interface TopArticulo {
  nombre: string;
  codigo: string;
  totalEntradas: number;
  totalSalidas: number;
}

@Component({
  selector: 'app-reportes',
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DatePipe, CurrencyPipe],
})
export class Reportes implements OnInit {
  private articulosService = inject(ArticulosService);
  private stockService = inject(StockService);
  private categoriasService = inject(CategoriasService);
  private supabase = inject(SupabaseService);

  loading = signal(true);
  error = signal<string | null>(null);

  private articulos = signal<Articulo[]>([]);
  private stockMap = signal<Map<string, number>>(new Map());
  private categorias = signal<Categoria[]>([]);
  private entradas = signal<EntradaRow[]>([]);
  private salidas = signal<SalidaRow[]>([]);
  private allEntradas = signal<{ articulo_id: string; cantidad: number }[]>([]);
  private allSalidas = signal<{ articulo_id: string; cantidad: number }[]>([]);

  // ── Summary cards ────────────────────────────────────────
  totalActivos = computed(() =>
    this.articulos().filter((a) => a.activo).length
  );

  stockBajo = computed(() => {
    const map = this.stockMap();
    return this.articulos().filter((a) => {
      const stock = map.get(a.id) ?? 0;
      return a.activo && stock <= a.stock_minimo;
    }).length;
  });

  sinStock = computed(() => {
    const map = this.stockMap();
    return this.articulos().filter((a) => {
      const stock = map.get(a.id) ?? 0;
      return a.activo && stock === 0;
    }).length;
  });

  valorTotal = computed(() => {
    const map = this.stockMap();
    return this.articulos().reduce((sum, a) => {
      if (a.precio_estimado == null) return sum;
      const stock = map.get(a.id) ?? 0;
      return sum + stock * a.precio_estimado;
    }, 0);
  });

  // ── Section 1: Stock por categoría ───────────────────────
  categoriaStats = computed((): CategoriaStat[] => {
    const map = this.stockMap();
    const cats = this.categorias();
    const arts = this.articulos();

    const stats = new Map<number, CategoriaStat>();
    for (const cat of cats) {
      stats.set(cat.id, { nombre: cat.nombre, articulosCount: 0, stockTotal: 0 });
    }

    for (const art of arts) {
      const entry = stats.get(art.categoria_id);
      if (!entry) continue;
      entry.articulosCount++;
      entry.stockTotal += map.get(art.id) ?? 0;
    }

    return [...stats.values()]
      .filter((s) => s.articulosCount > 0)
      .sort((a, b) => b.articulosCount - a.articulosCount);
  });

  // ── Section 2: Artículos críticos ────────────────────────
  articulosCriticos = computed((): ArticuloCritico[] => {
    const map = this.stockMap();
    return this.articulos()
      .filter((a) => {
        const stock = map.get(a.id) ?? 0;
        return a.activo && stock <= a.stock_minimo;
      })
      .map((a) => ({
        codigo: a.codigo,
        nombre: a.nombre,
        stockMinimo: a.stock_minimo,
        stockActual: map.get(a.id) ?? 0,
        diferencia: (map.get(a.id) ?? 0) - a.stock_minimo,
      }))
      .sort((a, b) => a.diferencia - b.diferencia);
  });

  // ── Section 4: Top 10 más movidos ────────────────────────
  topArticulos = computed((): TopArticulo[] => {
    const artMap = new Map<string, TopArticulo>();

    for (const art of this.articulos()) {
      artMap.set(art.id, {
        nombre: art.nombre,
        codigo: art.codigo,
        totalEntradas: 0,
        totalSalidas: 0,
      });
    }

    for (const e of this.allEntradas()) {
      const entry = artMap.get(e.articulo_id);
      if (entry) entry.totalEntradas += e.cantidad;
    }

    for (const s of this.allSalidas()) {
      const entry = artMap.get(s.articulo_id);
      if (entry) entry.totalSalidas += s.cantidad;
    }

    return [...artMap.values()]
      .filter((a) => a.totalEntradas > 0 || a.totalSalidas > 0)
      .sort((a, b) => b.totalEntradas + b.totalSalidas - (a.totalEntradas + a.totalSalidas))
      .slice(0, 10);
  });

  async ngOnInit(): Promise<void> {
    try {
      const [articulos, stock, categorias] = await Promise.all([
        this.articulosService.getAll(),
        this.stockService.getAll(),
        this.categoriasService.getAll(),
      ]);

      this.articulos.set(articulos);
      this.stockMap.set(this.stockService.buildTotalMap(stock));
      this.categorias.set(categorias);

      const [entradasRes, salidasRes, allEntradasRes, allSalidasRes] = await Promise.all([
        this.supabase.client
          .from('entradas_inventario')
          .select('*, articulo:articulos(nombre,codigo), bodega:bodegas(nombre)')
          .order('created_at', { ascending: false })
          .limit(10),
        this.supabase.client
          .from('salidas_inventario')
          .select('*, articulo:articulos(nombre,codigo), bodega:bodegas(nombre)')
          .order('created_at', { ascending: false })
          .limit(10),
        this.supabase.client
          .from('entradas_inventario')
          .select('articulo_id, cantidad'),
        this.supabase.client
          .from('salidas_inventario')
          .select('articulo_id, cantidad'),
      ]);

      if (entradasRes.error) throw new Error(entradasRes.error.message);
      if (salidasRes.error) throw new Error(salidasRes.error.message);
      if (allEntradasRes.error) throw new Error(allEntradasRes.error.message);
      if (allSalidasRes.error) throw new Error(allSalidasRes.error.message);

      this.entradas.set((entradasRes.data ?? []) as unknown as EntradaRow[]);
      this.salidas.set((salidasRes.data ?? []) as unknown as SalidaRow[]);
      this.allEntradas.set(
        (allEntradasRes.data ?? []) as unknown as { articulo_id: string; cantidad: number }[]
      );
      this.allSalidas.set(
        (allSalidasRes.data ?? []) as unknown as { articulo_id: string; cantidad: number }[]
      );
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error al cargar reportes');
    } finally {
      this.loading.set(false);
    }
  }

  entradasList = this.entradas.asReadonly();
  salidasList = this.salidas.asReadonly();
}
