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
import { OrdenesCompraService, OrdenCompraPayload } from '../../../../shared/services/ordenes-compra.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { SolicitudesCompraService } from '../../../../shared/services/solicitudes-compra.service';
import { EntradasService } from '../../../../shared/services/entradas.service';
import { OrdenCompra, OrdenCompraItem, OrdenEstado } from '../../../../shared/models/orden-compra.model';
import { EntradaInventario } from '../../../../shared/models/entrada.model';
import { Proveedor } from '../../../../shared/models/proveedor.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { SolicitudCompra } from '../../../../shared/models/solicitud.model';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../../shared/ui/articulo-picker/articulo-picker';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

const ESTADO_TRANSICIONES: Record<OrdenEstado, OrdenEstado[]> = {
  borrador: ['aprobada', 'cancelada'],
  aprobada: ['recibida', 'recibida_parcial', 'cancelada'],
  recibida_parcial: ['recibida', 'cancelada'],
  recibida: [],
  cancelada: [],
};

interface ItemRow {
  /** T8 — artículo del catálogo (habilita la reconciliación recibido-vs-ordenado). */
  articulo_id: string | null;
  /** Renglón en modo "Otro (texto libre)". */
  esOtro: boolean;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
}

const NUEVO_OC_ITEM: () => ItemRow = () => ({
  articulo_id: null,
  esOtro: false,
  descripcion: '',
  cantidad: 1,
  precio_unitario: 0,
});

type ReconciliacionEstado = 'completo' | 'parcial' | 'pendiente' | 'sin_articulo';

interface ReconciliacionRow {
  descripcion: string;
  ordenada: number;
  recibida: number | null;
  estado: ReconciliacionEstado;
}

