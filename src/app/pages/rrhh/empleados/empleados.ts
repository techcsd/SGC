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
import { UserService } from '../../../core/services/user.service';
import {
  Empleado,
  EmpleadoDocumento,
  TIPOS_CONTRATO,
  DEPARTAMENTOS,
  TipoContrato,
  GENEROS,
  ESTADOS_CIVILES,
  TIPOS_DOCUMENTO_EMPLEADO,
  CARGOS,
  AFPS,
  ARS_LIST,
  BANCOS,
  CEDULA_PATTERN,
} from '../../../../shared/models/empleado.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { TelefonoMask } from '../../../../shared/ui/telefono-mask.directive';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatAntiguedad, todayIso } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-empleados',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, TelefonoMask],
  templateUrl: './empleados.html',
  styleUrl: './empleados.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Empleados implements OnInit {
  private empleadosService = inject(EmpleadosService);
  private userService = inject(UserService);

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
  readonly GENEROS = GENEROS;
  readonly ESTADOS_CIVILES = ESTADOS_CIVILES;
  readonly TIPOS_DOCUMENTO = TIPOS_DOCUMENTO_EMPLEADO;
  readonly CARGOS = CARGOS;
  readonly AFPS = AFPS;
  readonly ARS_LIST = ARS_LIST;
  readonly BANCOS = BANCOS;
  readonly today = todayIso();

  // ── Employee documents (edit mode) ───────────────────────
  documentos = signal<EmpleadoDocumento[]>([]);
  documentosLoading = signal(false);
  uploadingDoc = signal(false);
  docTipo = new FormControl<string>('contrato');

  form = new FormGroup({
    cedula: new FormControl('', [Validators.required, Validators.pattern(CEDULA_PATTERN)]),
    nombre: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    apellido: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    cargo: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    departamento: new FormControl<string | null>(null),
    tipo_contrato: new FormControl<TipoContrato>('indefinido', [Validators.required]),
    fecha_ingreso: new FormControl('', [Validators.required]),
    salario: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    telefono: new FormControl<string | null>(null),
    email: new FormControl<string | null>(null, [Validators.email]),
    direccion: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
    // ── Datos personales ──
    fecha_nacimiento: new FormControl<string | null>(null),
    genero: new FormControl<string | null>(null),
    estado_civil: new FormControl<string | null>(null),
    contacto_emergencia_nombre: new FormControl<string | null>(null),
    contacto_emergencia_telefono: new FormControl<string | null>(null),
    // ── Organización / RRHH ──
    jefe_id: new FormControl<string | null>(null),
    dias_vacaciones_anuales: new FormControl<number>(14, [Validators.min(0), Validators.max(60)]),
    fecha_egreso: new FormControl<string | null>(null),
    motivo_egreso: new FormControl<string | null>(null),
    // ── Seguridad social / nómina ──
    numero_tss: new FormControl<string | null>(null),
    afp: new FormControl<string | null>(null),
    ars: new FormControl<string | null>(null),
    banco: new FormControl<string | null>(null),
    cuenta_banco: new FormControl<string | null>(null),
  });

  // Possible supervisors: any active employee other than the one being edited.
  jefeOptions = computed(() =>
    this.empleados().filter((e) => e.activo && e.id !== this.editingId()),
  );

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
    this.documentos.set([]);
    this.form.reset({ activo: true, tipo_contrato: 'indefinido', dias_vacaciones_anuales: 14 });
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
      fecha_nacimiento: emp.fecha_nacimiento,
      genero: emp.genero,
      estado_civil: emp.estado_civil,
      contacto_emergencia_nombre: emp.contacto_emergencia_nombre,
      contacto_emergencia_telefono: emp.contacto_emergencia_telefono,
      jefe_id: emp.jefe_id,
      dias_vacaciones_anuales: emp.dias_vacaciones_anuales,
      fecha_egreso: emp.fecha_egreso,
      motivo_egreso: emp.motivo_egreso,
      numero_tss: emp.numero_tss,
      afp: emp.afp,
      ars: emp.ars,
      banco: emp.banco,
      cuenta_banco: emp.cuenta_banco,
    });
    this.drawerOpen.set(true);
    void this.loadDocumentos(emp.id);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  // ── Employee documents ───────────────────────────────────
  private async loadDocumentos(empleadoId: string) {
    this.documentosLoading.set(true);
    this.documentos.set([]);
    try {
      this.documentos.set(await this.empleadosService.getDocumentos(empleadoId));
    } finally {
      this.documentosLoading.set(false);
    }
  }

  async onDocSelected(event: Event) {
    const empleadoId = this.editingId();
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!empleadoId || !files || files.length === 0) return;

    this.uploadingDoc.set(true);
    try {
      const tipo = this.docTipo.value || 'otro';
      for (const file of Array.from(files)) {
        const doc = await this.empleadosService.subirDocumento(empleadoId, tipo, file, this.userService.profile()?.id ?? null);
        this.documentos.update((list) => [doc, ...list]);
      }
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al subir el documento.');
    } finally {
      this.uploadingDoc.set(false);
      input.value = '';
    }
  }

  async descargarDoc(doc: EmpleadoDocumento) {
    const url = await this.empleadosService.getDocumentoUrl(doc.archivo_path);
    window.open(url, '_blank');
  }

  async eliminarDoc(doc: EmpleadoDocumento) {
    await this.empleadosService.eliminarDocumento(doc.id, doc.archivo_path);
    this.documentos.update((list) => list.filter((d) => d.id !== doc.id));
  }

  docTipoLabel(tipo: string): string {
    return this.TIPOS_DOCUMENTO.find((t) => t.value === tipo)?.label ?? tipo;
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const raw = this.form.value;
    const payload: Partial<Empleado> = {
      cedula: raw.cedula!,
      nombre: raw.nombre!,
      apellido: raw.apellido!,
      cargo: raw.cargo!,
      departamento: raw.departamento || null,
      tipo_contrato: raw.tipo_contrato!,
      fecha_ingreso: raw.fecha_ingreso!,
      salario: raw.salario ?? 0,
      telefono: raw.telefono || null,
      email: raw.email || null,
      direccion: raw.direccion || null,
      activo: raw.activo ?? true,
      fecha_nacimiento: raw.fecha_nacimiento || null,
      genero: (raw.genero as Empleado['genero']) || null,
      estado_civil: (raw.estado_civil as Empleado['estado_civil']) || null,
      contacto_emergencia_nombre: raw.contacto_emergencia_nombre || null,
      contacto_emergencia_telefono: raw.contacto_emergencia_telefono || null,
      jefe_id: raw.jefe_id || null,
      dias_vacaciones_anuales: raw.dias_vacaciones_anuales ?? 14,
      fecha_egreso: raw.fecha_egreso || null,
      motivo_egreso: raw.motivo_egreso || null,
      numero_tss: raw.numero_tss || null,
      afp: raw.afp || null,
      ars: raw.ars || null,
      banco: raw.banco || null,
      cuenta_banco: raw.cuenta_banco || null,
    };

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
    return formatAntiguedad(fecha);
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
