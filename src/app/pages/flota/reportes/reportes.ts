import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { daysAgoIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcelHojas } from '../../../../shared/utils/exportar-excel.util';

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
  vehiculo_id: string;
  placa: string;
  marca: string;
  litros: number;
  gasto: number;
}

/** R4a — placa denormalizada (incluye inactivos) resuelta vía RPC flota_placas. */
interface PlacaInfo {
  id: string;
  placa: string;
  marca: string;
  modelo: string;
  activo: boolean;
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
  private router = inject(Router);

  // X6 — etiqueta legible del tipo de visita a taller.
  tipoMantLabel(tipo: string): string {
    return (
      {
        preventivo: 'Preventivo',
        falla: 'Falla/avería',
        accidente_dano: 'Accidente/daño',
        cambio_pieza: 'Cambio de pieza',
      }[tipo] ?? tipo
    );
  }

  formatFecha = formatFechaDisplay;

  // R4b — filas clicables: todo abre su origen (regla del jefe).
  irAVehiculo(vehiculoId: string | null | undefined) {
    if (vehiculoId && this.placaMap().get(vehiculoId)) {
      this.router.navigate(['/flota/vehiculos', vehiculoId]);
    }
  }
  irAMantenimientosDe(vehiculoId: string | null | undefined) {
    if (vehiculoId) this.router.navigate(['/flota/mantenimientos'], { queryParams: { vehiculo: vehiculoId } });
  }

  // Regla del jefe: las 4 tarjetas de resumen abren su listado de origen.
  irAVehiculos() { this.router.navigate(['/flota/vehiculos']); }
  irAMantenimientos() { this.router.navigate(['/flota/mantenimientos']); }
  irACombustible() { this.router.navigate(['/flota/combustible']); }

  vehiculos = signal<VehiculoReport[]>([]);
  mantenimientos = signal<MantenimientoReport[]>([]);
  combustible = signal<CombustibleReport[]>([]);
  // R4a — mapa id→placa de TODOS los vehículos (incl. inactivos) vía RPC.
  private placaMap = signal<Map<string, PlacaInfo>>(new Map());
  loading = signal(true);
  error = signal('');

  /** R4a — placa legible desde un vehiculo_id (nunca el UUID). */
  resolverPlaca(vehiculoId: string | null | undefined, embedded?: string | null): string {
    if (embedded) return embedded;
    if (!vehiculoId) return '—';
    return this.placaMap().get(vehiculoId)?.placa ?? 'Vehículo desactivado';
  }
  resolverMarca(vehiculoId: string | null | undefined, embedded?: string | null): string {
    if (embedded) return embedded;
    return (vehiculoId && this.placaMap().get(vehiculoId)?.marca) || '';
  }

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
  // P6 — inactivos (activo=false) al final; entre activos, por estado.
  flotaOrdenada = computed(() =>
    [...this.vehiculos()].sort((a, b) => {
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
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

    // R4a — agrupa por vehiculo_id (estable) y resuelve la placa legible (nunca UUID).
    const map = new Map<string, CombustiblePorVehiculo>();
    for (const r of recientes) {
      const key = r.vehiculo_id;
      if (!map.has(key)) {
        map.set(key, {
          vehiculo_id: key,
          placa: this.resolverPlaca(r.vehiculo_id, r.vehiculo?.placa),
          marca: this.resolverMarca(r.vehiculo_id, r.vehiculo?.marca),
          litros: 0,
          gasto: 0,
        });
      }
      const entry = map.get(key)!;
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
      const [vRes, mRes, cRes, pRes] = await Promise.all([
        this.supabase.client.from('vehiculos').select('*').order('placa'),
        this.supabase.client
          .from('mantenimientos')
          .select('*, vehiculo:vehiculos(placa,marca,modelo)')
          .order('fecha', { ascending: false }),
        this.supabase.client
          .from('registros_combustible')
          .select('*, vehiculo:vehiculos(placa,marca)')
          .order('fecha', { ascending: false }),
        // R4a — placas denormalizadas (incluye vehículos inactivos) para no pintar UUID.
        this.supabase.client.rpc('flota_placas'),
      ]);

      if (vRes.error) throw new Error(vRes.error.message);
      if (mRes.error) throw new Error(mRes.error.message);
      if (cRes.error) throw new Error(cRes.error.message);

      if (!pRes.error && Array.isArray(pRes.data)) {
        this.placaMap.set(new Map((pRes.data as PlacaInfo[]).map((p) => [p.id, p])));
      }
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

  /**
   * Exporta el reporte de flota a Excel. Al ser un reporte con varias secciones,
   * se genera un libro con una hoja por sección (flota, mantenimientos y
   * combustible de los últimos 30 días), aplanadas a columnas legibles.
   */
  async exportar() {
    const flota = this.flotaOrdenada().map((v) => ({
      Placa: v.placa,
      Tipo: this.getTipoLabel(v.tipo),
      Marca: v.marca,
      Modelo: v.modelo,
      Estado: v.estado,
      Km: v.kilometraje,
      Activo: v.activo ? 'Sí' : 'No',
    }));
    const mantenimientos = this.mantenimientos().map((m) => ({
      Fecha: this.formatFecha(m.fecha),
      Vehículo: m.vehiculo?.placa ?? '',
      Tipo: m.tipo,
      Estado: m.estado,
      Costo: m.costo ?? '',
      Descripción: m.descripcion,
    }));
    const combustible = this.combustiblePorVehiculo().map((c) => ({
      Placa: c.placa,
      Marca: c.marca,
      'Galones / litros': c.litros,
      'Gasto (RD$)': c.gasto,
    }));
    await exportarExcelHojas('reporte-flota', [
      { nombre: 'Flota', filas: flota },
      { nombre: 'Mantenimientos', filas: mantenimientos },
      { nombre: 'Combustible 30 días', filas: combustible },
    ]);
  }

  getEstadoBadge(estado: string): string {
    if (estado === 'activo') return 'success';
    if (estado === 'mantenimiento') return 'warning';
    if (estado === 'en_proceso') return 'info';
    if (estado === 'completado') return 'success';
    if (estado === 'pendiente') return 'warning';
    return 'neutral';
  }

  /**
   * P6 — el badge de un vehículo reconcilia `activo` y `estado`: si está
   * desactivado (`activo=false`) manda "Desactivado"; si no, se usa `estado`.
   */
  vehiculoBadge(v: VehiculoReport): string {
    return v.activo ? this.getEstadoBadge(v.estado) : 'neutral';
  }
  vehiculoEstadoLabel(v: VehiculoReport): string {
    if (!v.activo) return 'Desactivado';
    if (v.estado === 'activo') return 'Activo';
    if (v.estado === 'mantenimiento') return 'Mantenimiento';
    return 'Baja';
  }

  getTipoLabel(tipo: string): string {
    const map: Record<string, string> = {
      motocicleta: 'Motocicleta', automovil: 'Automóvil / Sedán', suv: 'SUV / Jeepeta',
      camion: 'Camión', pickup: 'Pickup', excavadora: 'Excavadora',
      retroexcavadora: 'Retroexcavadora', bulldozer: 'Bulldozer',
      grua: 'Grúa', mixer: 'Mixer', compactadora: 'Compactadora',
      montacargas: 'Montacargas', otro: 'Otro',
    };
    return map[tipo] ?? tipo;
  }
}
