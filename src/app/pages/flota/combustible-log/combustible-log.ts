import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CombustibleService, LogCombustibleRow } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

/**
 * AF17 — Registro/log de echadas para admin y roles elevados. Sirve para detectar
 * kilometrajes irreales: muestra el delta de km vs la echada anterior, quién
 * registró cada echada y resalta los saltos fuera de umbral (km_alerta).
 */
@Component({
  selector: 'app-combustible-log',
  imports: [DecimalPipe, RouterLink, Skeleton, DateRangeFilter],
  templateUrl: './combustible-log.html',
  styleUrl: './combustible-log.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CombustibleLog implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);

  formatFecha = formatFechaDisplay;

  rows = signal<LogCombustibleRow[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  usuarios = signal<{ id: string; nombre: string }[]>([]);
  loading = signal(true);
  error = signal('');

  // Filtros
  vehiculoId = signal('');
  usuarioId = signal('');
  desde = signal('');
  hasta = signal('');

  saltos = computed(() => this.rows().filter((r) => r.km_alerta).length);

  async ngOnInit() {
    try {
      const [vehiculos, usuarios] = await Promise.all([
        this.vehiculosService.getAll(),
        this.conductoresService.getUsuariosVinculables().catch(() => []),
      ]);
      this.vehiculos.set(vehiculos);
      this.usuarios.set(usuarios);
    } catch { /* filtros opcionales */ }
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const rows = await this.combustibleService.getLog({
        desde: this.desde() || null,
        hasta: this.hasta() || null,
        vehiculoId: this.vehiculoId() || null,
        usuarioId: this.usuarioId() || null,
      });
      this.rows.set(rows);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el registro.');
    } finally {
      this.loading.set(false);
    }
  }

  onRango(r: RangoFecha) {
    this.desde.set(r.desde ?? '');
    this.hasta.set(r.hasta ?? '');
    this.cargar();
  }
  onVehiculo(v: string) { this.vehiculoId.set(v); this.cargar(); }
  onUsuario(v: string) { this.usuarioId.set(v); this.cargar(); }
  limpiar() {
    this.vehiculoId.set(''); this.usuarioId.set(''); this.desde.set(''); this.hasta.set('');
    this.cargar();
  }

  productoLabel(r: LogCombustibleRow): string {
    if (!r.producto) return '—';
    const sub = r.subtipo ? ` ${r.subtipo}` : '';
    return `${r.producto}${sub}`;
  }

  async exportar() {
    const rows = this.rows().map((r) => ({
      Fecha: this.formatFecha(r.fecha),
      Vehículo: r.placa ?? '',
      Lectura: r.kilometraje ?? '',
      'Δ km': r.km_recorridos ?? '',
      Galones: r.galones ?? '',
      Monto: r.monto ?? '',
      Combustible: this.productoLabel(r),
      Registró: r.registrado_nombre ?? '',
      Conductor: r.conductor_nombre ?? '',
      'Salto km': r.km_alerta ? 'SÍ' : '',
    }));
    await exportarExcel('registro-combustible', rows);
  }
}
