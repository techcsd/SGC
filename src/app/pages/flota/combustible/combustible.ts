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
import { CombustibleService } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { RegistroCombustible, RegistroCombustibleFormData } from '../../../../shared/models/combustible.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-combustible',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './combustible.html',
  styleUrl: './combustible.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Combustible implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);

  formatFecha = formatFechaDisplay;

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

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);

  readonly today = todayIso();

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    fecha: new FormControl(this.today, [Validators.required]),
    litros: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    costo_por_litro: new FormControl<number | null>(null, [Validators.min(0)]),
    total: new FormControl<number | null>({ value: null, disabled: true }),
    kilometraje: new FormControl<number | null>(null, [Validators.min(0)]),
    estacion: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const vId = this.selectedVehiculoId();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.registros().filter((r) => {
      if (
        q &&
        !r.vehiculo?.placa.toLowerCase().includes(q) &&
        !r.estacion?.toLowerCase().includes(q)
      ) {
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
  mesActual = computed(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.registros().filter((r) => r.fecha.startsWith(ym));
  });

  totalLitrosMes = computed(() =>
    this.mesActual().reduce((sum, r) => sum + r.litros, 0),
  );

  totalGastoMes = computed(() =>
    this.mesActual().reduce((sum, r) => sum + (r.total ?? 0), 0),
  );

  // ── Computed total in form ────────────────────────────────
  // FormControl.value isn't a signal, so a plain computed() reading it would
  // cache its initial (null) value forever and the hint below would never
  // show. Bridge the two controls through valueChanges instead.
  private litrosValue = toSignal(this.form.controls.litros.valueChanges, {
    initialValue: this.form.controls.litros.value,
  });
  private cplValue = toSignal(this.form.controls.costo_por_litro.valueChanges, {
    initialValue: this.form.controls.costo_por_litro.value,
  });
  computedTotal = computed(() => {
    const litros = this.litrosValue() ?? 0;
    const cpl = this.cplValue() ?? 0;
    return litros && cpl ? litros * cpl : null;
  });

  async ngOnInit() {
    await this.loadAll();

    // Auto-compute total when litros/costo_por_litro change
    this.form.controls.litros.valueChanges.subscribe(() => this.updateTotal());
    this.form.controls.costo_por_litro.valueChanges.subscribe(() => this.updateTotal());
  }

  private updateTotal() {
    const litros = this.form.controls.litros.value ?? 0;
    const cpl = this.form.controls.costo_por_litro.value ?? 0;
    const total = litros && cpl ? litros * cpl : null;
    this.form.controls.total.setValue(total, { emitEvent: false });
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
  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  onVehiculoChange(value: string) {
    this.selectedVehiculoId.set(value);
    this.currentPage.set(1);
  }

  onDateFromChange(value: string) {
    this.dateFrom.set(value);
    this.currentPage.set(1);
  }

  onDateToChange(value: string) {
    this.dateTo.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedVehiculoId.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.currentPage.set(1);
  }

  hasFilters = computed(() =>
    !!(this.searchQuery() || this.selectedVehiculoId() || this.dateFrom() || this.dateTo()),
  );

  // ── Pagination ───────────────────────────────────────────
  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  get pages(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
      range.push(i);
    }
    return range;
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.form.reset({
      fecha: this.today,
      vehiculo_id: '',
      conductor_id: null,
      litros: null,
      costo_por_litro: null,
      total: null,
      kilometraje: null,
      estacion: null,
      notas: null,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const raw = this.form.getRawValue();

    // Odometer can't go backwards: a new reading must be >= the vehicle's
    // current registered kilometraje.
    if (raw.kilometraje != null) {
      const veh = this.vehiculos().find((v) => v.id === raw.vehiculo_id);
      if (veh && raw.kilometraje < veh.kilometraje) {
        this.saveError.set(`El kilometraje no puede ser menor al actual del vehículo (${veh.kilometraje} km).`);
        return;
      }
    }

    this.saving.set(true);
    this.saveError.set('');

    const payload: RegistroCombustibleFormData = {
      vehiculo_id: raw.vehiculo_id!,
      conductor_id: raw.conductor_id || null,
      fecha: raw.fecha!,
      litros: raw.litros!,
      costo_por_litro: raw.costo_por_litro,
      total: raw.total,
      kilometraje: raw.kilometraje,
      estacion: raw.estacion,
      notas: raw.notas,
    };

    try {
      const created = await this.combustibleService.create(payload);
      this.registros.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
