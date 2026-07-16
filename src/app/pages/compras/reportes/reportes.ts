import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DecimalPipe, CurrencyPipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcelHojas } from '../../../../shared/utils/exportar-excel.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

interface OrdenReport {
  id: string;
  numero: string;
  proveedor?: { nombre: string };
  estado: string;
  fecha: string;
  total: number;
}

interface ProveedorReport {
  id: string;
  nombre: string;
  activo: boolean;
}

interface ProveedorStat {
  nombre: string;
  ordenes: number;
  total: number;
}

@Component({
  selector: 'app-compras-reportes',
  imports: [DecimalPipe, Skeleton],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComprasReportes implements OnInit {
  private supabase = inject(SupabaseService);

  formatFecha = formatFechaDisplay;

  ordenes = signal<OrdenReport[]>([]);
  proveedores = signal<ProveedorReport[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Summary computed ──────────────────────────────────────
  totalOrdenes = computed(() => this.ordenes().length);

  ordenesAprobadas = computed(
    () =>
      this.ordenes().filter(
        (o) => o.estado === 'aprobada' || o.estado === 'recibida' || o.estado === 'recibida_parcial',
      ).length,
  );

  ordenesMes = computed(() => {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.ordenes().filter((o) => o.fecha.slice(0, 7) === currentYearMonth).length;
  });

  totalGasto = computed(() =>
    this.ordenes()
      .filter(
        (o) => o.estado === 'aprobada' || o.estado === 'recibida' || o.estado === 'recibida_parcial',
      )
      .reduce((s, o) => s + (o.total ?? 0), 0),
  );

  // ── Section data ──────────────────────────────────────────
  ordenesByEstado = computed(() => {
    const map: Record<string, number> = {};
    for (const o of this.ordenes()) {
      map[o.estado] = (map[o.estado] ?? 0) + 1;
    }
    return Object.entries(map).map(([estado, count]) => ({ estado, count }));
  });

  topProveedores = computed((): ProveedorStat[] => {
    const map = new Map<string, ProveedorStat>();
    for (const o of this.ordenes()) {
      const nombre = o.proveedor?.nombre ?? 'Desconocido';
      if (!map.has(nombre)) map.set(nombre, { nombre, ordenes: 0, total: 0 });
      const p = map.get(nombre)!;
      p.ordenes++;
      p.total += o.total ?? 0;
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  });

  ordenesRecientes = computed(() =>
    [...this.ordenes()].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 10),
  );

  proveedoresActivos = computed(() => this.proveedores().filter((p) => p.activo).length);

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [oRes, pRes] = await Promise.all([
        this.supabase.client
          .from('ordenes_compra')
          .select('id, numero, proveedor:proveedores(nombre), estado, fecha, total')
          .order('fecha', { ascending: false }),
        this.supabase.client.from('proveedores').select('id, nombre, activo'),
      ]);

      if (oRes.error) throw new Error(oRes.error.message);
      if (pRes.error) throw new Error(pRes.error.message);

      this.ordenes.set((oRes.data ?? []) as unknown as OrdenReport[]);
      this.proveedores.set((pRes.data ?? []) as unknown as ProveedorReport[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al cargar datos.';
      if (!msg.includes('does not exist') && !msg.includes('relation')) {
        this.error.set(msg);
      }
    } finally {
      this.loading.set(false);
    }
  }

  // ── Exportar Excel (resumen de compras) ──────────────────
  async exportarExcelResumen() {
    const resumen = [
      { Métrica: 'Total de órdenes', Valor: this.totalOrdenes() },
      { Métrica: 'Órdenes aprobadas/recibidas', Valor: this.ordenesAprobadas() },
      { Métrica: 'Órdenes este mes', Valor: this.ordenesMes() },
      { Métrica: 'Gasto total (RD$)', Valor: this.totalGasto() },
      { Métrica: 'Proveedores activos', Valor: this.proveedoresActivos() },
    ];
    const porEstado = this.ordenesByEstado().map((e) => ({
      Estado: this.getEstadoLabel(e.estado),
      Órdenes: e.count,
    }));
    const porProveedor = this.topProveedores().map((p) => ({
      Proveedor: p.nombre,
      Órdenes: p.ordenes,
      'Total (RD$)': p.total,
    }));
    const recientes = this.ordenesRecientes().map((o) => ({
      Número: o.numero,
      Proveedor: o.proveedor?.nombre ?? '',
      Estado: this.getEstadoLabel(o.estado),
      Fecha: this.formatFecha(o.fecha),
      'Total (RD$)': o.total,
    }));
    await exportarExcelHojas('reporte-compras', [
      { nombre: 'Resumen', filas: resumen },
      { nombre: 'Por estado', filas: porEstado },
      { nombre: 'Por proveedor', filas: porProveedor },
      { nombre: 'Órdenes recientes', filas: recientes },
    ]);
  }

  getEstadoBadge(estado: string): string {
    const map: Record<string, string> = {
      borrador: 'neutral',
      aprobada: 'info',
      recibida_parcial: 'warning',
      recibida: 'success',
      cancelada: 'danger',
    };
    return map[estado] ?? 'neutral';
  }

  getEstadoLabel(estado: string): string {
    const map: Record<string, string> = {
      borrador: 'Borrador',
      aprobada: 'Aprobada',
      recibida_parcial: 'Recibida parcial',
      recibida: 'Recibida',
      cancelada: 'Cancelada',
    };
    return map[estado] ?? estado;
  }
}
