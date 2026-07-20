import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { SolicitudesMaterialService } from '../../../../shared/services/solicitudes-material.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { SalidaInventario, SalidaItemFormData, MOTIVOS_SALIDA, SALIDA_ESTADO_LABELS } from '../../../../shared/models/salida.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { SolicitudMaterial } from '../../../../shared/models/solicitud.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { QtyStepper } from '../../../../shared/ui/qty-stepper/qty-stepper';
import { HighlightItemDirective } from '../../../../shared/directives/highlight-item.directive';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';

@Component({
  selector: 'app-salidas',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, RouterLink, QtyStepper, HighlightItemDirective],
  templateUrl: './salidas.html',
  styleUrl: './salidas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Salidas implements OnInit {
  private salidasService = inject(SalidasService);
  private articulosService = inject(ArticulosService);
  private bodegasService = inject(BodegasService);
  private categoriasService = inject(CategoriasService);
  private proyectosService = inject(ProyectosService);
  private solicitudesMaterialService = inject(SolicitudesMaterialService);
  private toast = inject(ToastService);
  private userService = inject(UserService);

  // ── Data state ──────────────────────────────────────────
  salidas = signal<SalidaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  bodegas = signal<Bodega[]>([]);
  proyectos = signal<Proyecto[]>([]);
  solicitudesPendientes = signal<SolicitudMaterial[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');
  fotoError = signal('');

  // ── Solicitud being attended (set when "Crear salida" is triggered from a solicitud) ──
  solicitudEnAtencion = signal<SolicitudMaterial | null>(null);

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedBodega = signal<string>('');
  selectedMotivo = signal<string>('');
  dateFrom = signal<string>('');
  dateTo = signal<string>('');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  formItems = signal<SalidaItemFormData[]>([{ articulo_id: '', cantidad: 1 }]);
  // Foto de evidencia opcional (paridad con la app de campo).
  fotoFile = signal<File | null>(null);
  fotoPreview = signal<string | null>(null);

  /**
   * Paso del wizard dentro del drawer (patrón "hojas" del jefe en versión web):
   * 'form' (elegir por categorías + cantidades) → 'resumen' (revisar/editar todo
   * lo seleccionado) → 'exito' (confirmación). La aprobación de requisición NO
   * usa estos pasos (tiene su propio mapeo inline).
   */
  step = signal<'form' | 'resumen' | 'exito'>('form');
  /** Salida ya creada, para la pantalla de éxito (link al conduce). */
  creado = signal<SalidaInventario | null>(null);

  // A2 — al aprobar una requisición, el aprobador MAPEA cada renglón (texto libre del
  // ingeniero) a un artículo del catálogo. Mapeado -> puede despacharse de stock; sin
  // mapear -> va 100% a la solicitud de compra automática.
  reqItems = signal<{ descripcion: string; unidad: string | null; articulo_id: string | null; cantidad: number; talla: string | null }[]>([]);

  readonly MOTIVOS_SALIDA = MOTIVOS_SALIDA;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;

  formatFecha = formatFechaDisplay;
  readonly today = todayIso();

  form = new FormGroup({
    bodega_id: new FormControl<string | null>(null, [Validators.required]),
    proyecto_id: new FormControl<string | null>(null),
    motivo: new FormControl<string | null>(null, [Validators.required]),
    fecha: new FormControl<string>(this.today, [Validators.required]),
    responsable: new FormControl<string | null>(null),
    observaciones: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  activeProyectos = computed(() => this.proyectos().filter((p) => p.activo));

  /**
   * Artículos agrupados por categoría para los <select> (R16). Se itera categorias()
   * — que ya viene destacada-first + orden — emitiendo un grupo por categoría con
   * artículos; los artículos sin categoría activa caen en un grupo final "Otros".
   */
  articulosAgrupados = computed<{ categoria: string; destacada: boolean; articulos: Articulo[] }[]>(() => {
    // Solo artículos activos son seleccionables (los desactivados quedan en "(Revisión)").
    const arts = this.articulos().filter((a) => a.activo);
    const cats = this.categorias();
    const byCat = new Map<number, Articulo[]>();
    for (const a of arts) {
      const list = byCat.get(a.categoria_id);
      if (list) list.push(a);
      else byCat.set(a.categoria_id, [a]);
    }
    const grupos: { categoria: string; destacada: boolean; articulos: Articulo[] }[] = [];
    const catIds = new Set<number>();
    for (const c of cats) {
      catIds.add(c.id);
      const list = byCat.get(c.id);
      if (list && list.length) {
        grupos.push({ categoria: c.nombre, destacada: c.destacada, articulos: list });
      }
    }
    const otros = arts.filter((a) => !catIds.has(a.categoria_id));
    if (otros.length) {
      grupos.push({ categoria: 'Otros', destacada: false, articulos: otros });
    }
    return grupos;
  });

  /** True cuando el drawer está aprobando una requisición (auto-división), no una salida manual. */
  atendiendoRequisicion = computed(() => !!this.solicitudEnAtencion());
  drawerTitle = computed(() => {
    if (this.atendiendoRequisicion()) return 'Aprobar requisición';
    switch (this.step()) {
      case 'resumen': return 'Revisar salida';
      case 'exito': return '¡Salida registrada!';
      default: return 'Registrar salida';
    }
  });

  /**
   * Renglones válidos seleccionados, resueltos con su artículo y categoría, para
   * la hoja de resumen. Conserva el índice original en formItems para poder editar
   * la cantidad / quitar el renglón desde el resumen.
   */
  resumenItems = computed(() => {
    const arts = this.articulos();
    const catName = new Map(this.categorias().map((c) => [c.id, c.nombre] as const));
    return this.formItems()
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => it.articulo_id && it.cantidad > 0)
      .map(({ it, index }) => {
        const a = arts.find((x) => x.id === it.articulo_id);
        return {
          index,
          nombre: a?.nombre ?? '—',
          codigo: a?.codigo ?? '',
          categoria: a ? (catName.get(a.categoria_id) ?? 'Otros') : 'Otros',
          cantidad: it.cantidad,
          requiere_talla: a?.requiere_talla ?? false,
          talla: it.talla ?? null,
        };
      });
  });

  /** Artículo del catálogo por id (para talla/nota en la UI). */
  private articuloById(id: string | null | undefined): Articulo | undefined {
    return id ? this.articulos().find((a) => a.id === id) : undefined;
  }
  /** ¿El artículo de este renglón exige talla? */
  itemRequiereTalla(articuloId: string): boolean {
    return this.articuloById(articuloId)?.requiere_talla ?? false;
  }
  /** Nota/ayuda del artículo (empaque/referencia) para mostrar en el renglón. */
  itemNota(articuloId: string): string | null {
    return this.articuloById(articuloId)?.nota ?? null;
  }
  updateItemTalla(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, talla: value } : item)),
    );
  }

  /** Hay al menos un renglón válido para confirmar. */
  resumenValido = computed(() => this.resumenItems().length > 0);

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const bodega = this.selectedBodega();
    const motivo = this.selectedMotivo();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.salidas().filter((s) => {
      if (
        q &&
        !(s.responsable ?? '').toLowerCase().includes(q) &&
        !(s.proyecto?.nombre ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (bodega && s.bodega_id !== bodega) return false;
      if (motivo && s.motivo !== motivo) return false;
      if (from && s.fecha < from) return false;
      if (to && s.fecha > to) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  // FormControl.value isn't a signal — bridge valueChanges so this actually
  // recomputes when the user picks a motivo (a plain computed() never re-ran).
  private motivoValue = toSignal(this.form.controls.motivo.valueChanges, {
    initialValue: this.form.controls.motivo.value,
  });
  showProyectoField = computed(() => this.motivoValue() === 'uso_proyecto');

  hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedBodega() ||
      !!this.selectedMotivo() ||
      !!this.dateFrom() ||
      !!this.dateTo(),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [salidas, arts, cats, bods, proyectos, solicitudes] = await Promise.all([
        this.salidasService.getAll(),
        this.articulosService.getAll(),
        this.categoriasService.getAll(),
        this.bodegasService.getAll(),
        this.proyectosService.getAll(),
        this.solicitudesMaterialService.getAll(),
      ]);
      this.salidas.set(salidas);
      this.articulos.set(arts);
      this.categorias.set(cats);
      this.bodegas.set(bods);
      this.proyectos.set(proyectos);
      this.solicitudesPendientes.set(solicitudes.filter((s) => s.estado === 'pendiente'));
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

  onBodegaChange(value: string) {
    this.selectedBodega.set(value);
    this.currentPage.set(1);
  }

  onMotivoChange(value: string) {
    this.selectedMotivo.set(value);
    this.currentPage.set(1);
  }

  onDateFromChange(value: string) {
    this.dateFrom.set(value);
    this.currentPage.set(1);
  }

  onDateToChange(value: string) {
    this.dateTo.set(value);
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedBodega.set('');
    this.selectedMotivo.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
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

  /** Exporta las salidas filtradas a Excel. */
  async exportar() {
    const rows = this.filtered().map((s) => ({
      Fecha: this.formatFecha(s.fecha),
      Almacén: s.bodega?.nombre ?? '',
      Motivo: this.getMotivoLabel(s.motivo),
      Proyecto: s.proyecto?.nombre ?? '',
      Responsable: s.responsable ?? '',
      Estado: this.ESTADO_LABELS[s.estado],
      Artículos: (s.detalle_salidas ?? []).length,
    }));
    await exportarExcel('salidas-inventario', rows);
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.solicitudEnAtencion.set(null);
    this.creado.set(null);
    this.step.set('form');
    this.form.reset({ fecha: this.today });
    this.formItems.set([{ articulo_id: '', cantidad: 1 }]);
    this.quitarFoto();
    this.drawerOpen.set(true);
  }

  /** Selección de foto opcional (comprimida antes de guardar). */
  async onFotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const comprimida = await comprimirImagen(file);
    this.fotoFile.set(comprimida);
    this.fotoPreview.set(URL.createObjectURL(comprimida));
  }

  quitarFoto() {
    const prev = this.fotoPreview();
    if (prev) URL.revokeObjectURL(prev);
    this.fotoFile.set(null);
    this.fotoPreview.set(null);
  }

  /** Desde la hoja de éxito: limpia todo y vuelve a la hoja del formulario. */
  registrarOtra() {
    this.openCreate();
  }

  /** Opens the approval drawer for a pending requisición, auto-matching each line to the catalog. */
  atenderSolicitud(s: SolicitudMaterial) {
    this.saveError.set('');
    this.creado.set(null);
    this.step.set('form');
    this.solicitudEnAtencion.set(s);
    const arts = this.articulos();
    const norm = (t: string) => t.toLowerCase().trim();
    this.reqItems.set(
      (s.items ?? []).map((i) => {
        const d = norm(i.descripcion);
        // auto-match por nombre o código exacto; si no, queda sin mapear (irá a compra).
        const match = arts.find((a) => norm(a.nombre) === d || norm(a.codigo) === d);
        return { descripcion: i.descripcion, unidad: i.unidad, articulo_id: match?.id ?? null, cantidad: i.cantidad, talla: i.talla ?? null };
      }),
    );
    this.form.reset({
      fecha: this.today,
      motivo: 'uso_proyecto',
      proyecto_id: s.proyecto_id,
      observaciones: s.notas ?? null,
    });
    this.drawerOpen.set(true);
  }

  updateReqItemArticulo(index: number, value: string) {
    this.reqItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, articulo_id: value || null } : it)),
    );
  }

  updateReqItemCantidad(index: number, value: number | string) {
    const cantidad = Number(value);
    this.reqItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, cantidad } : it)),
    );
  }

  async rechazarSolicitud(s: SolicitudMaterial) {
    try {
      await this.solicitudesMaterialService.rechazar(s.id);
      this.solicitudesPendientes.update((list) => list.filter((x) => x.id !== s.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al rechazar la solicitud.');
    }
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { articulo_id: '', cantidad: 1 }]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateItemArticulo(index: number, value: string) {
    this.formItems.update((items) =>
      // Al cambiar de artículo, se limpia la talla previa (no aplica al nuevo).
      items.map((item, i) => (i === index ? { ...item, articulo_id: value, talla: null } : item)),
    );
  }

  updateItemCantidad(index: number, value: number | string) {
    const cantidad = Number(value);
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad } : item)),
    );
  }

  /**
   * Submit del formulario. Enruta según el contexto/paso:
   *  - Aprobación de requisición: despacha directo (flujo A2, sin resumen).
   *  - Paso 'form': valida y avanza a la hoja de resumen.
   *  - Paso 'resumen': confirma y ejecuta la salida.
   */
  async onSave() {
    const solicitud = this.solicitudEnAtencion();
    // A2 — Aprobación de requisición: el sistema divide (despacho + compra automática).
    // Enviamos los renglones ORIGINALES de la requisición (incluye los de texto libre
    // sin artículo, que van 100% a compra) — no los del editor de salida manual.
    if (solicitud) {
      await this.aprobarRequisicion(solicitud);
      return;
    }

    if (this.step() === 'resumen') {
      await this.confirmar();
      return;
    }
    this.irAResumen();
  }

  /** Valida la hoja del formulario y pasa a la hoja de resumen/review. */
  irAResumen() {
    this.form.markAllAsTouched();
    const items = this.formItems().filter((i) => i.articulo_id && i.cantidad > 0);
    if (this.form.invalid || items.length === 0) {
      if (items.length === 0) {
        this.saveError.set('Agrega al menos un artículo con cantidad mayor a cero.');
      }
      return;
    }

    const articuloIds = items.map((i) => i.articulo_id);
    if (new Set(articuloIds).size !== articuloIds.length) {
      this.saveError.set('No puedes agregar el mismo artículo más de una vez. Combina las cantidades en una sola línea.');
      return;
    }

    // EPP: exige talla en los artículos que la requieren.
    const sinTalla = items.filter((i) => this.itemRequiereTalla(i.articulo_id) && !(i.talla ?? '').trim());
    if (sinTalla.length > 0) {
      const nombres = sinTalla.map((i) => this.articuloById(i.articulo_id)?.nombre ?? 'artículo').join(', ');
      this.saveError.set(`Indica la talla para: ${nombres}.`);
      return;
    }

    const v = this.form.value;
    if (v.motivo === 'uso_proyecto' && !v.proyecto_id) {
      this.saveError.set('Selecciona el proyecto para una salida por uso en proyecto.');
      return;
    }

    this.saveError.set('');
    this.step.set('resumen');
  }

  /** Vuelve de la hoja de resumen a la del formulario para seguir editando. */
  volverAForm() {
    this.saveError.set('');
    this.step.set('form');
  }

  /** Confirma la salida desde la hoja de resumen y muestra la hoja de éxito. */
  private async confirmar() {
    const items = this.formItems().filter((i) => i.articulo_id && i.cantidad > 0);
    if (this.saving() || items.length === 0) return;

    this.saving.set(true);
    this.saveError.set('');

    try {
      const v = this.form.value;
      const userId = this.userService.profile()?.id ?? null;
      const created = await this.salidasService.create(
        {
          bodega_id: v.bodega_id!,
          proyecto_id: v.motivo === 'uso_proyecto' ? (v.proyecto_id ?? null) : null,
          motivo: v.motivo!,
          fecha: v.fecha!,
          responsable: v.responsable ?? null,
          observaciones: v.observaciones ?? null,
          conductor_id: null,
          vehiculo_id: null,
          items,
        },
        userId,
      );
      // Foto de evidencia opcional: se sube tras crear la salida (ya tenemos id).
      const foto = this.fotoFile();
      if (foto) {
        try {
          const path = await this.salidasService.subirFoto(created.id, foto);
          created.foto_path = path;
        } catch {
          // La salida ya se registró; la foto es opcional y no debe revertirla.
          this.toast.warning('Salida registrada', 'No se pudo adjuntar la foto; puedes reintentar luego.');
        }
      }
      this.salidas.update((list) => [created, ...list]);
      this.creado.set(created);
      this.step.set('exito');
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  /** A2 — Aprueba una requisición con auto-división (despacho en stock + compra del faltante). */
  private async aprobarRequisicion(solicitud: SolicitudMaterial) {
    this.form.markAllAsTouched();
    if (!this.form.controls.bodega_id.value) {
      this.saveError.set('Selecciona el almacén desde el que se despachará.');
      return;
    }
    if (this.saving()) return;

    const reqItems = this.reqItems().filter((i) => i.cantidad > 0);
    if (reqItems.length === 0) {
      this.saveError.set('La requisición no tiene renglones válidos.');
      return;
    }
    // Un mismo artículo mapeado no puede repetirse (el despacho fallaría al sumar stock).
    const mapped = reqItems.map((i) => i.articulo_id).filter((x): x is string => !!x);
    if (new Set(mapped).size !== mapped.length) {
      this.saveError.set('Un mismo artículo está mapeado en más de un renglón. Combínalos en uno solo.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    try {
      const v = this.form.value;
      const res = await this.solicitudesMaterialService.aprobarRequisicion(solicitud.id, {
        bodega_id: v.bodega_id!,
        fecha: v.fecha!,
        responsable: v.responsable ?? null,
        observaciones: v.observaciones ?? null,
        items: reqItems,
      });

      // La RPC es atómica y ya hizo commit: a partir de aquí es ÉXITO. Cerramos
      // y avisamos ANTES de leer nada más, para que un fallo de lectura posterior
      // no se muestre como "error al aprobar" (y no deje reintentar algo ya hecho).
      this.solicitudesPendientes.update((list) => list.filter((x) => x.id !== solicitud.id));
      this.drawerOpen.set(false);

      // Resumen de la división para el aprobador.
      if (res.faltante_total > 0 && res.despachado_total > 0) {
        this.toast.success(
          'Requisición aprobada',
          `Se despachó lo disponible (${res.despachado_total}) y se generó una solicitud de compra por el faltante (${res.faltante_total}) en Compras.`,
        );
      } else if (res.faltante_total > 0) {
        this.toast.warning(
          'Requisición aprobada — sin stock',
          `No había stock disponible. Se generó una solicitud de compra por ${res.faltante_total} en el módulo Compras.`,
        );
      } else {
        this.toast.success('Requisición aprobada', 'Se despachó completa desde el almacén. Genera el conduce para la entrega.');
      }

      // Refrescar la lista de salidas es secundario; si falla, se repone al recargar.
      if (res.salida_id) {
        try {
          const created = await this.salidasService.getById(res.salida_id);
          this.salidas.update((list) => [created, ...list]);
        } catch {
          /* la salida sí se creó; la lista se actualizará en la próxima carga */
        }
      }
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al aprobar la requisición.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  /** Nombre del almacén elegido en el form (para la hoja de resumen). */
  bodegaNombre(): string {
    const id = this.form.controls.bodega_id.value;
    return this.bodegas().find((b) => b.id === id)?.nombre ?? '—';
  }

  /** Nombre del proyecto elegido en el form (para la hoja de resumen). */
  proyectoNombre(): string {
    const id = this.form.controls.proyecto_id.value;
    return this.proyectos().find((p) => p.id === id)?.nombre ?? '—';
  }

  getMotivoLabel(motivo: string): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  /** X4 — abre la foto de evidencia capturada por la app de campo (mismo patrón que entradas). */
  async verFoto(s: SalidaInventario) {
    if (!s.foto_path) return;
    this.fotoError.set('');
    try {
      const url = await this.salidasService.getFotoUrl(s.foto_path);
      window.open(url, '_blank', 'noopener');
    } catch {
      this.fotoError.set('No se pudo abrir la foto.');
    }
  }

  getMotivoModifier(motivo: string): string {
    const map: Record<string, string> = {
      uso_proyecto: 'info',
      venta: 'success',
      merma: 'danger',
      devolucion: 'warning',
      ajuste: 'neutral',
      otro: 'neutral',
    };
    return map[motivo] ?? 'neutral';
  }

  get f() {
    return this.form.controls;
  }
}
