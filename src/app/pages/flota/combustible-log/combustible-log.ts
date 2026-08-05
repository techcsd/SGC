import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CombustibleService, LogCombustibleRow } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { RegistroCombustible, PRODUCTO_CANONICO_LABEL, RENDIMIENTO_ESTADO_META } from '../../../../shared/models/combustible.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

/**
 * AF17 — Registro/log de echadas para admin y roles elevados. Sirve para detectar
 * kilometrajes irreales: muestra el delta de km vs la echada anterior, quién
 * registró cada echada y resalta los saltos fuera de umbral (km_alerta).
 */
@Component({
  selector: 'app-combustible-log',
  imports: [DecimalPipe, RouterLink, Skeleton, DateRangeFilter, FormDrawer, Lightbox],
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

  // ── AG6 — detalle clicable de la echada (con estación + 3 fotos) ──
  detailOpen = signal(false);
  detail = signal<RegistroCombustible | null>(null);
  detailLoading = signal(false);
  fotoRecibo = signal<string | null>(null);
  fotoTablero = signal<string | null>(null);
  fotoBomba = signal<string | null>(null);
  lightbox = signal<string | null>(null);
  readonly PRODUCTO_LABEL = PRODUCTO_CANONICO_LABEL;
  readonly RENDIMIENTO_META = RENDIMIENTO_ESTADO_META;

  async abrirDetalle(row: LogCombustibleRow) {
    this.detailOpen.set(true);
    this.detail.set(null);
    this.fotoRecibo.set(null);
    this.fotoTablero.set(null);
    this.fotoBomba.set(null);
    this.detailLoading.set(true);
    try {
      const r = await this.combustibleService.getById(row.id);
      this.detail.set(r);
      if (r?.foto_recibo_path) this.combustibleService.getFotoUrl(r.foto_recibo_path).then((u) => this.fotoRecibo.set(u));
      if (r?.foto_tablero_path) this.combustibleService.getFotoUrl(r.foto_tablero_path).then((u) => this.fotoTablero.set(u));
      if (r?.foto_bomba_path) this.combustibleService.getFotoUrl(r.foto_bomba_path).then((u) => this.fotoBomba.set(u));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el detalle.');
      this.detailOpen.set(false);
    } finally {
      this.detailLoading.set(false);
    }
  }

  cerrarDetalle() { this.detailOpen.set(false); }
  verFoto(url: string | null) { if (url) this.lightbox.set(url); }

  rendimientoMeta(r: RegistroCombustible | null) {
    return r?.estado ? this.RENDIMIENTO_META[r.estado] : null;
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
