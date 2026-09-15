import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FlotaSubnav } from '../flota-subnav/flota-subnav';
import { DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CombustibleService, LogCombustibleRow, RegistroCombustibleHistorial } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { Vehiculo, identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { RegistroCombustible, PRODUCTO_CANONICO_LABEL, RENDIMIENTO_ESTADO_META } from '../../../../shared/models/combustible.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { formatFechaDisplay, formatHoraTimestamp, formatFechaHoraDisplay, todayIso, daysAgoIso } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Icon } from '../../../../shared/ui/icon/icon';

/** BQ5 — campos editables (whitelist alineada con el RPC editar_echada). */
type CampoEditable = 'vehiculo_id' | 'estacion' | 'fecha' | 'galones' | 'monto' | 'kilometraje' | 'producto';

/**
 * AF17 — Registro/log de echadas para admin y roles elevados. Sirve para detectar
 * kilometrajes irreales: muestra el delta de km vs la echada anterior, quién
 * registró cada echada y resalta los saltos fuera de umbral (km_alerta).
 */
@Component({
  selector: 'app-combustible-log',
  imports: [FlotaSubnav, DecimalPipe, ReactiveFormsModule, RouterLink, Skeleton, DateRangeFilter, FormDrawer, Lightbox, Icon],
  templateUrl: './combustible-log.html',
  styleUrl: './combustible-log.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CombustibleLog implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private route = inject(ActivatedRoute);
  private datosPruebaView = inject(DatosPruebaViewService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private fb = inject(FormBuilder);

  formatFecha = formatFechaDisplay;
  formatFechaHora = formatFechaHoraDisplay;
  readonly idVehiculo = identificacionVehiculo;

  // BQ5 — la edición/saneamiento de echadas la gestiona flota-elevado (mismo
  // predicado que editar_echada / echadas_sospechosas en el servidor).
  esFlotaElevado = computed(() =>
    ['admin', 'direccion', 'gerencia', 'jefe_flota', 'logistica'].some((r) => this.userService.hasRole(r)),
  );

  // BB6 — la echada muestra fecha Y hora. El día viene de `fecha` (lo que el usuario
  // eligió); la hora, del `created_at` (timestamptz del registro). Formato: dd/mm hh:mm.
  fechaHora(r: { fecha?: string | null; created_at?: string | null }): string {
    const dia = this.formatFecha(r.fecha);
    const hora = r.created_at ? formatHoraTimestamp(r.created_at) : '';
    return hora && hora !== '—' ? `${dia} · ${hora}` : dia;
  }

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
  // AT14/AT26 — datos de prueba fuera del selector de filtro para no-admin.
  vehiculosVisibles = computed(() => this.datosPruebaView.visibles(this.vehiculos()));
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
      Hora: r.created_at ? formatHoraTimestamp(r.created_at) : '',
      Vehículo: r.placa ?? '',
      Lectura: r.kilometraje ?? '',
      'Δ km': r.km_recorridos ?? '',
      Galones: r.galones ?? '',
      Monto: r.monto ?? '',
      Combustible: this.productoLabel(r),
      Registró: r.registrado_nombre ?? '',
      Conductor: r.conductor_nombre ?? '',
      'Salto km': r.km_alerta ? 'SÍ' : '',
      'Sin asignación': r.sin_asignacion ? 'SÍ' : '',
    }));
    await exportarExcel('registro-combustible', rows);
  }

  /** BR1 — "Revisar" desde el chip KM ALERTA / SIN ASIGNACIÓN: abre el detalle
   *  (superficie de revisión con el botón Editar de BQ5). */
  revisar(r: LogCombustibleRow, ev: Event) {
    ev.stopPropagation();
    this.abrirDetalle(r);
  }

  // ── BQ5 — Editar echada (drawer, solo flota-elevado) ──
  editOpen = signal(false);
  editSaving = signal(false);
  editError = signal('');
  editId = signal<string | null>(null);
  historial = signal<RegistroCombustibleHistorial[]>([]);
  historialLoading = signal(false);

  readonly PRODUCTO_OPCIONES = [
    { value: 'gasolina', label: 'Gasolina' },
    { value: 'diesel', label: 'Diésel' },
  ];
  // BQ5 — etiquetas de los campos para el diff antes/después del historial.
  readonly CAMPO_LABEL: Record<string, string> = {
    vehiculo_id: 'Vehículo', estacion: 'Estación', fecha: 'Fecha',
    galones: 'Galones', monto: 'Monto', kilometraje: 'Kilometraje', producto: 'Combustible',
    precio_por_galon: 'Precio/galón', km_recorridos: 'Δ km', rendimiento_km_gal: 'Rendimiento',
  };

  editForm = this.fb.group({
    vehiculo_id: [''],
    estacion: [''],
    fecha: ['', Validators.required],
    galones: [null as number | null],
    monto: [null as number | null],
    kilometraje: [null as number | null],
    producto: [''],
    motivo: ['', [Validators.required, Validators.minLength(3)]],
  });

  /** Abre el drawer de edición precargando los valores actuales de la echada. */
  async abrirEditar(r: RegistroCombustible) {
    if (!this.esFlotaElevado()) return;
    this.editError.set('');
    this.editId.set(r.id);
    this.editForm.reset({
      vehiculo_id: r.vehiculo_id ?? '',
      estacion: r.estacion ?? '',
      fecha: r.fecha ?? '',
      galones: r.galones,
      monto: r.monto,
      kilometraje: r.kilometraje,
      producto: r.producto ?? '',
      motivo: '',
    });
    this.editOpen.set(true);
    this.cargarHistorial(r.id);
  }

  cerrarEditar() { this.editOpen.set(false); }

  private async cargarHistorial(id: string) {
    this.historialLoading.set(true);
    this.historial.set([]);
    try {
      this.historial.set(await this.combustibleService.historialEchada(id));
    } catch { /* el historial es informativo; no bloquea la edición */ }
    finally { this.historialLoading.set(false); }
  }

  /** Guarda solo los campos que cambiaron respecto al detalle cargado. */
  async guardarEdicion() {
    const id = this.editId();
    const original = this.detail();
    if (!id || !original) return;
    if (this.editForm.invalid) { this.editForm.markAllAsTouched(); return; }

    const v = this.editForm.getRawValue();
    const propuesto: Record<CampoEditable, unknown> = {
      vehiculo_id: v.vehiculo_id || null,
      estacion: v.estacion?.trim() || null,
      fecha: v.fecha || null,
      galones: v.galones,
      monto: v.monto,
      kilometraje: v.kilometraje,
      producto: v.producto || null,
    };

    // Solo enviar las claves realmente cambiadas.
    const cambios: Record<string, unknown> = {};
    (Object.keys(propuesto) as CampoEditable[]).forEach((k) => {
      const antes = (original as unknown as Record<string, unknown>)[k] ?? null;
      const despues = propuesto[k] ?? null;
      if (String(antes) !== String(despues)) cambios[k] = despues;
    });

    if (Object.keys(cambios).length === 0) {
      this.toast.warning('Sin cambios', 'No modificaste ningún campo.');
      return;
    }

    this.editSaving.set(true);
    this.editError.set('');
    try {
      await this.combustibleService.editarEchada(id, cambios, v.motivo!.trim());
      this.toast.success('Echada actualizada', 'Se recalcularon los derivados y se guardó la traza.');
      this.editForm.markAsPristine();
      this.editOpen.set(false);
      // Re-lee el detalle con sus joins (el RPC devuelve la fila cruda) y la lista.
      try { this.detail.set(await this.combustibleService.getById(id)); } catch { /* no crítico */ }
      await this.cargar();                  // refresca la lista (derivados/estado)
    } catch (e: unknown) {
      this.editError.set(e instanceof Error ? e.message : 'No se pudo guardar la edición.');
    } finally {
      this.editSaving.set(false);
    }
  }

  /** Campos que cambiaron en una entrada del historial (para el diff antes/después). */
  diffCampos(h: RegistroCombustibleHistorial): { campo: string; antes: string; despues: string }[] {
    const antes = h.antes ?? {};
    const despues = h.despues ?? {};
    const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
    const out: { campo: string; antes: string; despues: string }[] = [];
    claves.forEach((k) => {
      const a = (antes as Record<string, unknown>)[k] ?? null;
      const d = (despues as Record<string, unknown>)[k] ?? null;
      if (String(a) !== String(d)) {
        out.push({ campo: this.CAMPO_LABEL[k] ?? k, antes: this.fmtValor(k, a), despues: this.fmtValor(k, d) });
      }
    });
    return out;
  }

  private fmtValor(campo: string, val: unknown): string {
    if (val === null || val === undefined || val === '') return '—';
    if (campo === 'fecha') return this.formatFecha(String(val));
    if (campo === 'vehiculo_id') {
      const veh = this.vehiculos().find((x) => x.id === val);
      return veh ? this.idVehiculo(veh) : String(val);
    }
    if (campo === 'producto') {
      return this.PRODUCTO_OPCIONES.find((p) => p.value === val)?.label
        ?? this.PRODUCTO_LABEL[String(val)] ?? String(val);
    }
    return String(val);
  }

  editorNombre(h: RegistroCombustibleHistorial): string {
    return h.editor?.nombre?.trim() || 'Usuario';
  }
}
