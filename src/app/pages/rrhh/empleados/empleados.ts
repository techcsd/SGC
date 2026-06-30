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
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { Empleado, EmpleadoFormData, TIPOS_CONTRATO, DEPARTAMENTOS, TipoContrato } from '../../../../shared/models/empleado.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-empleados',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './empleados.html',
  styleUrl: './empleados.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Empleados implements OnInit {
  private empleadosService = inject(EmpleadosService);

  // ── Data state ──────────────────────────────────────────
  empleados = signal<Empleado[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedDepartamento = signal('');
  selectedTipoContrato = signal('');
  selectedActivo = signal<'all' | 'active' | 'inactive'>('all');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly TIPOS_CONTRATO = TIPOS_CONTRATO;
  readonly DEPARTAMENTOS = DEPARTAMENTOS;

  form = new FormGroup({
    cedula: new FormControl('', [Validators.required, Validators.maxLength(20)]),
    nombre: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    apellido: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    cargo: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    departamento: new FormControl<string | null>(null),
    tipo_contrato: new FormControl<TipoContrato>('indefinido', [Validators.required]),
    fecha_ingreso: new FormControl('', [Validators.required]),
    salario: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    telefono: new FormControl<string | null>(null),
    email: new FormControl<string | null>(null, [Validators.email]),
    direccion: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const dept = this.selectedDepartamento();
    const tipo = this.selectedTipoContrato();
    const status = this.selectedActivo();

    return this.empleados().filter((e) => {
      if (q) {
        const full = `${e.nombre} ${e.apellido} ${e.cedula} ${e.cargo}`.toLowerCase();
        if (!full.includes(q)) return false;
      }
      if (dept && e.departamento !== dept) return false;
      if (tipo && e.tipo_contrato !== tipo) return false;
      if (status === 'active' && !e.activo) return false;
      if (status === 'inactive' && e.activo) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar empleado' : 'Nuevo empleado',
  );

  // ── Summary cards ─────────────────────────────────────────
  totalActivos = computed(() => this.empleados().filter((e) => e.activo).length);
  totalPorContrato = computed(
    () => this.empleados().filter((e) => e.tipo_contrato === 'temporal' || e.tipo_contrato === 'obra').length,
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.empleadosService.getAll();
      this.empleados.set(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los empleados.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  onDepartamentoChange(value: string) {
    this.selectedDepartamento.set(value);
    this.currentPage.set(1);
  }

  onTipoContratoChange(value: string) {
    this.selectedTipoContrato.set(value);
    this.currentPage.set(1);
  }

  onActivoChange(value: string) {
    this.selectedActivo.set(value as 'all' | 'active' | 'inactive');
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedDepartamento.set('');
    this.selectedTipoContrato.set('');
    this.selectedActivo.set('all');
    this.currentPage.set(1);
  }

  hasFilters = computed(
    () => !!this.searchQuery() || !!this.selectedDepartamento() || !!this.selectedTipoContrato() || this.selectedActivo() !== 'all',
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
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ activo: true, tipo_contrato: 'indefinido', salario: 0 });
    this.drawerOpen.set(true);
  }

  openEdit(emp: Empleado) {
    this.editingId.set(emp.id);
    this.saveError.set('');
    this.form.reset({
      cedula: emp.cedula,
      nombre: emp.nombre,
      apellido: emp.apellido,
      cargo: emp.cargo,
      departamento: emp.departamento,
      tipo_contrato: emp.tipo_contrato,
      fecha_ingreso: emp.fecha_ingreso,
      salario: emp.salario,
      telefono: emp.telefono,
      email: emp.email,
      direccion: emp.direccion,
      activo: emp.activo,
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

    const payload = this.form.value as EmpleadoFormData;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.empleadosService.update(id, payload);
        this.empleados.update((list) => list.map((e) => (e.id === id ? updated : e)));
      } else {
        const created = await this.empleadosService.create(payload);
        this.empleados.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActivo(emp: Empleado) {
    const next = !emp.activo;
    this.empleados.update((list) =>
      list.map((e) => (e.id === emp.id ? { ...e, activo: next } : e)),
    );
    try {
      await this.empleadosService.toggleActivo(emp.id, next);
    } catch {
      this.empleados.update((list) =>
        list.map((e) => (e.id === emp.id ? { ...e, activo: !next } : e)),
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  getAntiguedad(fecha: string): string {
    const start = new Date(fecha);
    const now = new Date();
    const years = Math.floor((now.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (years === 0) return '< 1 año';
    return `${years} año${years !== 1 ? 's' : ''}`;
  }

  getTipoContratoBadge(tipo: TipoContrato): string {
    switch (tipo) {
      case 'indefinido': return 'success';
      case 'temporal': return 'warning';
      case 'obra': return 'info';
    }
  }

  getTipoContratoLabel(tipo: TipoContrato): string {
    return TIPOS_CONTRATO.find((t) => t.value === tipo)?.label ?? tipo;
  }

  get f() {
    return this.form.controls;
  }
}
