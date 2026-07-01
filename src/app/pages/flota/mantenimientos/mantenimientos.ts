import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MantenimientosService } from '../../../../shared/services/mantenimientos.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import {
  Mantenimiento,
  MantenimientoFormData,
  MANT_TIPOS,
  MANT_ESTADOS,
} from '../../../../shared/models/mantenimiento.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-mantenimientos',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './mantenimientos.html',
  styleUrl: './mantenimientos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mantenimientos implements OnInit {
  private mantenimientosService = inject(MantenimientosService);
  private vehiculosService = inject(VehiculosService);

  // ── Data state ──────────────────────────────────────────
  mantenimientos = signal<Mantenimiento[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedTipo = signal('');
  selectedEstado = signal('');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly MANT_TIPOS = MANT_TIPOS;
  readonly MANT_ESTADOS = MANT_ESTADOS;

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    tipo: new FormControl('preventivo', [Validators.required]),
    estado: new FormControl('pendiente', [Validators.required]),
    descripcion: new FormControl('', [Validators.required]),
    fecha: new FormControl('', [Validators.required]),
    costo: new FormControl<number | null>(null),
    kilometraje_al_mantenimiento: new FormControl<number | null>(null),
    proveedor: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tipo = this.selectedTipo();
    const estado = this.selectedEstado();

    return this.mantenimientos().filter((m) => {
      if (
        q &&
        !m.vehiculo?.placa.toLowerCase().includes(q) &&
        !m.vehiculo?.marca.toLowerCase().includes(q) &&
        !m.proveedor?.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (tipo && m.tipo !== tipo) return false;
      if (estado && m.estado !== estado) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar mantenimiento' : 'Nuevo mantenimiento',
  );

  // ── Upcoming maintenance alert (next 7 days) ──────────────
  proximosMantenimientos = computed(() => {
    const today = new Date();
    const in7Days = new Date();
    in7Days.setDate(today.getDate() + 7);
    const todayStr = this.toDateStr(today);
    const in7Str = this.toDateStr(in7Days);

    return this.mantenimientos()
      .filter((m) => m.estado !== 'completado' && m.fecha >= todayStr && m.fecha <= in7Str)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [mantenimientos, vehiculos] = await Promise.all([
        this.mantenimientosService.getAll(),
        this.vehiculosService.getAll(),
      ]);
      this.mantenimientos.set(mantenimientos);
      this.vehiculos.set(vehiculos);
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

  onTipoChange(value: string) {
    this.selectedTipo.set(value);
    this.currentPage.set(1);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedTipo.set('');
    this.selectedEstado.set('');
    this.currentPage.set(1);
  }

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
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ tipo: 'preventivo', estado: 'pendiente' });
    this.drawerOpen.set(true);
  }

  openEdit(m: Mantenimiento) {
    this.editingId.set(m.id);
    this.saveError.set('');
    this.form.reset({
      vehiculo_id: m.vehiculo_id,
      tipo: m.tipo,
      estado: m.estado,
      descripcion: m.descripcion,
      fecha: m.fecha,
      costo: m.costo,
      kilometraje_al_mantenimiento: m.kilometraje_al_mantenimiento,
      proveedor: m.proveedor,
      notas: m.notas,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const payload = this.form.value as MantenimientoFormData;

    const conflict = this.findWeekConflict(payload);
    if (conflict) {
      this.saveError.set(
        `Conflicto de calendario: el vehículo ${conflict.vehiculo?.placa ?? ''} ya tiene un mantenimiento programado la semana del ${conflict.fecha}. No se pueden programar dos vehículos en mantenimiento la misma semana.`,
      );
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.mantenimientosService.update(id, payload);
        this.mantenimientos.update((list) => list.map((m) => (m.id === id ? updated : m)));
      } else {
        const created = await this.mantenimientosService.create(payload);
        this.mantenimientos.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** ISO-ish week key ("2026-W27") derived from a YYYY-MM-DD string, no UTC parsing. */
  private getWeekKey(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 4 - (date.getDay() || 7));
    const yearStart = new Date(date.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getFullYear()}-W${weekNo}`;
  }

  /** Two different vehicles can't both be scheduled for maintenance the same week. */
  private findWeekConflict(payload: MantenimientoFormData): Mantenimiento | null {
    if (payload.estado === 'completado') return null;
    const targetWeek = this.getWeekKey(payload.fecha);
    const editing = this.editingId();

    return (
      this.mantenimientos().find((m) => {
        if (m.id === editing) return false;
        if (m.estado === 'completado') return false;
        if (m.vehiculo_id === payload.vehiculo_id) return false;
        return this.getWeekKey(m.fecha) === targetWeek;
      }) ?? null
    );
  }

  getEstadoBadge(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'sgc-badge sgc-badge--warning';
      case 'en_proceso': return 'sgc-badge sgc-badge--info';
      case 'completado': return 'sgc-badge sgc-badge--success';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  getEstadoLabel(estado: string): string {
    return MANT_ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }

  getTipoLabel(tipo: string): string {
    return MANT_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  get f() {
    return this.form.controls;
  }
}
