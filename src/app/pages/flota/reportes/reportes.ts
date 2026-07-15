import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { daysAgoIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';

interface VehiculoReport {
  id: string;
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  estado: string;
  kilometraje: number;
  activo: boolean;
}

interface MantenimientoReport {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string; modelo: string };
  tipo: string;
  descripcion: string;
  fecha: string;
  costo: number | null;
  estado: string;
}

interface CombustibleReport {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string };
  fecha: string;
  // v1 (litros/total) y v2 (galones/monto) coexisten; v2 deja litros/total en null.
  litros: number | null;
  total: number | null;
  galones: number | null;
  monto: number | null;
  kilometraje: number | null;
}

interface CombustiblePorVehiculo {
  placa: string;
  marca: string;
  litros: number;
  gasto: number;
}

@Component({
  selector: 'app-flota-reportes',
  imports: [DecimalPipe, TitleCasePipe, Skeleton],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlotaReportes implements OnInit {
  private supabase = inject(SupabaseService);

  formatFecha = formatFechaDisplay;

  vehiculos = signal<VehiculoReport[]>([]);
  mantenimientos = signal<MantenimientoReport[]>([]);
  combustible = signal<CombustibleReport[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Summary computed ──────────────────────────────────────
  totalActivos = computed(() => this.vehiculos().filter((v) => v.activo && v.estado === 'activo').length);
  enMantenimiento = computed(() => this.vehiculos().filter((v) => v.estado === 'mantenimiento').length);

  mantenimientosEsteMes = computed(() => {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.mantenimientos().filter((m) => m.fecha.slice(0, 7) === currentYearMonth).length;
  });

  gastoCombustibleMes = computed(() => {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.combustible()
      .filter((r) => r.fecha.slice(0, 7) === currentYearMonth)
      // v2 guarda el gasto en `monto` (galones); legacy usaba `total` (litros).
      .reduce((sum, r) => sum + (r.monto ?? r.total ?? 0), 0);
  });

  // ── Section data computed ─────────────────────────────────
  flotaOrdenada = computed(() =>
    [...this.vehiculos()].sort((a, b) => {
      const order: Record<string, number> = { activo: 0, mantenimiento: 1, baja: 2 };
      return (order[a.estado] ?? 3) - (order[b.estado] ?? 3);
    }),
  );

  mantenimientosRecientes = computed(() =>
    [...this.mantenimientos()].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 10),
  );

  mantenimientosPendientes = computed(() =>
    this.mantenimientos()
      .filter((m) => m.estado === 'pendiente')
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
  );

  combustiblePorVehiculo = computed((): CombustiblePorVehiculo[] => {
    const hace30Str = daysAgoIso(30);
    const recientes = this.combustible().filter((r) => r.fecha >= hace30Str);

    const map = new Map<string, CombustiblePorVehiculo>();
    for (const r of recientes) {
      const placa = r.vehiculo?.placa ?? r.vehiculo_id;
      const marca = r.vehiculo?.marca ?? '';
      if (!map.has(placa)) {
        map.set(placa, { placa, marca, litros: 0, gasto: 0 });
      }
      const entry = map.get(placa)!;
      // v2 usa galones/monto; legacy usaba litros/total. Prioriza v2.
      entry.litros += r.galones ?? r.litros ?? 0;
      entry.gasto += r.monto ?? r.total ?? 0;
    }
    return [...map.values()].sort((a, b) => b.gasto - a.gasto);
  });

  totalCombustibleLitros = computed(() =>
    this.combustiblePorVehiculo().reduce((s, r) => s + r.litros, 0),
  );
  totalCombustibleGasto = computed(() =>
    this.combustiblePorVehiculo().reduce((s, r) => s + r.gasto, 0),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [vRes, mRes, cRes] = await Promise.all([
        this.supabase.client.from('vehiculos').select('*').order('placa'),
        this.supabase.client
          .from('mantenimientos')
          .select('*, vehiculo:vehiculos(placa,marca,modelo)')
          .order('fecha', { ascending: false }),
        this.supabase.client
          .from('registros_combustible')
          .select('*, vehiculo:vehiculos(placa,marca)')
          .order('fecha', { ascending: false }),
      ]);

      if (vRes.error) throw new Error(vRes.error.message);
      if (mRes.error) throw new Error(mRes.error.message);
      if (cRes.error) throw new Error(cRes.error.message);

      this.vehiculos.set((vRes.data ?? []) as unknown as VehiculoReport[]);
      this.mantenimientos.set((mRes.data ?? []) as unknown as MantenimientoReport[]);
      this.combustible.set((cRes.data ?? []) as unknown as CombustibleReport[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al cargar reportes.';
      if (!msg.includes('does not exist') && !msg.includes('relation')) {
        this.error.set(msg);
      }
    } finally {
      this.loading.set(false);
    }
  }

  getEstadoBadge(estado: string): string {
    if (estado === 'activo') return 'success';
    if (estado === 'mantenimiento') return 'warning';
    if (estado === 'en_proceso') return 'info';
    if (estado === 'completado') return 'success';
    if (estado === 'pendiente') return 'warning';
    return 'neutral';
  }

  getTipoLabel(tipo: string): string {
    const map: Record<string, string> = {
      camion: 'Camión', pickup: 'Pickup', excavadora: 'Excavadora',
      retroexcavadora: 'Retroexcavadora', bulldozer: 'Bulldozer',
      grua: 'Grúa', mixer: 'Mixer', compactadora: 'Compactadora',
      montacargas: 'Montacargas', otro: 'Otro',
    };
    return map[tipo] ?? tipo;
  }
}
