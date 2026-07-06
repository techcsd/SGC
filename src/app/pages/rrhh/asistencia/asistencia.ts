import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AsistenciaService } from '../../../../shared/services/asistencia.service';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { Asistencia as AsistenciaModel, AsistenciaFormData, ESTADOS_ASISTENCIA, EstadoAsistencia } from '../../../../shared/models/asistencia.model';
import { Empleado } from '../../../../shared/models/empleado.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { todayIso, formatHora12 } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-asistencia',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './asistencia.html',
  styleUrl: './asistencia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Asistencia implements OnInit {
  private asistenciaService = inject(AsistenciaService);
  private empleadosService = inject(EmpleadosService);

  // ── Data state ──────────────────────────────────────────
  registros = signal<AsistenciaModel[]>([]);
  empleadosActivos = signal<Empleado[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Date picker ──────────────────────────────────────────
  selectedDate = signal(this.todayISO());

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedEstado = signal<string>('');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly ESTADOS_ASISTENCIA = ESTADOS_ASISTENCIA;
  formatHora = formatHora12;

  form = new FormGroup({
    empleado_id: new FormControl('', [Validators.required]),
    fecha: new FormControl('', [Validators.required]),
    hora_entrada: new FormControl<string | null>(null),
    hora_salida: new FormControl<string | null>(null),
    estado: new FormControl<EstadoAsistencia>('presente', [Validators.required]),
    notas: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  summary = computed(() => {
    const list = this.registros();
    return {
      presentes: list.filter((r) => r.estado === 'presente').length,
      ausentes: list.filter((r) => r.estado === 'ausente').length,
      tardanzas: list.filter((r) => r.estado === 'tardanza').length,
      permisos: list.filter((r) => r.estado === 'permiso').length,
    };
  });

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar registro' : 'Registrar asistencia',
  );

  filteredRegistros = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    return this.registros().filter((r) => {
      if (estado && r.estado !== estado) return false;
      if (q) {
        const nombre = r.empleado
          ? `${r.empleado.apellido} ${r.empleado.nombre} ${r.empleado.cargo ?? ''}`
          : this.getEmpleadoNombre(r.empleado_id);
        if (!nombre.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  });

  hasActiveFilters = computed(() => !!this.searchQuery() || !!this.selectedEstado());

  async ngOnInit() {
    await Promise.all([this.loadRegistros(), this.loadEmpleados()]);
  }

  private async loadRegistros() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.asistenciaService.getByFecha(this.selectedDate());
      this.registros.set(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la asistencia.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEmpleados() {
    try {
      const all = await this.empleadosService.getAll();
      this.empleadosActivos.set(all.filter((e) => e.activo));
    } catch {
      // non-blocking: empleados list fallback
    }
  }

  // ── Date ─────────────────────────────────────────────────
  async onDateChange(value: string) {
    this.selectedDate.set(value);
    await this.loadRegistros();
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onEstadoFilter(value: string) {
    this.selectedEstado.set(value);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('');
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({
      empleado_id: '',
      fecha: this.selectedDate(),
      hora_entrada: null,
      hora_salida: null,
      estado: 'presente',
      notas: null,
    });
    this.drawerOpen.set(true);
  }

  openEdit(registro: AsistenciaModel) {
    this.editingId.set(registro.id);
    this.saveError.set('');
    this.form.reset({
      empleado_id: registro.empleado_id,
      fecha: registro.fecha,
      hora_entrada: registro.hora_entrada,
      hora_salida: registro.hora_salida,
      estado: registro.estado,
      notas: registro.notas,
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

    const payload = this.form.value as AsistenciaFormData;

    try {
      const saved = await this.asistenciaService.upsert(payload);
      // update or insert in local list
      const existing = this.registros().findIndex((r) => r.id === saved.id || (r.empleado_id === saved.empleado_id && r.fecha === saved.fecha));
      if (existing >= 0) {
        this.registros.update((list) => list.map((r, i) => (i === existing ? saved : r)));
      } else {
        this.registros.update((list) => [...list, saved]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  todayISO(): string {
    return todayIso();
  }

  getHorasTrabajadas(entrada: string | null, salida: string | null): string {
    if (!entrada || !salida) return '—';
    const [hE, mE] = entrada.split(':').map(Number);
    const [hS, mS] = salida.split(':').map(Number);
    const totalMin = (hS * 60 + mS) - (hE * 60 + mE);
    if (totalMin <= 0) return '—';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  getEstadoBadge(estado: EstadoAsistencia): string {
    return ESTADOS_ASISTENCIA.find((e) => e.value === estado)?.badge ?? 'neutral';
  }

  getEstadoLabel(estado: EstadoAsistencia): string {
    return ESTADOS_ASISTENCIA.find((e) => e.value === estado)?.label ?? estado;
  }

  hasRegistro(empleadoId: string): boolean {
    return this.registros().some((r) => r.empleado_id === empleadoId);
  }

  getRegistroByEmpleado(empleadoId: string): AsistenciaModel | undefined {
    return this.registros().find((r) => r.empleado_id === empleadoId);
  }

  getEmpleadoNombre(id: string): string {
    const emp = this.empleadosActivos().find((e) => e.id === id);
    return emp ? `${emp.apellido}, ${emp.nombre}` : id;
  }

  get f() {
    return this.form.controls;
  }
}
