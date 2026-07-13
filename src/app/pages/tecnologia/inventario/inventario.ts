import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  TecEquipo,
  TecEquipoFormData,
  TecEquipoEstado,
  TecEquipoHistorial,
  TEC_EQUIPO_TIPOS,
  TEC_EQUIPO_ESTADOS,
} from '../../../../shared/models/tecnologia.model';
import { Empleado } from '../../../../shared/models/empleado.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-tec-inventario',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecInventario implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private empleadosService = inject(EmpleadosService);
  private toast = inject(ToastService);

  readonly TIPOS = TEC_EQUIPO_TIPOS;
  readonly ESTADOS = TEC_EQUIPO_ESTADOS;

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;

  equipos = signal<TecEquipo[]>([]);
  empleados = signal<Empleado[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ───────────────────────────────────────────────
  searchQuery = signal('');
  selectedEstado = signal<string>('');

  // ── Create/Edit drawer ────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  // ── Detail/history drawer ─────────────────────────────────
  detailOpen = signal(false);
  detailEquipo = signal<TecEquipo | null>(null);
  historial = signal<TecEquipoHistorial[]>([]);
  historialLoading = signal(false);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    tipo: new FormControl<string | null>(null, [Validators.required]),
    marca: new FormControl<string | null>(null),
    modelo: new FormControl<string | null>(null),
    serie: new FormControl<string | null>(null),
    estado: new FormControl<TecEquipoEstado>('en_stock', [Validators.required]),
    empleado_id: new FormControl<string | null>(null),
    asignado_en: new FormControl<string | null>(null),
    ubicacion: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  drawerTitle = computed(() => (this.editingId() ? 'Editar equipo' : 'Nuevo equipo'));

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    return this.equipos().filter((e) => {
      if (
        q &&
        !e.nombre.toLowerCase().includes(q) &&
        !(e.codigo?.toLowerCase().includes(q) ?? false) &&
        !(e.serie?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      if (estado && e.estado !== estado) return false;
      return true;
    });
  });

  hasActiveFilters = computed(() => !!this.searchQuery() || !!this.selectedEstado());

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [equipos, empleados] = await Promise.all([
        this.tecnologia.getEquipos(),
        this.empleadosService.getAll(),
      ]);
      this.equipos.set(equipos);
      this.empleados.set(empleados);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el inventario.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  getTipoLabel(value: string): string {
    return this.TIPOS.find((t) => t.value === value)?.label ?? value;
  }

  getEstadoLabel(value: string): string {
    return this.ESTADOS.find((e) => e.value === value)?.label ?? value;
  }

  getEstadoBadge(value: string): string {
    return this.ESTADOS.find((e) => e.value === value)?.badge ?? 'neutral';
  }

  getEmpleadoNombre(e: TecEquipo): string {
    if (e.empleado) return `${e.empleado.nombre} ${e.empleado.apellido}`;
    return '—';
  }

  // ── Filters ───────────────────────────────────────────────
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

  // ── Create/Edit drawer ────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({
      nombre: '',
      tipo: null,
      marca: null,
      modelo: null,
      serie: null,
      estado: 'en_stock',
      empleado_id: null,
      asignado_en: null,
      ubicacion: null,
      notas: null,
    });
    this.drawerOpen.set(true);
  }

  openEdit(e: TecEquipo) {
    this.editingId.set(e.id);
    this.saveError.set('');
    this.form.reset({
      nombre: e.nombre,
      tipo: e.tipo,
      marca: e.marca,
      modelo: e.modelo,
      serie: e.serie,
      estado: e.estado,
      empleado_id: e.empleado_id,
      asignado_en: e.asignado_en,
      ubicacion: e.ubicacion,
      notas: e.notas,
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

    const payload = this.form.value as TecEquipoFormData;

    try {
      const id = this.editingId();
      if (id) {
        await this.tecnologia.updateEquipo(id, payload);
        await this.loadAll();
        this.toast.success('Equipo actualizado');
      } else {
        const created = await this.tecnologia.createEquipo(payload);
        this.equipos.update((list) => [created, ...list]);
        this.toast.success('Equipo registrado');
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(e: TecEquipo) {
    if (!confirm(`¿Eliminar el equipo "${e.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.tecnologia.removeEquipo(e.id);
      this.equipos.update((list) => list.filter((x) => x.id !== e.id));
      this.toast.success('Equipo eliminado');
    } catch (err: unknown) {
      this.toast.error(err instanceof Error ? err.message : 'Error al eliminar.');
    }
  }

  // ── Detail / history drawer ───────────────────────────────
  async openDetail(e: TecEquipo) {
    this.detailEquipo.set(e);
    this.detailOpen.set(true);
    this.historial.set([]);
    this.historialLoading.set(true);
    try {
      const historial = await this.tecnologia.getHistorial(e.id);
      this.historial.set(historial);
    } catch {
      this.toast.error('No se pudo cargar el historial.');
    } finally {
      this.historialLoading.set(false);
    }
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  get f() {
    return this.form.controls;
  }
}