@Component({
  selector: 'app-ordenes',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, DateRangeFilter, ArticuloPicker],
  templateUrl: './ordenes.html',
  styleUrl: './ordenes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ordenes implements OnInit {
  private ordenesService = inject(OrdenesCompraService);
  private articulosService = inject(ArticulosService);
  private categoriasService = inject(CategoriasService);
  private proveedoresService = inject(ProveedoresService);
  private proyectosService = inject(ProyectosService);
  private solicitudesCompraService = inject(SolicitudesCompraService);
  private entradasService = inject(EntradasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  // ── Data state ──────────────────────────────────────────
  ordenes = signal<OrdenCompra[]>([]);
  proveedores = signal<Proveedor[]>([]);
  articuloNombres = signal<string[]>([]);
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  proyectos = signal<Proyecto[]>([]);
  solicitudesPendientes = signal<SolicitudCompra[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Solicitud being attended (set when "Crear orden" is triggered from a solicitud) ──
  solicitudEnAtencion = signal<SolicitudCompra | null>(null);

  // ── Filters ──────────────────────────────────────────────
  searchProveedor = signal('');
  selectedEstado = signal('');
  fechaDesde = signal('');
  fechaHasta = signal('');

  // ── Create drawer ────────────────────────────────────────
  createDrawerOpen = signal(false);
  formItems = signal<ItemRow[]>([NUEVO_OC_ITEM()]);

  // ── Detail drawer ────────────────────────────────────────
  detailDrawerOpen = signal(false);
  detailOrden = signal<OrdenCompra | null>(null);
  detailLoading = signal(false);
  detailEntradas = signal<EntradaInventario[]>([]);

  readonly ESTADOS: OrdenEstado[] = ['borrador', 'aprobada', 'recibida_parcial', 'recibida', 'cancelada'];
  readonly IMPUESTO_RATE = 0.18;

  form = new FormGroup({
    proveedor_id: new FormControl('', [Validators.required]),
    proyecto_id: new FormControl<string | null>(null),
    fecha: new FormControl('', [Validators.required]),
    fecha_entrega_esperada: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchProveedor().toLowerCase().trim();
    const estado = this.selectedEstado();
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();

    return this.ordenes().filter((o) => {
      if (q && !(o.proveedor?.nombre ?? '').toLowerCase().includes(q)) return false;
      if (estado && o.estado !== estado) return false;
      if (desde && o.fecha < desde) return false;
      if (hasta && o.fecha > hasta) return false;
      return true;
    });
  });

  subtotal = computed(() =>
    this.formItems().reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0),
  );

  impuesto = computed(() => this.subtotal() * this.IMPUESTO_RATE);

  total = computed(() => this.subtotal() + this.impuesto());

  activeProveedores = computed(() => this.proveedores().filter((p) => p.activo));

  // ── QA-076 — Reconciliación recibido vs ordenado por renglón ──────────
  // Suma las cantidades de detalle_entradas (de todas las entradas ligadas a la
  // OC) que coinciden por articulo_id con cada renglón de la orden. Los ítems sin
  // articulo_id (capturados a mano) no se pueden reconciliar automáticamente.
  reconciliacion = computed<ReconciliacionRow[]>(() => {
    const orden = this.detailOrden();
    if (!orden?.items?.length) return [];

    const recibidoPorArticulo = new Map<string, number>();
    for (const e of this.detailEntradas()) {
      for (const d of e.detalle_entradas ?? []) {
        recibidoPorArticulo.set(d.articulo_id, (recibidoPorArticulo.get(d.articulo_id) ?? 0) + d.cantidad);
      }
    }

    return orden.items.map((item) => {
      if (item.articulo_id == null) {
        return { descripcion: item.descripcion, ordenada: item.cantidad, recibida: null, estado: 'sin_articulo' as const };
      }
      const recibida = recibidoPorArticulo.get(item.articulo_id) ?? 0;
      let estado: ReconciliacionEstado;
      if (recibida >= item.cantidad) estado = 'completo';
      else if (recibida > 0) estado = 'parcial';
      else estado = 'pendiente';
      return { descripcion: item.descripcion, ordenada: item.cantidad, recibida, estado };
    });
  });

  reconEstadoClass(estado: ReconciliacionEstado): string {
    switch (estado) {
      case 'completo': return 'sgc-badge sgc-badge--success';
      case 'parcial': return 'sgc-badge sgc-badge--warning';
      case 'pendiente': return 'sgc-badge sgc-badge--neutral';
      case 'sin_articulo': return 'sgc-badge sgc-badge--neutral';
    }
  }

  reconEstadoLabel(estado: ReconciliacionEstado): string {
    switch (estado) {
      case 'completo': return 'Completo';
      case 'parcial': return 'Parcial';
      case 'pendiente': return 'Pendiente';
      case 'sin_articulo': return 'Sin artículo';
    }
  }

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [ordenes, proveedores, proyectos, solicitudes, articulos, categorias] = await Promise.all([
        this.ordenesService.getAll(),
        this.proveedoresService.getAll(),
        this.proyectosService.getAll(),
        this.solicitudesCompraService.getAll(),
        this.articulosService.getAll(),
        this.categoriasService.getAll(),
      ]);
      this.ordenes.set(ordenes);
      this.proveedores.set(proveedores);
      this.proyectos.set(proyectos);
      this.solicitudesPendientes.set(solicitudes.filter((s) => s.estado === 'pendiente'));
      const activos = articulos.filter((a) => a.activo);
      this.articulos.set(activos);
      this.categorias.set(categorias);
      this.articuloNombres.set(activos.map((a) => a.nombre));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los datos.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearchProveedor(value: string) {
    this.searchProveedor.set(value);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }

  onFechaDesde(value: string) {
    this.fechaDesde.set(value);
  }

  onFechaHasta(value: string) {
    this.fechaHasta.set(value);
  }

  /** R12 — filtro de fechas unificado (presets + rango). */
  onRango(r: RangoFecha) {
    this.fechaDesde.set(r.desde ?? '');
    this.fechaHasta.set(r.hasta ?? '');
  }

  clearFilters() {
    this.searchProveedor.set('');
    this.selectedEstado.set('');
    this.fechaDesde.set('');
    this.fechaHasta.set('');
  }

  // ── Create drawer ────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.solicitudEnAtencion.set(null);
    this.form.reset();
    this.formItems.set([NUEVO_OC_ITEM()]);
    this.createDrawerOpen.set(true);
  }

  /** Opens the create drawer pre-filled from a pending solicitud de compra. */
  atenderSolicitud(s: SolicitudCompra) {
    this.saveError.set('');
    this.solicitudEnAtencion.set(s);
    this.form.reset({
      proyecto_id: s.proyecto_id,
      notas: `Solicitud de ${s.solicitante?.nombre ?? 'ingeniero'}${s.notas ? ' — ' + s.notas : ''}`,
    });
    const items: ItemRow[] = (s.items ?? []).map((i) => ({
      articulo_id: null,
      esOtro: true,
      descripcion: i.proveedor_sugerido ? `${i.descripcion} (sugerido: ${i.proveedor_sugerido})` : i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: 0,
    }));
    this.formItems.set(items.length > 0 ? items : [NUEVO_OC_ITEM()]);
    this.createDrawerOpen.set(true);
  }

  async rechazarSolicitud(s: SolicitudCompra) {
    try {
      await this.solicitudesCompraService.rechazar(s.id);
      this.solicitudesPendientes.update((list) => list.filter((x) => x.id !== s.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al rechazar la solicitud.');
    }
  }

  closeCreate() {
    this.createDrawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, NUEVO_OC_ITEM()]);
  }

  /** T8 — selección desde el picker: setea artículo + descripción automática (o modo Otro). */
  onArticuloSelect(index: number, sel: ArticuloPickerSelection) {
    this.formItems.update((items) =>
      items.map((item, i) => {
        if (i !== index) return item;
        const a = sel.articuloId ? this.articulos().find((x) => x.id === sel.articuloId) : undefined;
        return {
          ...item,
          articulo_id: sel.articuloId,
          esOtro: sel.esOtro,
          // Artículo del catálogo → descripción automática; Otro → conserva lo escrito.
          descripcion: a ? a.nombre : sel.esOtro ? item.descripcion : '',
        };
      }),
    );
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateItem(index: number, field: keyof ItemRow, value: string | number) {
    this.formItems.update((items) =>
      items.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: field === 'descripcion' ? value : Number(value) };
        return updated;
      }),
    );
  }

  async onSave() {
    this.form.markAllAsTouched();
    const items = this.formItems();
    // cantidad > 0 / precio_unitario > 0 also rejects NaN from a non-numeric
    // input (Number('abc') is NaN, and NaN > 0 is always false).
    const validItems = items.filter(
      (item) => item.descripcion.trim() && item.cantidad > 0 && item.precio_unitario > 0,
    );
    if (this.form.invalid || this.saving() || validItems.length === 0) return;

    const hasIncompleteLine = items.some(
      (item) => item.descripcion.trim() && (!(item.cantidad > 0) || !(item.precio_unitario > 0)),
    );
    if (hasIncompleteLine) {
      this.saveError.set('Cada línea necesita una cantidad y un precio unitario mayores que cero.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    const sub = this.subtotal();
    const imp = this.impuesto();
    const tot = this.total();
    const fv = this.form.value;

    const itemPayloads: Omit<OrdenCompraItem, 'id' | 'orden_id'>[] = validItems.map((item) => ({
      articulo_id: item.articulo_id,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      total: item.cantidad * item.precio_unitario,
    }));

    try {
      const creadoPor = this.userService.profile()?.id ?? null;
      const solicitud = this.solicitudEnAtencion();

      let created;
      if (solicitud) {
        // Atomic: creates the orden and marks the solicitud convertida in one transaction —
        // no window where an orden exists but the solicitud is still stuck at "pendiente".
        const ordenId = await this.solicitudesCompraService.aprobar(solicitud.id, {
          proveedor_id: fv.proveedor_id!,
          fecha: fv.fecha!,
          fecha_entrega_esperada: fv.fecha_entrega_esperada ?? null,
          subtotal: sub,
          impuesto: imp,
          total: tot,
          notas: fv.notas ?? null,
          items: itemPayloads,
        });
        created = await this.ordenesService.getById(ordenId);
        this.solicitudesPendientes.update((list) => list.filter((x) => x.id !== solicitud.id));
      } else {
        const payload: OrdenCompraPayload = {
          proveedor_id: fv.proveedor_id!,
          proyecto_id: fv.proyecto_id ?? null,
          estado: 'borrador',
          fecha: fv.fecha!,
          fecha_entrega_esperada: fv.fecha_entrega_esperada ?? null,
          subtotal: sub,
          impuesto: imp,
          total: tot,
          notas: fv.notas ?? null,
        };
        created = await this.ordenesService.create(payload, itemPayloads, creadoPor);
      }
      this.ordenes.update((list) => [created, ...list]);

      this.createDrawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Detail drawer ────────────────────────────────────────
  async openDetail(orden: OrdenCompra) {
    this.detailDrawerOpen.set(true);
    this.detailOrden.set(orden);
    this.detailLoading.set(true);
    this.detailEntradas.set([]);
    try {
      const [full, entradas] = await Promise.all([
        this.ordenesService.getById(orden.id),
        this.entradasService.getByOrdenCompra(orden.id),
      ]);
      this.detailOrden.set(full);
      this.detailEntradas.set(entradas);
    } catch {
      // keep partial data
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetail() {
    this.detailDrawerOpen.set(false);
    this.detailOrden.set(null);
    this.detailEntradas.set([]);
  }

  entradaTotal(entrada: EntradaInventario): number {
    return (entrada.detalle_entradas ?? []).reduce((acc, d) => acc + d.cantidad * (d.precio_unit ?? 0), 0);
  }

  // ── Estado ───────────────────────────────────────────────
  async cambiarEstado(orden: OrdenCompra, estado: OrdenEstado) {
    const prev = orden.estado;
    this.ordenes.update((list) =>
      list.map((o) => (o.id === orden.id ? { ...o, estado } : o)),
    );
    // also update detail if open
    if (this.detailOrden()?.id === orden.id) {
      this.detailOrden.update((o) => (o ? { ...o, estado } : null));
    }
    try {
      await this.ordenesService.updateEstado(orden.id, estado);
    } catch (e: unknown) {
      this.ordenes.update((list) =>
        list.map((o) => (o.id === orden.id ? { ...o, estado: prev } : o)),
      );
      if (this.detailOrden()?.id === orden.id) {
        this.detailOrden.update((o) => (o ? { ...o, estado: prev } : null));
      }
      this.toast.error('No se pudo cambiar el estado', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  estadoBadgeClass(estado: OrdenEstado): string {
    switch (estado) {
      case 'borrador': return 'sgc-badge sgc-badge--neutral';
      case 'aprobada': return 'sgc-badge sgc-badge--info';
      case 'recibida_parcial': return 'sgc-badge sgc-badge--warning';
      case 'recibida': return 'sgc-badge sgc-badge--success';
      case 'cancelada': return 'sgc-badge sgc-badge--danger';
    }
  }

  estadoLabel(estado: OrdenEstado): string {
    switch (estado) {
      case 'borrador': return 'Borrador';
      case 'aprobada': return 'Aprobada';
      case 'recibida_parcial': return 'Recibida parcial';
      case 'recibida': return 'Recibida';
      case 'cancelada': return 'Cancelada';
    }
  }

  nextEstados(current: OrdenEstado): OrdenEstado[] {
    return ESTADO_TRANSICIONES[current];
  }

  itemTotal(item: ItemRow): number {
    return item.cantidad * item.precio_unitario;
  }

  // ── Exportar Excel (OCs filtradas) ───────────────────────
  async exportarExcelOrdenes() {
    const rows = this.filtered().map((o) => ({
      Número: o.numero,
      Proveedor: o.proveedor?.nombre ?? '',
      Proyecto: o.proyecto?.nombre ?? '',
      Estado: this.estadoLabel(o.estado),
      Fecha: this.formatFecha(o.fecha),
      'Entrega esperada': o.fecha_entrega_esperada ? this.formatFecha(o.fecha_entrega_esperada) : '',
      Subtotal: o.subtotal,
      Impuesto: o.impuesto,
      Total: o.total,
    }));
    await exportarExcel('ordenes-compra', rows, 'Órdenes');
  }

  get f() {
    return this.form.controls;
  }
}
