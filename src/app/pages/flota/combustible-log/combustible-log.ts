import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CombustibleService, LogCombustibleRow } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { Vehiculo, identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { RegistroCombustible, PRODUCTO_CANONICO_LABEL, RENDIMIENTO_ESTADO_META } from '../../../../shared/models/combustible.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { formatFechaDisplay, todayIso, daysAgoIso } from '../../../../shared/utils/fecha.util';
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
  private route = inject(ActivatedRoute);

  formatFecha = formatFechaDisplay;
  readonly idVehiculo = identificacionVehiculo;

  // AQ13 — chips de periodo rápido (además del rango manual). dias hacia atrás.
  readonly CHIPS: { label: string; dias: number }[] = [
    { label: '1D', dias: 0 },
    { label: '1S', dias: 6 },
    { label: '1M', dias: 29 },
    { label: '3M', dias: 89 },
    { label: '6M', dias: 179 },
    { label: '1A', dias: 364 },
  ];
  chipActivo = signal<number | null>(null);

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

    // AQ6/AQ13 — deep-link desde la notificación de consumo anormal: ?echada=<id>
    const echadaId = this.route.snapshot.queryParamMap.get('echada');
    if (echadaId) this.abrirDetallePorId(echadaId);
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
    this.chipActivo.set(null); // rango manual → ningún chip activo
    this.desde.set(r.desde ?? '');
    this.hasta.set(r.hasta ?? '');
    this.cargar();
  }
  // AQ13 — chip de periodo rápido: fija el rango [hoy-dias, hoy] y recarga.
  aplicarChip(c: { label: string; dias: number }) {
    this.chipActivo.set(c.dias);
    this.desde.set(c.dias === 0 ? todayIso() : daysAgoIso(c.dias));
    this.hasta.set(todayIso());
    this.cargar();
  }
  onVehiculo(v: string) { this.vehiculoId.set(v); this.cargar(); }
  onUsuario(v: string) { this.usuarioId.set(v); this.cargar(); }
  limpiar() {
    this.chipActivo.set(null);
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

  abrirDetalle(row: LogCombustibleRow) { return this.abrirDetallePorId(row.id); }

  // AQ13/AQ6 — abre el detalle por id (row-click o deep-link ?echada=<id>).
  async abrirDetallePorId(id: string) {
    this.detailOpen.set(true);
    this.detail.set(null);
    this.fotoRecibo.set(null);
    this.fotoTablero.set(null);
    this.fotoBomba.set(null);
    this.detailLoading.set(true);
    try {
      const r = await this.combustibleService.getById(id);
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
