import { Component, ChangeDetectionStrategy, ElementRef, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Cargo, DuplicadoGrupo, PersonalObra, NACIONALIDAD_LABEL } from '../../../../shared/models/personal-obra.model';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';
import { formatFechaDisplay, formatFechaHoraDisplay } from '../../../../shared/utils/fecha.util';
import { TelemetryService } from '../../../../shared/services/telemetry.service';
import { FilterSelect, FilterOption } from '../../../../shared/ui/filter-select/filter-select';
import { Icon } from '../../../../shared/ui/icon/icon';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

interface PapeleraRow {
  id: string;
  nombre: string;
  proyecto: string | null;
  eliminado_at: string;
  eliminado_por: string | null;
  eliminado_motivo: string | null;
}

/** BO6 — normaliza para búsqueda: minúsculas, sin acentos (NFD), espacios colapsados. */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** AR1 — Listado de Personal de obra (filtros por obra/cargo/nacionalidad/estado). */
@Component({
  selector: 'app-personal-obra',
  imports: [FormsModule, Skeleton, RouterLink, FilterSelect, Icon, FormDrawer, StaggerDirective, TranslatePipe],
  templateUrl: './personal.html',
  styleUrl: './personal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocClick($event)' },
})
export class PersonalObraLista implements OnInit {
  private service = inject(PersonalObraService);
  private proyectos = inject(ProyectosService);
  private datosPrueba = inject(DatosPruebaViewService);
  private telemetry = inject(TelemetryService);
  private router = inject(Router);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private host = inject(ElementRef<HTMLElement>);

  readonly nacionalidadLabel = NACIONALIDAD_LABEL;
  esAdmin = computed(() => this.userService.hasRole('admin'));
  esLegalOAdmin = computed(() => this.esAdmin() || this.userService.hasRole('legal') || this.userService.hasRole('abogado'));
  // CP — "⋯" agrupa las acciones secundarias (antes 2 botones sueltos); se oculta
  // del todo si el usuario no tiene ninguna de las dos.
  tieneAccionesExtra = computed(() => this.esLegalOAdmin() || this.esAdmin());
  menuOpen = signal(false);
  toggleMenu() { this.menuOpen.update((v) => !v); }
  onDocClick(ev: MouseEvent) {
    if (this.menuOpen() && !this.host.nativeElement.contains(ev.target as Node)) this.menuOpen.set(false);
  }

  // CE16 — panel de posibles duplicados.
  dupOpen = signal(false);
  duplicados = signal<DuplicadoGrupo[]>([]);
  dupBusy = signal(false);

  // CE9 — papelera (admin).
  papeleraOpen = signal(false);
  papelera = signal<PapeleraRow[]>([]);

  // CP — filtro rápido por tipo de pendiente: lo activan los chips de la franja de
  // progreso Y el dropdown "Pendiente" de la barra de filtros (mismo signal, dos
  // entradas). Reemplaza el bloque "Pendientes del personal" que duplicaba la tabla.
  filPendiente = signal('');
  setPendiente(tipo: string) {
    this.filPendiente.set(this.filPendiente() === tipo ? '' : tipo);
  }
  readonly pendienteOpt: FilterOption[] = [
    { value: 'sin_carnet', label: 'Sin carnet' },
    { value: 'sin_asegurar', label: 'Sin seguro' },
    { value: 'sin_contrato', label: 'Sin contrato' },
    { value: 'sin_foto', label: 'Sin foto' },
  ];

  personal = signal<PersonalObra[]>([]);
  obras = signal<ObraRef[]>([]);
  cargos = signal<Cargo[]>([]);
  loading = signal(true);
  error = signal('');

  filObra = signal('');
  filCargo = signal('');
  filNacionalidad = signal('');
  filEstado = signal('activo');
  filAsegurado = signal('');   // AV4
  filCuadrilla = signal('');   // AV4
  busqueda = signal('');

  // AV4 — cuadrillas presentes (para el filtro de la vista de control).
  cuadrillas = computed(() =>
    [...new Set(this.personal().map((p) => (p.cuadrilla ?? '').trim()).filter(Boolean))].sort(),
  );

  // BP6 — opciones para los chips-filtro (filter-select).
  obrasOpt = computed(() => this.obras().map((o) => ({ value: o.id, label: o.nombre })));
  cargosOpt = computed(() => this.cargos().map((c) => ({ value: c.id, label: c.nombre })));
  cuadrillaOpt = computed(() => this.cuadrillas().map((c) => ({ value: c, label: c })));
  readonly nacionalidadOpt = [
    { value: 'dominicano', label: 'Dominicano' },
    { value: 'haitiano', label: 'Haitiano' },
    { value: 'otro', label: 'Otra' },
  ];
  readonly estadoOpt = [
    { value: 'activo', label: 'Activos' },
    { value: 'inactivo', label: 'Inactivos' },
  ];
  readonly aseguradoOpt = [
    { value: 'asegurado', label: 'Asegurados' },
    { value: 'no_asegurado', label: 'No asegurados' },
    { value: 'desconocido', label: 'Sin dato' },
  ];
  // Nº de filtros activos (para el botón "Limpiar (N)").
  filtrosActivos = computed(() =>
    [this.filObra(), this.filCargo(), this.filNacionalidad(), this.filEstado(), this.filAsegurado(), this.filCuadrilla(), this.filPendiente()]
      .filter(Boolean).length,
  );

