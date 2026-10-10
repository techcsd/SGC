import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  OnInit,
} from '@angular/core';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { combineLatest, of, from, startWith, debounceTime, switchMap, catchError } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { MantenimientosService, ValidacionKm } from '../../../../shared/services/mantenimientos.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import {
  Mantenimiento,
  MantenimientoFormData,
  MantenimientoAdjunto,
  ProveedorFlota,
  MANT_TIPOS,
  MANT_TIPO_BADGE,
  MANT_ESTADOS,
  MANT_ADJUNTO_TIPOS,
} from '../../../../shared/models/mantenimiento.model';
import { FilterSelect, FilterOption } from '../../../../shared/ui/filter-select/filter-select';
import { Vehiculo, kmFaltanMantenimiento, identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { ExportExcel, ExportColumn, ExportSection } from '../../../../shared/components/export-excel/export-excel';
import { formatFechaDisplay, formatFechaHoraDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { AudioNotas } from '../../../../shared/components/audio-notas/audio-notas';
import { Icon } from '../../../../shared/ui/icon/icon';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { PdfViewer } from '../../../../shared/ui/pdf-viewer/pdf-viewer';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';

interface PendingFoto {
  file: File;
  preview: string;
}

// CG13/CH3 — adjunto pendiente de subir (archivo + tipo de documento POR archivo,
// editable en la lista; `descripcion` cuando el tipo es "otro").
interface PendingAdjunto {
  file: File;
  tipo: string;
  descripcion?: string;
}

/** CH3 — infiere el tipo de documento inicial por nombre/mime del archivo. */
function inferirTipoAdjunto(file: File): string {
  if (file.type.startsWith('image/')) return 'foto';
  const n = (file.name || '').toLowerCase();
  if (/fact|fac|invoice|ncf/.test(n)) return 'factura';
  if (/cot/.test(n)) return 'cotizacion';
  if (/inf|reporte/.test(n)) return 'informe';
  return 'factura';
}

/** CH2 — normaliza un nombre (sin acentos, espacios colapsados, minúsculas) para
 *  comparar proveedores escritos a mano con el maestro. */
function normNombre(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

@Component({
  selector: 'app-mantenimientos',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe, Skeleton, AudioNotas, ExportExcel, Icon, FileUpload, PdfViewer, TranslatePipe, FilterSelect, StaggerDirective],
  templateUrl: './mantenimientos.html',
  styleUrl: './mantenimientos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mantenimientos implements OnInit {
  private mantenimientosService = inject(MantenimientosService);
  private vehiculosService = inject(VehiculosService);
  private proveedoresService = inject(ProveedoresService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private datosPrueba = inject(DatosPruebaService);

  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Drawer photos ────────────────────────────────────────
  fotoPaths = signal<string[]>([]); // existing persisted photo paths
  fotoFiles = signal<PendingFoto[]>([]); // newly picked, not yet uploaded
  fotoUrls = signal<Record<string, string>>({}); // path → signed URL for thumbnails (drawer)
  private rowFotoUrls = signal<Record<string, string>>({}); // path → signed URL for list rows
  private originalFotos: string[] = [];

  /** Signed URL of a photo shown in a list row (or null while resolving). */
  rowFotoUrl(path: string): string | null {
    return this.rowFotoUrls()[path] ?? null;
  }

  /** Resolves signed URLs for every photo across the loaded maintenance rows. */
  private resolveListaFotos(list: Mantenimiento[]) {
    for (const path of list.flatMap((m) => m.fotos ?? [])) {
      if (this.rowFotoUrls()[path]) continue;
      this.mantenimientosService.getFotoUrl(path).then((url) => {
        if (url) this.rowFotoUrls.update((m) => ({ ...m, [path]: url }));
      });
    }
  }

  // ── CG13/CH3 — Adjuntos (imágenes + PDFs), tipo POR archivo ───────────────
  readonly MANT_ADJUNTO_TIPOS = MANT_ADJUNTO_TIPOS;
  /** Nuevos adjuntos pendientes de subir (cada uno con su tipo editable). */
  adjPending = signal<PendingAdjunto[]>([]);
  /** Lista de File[] para el control <app-file-upload> (derivada de adjPending). */
  adjFiles = computed(() => this.adjPending().map((a) => a.file));
  /** Adjuntos ya guardados del registro en edición (para listar/editar/eliminar). */
  editingAdjuntos = signal<MantenimientoAdjunto[]>([]);
  /** CH3 — object URLs memoizados para las miniaturas de los pendientes (imágenes). */
  private adjPreviews = new Map<File, string>();

  adjPreviewUrl(file: File): string | null {
    if (!file.type.startsWith('image/')) return null;
    let url = this.adjPreviews.get(file);
    if (!url) { url = URL.createObjectURL(file); this.adjPreviews.set(file, url); }
    return url;
  }

  /** Tamaño legible de un archivo (KB/MB). */
  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** CH3 — cambia el tipo de un adjunto pendiente. */
  setAdjTipo(index: number, tipo: string) {
    this.adjPending.update((l) => l.map((a, i) => (i === index ? { ...a, tipo, descripcion: tipo === 'otro' ? a.descripcion : undefined } : a)));
  }
  /** CH3 — detalle del adjunto pendiente cuando el tipo es "otro". */
  setAdjDescripcion(index: number, descripcion: string) {
    this.adjPending.update((l) => l.map((a, i) => (i === index ? { ...a, descripcion } : a)));
  }

  /** CH3 — cambia el tipo de un adjunto YA guardado (update en servidor). */
  async cambiarTipoAdjuntoGuardado(adj: MantenimientoAdjunto, tipo: string) {
    const previo = adj.tipo_documento;
    if (tipo === previo) return;
    this.editingAdjuntos.update((l) => l.map((a) => (a.id === adj.id ? { ...a, tipo_documento: tipo } : a)));
    try {
      await this.mantenimientosService.updateAdjuntoTipo(adj.id, tipo, adj.descripcion ?? null);
      const id = this.editingId();
      if (id) {
        this.mantenimientos.update((list) =>
          list.map((m) => (m.id === id ? { ...m, adjuntos: (m.adjuntos ?? []).map((a) => (a.id === adj.id ? { ...a, tipo_documento: tipo } : a)) } : m)),
        );
      }
    } catch (e: unknown) {
      this.editingAdjuntos.update((l) => l.map((a) => (a.id === adj.id ? { ...a, tipo_documento: previo } : a)));
      this.toast.error('No se pudo cambiar el tipo', e instanceof Error ? e.message : undefined);
    }
  }

  /** CH3 — adjuntos de un registro agrupados por tipo (para el detalle/historial). */
  adjuntosPorTipo(m: Mantenimiento): { tipo: string; label: string; items: MantenimientoAdjunto[] }[] {
    const by = new Map<string, MantenimientoAdjunto[]>();
    for (const a of m.adjuntos ?? []) {
      const k = a.tipo_documento || 'otro';
      (by.get(k) ?? by.set(k, []).get(k)!).push(a);
    }
    return [...by.entries()].map(([tipo, items]) => ({ tipo, label: this.adjTipoLabel(tipo), items }));
  }

  // Visor de PDF embebido.
  pdfOpen = signal(false);
  pdfSrc = signal<string | null>(null);
  pdfNombre = signal('Documento');

  adjTipoLabel(tipo: string): string {
    return MANT_ADJUNTO_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  private esPdf(adj: MantenimientoAdjunto): boolean {
    return adj.mime === 'application/pdf' || adj.nombre.toLowerCase().endsWith('.pdf');
  }

  /** Abre un adjunto: PDF en el visor embebido, imagen en pestaña nueva. */
  async abrirAdjunto(adj: MantenimientoAdjunto) {
    const url = await this.mantenimientosService.getAdjuntoUrl(adj.path);
    if (!url) {
      this.toast.error('No se pudo abrir el adjunto', 'Vuelve a intentarlo.');
      return;
    }
    if (this.esPdf(adj)) {
      this.pdfNombre.set(adj.nombre);
      this.pdfSrc.set(url);
      this.pdfOpen.set(true);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  /** Recibe archivos del <app-file-upload>: admite imágenes y PDF, rechaza el resto.
   *  CH3 — cada archivo entra con su tipo inferido (editable luego en la lista). */
  onAdjAdd(files: File[]) {
    const aceptados: PendingAdjunto[] = [];
    let rechazados = 0;
    for (const f of files) {
      const ok = f.type.startsWith('image/') || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
      if (ok) aceptados.push({ file: f, tipo: inferirTipoAdjunto(f) });
      else rechazados++;
    }
    if (rechazados) {
      this.toast.warning('Archivo no admitido', 'Solo se aceptan imágenes y PDF.');
    }
    if (aceptados.length) this.adjPending.update((l) => [...l, ...aceptados]);
  }

  onAdjRemove(index: number) {
    const target = this.adjPending()[index];
    if (target) {
      const url = this.adjPreviews.get(target.file);
      if (url) { URL.revokeObjectURL(url); this.adjPreviews.delete(target.file); }
    }
    this.adjPending.update((l) => l.filter((_, i) => i !== index));
  }

  /** Elimina un adjunto ya guardado del registro en edición. */
  async eliminarAdjunto(adj: MantenimientoAdjunto) {
    if (!confirm(`¿Eliminar el adjunto "${adj.nombre}"?`)) return;
    try {
      await this.mantenimientosService.deleteAdjunto(adj.id, adj.path);
      this.editingAdjuntos.update((l) => l.filter((a) => a.id !== adj.id));
      const id = this.editingId();
      if (id) {
        this.mantenimientos.update((list) =>
          list.map((m) => (m.id === id ? { ...m, adjuntos: (m.adjuntos ?? []).filter((a) => a.id !== adj.id) } : m)),
        );
      }
      this.toast.success('Adjunto eliminado');
    } catch (e: unknown) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    }
  }

  formatFecha = formatFechaDisplay;
  readonly idVehiculo = identificacionVehiculo;
  /** AT17 — fecha + hora (12h) homologada, ej. `17/08/2026 8:04 p.m.`. */
  readonly fechaHora = formatFechaHoraDisplay;

  // ── CH2 — Proveedor / Taller: combobox del maestro + "Otro" ───────────────
  /** Solo admin/flota elevado puede dar de alta un taller al catálogo (AF32). */
  esFlotaElevado = this.userService.esFlotaElevado;
  /** Talleres + proveedores visibles para flota (talleres primero, RLS-safe). */
  proveedoresFlota = signal<ProveedorFlota[]>([]);
  /** Valor del combobox: '' (sin selección), id del proveedor, o '__otro__'. */
  proveedorSel = signal<string>('');
  /** Alta al catálogo como taller (solo se ofrece a flota elevado al escribir "Otro"). */
  proveedorAltaTaller = signal(false);

  readonly OTRO = '__otro__';

  /** Opciones del combobox: grupo Talleres, grupo Otros proveedores, y "Otro…". */
  proveedorOpciones = computed<FilterOption[]>(() => {
    const opts: FilterOption[] = [];
    for (const p of this.proveedoresFlota()) {
      opts.push({ value: p.id, label: p.nombre, group: p.es_taller ? 'Talleres' : 'Otros proveedores' });
    }
    opts.push({ value: this.OTRO, label: 'Otro…' });
    return opts;
  });

  /** Elección en el combobox de proveedor/taller. */
  onProveedorPick(value: string) {
    if (value === this.OTRO) {
      this.proveedorSel.set(this.OTRO);
      this.form.patchValue({ proveedor_id: null, proveedor: this.form.value.proveedor ?? '' });
      return;
    }
    if (!value) { // limpiar
      this.proveedorSel.set('');
      this.proveedorAltaTaller.set(false);
      this.form.patchValue({ proveedor_id: null, proveedor: null });
      return;
    }
    const p = this.proveedoresFlota().find((x) => x.id === value);
    this.proveedorSel.set(value);
    this.proveedorAltaTaller.set(false);
    this.form.patchValue({ proveedor_id: value, proveedor: p?.nombre ?? null });
  }

  /** Texto del proveedor "Otro" escrito a mano (bind al control `proveedor`). */
  onProveedorOtroTexto(value: string) {
    this.form.patchValue({ proveedor: value, proveedor_id: null });
  }

  /** Nombre del proveedor seleccionado del catálogo (para la etiqueta del chip). */
  proveedorSelLabel = computed<string>(() => {
    const v = this.proveedorSel();
    if (v === this.OTRO) return 'Otro…';
    return this.proveedoresFlota().find((p) => p.id === v)?.nombre ?? '';
  });

  // ── Data state ──────────────────────────────────────────
  mantenimientos = signal<Mantenimiento[]>([]);

  // ── Export a Excel (con seccionado por tipo / estado / proveedor / vehículo) ──
  private vehiculoLabel(m: Mantenimiento): string {
    const v = m.vehiculo;
    if (!v) return '';
    return v.placa ?? `${v.marca ?? ''} ${v.modelo ?? ''}`.trim();
  }
  readonly exportCols: ExportColumn[] = [
    { key: 'fecha', label: 'Fecha', value: (r) => (r as Mantenimiento).fecha ?? '' },
    { key: 'vehiculo', label: 'Vehículo', value: (r) => this.vehiculoLabel(r as Mantenimiento) },
    { key: 'tipo', label: 'Tipo', value: (r) => this.getTipoLabel((r as Mantenimiento).tipo) },
    { key: 'estado', label: 'Estado', value: (r) => this.getEstadoLabel((r as Mantenimiento).estado) },
    { key: 'descripcion', label: 'Descripción', value: (r) => (r as Mantenimiento).descripcion ?? '' },
    { key: 'costo', label: 'Costo', value: (r) => (r as Mantenimiento).costo ?? '' },
    { key: 'km', label: 'Kilometraje', value: (r) => (r as Mantenimiento).kilometraje_al_mantenimiento ?? '' },
    { key: 'proveedor', label: 'Proveedor', value: (r) => (r as Mantenimiento).proveedor ?? '' },
    { key: 'notas', label: 'Notas', value: (r) => (r as Mantenimiento).notas ?? '', default: false },
  ];
  readonly exportSecciones: ExportSection[] = [
    { key: 'tipo', label: 'Tipo', values: (r) => [this.getTipoLabel((r as Mantenimiento).tipo)] },
    { key: 'estado', label: 'Estado', values: (r) => [this.getEstadoLabel((r as Mantenimiento).estado)] },
    { key: 'proveedor', label: 'Proveedor', values: (r) => { const p = (r as Mantenimiento).proveedor; return p ? [p] : []; } },
    { key: 'vehiculo', label: 'Vehículo', values: (r) => { const v = this.vehiculoLabel(r as Mantenimiento); return v ? [v] : []; } },
  ];
  vehiculos = signal<Vehiculo[]>([]);
  // AT14/AT26 — datos de prueba fuera del selector para no-admin.
  vehiculosVisibles = computed(() => this.datosPruebaViewSvc.visibles(this.vehiculos()));
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedTipo = signal('');
  selectedEstado = signal('');
  selectedVehiculo = signal(''); // R4b — drill-down desde Reportes (?vehiculo=)

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);
  // Z23c — es_prueba del registro en edición (para marcar sus notas de voz).
  editingEsPrueba = signal<boolean>(false);

  // ── AB3 — Detalle (fila → detalle read-only) ─────────────
  detailOpen = signal(false);
  selected = signal<Mantenimiento | null>(null);

  readonly MANT_TIPOS = MANT_TIPOS;
  readonly MANT_TIPO_BADGE = MANT_TIPO_BADGE;
  readonly MANT_ESTADOS = MANT_ESTADOS;

  tipoBadge(tipo: string): string {
    return (MANT_TIPO_BADGE as Record<string, string>)[tipo] ?? 'neutral';
  }

  form = new FormGroup({
    vehiculo_id: new FormControl('', [Validators.required]),
    tipo: new FormControl('preventivo', [Validators.required]),
    estado: new FormControl('pendiente', [Validators.required]),
    descripcion: new FormControl('', [Validators.required]),
    fecha: new FormControl('', [Validators.required]),
    costo: new FormControl<number | null>(null, [Validators.min(0)]),
    kilometraje_al_mantenimiento: new FormControl<number | null>(null, [Validators.min(0)]),
    proveedor: new FormControl<string | null>(null),
    proveedor_id: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    incluye_preventivo: new FormControl<boolean>(false),
  });

  // X6 — el tipo de forma reactiva (OnPush: no leer form.value directo).
  tipoActual = toSignal(this.form.controls.tipo.valueChanges, {
    initialValue: this.form.controls.tipo.value,
  });
  esNoPreventivo = computed(() => this.tipoActual() !== 'preventivo');

  // CH1 — unidad del vehículo seleccionado (km | horas) para etiquetas/pistas.
  private vehiculoSelId = toSignal(this.form.controls.vehiculo_id.valueChanges, {
    initialValue: this.form.controls.vehiculo_id.value,
  });
  vehiculoSel = computed(() => this.vehiculos().find((v) => v.id === this.vehiculoSelId()) ?? null);
  esHorometro = computed(() => this.vehiculoSel()?.medida_uso === 'horas');
  unidadUso = computed(() => (this.esHorometro() ? 'h' : 'km'));
  odometroSeleccionado = computed<number | null>(() => this.vehiculoSel()?.kilometraje ?? null);

  // CH1 — validación del km contra TODAS las lecturas con fecha del vehículo
  // (echadas, inspecciones, entregas, mantenimientos), con debounce. Reemplaza el
  // falso positivo "km > odómetro" (subir respecto al odómetro es lo normal).
  private kmValidacion$ = combineLatest([
    this.form.controls.vehiculo_id.valueChanges.pipe(startWith(this.form.controls.vehiculo_id.value)),
    this.form.controls.fecha.valueChanges.pipe(startWith(this.form.controls.fecha.value)),
    this.form.controls.kilometraje_al_mantenimiento.valueChanges.pipe(
      startWith(this.form.controls.kilometraje_al_mantenimiento.value),
    ),
  ]).pipe(
    debounceTime(350),
    switchMap(([veh, fecha, km]) => {
      if (!veh || !fecha || km == null || Number.isNaN(Number(km))) return of<ValidacionKm | null>(null);
      return from(this.mantenimientosService.validarKm(veh, Number(km), fecha, this.editingId())).pipe(
        catchError(() => of<ValidacionKm | null>(null)),
      );
    }),
  );
  kmValidacion = toSignal(this.kmValidacion$, { initialValue: null as ValidacionKm | null });
  /** Confirmación del usuario ante un salto inverosímil (aviso ámbar). */
  kmConfirmado = signal(false);

  constructor() {
    // Cada vez que cambia el veredicto del km, se exige volver a confirmar el salto.
    effect(() => {
      this.kmValidacion();
      this.kmConfirmado.set(false);
    });
  }

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tipo = this.selectedTipo();
    const estado = this.selectedEstado();
    // T2 — no-admin nunca ve datos de prueba (RLS server-side); admin los oculta salvo toggle.
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.mantenimientos().filter((m) => {
      if (m.es_prueba && !verPrueba) return false;
      if (
        q &&
        !m.vehiculo?.placa?.toLowerCase().includes(q) &&
        !m.vehiculo?.marca.toLowerCase().includes(q) &&
        !m.proveedor?.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (tipo && m.tipo !== tipo) return false;
      if (estado && m.estado !== estado) return false;
      if (this.selectedVehiculo() && m.vehiculo_id !== this.selectedVehiculo()) return false;
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

  // ── T16 — Vehículos cerca o vencidos de mantenimiento (por km) ──────────────
  // Umbral "cerca": faltan <=500 km; "vencido": km faltantes <= 0.
  readonly UMBRAL_CERCA_KM = 500;
  vehiculosMantenimiento = computed(() => {
    const conMant = new Set(
      this.mantenimientos()
        .filter((m) => m.estado !== 'completado')
        .map((m) => m.vehiculo_id),
    );
    return this.vehiculos()
      .filter((v) => v.activo && v.estado !== 'baja')
      .map((v) => ({ v, faltan: kmFaltanMantenimiento(v) }))
      .filter((x) => x.faltan != null && x.faltan <= this.UMBRAL_CERCA_KM)
      // No repetir los que ya tienen un mantenimiento abierto/programado.
      .filter((x) => !conMant.has(x.v.id))
      .sort((a, b) => (a.faltan ?? 0) - (b.faltan ?? 0));
  });

  /** Abre el drawer prellenado para un vehículo del banner de mantenimiento. */
  crearDesdeBanner(vehiculoId: string, vencido: boolean) {
    this.openCreateDesdeAviso(vehiculoId, vencido ? 'correctivo' : 'preventivo');
  }

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
    // R9: crear cita precargada desde un aviso de flota (?nuevo=1&vehiculo=..&tipo=..).
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('nuevo')) {
      this.openCreateDesdeAviso(qp.get('vehiculo'), qp.get('tipo') ?? 'preventivo');
    } else if (qp.get('vehiculo')) {
      // R4b — llegada desde Reportes: filtra la lista por ese vehículo.
      this.selectedVehiculo.set(qp.get('vehiculo')!);
    }
    // AB3 — deep-link a un detalle concreto (?item=<id>).
    const itemId = qp.get('item');
    if (itemId) {
      const m = this.mantenimientos().find((x) => x.id === itemId);
      if (m) this.openDetail(m);
    }
  }

  /** Abre el drawer de creación precargando vehículo, km actual y fecha. Una
   *  cita desde un aviso de mantenimiento es SIEMPRE preventiva (X6). */
  openCreateDesdeAviso(vehiculoId: string | null, _tipoAviso: string) {
    this.openCreate();
    const v = this.vehiculos().find((x) => x.id === vehiculoId);
    this.form.patchValue({
      vehiculo_id: vehiculoId ?? '',
      tipo: 'preventivo',
      fecha: this.toDateStr(new Date()),
      kilometraje_al_mantenimiento: v?.kilometraje ?? null,
      descripcion: 'Mantenimiento preventivo programado',
    });
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [mantenimientos, vehiculos, proveedores] = await Promise.all([
        this.mantenimientosService.getAll(),
        this.vehiculosService.getAll(),
        this.mantenimientosService.getProveedoresFlota(),
      ]);
      this.mantenimientos.set(mantenimientos);
      this.vehiculos.set(vehiculos);
      this.proveedoresFlota.set(proveedores);
      this.resolveListaFotos(mantenimientos);
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

  /** Exporta los mantenimientos filtrados a Excel. */
  async exportar() {
    const rows = this.filtered().map((m) => ({
      Fecha: this.formatFecha(m.fecha),
      Vehículo: m.vehiculo?.placa ?? '',
      Tipo: this.getTipoLabel(m.tipo),
      Estado: this.getEstadoLabel(m.estado),
      Costo: m.costo ?? '',
      Proveedor: m.proveedor ?? '',
      Km: m.kilometraje_al_mantenimiento ?? '',
    }));
    await exportarExcel('mantenimientos', rows);
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.editingEsPrueba.set(false);
    this.saveError.set('');
    this.resetFotos([]);
    this.resetAdjuntos([]);
    this.proveedorSel.set('');
    this.proveedorAltaTaller.set(false);
    this.kmConfirmado.set(false);
    this.form.reset({ tipo: 'preventivo', estado: 'pendiente' });
    this.drawerOpen.set(true);
  }

  /** CG13/CH3 — reinicia el estado de adjuntos del drawer. */
  private resetAdjuntos(existentes: MantenimientoAdjunto[]) {
    for (const url of this.adjPreviews.values()) URL.revokeObjectURL(url);
    this.adjPreviews.clear();
    this.adjPending.set([]);
    this.editingAdjuntos.set([...existentes]);
  }

  completandoId = signal<string | null>(null);

  /** Marca el mantenimiento como hecho: resetea el contador del vehículo + atiende avisos. */
  async completar(m: Mantenimiento) {
    if (this.completandoId()) return;
    this.completandoId.set(m.id);
    try {
      await this.mantenimientosService.completar(m.id, m.kilometraje_al_mantenimiento ?? null);
      await this.loadAll();
      this.toast.success('Mantenimiento completado', 'Se actualizó el próximo mantenimiento del vehículo.');
    } catch (e: unknown) {
      this.toast.error('No se pudo completar', e instanceof Error ? e.message : undefined);
    } finally {
      this.completandoId.set(null);
    }
  }

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca o desmarca un mantenimiento como dato de prueba. */
  async marcarPrueba(m: Mantenimiento, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar('mantenimientos', m.id, valor);
      this.mantenimientos.update((list) =>
        list.map((x) => (x.id === m.id ? { ...x, es_prueba: valor } : x)),
      );
      this.toast.success(
        valor ? 'Marcado como prueba' : 'Quitado de prueba',
        valor ? 'El mantenimiento se ocultará del listado.' : 'El mantenimiento vuelve al listado.',
      );
    } catch (e: unknown) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }

  /** Elimina definitivamente un mantenimiento marcado como prueba. */
  async eliminarPrueba(m: Mantenimiento) {
    if (!this.esAdmin() || !m.es_prueba) return;
    if (!confirm('¿Eliminar este dato de prueba? Esta acción no se puede deshacer.')) return;
    try {
      await this.datosPrueba.eliminar('mantenimientos', m.id);
      this.mantenimientos.update((list) => list.filter((x) => x.id !== m.id));
      this.toast.success('Dato de prueba eliminado', 'El mantenimiento se eliminó definitivamente.');
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  openEdit(m: Mantenimiento) {
    this.editingId.set(m.id);
    this.editingEsPrueba.set(m.es_prueba ?? false);
    this.saveError.set('');
    this.resetFotos(m.fotos ?? []);
    this.resetAdjuntos(m.adjuntos ?? []);
    this.form.reset({
      vehiculo_id: m.vehiculo_id,
      tipo: m.tipo,
      estado: m.estado,
      descripcion: m.descripcion,
      fecha: m.fecha,
      costo: m.costo,
      kilometraje_al_mantenimiento: m.kilometraje_al_mantenimiento,
      proveedor: m.proveedor,
      proveedor_id: m.proveedor_id ?? null,
      notas: m.notas,
      incluye_preventivo: m.incluye_preventivo ?? false,
    });
    // CH2 — preselecciona del maestro por id; si no, por nombre normalizado; si no, "Otro".
    this.proveedorAltaTaller.set(false);
    this.kmConfirmado.set(false);
    if (m.proveedor_id && this.proveedoresFlota().some((p) => p.id === m.proveedor_id)) {
      this.proveedorSel.set(m.proveedor_id);
    } else if (m.proveedor) {
      const match = this.proveedoresFlota().find((p) => normNombre(p.nombre) === normNombre(m.proveedor!));
      if (match) {
        this.proveedorSel.set(match.id);
        this.form.patchValue({ proveedor_id: match.id, proveedor: match.nombre });
      } else {
        this.proveedorSel.set(this.OTRO);
      }
    } else {
      this.proveedorSel.set('');
    }
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
    this.revokePreviews();
    for (const url of this.adjPreviews.values()) URL.revokeObjectURL(url);
    this.adjPreviews.clear();
  }

  // ── AB3 — Detalle read-only ──────────────────────────────
  /** Abre el detalle de una fila. Reutiliza las URLs firmadas ya resueltas para
   *  las miniaturas del listado (resolveListaFotos). */
  openDetail(m: Mantenimiento) {
    this.selected.set(m);
    this.resolveListaFotos([m]);
    this.detailOpen.set(true);
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  /** Pasa de detalle a edición del mismo registro. */
  editDesdeDetalle(m: Mantenimiento) {
    this.detailOpen.set(false);
    this.openEdit(m);
  }

  // ── Photos ───────────────────────────────────────────────
  private resetFotos(existing: string[]) {
    this.revokePreviews();
    this.originalFotos = [...existing];
    this.fotoPaths.set([...existing]);
    this.fotoFiles.set([]);
    this.fotoUrls.set({});
    for (const path of existing) {
      this.mantenimientosService.getFotoUrl(path).then((url) => {
        if (url) this.fotoUrls.update((m) => ({ ...m, [path]: url }));
      });
    }
  }

  private revokePreviews() {
    for (const p of this.fotoFiles()) URL.revokeObjectURL(p.preview);
  }

  onFilesPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    const pending = picked.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    this.fotoFiles.update((list) => [...list, ...pending]);
    input.value = ''; // allow re-picking the same file
  }

  removePending(index: number) {
    this.fotoFiles.update((list) => {
      const target = list[index];
      if (target) URL.revokeObjectURL(target.preview);
      return list.filter((_, i) => i !== index);
    });
  }

  removeExistingFoto(path: string) {
    this.fotoPaths.update((list) => list.filter((p) => p !== path));
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    // CH1 — bloquea retroceso/exceso; exige confirmar un salto inverosímil (ámbar).
    const km = this.kmValidacion();
    if (km?.nivel === 'error') {
      this.saveError.set(km.mensaje ?? 'El kilometraje no es coherente con las lecturas del vehículo.');
      return;
    }
    if (km?.nivel === 'aviso' && !this.kmConfirmado()) {
      this.saveError.set('Marca "Sí, es correcto" para confirmar el kilometraje, o corrígelo.');
      return;
    }

    const payload = this.form.value as MantenimientoFormData;
    // X6 — el flag "incluyó preventivo" solo aplica a visitas no-preventivas.
    if (payload.tipo === 'preventivo') payload.incluye_preventivo = false;

    const conflict = this.findWeekConflict(payload);
    if (conflict) {
      this.saveError.set(
        `Conflicto de calendario: el vehículo ${conflict.vehiculo?.placa ?? ''} ya tiene un mantenimiento programado la semana del ${formatFechaDisplay(conflict.fecha)}. No se pueden programar dos vehículos en mantenimiento la misma semana.`,
      );
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      // CH2 — "Otro" + alta al catálogo como taller (solo flota elevado). Si ya hay
      // uno con nombre parecido, se reutiliza en vez de duplicar.
      if (this.proveedorSel() === this.OTRO && this.proveedorAltaTaller() && this.esFlotaElevado()) {
        const nombre = (payload.proveedor ?? '').trim();
        if (nombre) {
          const existente = this.proveedoresFlota().find((p) => normNombre(p.nombre) === normNombre(nombre));
          if (existente) {
            payload.proveedor_id = existente.id;
            payload.proveedor = existente.nombre;
          } else {
            const creado = await this.proveedoresService.create({ nombre, tipos: ['taller'], activo: true });
            this.proveedoresFlota.update((l) => [{ id: creado.id, nombre: creado.nombre, tipos: creado.tipos ?? ['taller'], es_taller: true }, ...l]);
            payload.proveedor_id = creado.id;
            payload.proveedor = creado.nombre;
            this.proveedorSel.set(creado.id);
          }
        }
      }

      const id = this.editingId();
      let saved: Mantenimiento;
      if (id) {
        saved = await this.mantenimientosService.update(id, payload);
      } else {
        saved = await this.mantenimientosService.create(payload);
      }

      // Photos: upload any newly-picked files to the (now known) record id,
      // then persist the full list. A failed upload never blocks the save.
      const uploaded: string[] = [];
      for (const pending of this.fotoFiles()) {
        try {
          uploaded.push(await this.mantenimientosService.uploadFoto(saved.id, pending.file));
        } catch {
          this.toast.warning('Foto no subida', `No se pudo subir "${pending.file.name}".`);
        }
      }

      const finalFotos = [...this.fotoPaths(), ...uploaded];
      const changed =
        finalFotos.length !== this.originalFotos.length ||
        finalFotos.some((p, i) => p !== this.originalFotos[i]);
      if (changed) {
        try {
          await this.mantenimientosService.setFotos(saved.id, finalFotos);
          saved = { ...saved, fotos: finalFotos };
        } catch {
          this.toast.warning('Fotos no guardadas', 'El mantenimiento se guardó, pero las fotos no.');
        }
      } else {
        saved = { ...saved, fotos: finalFotos };
      }

      // CG13 — nuevos adjuntos (imágenes + PDFs) → tabla mantenimiento_adjuntos.
      // Un adjunto que falle no bloquea el guardado del registro.
      const adjuntos = this.adjPending();
      for (const p of adjuntos) {
        try {
          await this.mantenimientosService.uploadAdjunto(saved.id, p.file, p.tipo, p.descripcion ?? null);
        } catch (e: unknown) {
          this.toast.warning('Adjunto no subido', `No se pudo subir "${p.file.name}".`);
        }
      }

      if (id) {
        this.mantenimientos.update((list) => list.map((m) => (m.id === id ? saved : m)));
      } else {
        this.mantenimientos.update((list) => [saved, ...list]);
      }
      this.resolveListaFotos([saved]);
      this.revokePreviews();
      this.drawerOpen.set(false);
      // Si se subieron adjuntos, recarga para traer el array `adjuntos` del servidor
      // (listar_mantenimientos lo devuelve) y mostrarlos en la fila recién guardada.
      if (adjuntos.length) await this.loadAll();
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
