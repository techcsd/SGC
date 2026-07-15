import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { VehiculoPicker } from '../../../../shared/components/vehiculo-picker/vehiculo-picker';
import { CombustibleService } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { FlotaConfigService } from '../../../../shared/services/flota-config.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  RegistroCombustible,
  RegistroCombustibleFormData,
  esRegistroV2,
} from '../../../../shared/models/combustible.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-combustible',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe, RouterLink, VehiculoPicker, Skeleton],
  templateUrl: './combustible.html',
  styleUrl: './combustible.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Combustible implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private flotaConfig = inject(FlotaConfigService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;
  esV2 = esRegistroV2;

  // ── Data state ──────────────────────────────────────────
  registros = signal<RegistroCombustible[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
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
  loadingDetail = signal(false);

  readonly today = todayIso();

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    fecha: new FormControl(this.today, [Validators.required]),
    kilometraje: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    galones: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    monto: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    estacion: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Filtering ────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const vId = this.selectedVehiculoId();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.registros().filter((r) => {
      if (q && !r.vehiculo?.placa.toLowerCase().includes(q) && !r.estacion?.toLowerCase().includes(q)) {
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
  private mesActual = computed(() => {
    const ym = todayIso().slice(0, 7);
    return this.registros().filter((r) => r.fecha.startsWith(ym));
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

  /** Km de la última echada del vehículo seleccionado (calc. local = server). */
  kmAnterior = computed<number | null>(() => {
    const vId = this.vehiculoVal();
    if (!vId) return null;
    const kms = this.registros()
      .filter((r) => r.vehiculo_id === vId && r.kilometraje != null)
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
    const alerta =
      rend != null && prom != null && rend < prom * (1 - this.flotaConfig.umbralConsumoPct() / 100);
    return { precio, kmRec, rend, costoKm, prom, alerta };
  });

  hasFilters = computed(() =>
    !!(this.searchQuery() || this.selectedVehiculoId() || this.dateFrom() || this.dateTo()),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [registros, vehiculos, conductores] = await Promise.all([
        this.combustibleService.getAll(),
        this.vehiculosService.getAll(),
        this.conductoresService.getAll(),
      ]);
      this.registros.set(registros);
      this.vehiculos.set(vehiculos);
      this.conductores.set(conductores);
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

  // ── Create ───────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.clearFiles();
    this.form.reset({ fecha: this.today, vehiculo_id: '', conductor_id: null,
      kilometraje: null, galones: null, monto: null, estacion: null, notas: null });
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
    // El odómetro no retrocede: km > última echada del vehículo.
    const kmAnt = this.kmAnterior();
    if (kmAnt != null && (raw.kilometraje ?? 0) <= kmAnt) {
      this.saveError.set(`El kilometraje debe ser mayor al de la última echada (${kmAnt} km).`);
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    const payload: RegistroCombustibleFormData = {
      vehiculo_id: raw.vehiculo_id!,
      conductor_id: raw.conductor_id || null,
      fecha: raw.fecha!,
      kilometraje: raw.kilometraje!,
      galones: raw.galones!,
      monto: raw.monto!,
      estacion: raw.estacion?.trim() || null,
      notas: raw.notas?.trim() || null,
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
          `${derivados.rendimiento_km_gal} km/gal, bajo el promedio del vehículo (${derivados.promedio_rendimiento} km/gal). Se notificó a Flota.`,
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
    this.loadingDetail.set(true);
    try {
      const [recibo, tablero] = await Promise.all([
        this.combustibleService.getFotoUrl(row.foto_recibo_path),
        this.combustibleService.getFotoUrl(row.foto_tablero_path),
      ]);
      this.detailReciboUrl.set(recibo);
      this.detailTableroUrl.set(tablero);
    } finally {
      this.loadingDetail.set(false);
    }
  }
  closeDetail() { this.detailOpen.set(false); }

  /** Precio/galón promedio de la flota en el mes del registro (análisis). */
  precioPromedioFlotaMes(row: RegistroCombustible): number | null {
    const ym = row.fecha.slice(0, 7);
    const precios = this.registros()
      .filter((r) => r.fecha.startsWith(ym) && r.precio_por_galon != null)
      .map((r) => r.precio_por_galon as number);
    return precios.length ? precios.reduce((a, b) => a + b, 0) / precios.length : null;
  }

  get f() { return this.form.controls; }
}