  filtrados = computed(() => {
    const visibles = this.datosPrueba.visibles(this.personal());
    const cargo = this.filCargo();
    const nac = this.filNacionalidad();
    const est = this.filEstado();
    const obra = this.filObra();
    const aseg = this.filAsegurado();
    const cuad = this.filCuadrilla();
    const pend = this.filPendiente();
    // BO6 — búsqueda insensible a acentos (NFD) y por tokens: "sacalo papolo"
    // encuentra a "Papolo Sacalo" (antes era substring del concatenado en orden y
    // sensible a acentos, así que no lo hallaba).
    const tokens = norm(this.busqueda()).split(/\s+/).filter(Boolean);
    return visibles.filter((p) => {
      if (obra && p.proyecto_id !== obra) return false;
      if (cargo && p.cargo_id !== cargo) return false;
      if (nac && p.nacionalidad !== nac) return false;
      if (est && p.estado !== est) return false;
      if (aseg && (p.aseguramiento_estado ?? 'desconocido') !== aseg) return false;
      if (cuad && (p.cuadrilla ?? '') !== cuad) return false;
      // CF2 — filtro rápido por tipo de pendiente (KPI/chips clicables).
      if (pend === 'sin_carnet' && p.carnet_numero) return false;
      if (pend === 'sin_asegurar' && p.aseguramiento_estado === 'asegurado') return false;
      if (pend === 'sin_contrato' && p.tiene_contrato) return false;
      if (pend === 'sin_foto' && p.tiene_foto_persona) return false;
      if (tokens.length) {
        const hay = norm(`${p.nombre} ${p.apellido ?? ''} ${p.documento_numero ?? ''} ${p.cargo?.nombre ?? ''} ${p.carnet_numero ?? ''}`);
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  });

  // AY6/BL5 — contadores para los tiles de resumen. Se quita "Activos" (redundante
  // con "En la vista" bajo el filtro por defecto) y se añade procedencia.
  formatFecha = formatFechaDisplay;
  formatFechaHora = formatFechaHoraDisplay; // CE11 — timestamps (created_at) con fecha y hora
  totalVisibles = computed(() => this.filtrados().length);
  obrasDistintas = computed(() => new Set(this.filtrados().map((p) => p.proyecto_id).filter(Boolean)).size);
  importados = computed(() => this.filtrados().filter((p) => !!p.lote_import).length);
  manuales = computed(() => this.filtrados().filter((p) => !p.lote_import).length);
  // CE1 — contadores útiles al ingeniero (sobre lo filtrado/activo).
  sinCarnet = computed(() => this.filtrados().filter((p) => !p.carnet_numero).length);
  sinAsegurar = computed(() => this.filtrados().filter((p) => p.aseguramiento_estado !== 'asegurado').length);
  sinContrato = computed(() => this.filtrados().filter((p) => !p.tiene_contrato).length);
  sinFoto = computed(() => this.filtrados().filter((p) => !p.tiene_foto_persona).length);

  // CP — franja de progreso única (reemplaza las 5 tarjetas de KPI idénticas):
  // "Expedientes completos N de M" + barra, y chips de pendiente que DUPLICAN como
  // filtro rápido (se ocultan solos cuando su conteo es 0 — nunca "0 sin X").
  expedientesCompletos = computed(() =>
    this.filtrados().filter(
      (p) => !!p.carnet_numero && p.aseguramiento_estado === 'asegurado' && !!p.tiene_contrato && !!p.tiene_foto_persona,
    ).length,
  );
  porcentajeCompletos = computed(() => {
    const total = this.totalVisibles();
    return total ? Math.round((this.expedientesCompletos() / total) * 100) : 0;
  });
  pendientesChips = computed(() =>
    ([
      { tipo: 'sin_carnet', label: 'sin carnet', count: this.sinCarnet() },
      { tipo: 'sin_asegurar', label: 'sin seguro', count: this.sinAsegurar() },
      { tipo: 'sin_contrato', label: 'sin contrato', count: this.sinContrato() },
      { tipo: 'sin_foto', label: 'sin foto', count: this.sinFoto() },
    ] as const).filter((c) => c.count > 0),
  );

  /** CP — tags de la columna "Le falta" (solo lo que falta; vacío = expediente completo). */
  faltantes(p: PersonalObra): string[] {
    const out: string[] = [];
    if (!p.carnet_numero) out.push('Carnet');
    if (p.aseguramiento_estado !== 'asegurado') out.push('Seguro');
    if (!p.tiene_contrato) out.push('Contrato');
    if (!p.tiene_foto_persona) out.push('Foto');
    return out;
  }

  /** CP — subtítulo de la celda "Persona": nacionalidad · procedencia + fecha, en una línea. */
  personaSubline(p: PersonalObra): string {
    const nac = this.nacionalidadLabel[p.nacionalidad] ?? p.nacionalidad;
    const fecha = this.formatFecha(p.created_at);
    const origen = p.lote_import
      ? `importado ${fecha}`
      : `registrado por ${p.registrado_por_nombre ?? p.registrador?.nombre ?? '—'} ${fecha}`;
    return `${nac} · ${origen}`;
  }

  // AZ3 — vacío ≠ oculto ≠ error: el estado vacío debe decir la verdad.
  // Cuántos registros existen pero están ocultos SOLO por el filtro de datos de prueba.
  ocultosPrueba = computed(() =>
    this.datosPrueba.verPrueba() ? 0 : this.personal().filter((p) => p.es_prueba).length,
  );
  puedeVerPrueba = computed(() => this.datosPrueba.puedeVerPrueba());
  /** Motivo por el que la lista sale vacía, para pintar el mensaje correcto. */
  motivoVacio = computed<'ninguno' | 'todos_prueba' | 'filtros' | 'sin_datos'>(() => {
    if (this.filtrados().length) return 'ninguno';
    // hay registros no-prueba visibles pero los filtros los excluyen
    if (this.datosPrueba.visibles(this.personal()).length > 0) return 'filtros';
    // todo lo que existe es de prueba y está oculto
    if (this.ocultosPrueba() > 0) return 'todos_prueba';
    return 'sin_datos';
  });

  mostrarPrueba() {
    this.datosPrueba.set(true);
  }

  limpiarFiltros() {
    this.filObra.set('');
    this.filCargo.set('');
    this.filNacionalidad.set('');
    this.filEstado.set('');
    this.filAsegurado.set('');
    this.filCuadrilla.set('');
    this.filPendiente.set('');
    this.busqueda.set('');
  }

  /** AY6 — iniciales para el avatar del listado. */
  iniciales(p: PersonalObra): string {
    return `${(p.nombre?.[0] ?? '')}${(p.apellido?.[0] ?? '')}`.toUpperCase() || '?';
  }

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [personal, obras, cargos] = await Promise.all([
        this.service.listar(),
        this.proyectos.getDirectorio('personal'),
        this.service.getCargos(),
      ]);
      this.personal.set(personal);
      this.obras.set(obras);
      this.cargos.set(cargos);
    } catch (e: unknown) {
      // BB5/AU5(d)/AW1 — nunca el texto técnico crudo al usuario: mensaje humano
      // en pantalla, detalle crudo a telemetría.
      const f = humanizeError(e);
      if (f.technical) this.telemetry.reportCaught(f.raw, { titulo: 'Cargar personal de obra' });
      this.error.set(f.mensaje || 'No pudimos cargar el personal — ya fue reportado.');
    } finally {
      this.loading.set(false);
    }
  }

  registrar() {
    this.router.navigate(['/proyectos/personal/registrar'], {
      queryParams: this.filObra() ? { obra: this.filObra() } : {},
    });
  }

  abrir(p: PersonalObra) {
    this.router.navigate(['/proyectos/personal', p.id]);
  }

  // ── CE16 — posibles duplicados ──────────────────────────────────────────────
  async abrirDuplicados() {
    this.dupOpen.set(true);
    this.dupBusy.set(true);
    try {
      this.duplicados.set(await this.service.duplicados());
    } catch (e: unknown) {
      this.toast.error('No se pudieron cargar los duplicados', e instanceof Error ? e.message : undefined);
    } finally {
      this.dupBusy.set(false);
    }
  }

  async fusionar(keep: string, drop: string) {
    if (this.dupBusy()) return;
    this.dupBusy.set(true);
    try {
      await this.service.fusionar(keep, drop, 'Fusión de duplicados desde la lista');
      this.toast.success('Registros fusionados', 'Se conservaron las fotos y firmas de ambos.');
      this.duplicados.set(await this.service.duplicados());
      await this.recargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo fusionar', e instanceof Error ? e.message : undefined);
    } finally {
      this.dupBusy.set(false);
    }
  }

  // ── CE9 — papelera (admin) ──────────────────────────────────────────────────
  async abrirPapelera() {
    this.papeleraOpen.set(true);
    try {
      this.papelera.set((await this.service.papelera()) as PapeleraRow[]);
    } catch (e: unknown) {
      this.toast.error('No se pudo cargar la papelera', e instanceof Error ? e.message : undefined);
    }
  }

  async restaurar(id: string) {
    try {
      await this.service.restaurar(id);
      this.toast.success('Registro restaurado');
      this.papelera.set((await this.service.papelera()) as PapeleraRow[]);
      await this.recargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo restaurar', e instanceof Error ? e.message : undefined);
    }
  }

  private async recargar() {
    try {
      this.personal.set(await this.service.listar());
    } catch { /* el error ya se muestra en carga inicial */ }
  }
}
