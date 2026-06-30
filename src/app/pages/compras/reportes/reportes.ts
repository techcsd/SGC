import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DecimalPipe, DatePipe, CurrencyPipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';

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
  categoria: string | null;
  activo: boolean;
}

interface ProveedorStat {
  nombre: string;
  ordenes: number;
  total: number;
}

@Component({
  selector: 'app-compras-reportes',
  imports: [DecimalPipe, DatePipe],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComprasReportes implements OnInit {
  private supabase = inject(SupabaseService);

  ordenes = signal<OrdenReport[]>([]);
  proveedores = signal<ProveedorReport[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Summary computed ──────────────────────────────────────
  totalOrdenes = computed(() => this.ordenes().length);

  ordenesAprobadas = computed(
    () => this.ordenes().filter((o) => o.estado === 'aprobada' || o.estado === 'recibida').length,
  );

  ordenesMes = computed(() => {
    const now = new Date();
    return this.ordenes().filter((o) => {
      const d = new Date(o.fecha);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  });

  totalGasto = computed(() =>
    this.ordenes()
      .filter((o) => o.estado === 'aprobada' || o.estado === 'recibida')
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
    [...this.ordenes()]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 10),
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
        this.supabase.client.from('proveedores').select('id, nombre, categoria, activo'),
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

  getEstadoBadge(estado: string): string {
    const map: Record<string, string> = {
      borrador: 'neutral',
      aprobada: 'info',
      recibida: 'success',
      cancelada: 'danger',
    };
    return map[estado] ?? 'neutral';
  }

  getEstadoLabel(estado: string): string {
    const map: Record<string, string> = {
      borrador: 'Borrador',
      aprobada: 'Aprobada',
      recibida: 'Recibida',
      cancelada: 'Cancelada',
    };
    return map[estado] ?? estado;
  }
}
