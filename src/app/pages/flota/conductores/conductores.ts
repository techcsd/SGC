import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import {
  Conductor,
  ConductorFormData,
  LICENCIA_TIPOS,
} from '../../../../shared/models/conductor.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { daysUntil } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-conductores',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './conductores.html',
  styleUrl: './conductores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conductores implements OnInit {
  private conductoresService = inject(ConductoresService);
  private vehiculosService = inject(VehiculosService);

  // ── Data state ──────────────────────────────────────────
  conductores = signal<Conductor[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedActivo = signal<'all' | 'active' | 'inactive'>('all');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly LICENCIA_TIPOS = LICENCIA_TIPOS;

  form = new FormGroup({
    cedula: new FormControl('', [Validators.required]),
    nombre: new FormControl('', [Validators.required]),
    telefono: new FormControl<string | null>(null),
    licencia_tipo: new FormControl<string>('B', [Validators.required]),
    licencia_numero: new FormControl<string | null>(null),
    licencia_vencimiento: new FormControl<string | null>(null),
    vehiculo_id: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const activo = this.selectedActivo();

    return this.conductores().filter((c) => {
      if (q && !c.nombre.toLowerCase().includes(q) && !c.cedula.toLowerCase().includes(q)) {
        return false;
      }
      if (activo === 'active' && !c.activo) return false;
      if (activo === 'inactive' && c.activo) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar conductor' : 'Nuevo conductor',
  );

  // Vehicles available to assign: unassigned ones, plus the one already
  // assigned to the conductor being edited (so it stays selectable).
  availableVehiculos = computed(() => {
    const assignedIds = new Set(
      this.conductores()
        .filter((c) => c.id !== this.editingId())
        .map((c) => c.vehiculo_id)
        .filter((id): id is string => !!id),
    );
    return this.vehiculos().filter((v) => v.activo && !assignedIds.has(v.id));
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [conductores, vehiculos] = await Promise.all([
        this.conductoresService.getAll(),
        this.vehiculosService.getAll(),
      ]);
      this.conductores.set(conductores);
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

  onActivoChange(value: string) {
    this.selectedActivo.set(value as 'all' | 'active' | 'inactive');
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedActivo.set('all');
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
    this.form.reset({ activo: true, licencia_tipo: 'B' });
    this.drawerOpen.set(true);
  }

  openEdit(c: Conductor) {
    this.editingId.set(c.id);
    this.saveError.set('');
    this.form.reset({
      cedula: c.cedula,
      nombre: c.nombre,
      telefono: c.telefono,
      licencia_tipo: c.licencia_tipo,
      licencia_numero: c.licencia_numero,
      licencia_vencimiento: c.licencia_vencimiento,
      vehiculo_id: c.vehiculo_id,
      activo: c.activo,
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

    const payload = this.form.value as ConductorFormData;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.conductoresService.update(id, payload);
        this.conductores.update((list) => list.map((c) => (c.id === id ? updated : c)));
      } else {
        const created = await this.conductoresService.create(payload);
        this.conductores.update((list) => [...list, created].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async toggleActivo(c: Conductor) {
    const next = !c.activo;
    this.conductores.update((list) =>
      list.map((item) => (item.id === c.id ? { ...item, activo: next } : item)),
    );
    try {
      await this.conductoresService.toggleActivo(c.id, next);
    } catch {
      this.conductores.update((list) =>
        list.map((item) => (item.id === c.id ? { ...item, activo: !next } : item)),
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  isLicenciaExpiringSoon(vencimiento: string | null): boolean {
    if (!vencimiento) return false;
    return daysUntil(vencimiento) <= 30;
  }

  isLicenciaExpired(vencimiento: string | null): boolean {
    if (!vencimiento) return false;
    return daysUntil(vencimiento) < 0;
  }

  getLicenciaClass(vencimiento: string | null): string {
    if (this.isLicenciaExpired(vencimiento)) return 'conductores__licencia-date conductores__licencia-date--expired';
    if (this.isLicenciaExpiringSoon(vencimiento)) return 'conductores__licencia-date conductores__licencia-date--warning';
    return 'conductores__licencia-date';
  }

  get f() {
    return this.form.controls;
  }
}
