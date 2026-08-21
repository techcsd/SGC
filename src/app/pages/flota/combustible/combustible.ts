import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  OnInit,
} from '@angular/core';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { VehiculoPicker } from '../../../../shared/components/vehiculo-picker/vehiculo-picker';
import { CombustibleService } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { FlotaConfigService } from '../../../../shared/services/flota-config.service';
import { EstacionesCombustibleService, EstacionCombustible } from '../../../../shared/services/estaciones-combustible.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import {
  RegistroCombustible,
  RegistroCombustibleFormData,
  esRegistroV2,
  PrecioCombustibleVigente,
  PRODUCTO_CANONICO_LABEL,
  productoCanonico,
  RendimientoEstado,
  RENDIMIENTO_ESTADO_META,
} from '../../../../shared/models/combustible.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

@Component({
  selector: 'app-combustible',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe, RouterLink, VehiculoPicker, Skeleton, DateRangeFilter],
  templateUrl: './combustible.html',
  styleUrl: './combustible.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Combustible implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private proyectosService = inject(ProyectosService);
  private conductoresService = inject(ConductoresService);
  protected flotaConfig = inject(FlotaConfigService);
  private estacionesService = inject(EstacionesCombustibleService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private datosPrueba = inject(DatosPruebaService);

  formatFecha = formatFechaDisplay;
  esV2 = esRegistroV2;

  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Data state ──────────────────────────────────────────
  registros = signal<RegistroCombustible[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
  estaciones = signal<EstacionCombustible[]>([]);
  // AC11 — obras activas para asociar el combustible de depósito en obra.
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedVehiculoId = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Create drawer ────────────────────────────────────────
  drawerOpen = signal(false);
  reciboFile = signal<File | null>(null);
  tableroFile = signal<File | null>(null);
  reciboPreview = signal<string | null>(null);
  tableroPreview = signal<string | null>(null);

  // ── Detail drawer ────────────────────────────────────────
  detailOpen = signal(false);
  selected = signal<RegistroCombustible | null>(null);
  detailReciboUrl = signal<string | null>(null);
  detailTableroUrl = signal<string | null>(null);
  detailBombaUrl = signal<string | null>(null); // Y4 — 3ª foto (bomba en 0)
  loadingDetail = signal(false);

  readonly today = todayIso();

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    fecha: new FormControl(this.today, [Validators.required]),
    kilometraje: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    galones: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    monto: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    // AC11 — origen: estación (conciliable) o depósito/garrafón en obra.
    origen: new FormControl<'estacion' | 'deposito_obra'>('estacion', { nonNullable: true }),
    proyecto_id: new FormControl<string | null>(null),
    // T4 — estación desde el catálogo (Total Energies default); 'Otro' habilita texto libre.
    estacionSel: new FormControl<string>('Total Energies'),
    estacion: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    // Z23.4 — datos de conciliación con el reporte del proveedor (opcionales).
    producto: new FormControl<string | null>(null),
    // AA20 — subtipo regular|premium (se pide tras elegir gasolina/diésel).
    subtipo: new FormControl<string | null>(null),
    tarjeta: new FormControl<string | null>(null),
    titular: new FormControl<string | null>(null),
    titular_es_persona: new FormControl<boolean>(false, { nonNullable: true }),
  });

  private estacionSelVal = toSignal(this.form.controls.estacionSel.valueChanges, {
    initialValue: this.form.controls.estacionSel.value,
  });
  estacionEsOtro = computed(() => this.estacionSelVal() === 'Otro');

  // AC11 — depósito en obra: monto opcional, sin conciliación, con obra asociada.
  private origenVal = toSignal(this.form.controls.origen.valueChanges, {
    initialValue: this.form.controls.origen.value,
  });
  esDepositoObra = computed(() => this.origenVal() === 'deposito_obra');

  constructor() {
    // AC11 — el origen reconfigura las validaciones: en depósito de obra el monto
    // es opcional (garrafón sin factura) y la obra pasa a ser obligatoria.
    effect(() => {
      const deposito = this.esDepositoObra();
      const monto = this.form.controls.monto;
      const proyecto = this.form.controls.proyecto_id;
      monto.setValidators(deposito ? [] : [Validators.required, Validators.min(0.01)]);
      proyecto.setValidators(deposito ? [Validators.required] : []);
      monto.updateValueAndValidity({ emitEvent: false });
      proyecto.updateValueAndValidity({ emitEvent: false });
    });
  }

  // Z23.4 — el campo "titular" solo aplica cuando la tarjeta es de una persona.
  private titularEsPersonaVal = toSignal(this.form.controls.titular_es_persona.valueChanges, {
    initialValue: this.form.controls.titular_es_persona.value,
  });
  tarjetaEsPersona = computed(() => this.titularEsPersonaVal() === true);

  // ── AA20 — subtipo + precios oficiales ────────────────────
  preciosVigentes = signal<PrecioCombustibleVigente[]>([]);
  productoCanonicoLabel(p: string): string { return PRODUCTO_CANONICO_LABEL[p] ?? p; }

  // ── AD7 — estado calibrado del rendimiento (4 estados) ────
  /** Estado del registro; si `estado` no vino (legacy), se deriva de forma segura. */
  estadoDe(r: RegistroCombustible): RendimientoEstado {
    if (r.estado) return r.estado;
    if (r.rendimiento_km_gal == null) return 'datos_insuficientes';
    return r.alerta_consumo ? 'anormal' : 'optimo';
  }
  estadoMeta(r: RegistroCombustible) { return RENDIMIENTO_ESTADO_META[this.estadoDe(r)]; }
  estadoIcon(r: RegistroCombustible): string {
    return { optimo: '✓', bajo: '↓', anormal: '⚠', datos_insuficientes: '•' }[this.estadoDe(r)];
  }

  // ── Precios de combustible: override manual (admin/flota) ─
  preciosEditOpen = signal(false);
  savingPrecios = signal(false);
  preciosEdit = signal<Record<string, number>>({});

  togglePreciosEdit() {
    const open = !this.preciosEditOpen();
    this.preciosEditOpen.set(open);
    if (open) {
      const map: Record<string, number> = {};
      for (const p of this.preciosVigentes()) map[p.producto] = p.precio;
      this.preciosEdit.set(map);
    }
  }
  setPrecioForm(producto: string, valor: string) {
    const n = Number(valor);
    this.preciosEdit.update((m) => ({ ...m, [producto]: Number.isFinite(n) ? n : 0 }));
  }
  async guardarPrecios() {
    if (this.savingPrecios()) return;
    this.savingPrecios.set(true);
    try {
      const actuales = new Map(this.preciosVigentes().map((p) => [p.producto, p.precio]));
      const edits = this.preciosEdit();
      let cambios = 0;
      for (const [producto, precio] of Object.entries(edits)) {
        if (precio > 0 && precio !== actuales.get(producto)) {
          await this.combustibleService.setPrecio(producto, precio);
          cambios++;
        }
      }
      if (cambios > 0) {
        this.preciosVigentes.set(await this.combustibleService.getPreciosVigentes());
        this.toast.success('Precios actualizados', `Se actualizaron ${cambios} precio(s).`);
      }
      this.preciosEditOpen.set(false);
    } catch (e: unknown) {
      this.toast.error('No se pudieron guardar los precios', e instanceof Error ? e.message : undefined);
    } finally {
      this.savingPrecios.set(false);
    }
  }

  // ── AD7 — panel de umbrales (admin, Hard-rule #2) ─────────
  configPanelOpen = signal(false);
  savingConfig = signal(false);
  configForm = new FormGroup({
    dist_min_km: new FormControl(50, [Validators.required, Validators.min(1)]),
    rendimiento_minimo_km_gal: new FormControl(10, [Validators.required, Validators.min(0.01)]),
    rendimiento_maximo_km_gal: new FormControl(35, [Validators.required, Validators.min(1)]),
    umbral_consumo_pct: new FormControl(20, [Validators.required, Validators.min(1), Validators.max(99)]),
    umbral_anormal_pct: new FormControl(40, [Validators.required, Validators.min(1), Validators.max(99)]),
  });

  toggleConfig() {
    const open = !this.configPanelOpen();
    this.configPanelOpen.set(open);
    if (open) {
      this.configForm.reset({
        dist_min_km: this.flotaConfig.distMinKm(),
        rendimiento_minimo_km_gal: this.flotaConfig.rendimientoMinimoKmGal(),
        rendimiento_maximo_km_gal: this.flotaConfig.rendimientoMaximoKmGal(),
        umbral_consumo_pct: this.flotaConfig.umbralConsumoPct(),
        umbral_anormal_pct: this.flotaConfig.umbralAnormalPct(),
      });
    }
  }

  async saveConfig() {
    if (this.configForm.invalid || this.savingConfig()) return;
    this.savingConfig.set(true);
    try {
      const v = this.configForm.value;
      const entries: [string, number][] = [
        ['dist_min_km', v.dist_min_km!],
        ['rendimiento_minimo_km_gal', v.rendimiento_minimo_km_gal!],
        ['rendimiento_maximo_km_gal', v.rendimiento_maximo_km_gal!],
        ['umbral_consumo_pct', v.umbral_consumo_pct!],
        ['umbral_anormal_pct', v.umbral_anormal_pct!],
      ];
      for (const [k, val] of entries) await this.flotaConfig.setConfig(k, val);
      // Refleja en los signals + recalcula el histórico con los nuevos umbrales.
      this.flotaConfig.distMinKm.set(v.dist_min_km!);
      this.flotaConfig.rendimientoMinimoKmGal.set(v.rendimiento_minimo_km_gal!);
      this.flotaConfig.rendimientoMaximoKmGal.set(v.rendimiento_maximo_km_gal!);
      this.flotaConfig.umbralConsumoPct.set(v.umbral_consumo_pct!);
      this.flotaConfig.umbralAnormalPct.set(v.umbral_anormal_pct!);
      const n = await this.flotaConfig.recalcularEstados();
      this.toast.success('Umbrales guardados', `Se recalcularon ${n} registros con las reglas nuevas.`);
      this.configPanelOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error('No se pudieron guardar los umbrales', e instanceof Error ? e.message : undefined);
    } finally {
      this.savingConfig.set(false);
    }
  }
  private productoVal = toSignal(this.form.controls.producto.valueChanges, { initialValue: null as string | null });
  private subtipoVal = toSignal(this.form.controls.subtipo.valueChanges, { initialValue: null as string | null });

  /** Precio oficial vigente del producto+subtipo seleccionado (RD$/gal), o null. */
  precioReferencia = computed<number | null>(() => {
    const canon = productoCanonico(this.productoVal(), this.subtipoVal());
    if (!canon) return null;
    return this.preciosVigentes().find((p) => p.producto === canon)?.precio ?? null;
  });

  /** Desviación del precio pagado vs. el oficial (%), o null si no hay referencia. */
  desviacionPrecio = computed<number | null>(() => {
    const ref = this.precioReferencia();
    const g = this.galonesVal() ?? 0;
    const m = this.montoVal() ?? 0;
    if (!ref || g <= 0 || m <= 0) return null;
    const pagado = m / g;
    return Math.round(((pagado - ref) / ref) * 100);
  });

  // ── Filtering ────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const vId = this.selectedVehiculoId();
    const from = this.dateFrom();
    const to = this.dateTo();
    // T2 — admin: oculta datos de prueba salvo que active el toggle (no-admin nunca los recibe).
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.registros().filter((r) => {
      if (r.es_prueba && !verPrueba) return false;
      if (q && !r.vehiculo?.placa?.toLowerCase().includes(q) && !r.estacion?.toLowerCase().includes(q)) {
        return false;
      }
      if (vId && r.vehiculo_id !== vId) return false;
      if (from && r.fecha < from) return false;
      if (to && r.fecha > to) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  // ── Monthly totals (current month) ───────────────────────
  // Z5(c) — los KPIs del mes excluyen datos de prueba salvo que el admin active el toggle.
  private mesActual = computed(() => {
    const ym = todayIso().slice(0, 7);
    const verPrueba = this.esAdmin() && this.mostrarPrueba();
    return this.registros().filter((r) => r.fecha.startsWith(ym) && !(r.es_prueba && !verPrueba));
  });
  totalGalonesMes = computed(() =>
    this.mesActual().reduce((s, r) => s + (r.galones ?? r.litros ?? 0), 0),
  );
  totalGastoMes = computed(() =>
    this.mesActual().reduce((s, r) => s + (r.monto ?? r.total ?? 0), 0),
  );

  // ── Live calculation (reactive to form value changes) ────
  private galonesVal = toSignal(this.form.controls.galones.valueChanges, { initialValue: null });
  private montoVal = toSignal(this.form.controls.monto.valueChanges, { initialValue: null });
  private kmVal = toSignal(this.form.controls.kilometraje.valueChanges, { initialValue: null });
  private vehiculoVal = toSignal(this.form.controls.vehiculo_id.valueChanges, { initialValue: '' });

  /**
   * Y5 — Odómetro actual del vehículo (vehiculos.kilometraje): la ÚNICA fuente de
   * verdad, la misma cifra que valida el servidor y que ve el usuario.
   */
  odometroActual = computed<number | null>(() => {
    const vId = this.vehiculoVal();
    if (!vId) return null;
    return this.vehiculos().find((v) => v.id === vId)?.kilometraje ?? null;
  });

  // AA18.3 — unidad del vehículo seleccionado (km | horas) para labels/mensajes.
  medidaSel = computed<'km' | 'horas'>(() => {
    const vId = this.vehiculoVal();
    return (this.vehiculos().find((v) => v.id === vId)?.medida_uso as 'km' | 'horas') ?? 'km';
  });
  unidadSel = computed(() => (this.medidaSel() === 'horas' ? 'h' : 'km'));
  labelLectura = computed(() => (this.medidaSel() === 'horas' ? 'Horas de uso actual' : 'Kilometraje actual'));

  /**
   * Km de la última echada del vehículo, en el MISMO contexto es_prueba del vehículo
   * (AD7c: un vehículo de prueba compara contra sus echadas de prueba; uno real,
   * contra las reales). Igual que el servidor. Solo para el preview de km recorridos/
   * rendimiento, NO para el no-retroceso (eso lo gobierna el odómetro).
   */
  kmAnterior = computed<number | null>(() => {
    const vId = this.vehiculoVal();
    if (!vId) return null;
    const vEsPrueba = !!this.vehiculos().find((v) => v.id === vId)?.es_prueba;
    const kms = this.registros()
      .filter((r) => r.vehiculo_id === vId && r.kilometraje != null && !!r.es_prueba === vEsPrueba)
      .map((r) => r.kilometraje as number);
    return kms.length ? Math.max(...kms) : null;
  });

  /** Promedio de rendimiento histórico del vehículo (para la alerta preview). */
  private promedioRendimientoVeh = computed<number | null>(() => {
    const vId = this.vehiculoVal();
    if (!vId) return null;
    const rends = this.registros()
      .filter((r) => r.vehiculo_id === vId && r.rendimiento_km_gal != null)
      .map((r) => r.rendimiento_km_gal as number);
    return rends.length >= 3 ? rends.reduce((a, b) => a + b, 0) / rends.length : null;
  });

  /** Rendimiento esperado del vehículo seleccionado (S20), para el preview de la alerta. */
  private esperadoVeh = computed<number | null>(() => {
    const vId = this.vehiculoVal();
    if (!vId) return null;
    return this.vehiculos().find((v) => v.id === vId)?.rendimiento_esperado_km_gal ?? null;
  });

  calc = computed(() => {
    const gal = this.galonesVal() ?? 0;
    const monto = this.montoVal() ?? 0;
    const km = this.kmVal() ?? 0;
    const kmAnt = this.kmAnterior();
    const precio = gal > 0 && monto > 0 ? monto / gal : null;
    const kmRec = kmAnt != null && km > kmAnt ? km - kmAnt : null;
    const rend = kmRec != null && gal > 0 ? kmRec / gal : null;
    const costoKm = kmRec != null && kmRec > 0 ? monto / kmRec : null;
    const prom = this.promedioRendimientoVeh();
    const esperado = this.esperadoVeh();
    const piso = this.flotaConfig.rendimientoMinimoKmGal();
    const factor = 1 - this.flotaConfig.umbralConsumoPct() / 100;
    // T5 + U10 — cascada: esperado → promedio propio → piso absoluto (respaldo final).
    let alerta = false;
    let refTipo: 'esperado' | 'propio' | 'piso' | null = null;
    if (rend != null && kmRec != null && kmRec > 0) {
      if (esperado != null && esperado > 0 && rend < esperado * factor) {
        alerta = true;
        refTipo = 'esperado';
      } else if (prom != null && rend < prom * factor) {
        alerta = true;
        refTipo = 'propio';
      }
      // Piso absoluto: rendimiento imposiblemente bajo alerta SIEMPRE.
      if (rend < piso) {
        alerta = true;
        if (refTipo == null) refTipo = 'piso';
      }
    }
    return { precio, kmRec, rend, costoKm, prom, esperado, piso, alerta, refTipo };
  });

  hasFilters = computed(() =>
    !!(this.searchQuery() || this.selectedVehiculoId() || this.dateFrom() || this.dateTo()),
  );

  // QA-001 — solo vehículos usables pueden echar combustible (no baja / no_disponible).
  vehiculosDisponibles = computed(() =>
    this.datosPruebaViewSvc.visibles(this.vehiculos()).filter(
      (v) => v.activo && v.estado !== 'no_disponible' && v.estado !== 'baja',
    ),
  );
  // AT14/AT26 — datos de prueba fuera de los selectores para no-admin.
  conductoresVisibles = computed(() => this.datosPruebaViewSvc.visibles(this.conductores()));
  proyectosVisibles = computed(() => this.datosPruebaViewSvc.visibles(this.proyectos()));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [registros, vehiculos, conductores, estaciones, precios, proyectos] = await Promise.all([
        this.combustibleService.getAll(),
        this.vehiculosService.getAll(),
        this.conductoresService.getAll(),
        this.estacionesService.getActivas(),
        this.combustibleService.getPreciosVigentes(), // AA20
        this.proyectosService.getAll(), // AC11 — obras para depósito en obra
      ]);
      this.registros.set(registros);
      this.vehiculos.set(vehiculos);
      this.conductores.set(conductores);
      this.estaciones.set(estaciones);
      this.preciosVigentes.set(precios);
      // AC11 — solo obras activas en el selector de depósito en obra.
      this.proyectos.set(proyectos.filter((p) => p.activo));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los datos.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(v: string) { this.searchQuery.set(v); this.currentPage.set(1); }
  onVehiculoChange(v: string | null) { this.selectedVehiculoId.set(v ?? ''); this.currentPage.set(1); }
  onDateFromChange(v: string) { this.dateFrom.set(v); this.currentPage.set(1); }
  onDateToChange(v: string) { this.dateTo.set(v); this.currentPage.set(1); }
  /** R12 — filtro de fechas unificado. */
  onRango(r: RangoFecha) { this.dateFrom.set(r.desde ?? ''); this.dateTo.set(r.hasta ?? ''); this.currentPage.set(1); }
  clearFilters() {
    this.searchQuery.set(''); this.selectedVehiculoId.set('');
    this.dateFrom.set(''); this.dateTo.set(''); this.currentPage.set(1);
  }

  // ── Pagination ───────────────────────────────────────────
  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) this.currentPage.set(page);
  }
  get pages(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const range: number[] = [];
    for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) range.push(i);
    return range;
  }

  /** Exporta los registros de combustible filtrados a Excel. */
  async exportar() {
    const rows = this.filtered().map((r) => ({
      Fecha: this.formatFecha(r.fecha),
      Vehículo: r.vehiculo?.placa ?? '',
      Conductor: r.conductor?.nombre ?? '',
      Km: r.kilometraje ?? '',
      Galones: r.galones ?? r.litros ?? '',
      Monto: r.monto ?? r.total ?? '',
      'Rendimiento (km/gal)': r.rendimiento_km_gal ?? '',
    }));
    await exportarExcel('combustible', rows);
  }

  // ── Create ───────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.clearFiles();
    this.form.reset({ fecha: this.today, vehiculo_id: '', conductor_id: null,
      kilometraje: null, galones: null, monto: null,
      origen: 'estacion', proyecto_id: null,
      estacionSel: 'Total Energies', estacion: null, notas: null,
      producto: null, subtipo: null, tarjeta: null, titular: null, titular_es_persona: false });
    this.drawerOpen.set(true);
  }

  closeDrawer() { this.drawerOpen.set(false); this.clearFiles(); }

  private clearFiles() {
    const r = this.reciboPreview(); if (r) URL.revokeObjectURL(r);
    const t = this.tableroPreview(); if (t) URL.revokeObjectURL(t);
    this.reciboFile.set(null); this.tableroFile.set(null);
    this.reciboPreview.set(null); this.tableroPreview.set(null);
  }

  onFileSelected(slot: 'recibo' | 'tablero', event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (slot === 'recibo') {
      const prev = this.reciboPreview(); if (prev) URL.revokeObjectURL(prev);
      this.reciboFile.set(file);
      this.reciboPreview.set(file ? URL.createObjectURL(file) : null);
    } else {
      const prev = this.tableroPreview(); if (prev) URL.revokeObjectURL(prev);
      this.tableroFile.set(file);
      this.tableroPreview.set(file ? URL.createObjectURL(file) : null);
    }
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const recibo = this.reciboFile();
    const tablero = this.tableroFile();
    if (!recibo || !tablero) {
      this.saveError.set('Ambas fotos (recibo y tablero) son obligatorias.');
      return;
    }

    const raw = this.form.getRawValue();
    // Y5 — el odómetro no retrocede: km >= odómetro actual (misma regla y cifra que el servidor).
    const odo = this.odometroActual();
    if (odo != null && (raw.kilometraje ?? 0) < odo) {
      const u = this.unidadSel();
      this.saveError.set(
        `La lectura (${raw.kilometraje ?? 0} ${u}) no puede ser menor a la lectura actual del vehículo (${odo} ${u}).`,
      );
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    // AC11 — depósito en obra: no entra a conciliación de estación, así que no se
    // envían estación/producto/tarjeta/titular; el monto es opcional.
    const deposito = raw.origen === 'deposito_obra';
    const payload: RegistroCombustibleFormData = {
      vehiculo_id: raw.vehiculo_id!,
      conductor_id: raw.conductor_id || null,
      fecha: raw.fecha!,
      kilometraje: raw.kilometraje!,
      galones: raw.galones!,
      monto: raw.monto ?? 0,
      estacion: deposito
        ? null
        : raw.estacionSel === 'Otro' ? raw.estacion?.trim() || 'Otro' : raw.estacionSel || null,
      notas: raw.notas?.trim() || null,
      // Z23.4 — datos de conciliación (solo aplican a estación).
      producto: deposito ? null : raw.producto || null,
      subtipo: deposito ? null : raw.subtipo || null, // AA20
      tarjeta: deposito ? null : raw.tarjeta?.trim() || null,
      titular: deposito ? null : (raw.titular_es_persona ? raw.titular?.trim() || null : null),
      titular_es_persona: deposito ? false : !!raw.titular_es_persona,
      // AC11 — origen + obra asociada.
      origen: deposito ? 'deposito_obra' : 'estacion',
      proyecto_id: deposito ? raw.proyecto_id || null : null,
    };

    try {
      const { registro, derivados } = await this.combustibleService.registrar(payload, recibo, tablero);
      this.registros.update((list) => [registro, ...list]);
      this.drawerOpen.set(false);
      this.clearFiles();

      if (derivados.alerta_consumo) {
        this.combustibleService.notificarConsumoAnormal(registro); // email no bloqueante
        this.toast.warning(
          'Consumo anormal detectado',
          `${derivados.motivo_alerta ?? `${derivados.rendimiento_km_gal} km/gal, por debajo de lo normal.`} Se notificó a Flota.`,
        );
      } else {
        const rendTxt = derivados.rendimiento_km_gal != null
          ? `${derivados.rendimiento_km_gal} km/gal` : 'primera echada del vehículo';
        this.toast.success('Combustible registrado', `Rendimiento: ${rendTxt}.`);
      }
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Detail ───────────────────────────────────────────────
  async openDetail(row: RegistroCombustible) {
    this.detailOpen.set(true);
    this.selected.set(row);
    this.detailReciboUrl.set(null);
    this.detailTableroUrl.set(null);
    this.detailBombaUrl.set(null); // Y4
    this.loadingDetail.set(true);
    try {
      const [recibo, tablero, bomba] = await Promise.all([
        this.combustibleService.getFotoUrl(row.foto_recibo_path),
        this.combustibleService.getFotoUrl(row.foto_tablero_path),
        this.combustibleService.getFotoUrl(row.foto_bomba_path), // Y4
      ]);
      this.detailReciboUrl.set(recibo);
      this.detailTableroUrl.set(tablero);
      this.detailBombaUrl.set(bomba); // Y4
    } finally {
      this.loadingDetail.set(false);
    }
  }
  closeDetail() { this.detailOpen.set(false); }

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca o desmarca un registro como dato de prueba. */
  async marcarPrueba(r: RegistroCombustible, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar('registros_combustible', r.id, valor);
      this.registros.update((list) => list.map((x) => (x.id === r.id ? { ...x, es_prueba: valor } : x)));
      this.selected.update((s) => (s && s.id === r.id ? { ...s, es_prueba: valor } : s));
      this.toast.success(valor ? 'Marcado como dato de prueba' : 'Ya no es dato de prueba');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  /** Elimina definitivamente un registro de prueba (solo admin). */
  async eliminarPrueba(r: RegistroCombustible) {
    if (!this.esAdmin() || !r.es_prueba) return;
    if (!confirm('¿Eliminar este dato de prueba? Esta acción no se puede deshacer.')) return;
    try {
      await this.datosPrueba.eliminar('registros_combustible', r.id);
      this.registros.update((list) => list.filter((x) => x.id !== r.id));
      this.detailOpen.set(false);
      this.toast.success('Dato de prueba eliminado');
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  /** T5 — referencias para el "Análisis automático" del detalle. */
  esperadoDeVehiculo(vehiculoId: string): number | null {
    return this.vehiculos().find((v) => v.id === vehiculoId)?.rendimiento_esperado_km_gal ?? null;
  }
  promedioVehiculo(vehiculoId: string): number | null {
    const rends = this.registros()
      .filter((r) => r.vehiculo_id === vehiculoId && r.rendimiento_km_gal != null)
      .map((r) => r.rendimiento_km_gal as number);
    return rends.length ? rends.reduce((a, b) => a + b, 0) / rends.length : null;
  }
  promedioFlota(): number | null {
    const rends = this.registros()
      .filter((r) => r.rendimiento_km_gal != null)
      .map((r) => r.rendimiento_km_gal as number);
    return rends.length ? rends.reduce((a, b) => a + b, 0) / rends.length : null;
  }

  /** Precio/galón promedio de la flota en el mes del registro (análisis). */
  precioPromedioFlotaMes(row: RegistroCombustible): number | null {
    const ym = row.fecha.slice(0, 7);
    const precios = this.registros()
      .filter((r) => r.fecha.startsWith(ym) && r.precio_por_galon != null)
      .map((r) => r.precio_por_galon as number);
    return precios.length ? precios.reduce((a, b) => a + b, 0) / precios.length : null;
  }

  /** AC11 — nombre de la obra asociada a una echada de depósito (o null). */
  proyectoNombre(id: string | null | undefined): string | null {
    if (!id) return null;
    const p = this.proyectos().find((x) => x.id === id);
    return p ? (p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre) : null;
  }

  /** AC11 — etiqueta legible del origen de la echada. */
  origenLabel(r: RegistroCombustible): string {
    return r.origen === 'deposito_obra' ? 'Depósito en obra' : 'Estación';
  }

  get f() { return this.form.controls; }
}
