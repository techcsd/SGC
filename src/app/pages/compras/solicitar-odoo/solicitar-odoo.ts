import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SolicitudesCompraService } from '../../../../shared/services/solicitudes-compra.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { UserService } from '../../../core/services/user.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { SolicitudCompra } from '../../../../shared/models/solicitud.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { Icon } from '../../../../shared/ui/icon/icon';
import { OdooProductoPicker } from '../../../../shared/ui/odoo-producto-picker/odoo-producto-picker';
import { OdooProductoCompra } from '../../../../shared/models/odoo.model';
import { OdooProductoSolicitudesService } from '../../../../shared/services/odoo-producto-solicitudes.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';

interface ItemRow {
  descripcion: string;
  cantidad: number;
  proveedor_sugerido: string;
  /** Producto elegido de Odoo (null = texto libre pendiente de alta). */
  odoo_product: OdooProductoCompra | null;
}

const ITEM_VACIO: ItemRow = { descripcion: '', cantidad: 1, proveedor_sugerido: '', odoo_product: null };

const ESTADO_BADGE: Record<string, string> = {
  pendiente: 'warning',
  convertida: 'success',
  rechazada: 'danger',
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  convertida: 'Convertida en orden',
  rechazada: 'Rechazada',
};

// AY3 — estado REAL de la orden de compra que nació de la requisición.
const ORDEN_ESTADO_LABEL: Record<string, string> = {
  borrador: 'Orden en borrador',
  aprobada: 'Orden aprobada',
  recibida_parcial: 'Orden recibida (parcial)',
  recibida: 'Orden recibida',
  cancelada: 'Orden cancelada',
};
const ORDEN_ESTADO_BADGE: Record<string, string> = {
  borrador: 'neutral',
  aprobada: 'info',
  recibida_parcial: 'warning',
  recibida: 'success',
  cancelada: 'danger',
};

@Component({
  selector: 'app-solicitar-odoo',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, Icon, StaggerDirective, OdooProductoPicker],
  templateUrl: './solicitar-odoo.html',
  styleUrl: './solicitar-odoo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/** Variante «Odoo directo» de Solicitar compra (CY24): mismo flujo; el producto se elige de Odoo. */
export class SolicitarOdoo implements OnInit {
  private odooSolicitudes = inject(OdooProductoSolicitudesService);
  private toast = inject(ToastService);
  private solicitudesService = inject(SolicitudesCompraService);
  private proyectosService = inject(ProyectosService);
  private datosPruebaView = inject(DatosPruebaViewService);
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;
  estadoBadge = (estado: string) => ESTADO_BADGE[estado] ?? 'neutral';
  estadoLabel = (estado: string) => ESTADO_LABEL[estado] ?? estado;
  ordenEstadoLabel = (estado: string) => ORDEN_ESTADO_LABEL[estado] ?? estado;
  ordenEstadoBadge = (estado: string) => ORDEN_ESTADO_BADGE[estado] ?? 'neutral';
  ordenDe = (solicitudId: string) => this.ordenesMap()[solicitudId] ?? null;

  solicitudes = signal<SolicitudCompra[]>([]);
  proyectos = signal<Proyecto[]>([]);
  // AY3 — solicitud_id → estado real de su orden de compra (para el ingeniero).
  ordenesMap = signal<Record<string, { orden_estado: string; numero: string | null }>>({});
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  drawerOpen = signal(false);
  formItems = signal<ItemRow[]>([{ ...ITEM_VACIO }]);

  // QA-041 — fila expandible: ver renglones (proveedor, foto, notas, enlace a OC).
  expandedId = signal<string | null>(null);
  toggle(id: string) {
    this.expandedId.update((cur) => (cur === id ? null : id));
  }

  /** Abre la foto adjunta del renglón (bucket privado `inventario`) con URL firmada. */
  async verFoto(path: string) {
    try {
      const { data, error } = await this.supabase.client.storage
        .from('inventario')
        .createSignedUrl(path, 3600);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch {
      this.error.set('No se pudo abrir la foto.');
    }
  }

  form = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    notas: new FormControl<string | null>(null),
  });

  activeProyectos = computed(() =>
    this.datosPruebaView.visibles(this.proyectos()).filter((p) => p.activo),
  );

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [solicitudes, proyectos, ordenes] = await Promise.all([
        this.solicitudesService.getAll(),
        this.proyectosService.getAll(),
        this.solicitudesService.misOrdenes(),
      ]);
      this.solicitudes.set(solicitudes);
      this.proyectos.set(proyectos);
      this.ordenesMap.set(ordenes);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las solicitudes.');
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    this.saveError.set('');
    this.form.reset();
    this.formItems.set([{ ...ITEM_VACIO }]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { ...ITEM_VACIO }]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  onOdooProductoSelect(index: number, producto: OdooProductoCompra | null) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, odoo_product: producto, descripcion: producto ? producto.nombre : '' } : item)),
    );
  }

  /** «Solicitar alta» desde el renglón: queda en la bandeja de Compras; la línea no se guarda hasta tener producto. */
  async onOdooSolicitarAlta(index: number, terminoBuscado: string) {
    const descripcion = this.formItems()[index].descripcion.trim() || terminoBuscado;
    try {
      await this.odooSolicitudes.crear(descripcion, terminoBuscado);
      this.toast.success('Solicitud de alta enviada', 'Compras la resolverá en «Productos por dar de alta en Odoo».');
    } catch (e: unknown) {
      this.toast.error('No se pudo enviar la solicitud de alta', e instanceof Error ? e.message : undefined);
    }
  }

  updateItem(index: number, field: 'cantidad' | 'proveedor_sugerido', value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, [field]: field === 'cantidad' ? Number(value) : value } : item)),
    );
  }

  async onSave() {
    this.form.markAllAsTouched();
    const items = this.formItems().filter((i) => i.odoo_product && i.cantidad > 0);
    if (this.form.invalid || this.saving() || items.length === 0) return;

    this.saving.set(true);
    this.saveError.set('');

    try {
      const solicitanteId = this.userService.profile()?.id;
      if (!solicitanteId) throw new Error('Sesión inválida.');

      const v = this.form.value;
      const created = await this.solicitudesService.create({
        proyecto_id: v.proyecto_id!,
        solicitante_id: solicitanteId,
        notas: v.notas ?? null,
        items: items.map((i) => ({
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          proveedor_sugerido: i.proveedor_sugerido || null,
          odoo_product_id: i.odoo_product!.id,
          odoo_uom_id: i.odoo_product!.unidad_compra_id ?? null,
          odoo_snapshot: i.odoo_product,
        })),
      });
      this.solicitudes.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
