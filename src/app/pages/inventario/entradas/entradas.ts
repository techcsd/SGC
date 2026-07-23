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
import { DecimalPipe } from '@angular/common';
import { EntradasService } from '../../../../shared/services/entradas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import { OrdenesCompraService } from '../../../../shared/services/ordenes-compra.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { DatosPruebaService, TablaPrueba } from '../../../../shared/services/datos-prueba.service';
import { EntradaInventario, EntradaItemFormData, OrigenEntrada } from '../../../../shared/models/entrada.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { Proveedor } from '../../../../shared/models/proveedor.model';
import { OrdenCompra } from '../../../../shared/models/orden-compra.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { QtyStepper } from '../../../../shared/ui/qty-stepper/qty-stepper';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { HighlightItemDirective } from '../../../../shared/directives/highlight-item.directive';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';

@Component({
  selector: 'app-entradas',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, QtyStepper, DateRangeFilter, HighlightItemDirective, Lightbox],
  templateUrl: './entradas.html',
  styleUrl: './entradas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Entradas implements OnInit {
  private entradasService = inject(EntradasService);
  private articulosService = inject(ArticulosService);
  private bodegasService = inject(BodegasService);
  private categoriasService = inject(CategoriasService);
  private proveedoresService = inject(ProveedoresService);
  private ordenesCompraService = inject(OrdenesCompraService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private datosPrueba = inject(DatosPruebaService);

  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  readonly TABLA_PRUEBA: TablaPrueba = 'entradas_inventario';

  // ── Data state ──────────────────────────────────────────
  entries = signal<EntradaInventario[]>([]);
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  bodegas = signal<Bodega[]>([]);
  proveedores = signal<Proveedor[]>([]);
  ordenesCompra = signal<OrdenCompra[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedBodega = signal('');
  dateFrom = signal('');
  dateTo = signal('');
  // T2 — mostrar datos de prueba (solo admin; por defecto ocultos).
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── R8 — Detalle read-only de una entrada ────────────────
  detailOpen = signal(false);
  detailEntrada = signal<EntradaInventario | null>(null);
  openDetail(e: EntradaInventario) {
    this.detailEntrada.set(e);
    this.detailOpen.set(true);
  }
  closeDetail() {
    this.detailOpen.set(false);
  }

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca o desmarca la entrada como dato de prueba. */
  async marcarPrueba(e: EntradaInventario, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar(this.TABLA_PRUEBA, e.id, valor);
      this.entries.update((list) => list.map((x) => (x.id === e.id ? { ...x, es_prueba: valor } : x)));
      this.detailEntrada.update((d) => (d && d.id === e.id ? { ...d, es_prueba: valor } : d));
      this.toast.success(
        valor ? 'Marcada como prueba' : 'Prueba quitada',
        valor ? 'La entrada se ocultará del listado.' : 'La entrada vuelve al listado normal.',
      );
    } catch (err: unknown) {
      this.toast.error('Error', err instanceof Error ? err.message : 'Intenta de nuevo.');
    }
  }

  /** Elimina definitivamente una entrada marcada como prueba. */
  async eliminarPrueba(e: EntradaInventario) {
    if (!this.esAdmin() || !e.es_prueba) return;
    if (!confirm(`¿Eliminar definitivamente la entrada de prueba del ${this.formatFecha(e.fecha)}? Esta acción no se puede deshacer.`)) return;
    try {
      await this.datosPrueba.eliminar(this.TABLA_PRUEBA, e.id);
      this.entries.update((list) => list.filter((x) => x.id !== e.id));
      this.closeDetail();
      this.toast.success('Dato de prueba eliminado', 'Se eliminó la entrada.');
    } catch (err: unknown) {
      this.toast.error('Error al eliminar', err instanceof Error ? err.message : 'Intenta de nuevo.');
    }
  }

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  formItems = signal<EntradaItemFormData[]>([{ articulo_id: '', cantidad: 1, precio_unit: null }]);
  // Foto de evidencia opcional (paridad con la app de campo).
  fotoFile = signal<File | null>(null);
  fotoPreview = signal<string | null>(null);

  /**
   * Paso del wizard dentro del drawer (patrón "hojas" en versión web): 'form'
   * (elegir por categorías + cantidades) → 'resumen' (revisar/editar) → 'exito'.
   */
  step = signal<'form' | 'resumen' | 'exito'>('form');
  /** Entrada ya creada, para la hoja de éxito. */
  creado = signal<EntradaInventario | null>(null);

  formatFecha = formatFechaDisplay;
  readonly today = todayIso();
  fotoError = signal('');

  // W11 — thumbnails de la lista + lightbox in-page (nunca nueva pestaña).
  fotoThumbs = signal<Record<string, string>>({});
  fotoLightbox = signal<string | null>(null);

  thumb(e: EntradaInventario): string | null {
    return this.fotoThumbs()[e.id] ?? null;
  }

  /** Resuelve los thumbnails livianos de las entradas con foto (W9 cache). */
  private resolverThumbs(list: EntradaInventario[]) {
    for (const e of list) {
      if (!e.foto_path || this.fotoThumbs()[e.id]) continue;
      this.entradasService.getFotoUrl(e.foto_path, { width: 96, quality: 60 }).then((url) => {
        if (url) this.fotoThumbs.update((m) => ({ ...m, [e.id]: url }));
      });
    }
  }

  /** W11 — abre la foto en grande DENTRO de la página (lightbox), no en otra pestaña. */
  async verFoto(e: EntradaInventario) {
    if (!e.foto_path) return;
    this.fotoError.set('');
    try {
      const url = await this.entradasService.getFotoUrl(e.foto_path);
      if (url) this.fotoLightbox.set(url);
    } catch {
      this.fotoError.set('No se pudo abrir la foto.');
    }
  }

  /** P12 — opciones de origen del material (homologadas, primera mayúscula). */
  readonly ORIGENES: { value: OrigenEntrada; label: string }[] = [
    { value: 'compra', label: 'Compra' },
    { value: 'devolucion_obra', label: 'Devolución de obra' },
    { value: 'sobrante', label: 'Sobrante' },
    { value: 'otro', label: 'Otro' },
  ];

  form = new FormGroup({
    bodega_id: new FormControl<string | null>(null, [Validators.required]),
    origen_tipo: new FormControl<OrigenEntrada>('compra', [Validators.required]),
    origen_proyecto_id: new FormControl<string | null>(null),
    descontar_origen: new FormControl<boolean>(false),
    proveedor_id: new FormControl<string | null>(null),
    orden_compra_id: new FormControl<string | null>(null),
    fecha: new FormControl(this.today, [Validators.required]),
    referencia: new FormControl<string | null>(null),
    observaciones: new FormControl<string | null>(null),
  });

  /** Reactivo al origen elegido para mostrar/ocultar campos en la plantilla. */
  private origenTipo = signal<OrigenEntrada>('compra');
  esDevolucionObra = computed(() => this.origenTipo() === 'devolucion_obra');

  /** IDs de obra que tienen al menos un almacén activo (para ofrecer descontar). */
  private proyectosConBodega = computed(
    () => new Set(this.bodegas().filter((b) => b.proyecto_id && b.activo).map((b) => b.proyecto_id!)),
  );

  /** La obra de origen elegida tiene almacén propio → se puede descontar de él. */
  obraOrigenTieneBodega = computed(() => {
    const id = this.origenProyectoId();
    return !!id && this.proyectosConBodega().has(id);
  });
  private origenProyectoId = signal<string | null>(null);

  /** Obras activas para el selector de origen. */
  obrasActivas = computed(() => this.proyectos().filter((p) => p.activo !== false));

  onOrigenChange(value: string) {
    const tipo = (value || 'compra') as OrigenEntrada;
    this.form.controls.origen_tipo.setValue(tipo);
    this.origenTipo.set(tipo);
    if (tipo !== 'devolucion_obra') {
      this.form.controls.origen_proyecto_id.setValue(null);
      this.form.controls.descontar_origen.setValue(false);
      this.origenProyectoId.set(null);
    }
  }

  onOrigenProyectoChange(value: string) {
    const id = value || null;
    this.form.controls.origen_proyecto_id.setValue(id);
    this.origenProyectoId.set(id);
    // Si la nueva obra no tiene almacén, no puede descontarse.
    if (!id || !this.proyectosConBodega().has(id)) {
      this.form.controls.descontar_origen.setValue(false);
    }
  }

  // ── Computed ─────────────────────────────────────────────
  activeProveedores = computed(() => this.proveedores().filter((p) => p.activo));

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

  // Only orders still awaiting (full or partial) delivery are valid link targets —
  // matches sgc.registrar_entrada_inventario()'s own check server-side.
  ordenesRecibibles = computed(() =>
    this.ordenesCompra().filter((o) => o.estado === 'aprobada' || o.estado === 'recibida_parcial'),
  );

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const bodegaId = this.selectedBodega();
    const from = this.dateFrom();
    const to = this.dateTo();
    // T2 — no-admin nunca ve datos de prueba (RLS ya los oculta); admin los oculta salvo toggle.
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.entries().filter((e) => {
      if (e.es_prueba && !verPrueba) return false;
      if (q && !(e.referencia ?? '').toLowerCase().includes(q) && !(e.proveedor?.nombre ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (bodegaId && e.bodega_id !== bodegaId) return false;
      if (from && e.fecha < from) return false;
      if (to && e.fecha > to) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  hasActiveFilters = computed(
    () => !!(this.searchQuery() || this.selectedBodega() || this.dateFrom() || this.dateTo()),
  );

  itemsSubtotal = computed(() =>
    this.formItems().reduce((acc, i) => acc + i.cantidad * (i.precio_unit ?? 0), 0),
  );

  drawerTitle = computed(() => {
    switch (this.step()) {
      case 'resumen': return 'Revisar entrada';
      case 'exito': return '¡Entrada registrada!';
      default: return 'Registrar entrada';
    }
  });

  /**
   * Renglones válidos resueltos con su artículo y categoría, para la hoja de
   * resumen. Conserva el índice original en formItems para editar/quitar.
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
          precio_unit: it.precio_unit ?? null,
        };
      });
  });

  resumenValido = computed(() => this.resumenItems().length > 0);

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [entries, arts, cats, bods, provs, ordenes, proys] = await Promise.all([
        this.entradasService.getAll(),
        this.articulosService.getAll(),
        this.categoriasService.getAll(),
        this.bodegasService.getAll(),
        this.proveedoresService.getAll(),
        this.ordenesCompraService.getAll(),
        this.proyectosService.getAll(),
      ]);
      this.entries.set(entries);
      this.resolverThumbs(entries); // W11
      this.articulos.set(arts);
      this.categorias.set(cats);
      this.bodegas.set(bods);
      this.proveedores.set(provs);
      this.ordenesCompra.set(ordenes);
      this.proyectos.set(proys);
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

  onDateFromChange(value: string) {
    this.dateFrom.set(value);
    this.currentPage.set(1);
  }

  onDateToChange(value: string) {
    this.dateTo.set(value);
    this.currentPage.set(1);
  }

  /** R12 — filtro de fechas unificado. */
  onRango(r: RangoFecha) {
    this.dateFrom.set(r.desde ?? '');
    this.dateTo.set(r.hasta ?? '');
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedBodega.set('');
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

  /** Exporta las entradas filtradas a Excel. */
  async exportar() {
    const rows = this.filtered().map((e) => ({
      Fecha: this.formatFecha(e.fecha),
      Almacén: e.bodega?.nombre ?? '',
      Proveedor: e.proveedor?.nombre ?? '',
      Referencia: e.referencia ?? '',
      Artículos: (e.detalle_entradas ?? []).length,
      Total: this.entryTotal(e),
    }));
    await exportarExcel('entradas-inventario', rows);
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.creado.set(null);
    this.step.set('form');
    this.form.reset({ fecha: this.today, origen_tipo: 'compra', descontar_origen: false });
    this.origenTipo.set('compra');
    this.origenProyectoId.set(null);
    this.formItems.set([{ articulo_id: '', cantidad: 1, precio_unit: null }]);
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

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { articulo_id: '', cantidad: 1, precio_unit: null }]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateItemArticulo(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, articulo_id: value } : item)),
    );
  }

  updateItemCantidad(index: number, value: number | string) {
    const cantidad = Number(value);
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad } : item)),
    );
  }

  updateItemPrecio(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, precio_unit: value === '' ? null : Number(value) } : item)),
    );
  }

  itemTotal(item: EntradaItemFormData): number {
    return item.cantidad * (item.precio_unit ?? 0);
  }

  /**
   * Submit del formulario: en la hoja 'form' valida y avanza al resumen; en la
   * hoja 'resumen' confirma y ejecuta la entrada.
   */
  async onSave() {
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

    // P12 — devolución de obra requiere elegir la obra de origen.
    if (this.form.controls.origen_tipo.value === 'devolucion_obra' && !this.form.controls.origen_proyecto_id.value) {
      this.saveError.set('Selecciona la obra de origen de la devolución.');
      return;
    }

    const articuloIds = items.map((i) => i.articulo_id);
    if (new Set(articuloIds).size !== articuloIds.length) {
      this.saveError.set('No puedes agregar el mismo artículo más de una vez. Combina las cantidades en una sola línea.');
      return;
    }

    // precio_unit is optional (some entries have no known cost yet), but if
    // provided it must be a real non-negative number — catches both a
    // typo'd negative value and a non-numeric input silently becoming NaN.
    if (items.some((i) => i.precio_unit !== null && !(i.precio_unit >= 0))) {
      this.saveError.set('El precio unitario debe ser un número mayor o igual a cero.');
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

  /** Confirma la entrada desde la hoja de resumen y muestra la hoja de éxito. */
  private async confirmar() {
    const items = this.formItems().filter((i) => i.articulo_id && i.cantidad > 0);
    if (this.saving() || items.length === 0) return;

    this.saving.set(true);
    this.saveError.set('');

    try {
      const userId = this.userService.profile()?.id ?? null;
      const v = this.form.value;
      const esDevolucion = v.origen_tipo === 'devolucion_obra';
      const created = await this.entradasService.create(
        {
          bodega_id: v.bodega_id!,
          // En devolución de obra no aplican proveedor/OC.
          proveedor_id: esDevolucion ? null : (v.proveedor_id ?? null),
          orden_compra_id: esDevolucion ? null : (v.orden_compra_id ?? null),
          fecha: v.fecha!,
          referencia: v.referencia ?? null,
          observaciones: v.observaciones ?? null,
          items,
          origen_tipo: v.origen_tipo ?? 'compra',
          origen_proyecto_id: esDevolucion ? (v.origen_proyecto_id ?? null) : null,
          descontar_origen: esDevolucion ? (v.descontar_origen ?? false) : false,
        },
        userId,
      );
      // Foto de evidencia opcional: se sube tras crear la entrada (ya tenemos id).
      const foto = this.fotoFile();
      if (foto) {
        try {
          const path = await this.entradasService.subirFoto(created.id, foto);
          created.foto_path = path;
        } catch {
          // La entrada ya se registró; la foto es opcional y no debe revertirla.
        }
      }
      this.entries.update((list) => [created, ...list]);
      this.creado.set(created);
      this.step.set('exito');
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
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

  /** Nombre del proveedor elegido en el form (para la hoja de resumen). */
  proveedorNombre(): string {
    const id = this.form.controls.proveedor_id.value;
    return this.proveedores().find((p) => p.id === id)?.nombre ?? '—';
  }

  /** Etiqueta legible del origen elegido (para la hoja de resumen). */
  origenLabel(): string {
    const v = this.form.controls.origen_tipo.value;
    return this.ORIGENES.find((o) => o.value === v)?.label ?? 'Compra';
  }

  /** Nombre de la obra de origen elegida (para la hoja de resumen). */
  obraOrigenNombre(): string {
    const id = this.form.controls.origen_proyecto_id.value;
    return this.proyectos().find((p) => p.id === id)?.nombre ?? '—';
  }

  entryTotal(entry: EntradaInventario): number {
    return (entry.detalle_entradas ?? []).reduce(
      (acc, d) => acc + d.cantidad * (d.precio_unit ?? 0),
      0,
    );
  }

  get f() {
    return this.form.controls;
  }
}
