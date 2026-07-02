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
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { SolicitudesCompraService } from '../../../../shared/services/solicitudes-compra.service';
import { OrdenCompra, OrdenCompraItem, OrdenEstado } from '../../../../shared/models/orden-compra.model';
import { Proveedor } from '../../../../shared/models/proveedor.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { SolicitudCompra } from '../../../../shared/models/solicitud.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { UserService } from '../../../core/services/user.service';

const ESTADO_TRANSICIONES: Record<OrdenEstado, OrdenEstado[]> = {
  borrador: ['aprobada', 'cancelada'],
  aprobada: ['recibida', 'cancelada'],
  recibida: [],
  cancelada: [],
};

interface ItemRow {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
}

@Component({
  selector: 'app-ordenes',
  imports: [ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './ordenes.html',
  styleUrl: './ordenes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ordenes implements OnInit {
  private ordenesService = inject(OrdenesCompraService);
  private proveedoresService = inject(ProveedoresService);
  private proyectosService = inject(ProyectosService);
  private solicitudesCompraService = inject(SolicitudesCompraService);
  private userService = inject(UserService);

  // ── Data state ──────────────────────────────────────────
  ordenes = signal<OrdenCompra[]>([]);
  proveedores = signal<Proveedor[]>([]);
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
  formItems = signal<ItemRow[]>([{ descripcion: '', cantidad: 1, precio_unitario: 0 }]);

  // ── Detail drawer ────────────────────────────────────────
  detailDrawerOpen = signal(false);
  detailOrden = signal<OrdenCompra | null>(null);
  detailLoading = signal(false);

  readonly ESTADOS: OrdenEstado[] = ['borrador', 'aprobada', 'recibida', 'cancelada'];
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

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [ordenes, proveedores, proyectos, solicitudes] = await Promise.all([
        this.ordenesService.getAll(),
        this.proveedoresService.getAll(),
        this.proyectosService.getAll(),
        this.solicitudesCompraService.getAll(),
      ]);
      this.ordenes.set(ordenes);
      this.proveedores.set(proveedores);
      this.proyectos.set(proyectos);
      this.solicitudesPendientes.set(solicitudes.filter((s) => s.estado === 'pendiente'));
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
    this.formItems.set([{ descripcion: '', cantidad: 1, precio_unitario: 0 }]);
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
    const items = (s.items ?? []).map((i) => ({
      descripcion: i.proveedor_sugerido ? `${i.descripcion} (sugerido: ${i.proveedor_sugerido})` : i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: 0,
    }));
    this.formItems.set(items.length > 0 ? items : [{ descripcion: '', cantidad: 1, precio_unitario: 0 }]);
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
    this.formItems.update((items) => [...items, { descripcion: '', cantidad: 1, precio_unitario: 0 }]);
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
    const validItems = items.filter((item) => item.descripcion.trim());
    if (this.form.invalid || this.saving() || validItems.length === 0) return;

    this.saving.set(true);
    this.saveError.set('');

    const sub = this.subtotal();
    const imp = this.impuesto();
    const tot = this.total();
    const fv = this.form.value;

    const itemPayloads: Omit<OrdenCompraItem, 'id' | 'orden_id'>[] = validItems.map((item) => ({
      articulo_id: null,
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
    try {
      const full = await this.ordenesService.getById(orden.id);
      this.detailOrden.set(full);
    } catch {
      // keep partial data
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetail() {
    this.detailDrawerOpen.set(false);
    this.detailOrden.set(null);
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
    } catch {
      this.ordenes.update((list) =>
        list.map((o) => (o.id === orden.id ? { ...o, estado: prev } : o)),
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  estadoBadgeClass(estado: OrdenEstado): string {
    switch (estado) {
      case 'borrador': return 'sgc-badge sgc-badge--neutral';
      case 'aprobada': return 'sgc-badge sgc-badge--info';
      case 'recibida': return 'sgc-badge sgc-badge--success';
      case 'cancelada': return 'sgc-badge sgc-badge--danger';
    }
  }

  estadoLabel(estado: OrdenEstado): string {
    switch (estado) {
      case 'borrador': return 'Borrador';
      case 'aprobada': return 'Aprobada';
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

  get f() {
    return this.form.controls;
  }
}
