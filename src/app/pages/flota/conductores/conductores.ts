import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ConductoresService,
  UsuarioVinculable,
  ConductorDocumentosResumen,
} from '../../../../shared/services/conductores.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { FlotaConfigService } from '../../../../shared/services/flota-config.service';
import { DocumentosFlotaService } from '../../../../shared/services/documentos-flota.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import {
  Conductor,
  ConductorFormData,
  LicenciaCategoria,
  CONDUCTOR_TAGS_SUGERIDOS,
  TIPO_VEHICULO_AUTORIZADO,
} from '../../../../shared/models/conductor.model';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { VehiculoAsignacion } from '../../../../shared/models/vehiculo-asignacion.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TelefonoMask } from '../../../../shared/ui/telefono-mask.directive';
import { daysUntil, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { formatearTelefono } from '../../../../shared/utils/telefono.util';
import { cleanUuid } from '../../../../shared/utils/uuid.util';

@Component({
  selector: 'app-conductores',
  imports: [ReactiveFormsModule, FormDrawer, RouterLink, TelefonoMask, Skeleton],
  templateUrl: './conductores.html',
  styleUrl: './conductores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conductores implements OnInit {
  private conductoresService = inject(ConductoresService);
  private vehiculosService = inject(VehiculosService);
  private flotaConfig = inject(FlotaConfigService);
  private documentosService = inject(DocumentosFlotaService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private datosPrueba = inject(DatosPruebaService);

  // T2 — solo admin ve/gestiona datos de prueba (enforcement server-side vía RLS).
  esAdmin = computed(() => this.userService.hasRole('admin'));
  // T2 — mostrar datos de prueba (solo admin; por defecto ocultos).
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Data state ──────────────────────────────────────────
  conductores = signal<Conductor[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  usuarios = signal<UsuarioVinculable[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedActivo = signal<'all' | 'active' | 'inactive'>('all');
  soloIncompletos = signal(false); // C7 — filtrar por documentos incompletos

  // C7 — mapa conductor_id → resumen de documentos destacados.
  private docsResumen = signal<Map<string, ConductorDocumentosResumen>>(new Map());

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  readonly TIPOS_AUTORIZADOS = TIPO_VEHICULO_AUTORIZADO;
  readonly TAGS_SUGERIDOS = CONDUCTOR_TAGS_SUGERIDOS;

  // C1 — catálogo de categorías de licencia RD (cargado de BD).
  categorias = signal<LicenciaCategoria[]>([]);

  // C3 — tags del conductor (chips) editados fuera del FormGroup.
  tags = signal<string[]>([]);
  tagInput = signal('');

  // C4 — documentos opcionales elegidos en el alta (se suben tras crear).
  docsAlta = signal<{ cedula: File | null; licencia: File[] }>({ cedula: null, licencia: [] });

  // P5 — acceso del conductor (cédula + PIN). Gated a admin o módulo flota.
  puedeGestionarAcceso = computed(
    () => this.userService.hasRole('admin') || this.userService.hasModulo('flota'),
  );
  accesoConductor = signal<Conductor | null>(null);
  accesoPin = signal('');
  accesoSaving = signal(false);
  accesoError = signal('');
  accesoOk = signal('');

  /**
   * P5 — ¿este conductor usa acceso por cédula+PIN? Sí si no tiene usuario, o si
   * su usuario es una cuenta sintética de conductor. Los vinculados a un correo
   * real (p. ej. el jefe de flota) inician sesión con su correo → sin PIN.
   */
  usaAccesoPin(c: Conductor): boolean {
    if (!c.usuario_id) return true;
    const email = c.usuario?.email ?? '';
    return email.endsWith('@conductores.constructorasd.local');
  }

  openAcceso(c: Conductor) {
    this.accesoConductor.set(c);
    this.accesoPin.set('');
    this.accesoError.set('');
    this.accesoOk.set('');
  }

  closeAcceso() {
    this.accesoConductor.set(null);
  }

  async guardarAcceso() {
    const c = this.accesoConductor();
    if (!c || this.accesoSaving()) return;
    const pin = this.accesoPin().trim();
    if (!/^\d{6}$/.test(pin)) {
      this.accesoError.set('El PIN debe tener exactamente 6 dígitos.');
      return;
    }
    this.accesoSaving.set(true);
    this.accesoError.set('');
    this.accesoOk.set('');
    try {
      const res = await this.conductoresService.generarAccesoConductor(c.id, pin);
      // R2 — Reflejar el enlace sin recargar. Además del usuario_id hay que poblar
      // `usuario.email` sintético para que usaAccesoPin() siga devolviendo true y el
      // botón pase de "Generar acceso" a "Restablecer PIN" al instante (antes el
      // email quedaba '' y el botón desaparecía hasta recargar).
      if (res.usuarioId) {
        const usuarioSintetico = {
          nombre: c.nombre,
          email: `c-${c.cedula}@conductores.constructorasd.local`,
        };
        this.conductores.update((list) =>
          list.map((x) =>
            x.id === c.id ? { ...x, usuario_id: res.usuarioId, usuario: usuarioSintetico } : x,
          ),
        );
        this.accesoConductor.update((x) =>
          x ? { ...x, usuario_id: res.usuarioId, usuario: usuarioSintetico } : x,
        );
      }
      this.accesoOk.set(
        res.rotated
          ? `PIN restablecido. El conductor entra con su cédula (${c.cedula}) y el nuevo PIN.`
          : `Acceso generado. El conductor entra con su cédula (${c.cedula}) y el PIN.`,
      );
      this.accesoPin.set('');
    } catch (e: unknown) {
      this.accesoError.set(e instanceof Error ? e.message : 'No se pudo generar el acceso.');
    } finally {
      this.accesoSaving.set(false);
    }
  }

  // C1 — mapa codigo->label para el listado (Cat. 02 — Vehículos livianos).
  categoriaLabel(codigo: string | null | undefined): string {
    if (!codigo) return '—';
    const c = this.categorias().find((x) => x.codigo === codigo);
    return c ? `${c.codigo} — ${c.nombre}` : codigo;
  }

  form = new FormGroup({
    cedula: new FormControl('', [Validators.required, Validators.pattern(/^\d{3}-?\d{7}-?\d$/)]),
    nombre: new FormControl('', [Validators.required]),
    telefono: new FormControl<string | null>(null, [Validators.maxLength(20)]),
    licencia_tipo: new FormControl<string>('02', [Validators.required]),
    licencia_numero: new FormControl<string | null>(null, [Validators.maxLength(30)]),
    licencia_vencimiento: new FormControl<string | null>(null),
    tipo_vehiculo_autorizado: new FormControl<string>('Ambos', [Validators.required]),
    vehiculo_id: new FormControl<string | null>(null),
    usuario_id: new FormControl<string | null>(null),
    nota: new FormControl<string | null>(null, [Validators.maxLength(500)]),
    activo: new FormControl<boolean>(true),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const activo = this.selectedActivo();
    const soloIncompletos = this.soloIncompletos();
    // T2 — no-admin nunca ve datos de prueba (RLS); admin los oculta salvo toggle.
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.conductores().filter((c) => {
      if (c.es_prueba && !verPrueba) return false;
      if (q && !c.nombre.toLowerCase().includes(q) && !c.cedula.toLowerCase().includes(q)) {
        return false;
      }
      if (activo === 'active' && !c.activo) return false;
      if (activo === 'inactive' && c.activo) return false;
      if (soloIncompletos && !this.docsIncompletos(c.id)) return false;
      return true;
    });
  });

  /**
   * C7 — si al conductor le falta algún documento destacado (cédula o licencia).
   * Sin resumen global (vista no disponible) no marca nada, para no dar falsos avisos.
   */
  docsIncompletos(conductorId: string): boolean {
    const map = this.docsResumen();
    if (map.size === 0) return false;
    const r = map.get(conductorId);
    if (!r) return true; // sin fila = sin documentos
    return !r.tiene_cedula || !r.tiene_licencia;
  }

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar conductor' : 'Nuevo conductor',
  );

  // U1 — pool compartido: los vehículos son seleccionables por todos; NO se
  // excluyen los "ya asignados". Solo se listan los que pueden operar.
  availableVehiculos = computed(() =>
    this.vehiculos().filter((v) => v.activo && v.estado !== 'baja'),
  );

  // U2 — asignaciones activas del usuario vinculado (fuente de verdad:
  // vehiculo_asignaciones). El form las MUESTRA para no ofrecer "asignar" como
  // si el usuario no tuviera vehículo.
  asignacionesUsuario = signal<VehiculoAsignacion[]>([]);

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [conductores, vehiculos, usuarios, categorias, docsResumen] = await Promise.all([
        this.conductoresService.getAll(),
        this.vehiculosService.getAll(),
        this.conductoresService.getUsuariosVinculables(),
        this.conductoresService.getCategoriasLicencia(),
        this.conductoresService.getDocumentosResumen(),
      ]);
      this.conductores.set(conductores);
      this.vehiculos.set(vehiculos);
      this.usuarios.set(usuarios);
      this.categorias.set(categorias);
      this.docsResumen.set(new Map(docsResumen.map((r) => [r.conductor_id, r])));
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

  toggleIncompletos() {
    this.soloIncompletos.update((v) => !v);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedActivo.set('all');
    this.soloIncompletos.set(false);
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
    this.asignacionesUsuario.set([]);
    this.tags.set([]);
    this.tagInput.set('');
    this.docsAlta.set({ cedula: null, licencia: [] });
    // C1 — default '02' (vehículos livianos), la categoría RD más común.
    this.form.reset({ activo: true, licencia_tipo: '02', tipo_vehiculo_autorizado: 'Ambos' });
    this.drawerOpen.set(true);
  }

  openEdit(c: Conductor) {
    this.editingId.set(c.id);
    this.saveError.set('');
    this.tags.set([...(c.tags ?? [])]);
    this.tagInput.set('');
    this.docsAlta.set({ cedula: null, licencia: [] });
    this.form.reset({
      cedula: c.cedula,
      nombre: c.nombre,
      telefono: c.telefono,
      licencia_tipo: c.licencia_tipo,
      licencia_numero: c.licencia_numero,
      licencia_vencimiento: c.licencia_vencimiento,
      tipo_vehiculo_autorizado: c.tipo_vehiculo_autorizado ?? 'Ambos',
      vehiculo_id: c.vehiculo_id,
      usuario_id: c.usuario_id,
      nota: c.nota,
      activo: c.activo,
    });
    void this.cargarAsignacionesUsuario(c.usuario_id ?? null);
    this.drawerOpen.set(true);
  }

  // ── C3 — tags (chips) ─────────────────────────────────────
  addTag(raw: string) {
    const t = raw.trim();
    if (!t) return;
    // Homologación: primera mayúscula; sin duplicados (case-insensitive).
    const norm = t.charAt(0).toUpperCase() + t.slice(1);
    if (!this.tags().some((x) => x.toLowerCase() === norm.toLowerCase())) {
      this.tags.update((list) => [...list, norm]);
    }
    this.tagInput.set('');
  }

  removeTag(tag: string) {
    this.tags.update((list) => list.filter((t) => t !== tag));
  }

  onTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addTag(this.tagInput());
    }
  }

  /**
   * B4/U3 — al vincular un usuario existente, autollena lo que su ficha ya tiene
   * (nombre, cédula, teléfono) sin pisar lo que el usuario ya escribió (editable).
   * U2 — carga sus asignaciones activas para reflejarlas en el form.
   */
  onUsuarioChange(usuarioId: string) {
    // C2 — un <select> nativo con [value]="null" entrega el string "null" al
    // desvincular. cleanUuid lo normaliza a null real (ver onSave y el servicio).
    const id = this.cleanUuid(usuarioId);
    this.form.controls.usuario_id.setValue(id);
    if (id) {
      const u = this.usuarios().find((x) => x.id === id);
      if (u) {
        const c = this.form.controls;
        if (!c.nombre.value?.trim()) c.nombre.setValue(u.nombre);
        if (u.cedula && !c.cedula.value?.trim()) c.cedula.setValue(u.cedula);
        if (u.telefono && !c.telefono.value?.trim()) c.telefono.setValue(u.telefono);
      }
    }
    void this.cargarAsignacionesUsuario(id);
  }

  private async cargarAsignacionesUsuario(usuarioId: string | null) {
    if (!usuarioId) {
      this.asignacionesUsuario.set([]);
      return;
    }
    try {
      this.asignacionesUsuario.set(await this.vehiculosService.getAsignacionesActivasByUsuario(usuarioId));
    } catch {
      this.asignacionesUsuario.set([]);
    }
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    // C2 — sanea los uuid opcionales: un <select> nativo con [value]="null"
    // entrega el string "null", que rompe el cast a uuid en Postgres.
    // C3 — nota + tags (tags viven fuera del FormGroup).
    const raw = this.form.value;
    const tags = this.tags();
    const payload = {
      ...raw,
      usuario_id: this.cleanUuid(raw.usuario_id),
      vehiculo_id: this.cleanUuid(raw.vehiculo_id),
      nota: raw.nota?.trim() || null,
      tags: tags.length > 0 ? tags : null,
    } as ConductorFormData;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.conductoresService.update(id, payload);
        this.conductores.update((list) => list.map((c) => (c.id === id ? updated : c)));
        await this.subirDocsAlta(id); // C4 — también en edición, si se eligieron
      } else {
        const created = await this.conductoresService.create(payload);
        this.conductores.update((list) => [...list, created].sort((a, b) => a.nombre.localeCompare(b.nombre)));
        await this.subirDocsAlta(created.id); // C4 — subir cédula/licencia opcionales
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── C4 — documentos opcionales en el alta ─────────────────
  onDocPick(tipo: 'cedula' | 'licencia', event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    if (tipo === 'cedula') {
      this.docsAlta.update((d) => ({ ...d, cedula: files[0] }));
    } else {
      this.docsAlta.update((d) => ({ ...d, licencia: [...d.licencia, ...files] }));
    }
  }

  removeDocAlta(tipo: 'cedula' | 'licencia', index?: number) {
    if (tipo === 'cedula') {
      this.docsAlta.update((d) => ({ ...d, cedula: null }));
    } else {
      this.docsAlta.update((d) => ({ ...d, licencia: d.licencia.filter((_, i) => i !== index) }));
    }
  }

  /**
   * C4 — sube cédula/licencia elegidas en el drawer tras crear/editar el
   * conductor. No bloquea el guardado: un fallo avisa por toast y sigue.
   */
  private async subirDocsAlta(conductorId: string) {
    const docs = this.docsAlta();
    const usuarioId = this.userService.profile()?.id ?? null;
    const jobs: Promise<unknown>[] = [];
    if (docs.cedula) {
      jobs.push(this.documentosService.upload('conductor', conductorId, 'cedula', docs.cedula, docs.cedula.name, usuarioId));
    }
    for (const f of docs.licencia) {
      jobs.push(this.documentosService.upload('conductor', conductorId, 'licencia', f, f.name, usuarioId));
    }
    if (jobs.length === 0) return;
    const results = await Promise.allSettled(jobs);
    const fallidos = results.filter((r) => r.status === 'rejected').length;
    if (fallidos > 0) {
      this.toast.warning('Documentos', `${fallidos} documento(s) no se pudieron subir. Puedes reintentarlo desde el perfil.`);
    }
    this.docsAlta.set({ cedula: null, licencia: [] });
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

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca/desmarca el conductor como dato de prueba. */
  async marcarPrueba(c: Conductor, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar('conductores', c.id, valor);
      this.conductores.update((list) =>
        list.map((x) => (x.id === c.id ? { ...x, es_prueba: valor } : x)),
      );
      this.toast.success(
        valor ? 'Marcado como prueba' : 'Quitado de prueba',
        `"${c.nombre}" ${valor ? 'ahora es un dato de prueba' : 'ya no es un dato de prueba'}.`,
      );
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  /** Elimina definitivamente un conductor de prueba (solo admin). */
  async eliminarPrueba(c: Conductor) {
    if (!this.esAdmin() || !c.es_prueba) return;
    if (!confirm(`¿Eliminar el dato de prueba "${c.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.datosPrueba.eliminar('conductores', c.id);
      this.conductores.update((list) => list.filter((x) => x.id !== c.id));
      this.toast.success('Dato de prueba eliminado', `Se eliminó "${c.nombre}".`);
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  // C2 — normaliza uuid de <select> ("null"/""/undefined → null). Ver uuid.util.
  private cleanUuid = cleanUuid;

  // U9 — fecha legible; U5 — teléfono formateado en el listado.
  formatFecha = formatFechaDisplay;
  formatTelefono = formatearTelefono;

  isLicenciaExpiringSoon(vencimiento: string | null): boolean {
    if (!vencimiento) return false;
    return daysUntil(vencimiento) <= this.flotaConfig.umbralLicenciaDias();
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
