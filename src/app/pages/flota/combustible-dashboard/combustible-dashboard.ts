import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CombustibleService } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { AvisosFlotaService } from '../../../../shared/services/avisos-flota.service';
import { FlotaConfigService } from '../../../../shared/services/flota-config.service';
import { RegistroCombustible } from '../../../../shared/models/combustible.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { AvisoFlota, AVISO_TIPO_LABEL, AVISO_SEVERIDAD_BADGE } from '../../../../shared/models/aviso-flota.model';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';

type Vista = 'vehiculo' | 'flotilla';
type EstadoVeh = 'NORMAL' | 'REVISAR' | 'ALERTA';

interface ResumenVehiculo {
  vehiculo: Vehiculo;
  echadas: number;
  galones: number;
  gastado: number;
  km: number;
  rendimiento: number | null;
  costoKm: number | null;
  estado: EstadoVeh;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

@Component({
  selector: 'app-combustible-dashboard',
  imports: [DecimalPipe, RouterLink, BarChart, Skeleton],
  templateUrl: './combustible-dashboard.html',
  styleUrl: './combustible-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CombustibleDashboard implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private avisosService = inject(AvisosFlotaService);
  private flotaConfig = inject(FlotaConfigService);

  formatFecha = formatFechaDisplay;
  tipoLabel = AVISO_TIPO_LABEL;
  sevBadge = AVISO_SEVERIDAD_BADGE;

  registros = signal<RegistroCombustible[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  avisos = signal<AvisoFlota[]>([]);
  loading = signal(true);
  error = signal('');

  vista = signal<Vista>('vehiculo');
  meses = signal(6);
  selectedVehiculoId = signal('');

  /** Registros v2 (con galones) dentro del rango de meses seleccionado. */
  private enRango = computed(() => {
    const desde = this.desdeIso();
    return this.registros().filter((r) => r.galones != null && r.fecha >= desde);
  });

  private desdeIso = computed(() => {
    const d = new Date(todayIso() + 'T00:00:00');
    d.setMonth(d.getMonth() - this.meses());
    return d.toISOString().slice(0, 10);
  });

  // ── Por vehículo ─────────────────────────────────────────
  echadasVehiculo = computed(() => {
    const vId = this.selectedVehiculoId();
    return this.enRango()
      .filter((r) => r.vehiculo_id === vId)
      .sort((a, b) => (a.kilometraje ?? 0) - (b.kilometraje ?? 0));
  });

  vehiculoStats = computed(() => {
    const e = this.echadasVehiculo();
    const gastado = e.reduce((s, r) => s + (r.monto ?? 0), 0);
    const galones = e.reduce((s, r) => s + (r.galones ?? 0), 0);
    const km = e.reduce((s, r) => s + (r.km_recorridos ?? 0), 0);
    const rends = e.filter((r) => r.rendimiento_km_gal != null).map((r) => r.rendimiento_km_gal as number);
    const rendimiento = rends.length ? rends.reduce((a, b) => a + b, 0) / rends.length : null;
    const costoKm = km > 0 ? gastado / km : null;
    return { gastado, galones, km, rendimiento, costoKm, echadas: e.length };
  });

  /** Alerta si las últimas 3 echadas rinden < 80% del promedio del período. */
  alertaVehiculo = computed(() => {
    const e = this.echadasVehiculo().filter((r) => r.rendimiento_km_gal != null);
    if (e.length < 4) return false;
    const prom = this.vehiculoStats().rendimiento;
    if (prom == null) return false;
    const ultimas3 = e.slice(-3).map((r) => r.rendimiento_km_gal as number);
    const promUlt = ultimas3.reduce((a, b) => a + b, 0) / ultimas3.length;
    return promUlt < prom * (1 - this.flotaConfig.umbralConsumoPct() / 100);
  });

  rendimientoChart = computed<BarDatum[]>(() =>
    this.echadasVehiculo()
      .filter((r) => r.rendimiento_km_gal != null)
      .map((r) => ({
        label: this.fechaCorta(r.fecha),
        value: Math.round((r.rendimiento_km_gal as number) * 10) / 10,
        color: r.alerta_consumo ? 'var(--sgc-danger)' : 'var(--sgc-primary)',
      })),
  );

  gastoMensualVehiculoChart = computed<BarDatum[]>(() => this.gastoMensual(this.echadasVehiculo()));

  // ── Flotilla ─────────────────────────────────────────────
  flotaStats = computed(() => {
    const e = this.enRango();
    const gastado = e.reduce((s, r) => s + (r.monto ?? 0), 0);
    const galones = e.reduce((s, r) => s + (r.galones ?? 0), 0);
    const km = e.reduce((s, r) => s + (r.km_recorridos ?? 0), 0);
    const costoKm = km > 0 ? gastado / km : null;
    const alertas = this.avisos().filter((a) => a.estado === 'pendiente').length;
    return { gastado, galones, km, costoKm, alertas };
  });

  resumenPorVehiculo = computed<ResumenVehiculo[]>(() => {
    const byVeh = new Map<string, RegistroCombustible[]>();
    for (const r of this.enRango()) {
      const list = byVeh.get(r.vehiculo_id) ?? [];
      list.push(r);
      byVeh.set(r.vehiculo_id, list);
    }
    const alertaVehIds = new Set(
      this.avisos()
        .filter((a) => a.estado === 'pendiente' && a.tipo === 'consumo_anormal' && a.vehiculo_id)
        .map((a) => a.vehiculo_id as string),
    );
    const out: ResumenVehiculo[] = [];
    for (const v of this.vehiculos()) {
      const e = byVeh.get(v.id);
      if (!e || e.length === 0) continue;
      const gastado = e.reduce((s, r) => s + (r.monto ?? 0), 0);
      const galones = e.reduce((s, r) => s + (r.galones ?? 0), 0);
      const km = e.reduce((s, r) => s + (r.km_recorridos ?? 0), 0);
      const rends = e.filter((r) => r.rendimiento_km_gal != null).map((r) => r.rendimiento_km_gal as number);
      const rendimiento = rends.length ? rends.reduce((a, b) => a + b, 0) / rends.length : null;
      const costoKm = km > 0 ? gastado / km : null;
      const tieneAlerta = alertaVehIds.has(v.id) || e.some((r) => r.alerta_consumo);
      const ordenados = [...e].sort((a, b) => (a.kilometraje ?? 0) - (b.kilometraje ?? 0));
      const ultimoRend = ordenados.filter((r) => r.rendimiento_km_gal != null).at(-1)?.rendimiento_km_gal ?? null;
      let estado: EstadoVeh = 'NORMAL';
      if (tieneAlerta) estado = 'ALERTA';
      // Estado "REVISAR": umbral suave e independiente (no es el umbral de consumo configurable).
      else if (rendimiento != null && ultimoRend != null && ultimoRend < rendimiento * 0.9) estado = 'REVISAR';
      out.push({ vehiculo: v, echadas: e.length, galones, gastado, km, rendimiento, costoKm, estado });
    }
    return out.sort((a, b) => b.gastado - a.gastado);
  });

  alertasActivas = computed(() => this.avisos().filter((a) => a.estado === 'pendiente'));

  gastoMensualFlotaChart = computed<BarDatum[]>(() => this.gastoMensual(this.enRango()));

  estadoBadge(e: EstadoVeh): string {
    return e === 'ALERTA' ? 'danger' : e === 'REVISAR' ? 'warning' : 'success';
  }

  async ngOnInit() {
    this.loading.set(true);
    try {
      const [registros, vehiculos, avisos] = await Promise.all([
        this.combustibleService.getAll(),
        this.vehiculosService.getAll(),
        this.avisosService.getActivas(),
      ]);
      this.registros.set(registros);
      this.vehiculos.set(vehiculos);
      this.avisos.set(avisos);
      // Preselecciona el vehículo con más echadas v2.
      const conDatos = this.resumenPorVehiculo();
      this.selectedVehiculoId.set(conDatos[0]?.vehiculo.id ?? vehiculos[0]?.id ?? '');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los datos.');
    } finally {
      this.loading.set(false);
    }
  }

  setVista(v: Vista) { this.vista.set(v); }
  onVehiculoChange(v: string) { this.selectedVehiculoId.set(v); }
  onMesesChange(v: string) { this.meses.set(Number(v)); }

  selectedVehiculo = computed(() => this.vehiculos().find((v) => v.id === this.selectedVehiculoId()) ?? null);

  // ── Helpers ──────────────────────────────────────────────
  private fechaCorta(fecha: string): string {
    const [, m, d] = fecha.split('-');
    return `${d}/${m}`;
  }

  private gastoMensual(regs: RegistroCombustible[]): BarDatum[] {
    const byMonth = new Map<string, number>();
    for (const r of regs) {
      const ym = r.fecha.slice(0, 7);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + (r.monto ?? 0));
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, total]) => {
        const [, mm] = ym.split('-');
        return { label: MESES[Number(mm) - 1] ?? ym, value: Math.round(total) };
      });
  }
}
