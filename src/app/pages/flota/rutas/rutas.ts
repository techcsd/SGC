import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RutasService } from '../../../../shared/services/rutas.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { UserService } from '../../../core/services/user.service';
import { Ruta, RutaFormData, RutaEstado, RUTA_ESTADOS } from '../../../../shared/models/ruta.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-rutas',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe],
  templateUrl: './rutas.html',
  styleUrl: './rutas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Rutas implements OnInit {
  private rutasService = inject(RutasService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private userService = inject(UserService);

  // ── Data state ──────────────────────────────────────────
  rutas = signal<Ruta[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedEstado = signal('');

  readonly RUTA_ESTADOS = RUTA_ESTADOS;
  readonly today = new Date().toISOString().split('T')[0];

  // ── Create/edit drawer ────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    origen: new FormControl('', [Validators.required]),
    destino: new FormControl('', [Validators.required]),
    fecha: new FormControl(this.today, [Validators.required]),
    km_estimado: new FormControl<number | null>(null, [Validators.min(0)]),
    tiempo_estimado_min: new FormControl<number | null>(null, [Validators.min(0)]),
    estado: new FormControl<RutaEstado>('planificada', [Validators.required]),
    notas: new FormControl<string | null>(null),
  });

  // ── Registrar real drawer ──────────────────────────────────
  registrarDrawerOpen = signal(false);
  registrarTarget = signal<Ruta | null>(null);
  registrarForm = new FormGroup({
    km_real: new FormControl<number | null>(null, [Validators.min(0)]),
    tiempo_real_min: new FormControl<number | null>(null, [Validators.min(0)]),
    estado: new FormControl<RutaEstado>('completada', [Validators.required]),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();

    return this.rutas().filter((r) => {
      if (
        q &&
        !r.origen.toLowerCase().includes(q) &&
        !r.destino.toLowerCase().includes(q) &&
        !(r.vehiculo?.placa ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (estado && r.estado !== estado) return false;
      return true;
    });
  });

  activeVehiculos = computed(() => this.vehiculos().filter((v) => v.activo));
  activeConductores = computed(() => this.conductores().filter((c) => c.activo));

  drawerTitle = computed(() => (this.editingId() ? 'Editar ruta' : 'Planificar ruta'));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [rutas, vehiculos, conductores] = await Promise.all([
        this.rutasService.getAll(),
        this.vehiculosService.getAll(),
        this.conductoresService.getAll(),
      ]);
      this.rutas.set(rutas);
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
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('');
  }

  // ── Create/edit drawer ────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ fecha: this.today, estado: 'planificada' });
    this.drawerOpen.set(true);
  }

  openEdit(r: Ruta) {
    this.editingId.set(r.id);
    this.saveError.set('');
    this.form.reset({
      vehiculo_id: r.vehiculo_id,
      conductor_id: r.conductor_id,
      origen: r.origen,
      destino: r.destino,
      fecha: r.fecha,
      km_estimado: r.km_estimado,
      tiempo_estimado_min: r.tiempo_estimado_min,
      estado: r.estado,
      notas: r.notas,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.value as RutaFormData;
    const userId = this.userService.profile()?.id ?? null;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.rutasService.update(id, payload);
        this.rutas.update((list) => list.map((r) => (r.id === id ? updated : r)));
      } else {
        const created = await this.rutasService.create(payload, userId);
        this.rutas.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Registrar real (actual km/time) ───────────────────────
  openRegistrar(r: Ruta) {
    this.registrarTarget.set(r);
    this.saveError.set('');
    this.registrarForm.reset({
      km_real: r.km_real ?? r.km_estimado,
      tiempo_real_min: r.tiempo_real_min ?? r.tiempo_estimado_min,
      estado: 'completada',
    });
    this.registrarDrawerOpen.set(true);
  }

  closeRegistrar() {
    this.registrarDrawerOpen.set(false);
    this.registrarTarget.set(null);
  }

  async onSaveRegistrar() {
    const target = this.registrarTarget();
    if (!target || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const v = this.registrarForm.value;

    try {
      const updated = await this.rutasService.registrarReal(target.id, {
        km_real: v.km_real ?? null,
        tiempo_real_min: v.tiempo_real_min ?? null,
        estado: v.estado ?? 'completada',
      });
      this.rutas.update((list) => list.map((r) => (r.id === target.id ? updated : r)));
      this.closeRegistrar();
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getEstadoInfo(estado: RutaEstado) {
    return RUTA_ESTADOS.find((e) => e.value === estado);
  }

  kmDesvio(r: Ruta): number | null {
    if (r.km_real == null || r.km_estimado == null) return null;
    return r.km_real - r.km_estimado;
  }

  tiempoDesvio(r: Ruta): number | null {
    if (r.tiempo_real_min == null || r.tiempo_estimado_min == null) return null;
    return r.tiempo_real_min - r.tiempo_estimado_min;
  }

  get f() {
    return this.form.controls;
  }

  get rf() {
    return this.registrarForm.controls;
  }
}
