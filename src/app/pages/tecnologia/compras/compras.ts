import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SolicitudCompra, SolicitudCompraEstado } from '../../../../shared/models/solicitud.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

interface CompraItemForm {
  descripcion: string;
  cantidad: number;
  proveedor_sugerido: string;
}

const ESTADO_META: Record<SolicitudCompraEstado, { label: string; badge: string }> = {
  pendiente: { label: 'Pendiente', badge: 'warning' },
  convertida: { label: 'Aprobada / convertida', badge: 'success' },
  rechazada: { label: 'Rechazada', badge: 'danger' },
};

@Component({
  selector: 'app-tec-compras',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton],
  templateUrl: './compras.html',
  styleUrl: './compras.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecCompras implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private toast = inject(ToastService);

  formatTimestamp = formatTimestampDisplay;

  compras = signal<SolicitudCompra[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  drawerOpen = signal(false);
  formItems = signal<CompraItemForm[]>([{ descripcion: '', cantidad: 1, proveedor_sugerido: '' }]);

  form = new FormGroup({
    notas: new FormControl<string | null>(null),
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const compras = await this.tecnologia.getComprasTec();
      this.compras.set(compras);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las compras.');
    } finally {
      this.loading.set(false);
    }
  }

  getEstadoLabel(estado: SolicitudCompraEstado): string {
    return ESTADO_META[estado]?.label ?? estado;
  }

  getEstadoBadge(estado: SolicitudCompraEstado): string {
    return ESTADO_META[estado]?.badge ?? 'neutral';
  }

  // ── Drawer ────────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.form.reset({ notas: null });
    this.formItems.set([{ descripcion: '', cantidad: 1, proveedor_sugerido: '' }]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { descripcion: '', cantidad: 1, proveedor_sugerido: '' }]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateItemDescripcion(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, descripcion: value } : it)),
    );
  }

  updateItemCantidad(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, cantidad: Number(value) } : it)),
    );
  }

  updateItemProveedor(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, proveedor_sugerido: value } : it)),
    );
  }

  async onSave() {
    if (this.saving()) return;

    const items = this.formItems()
      .filter((i) => i.descripcion.trim() && i.cantidad > 0)
      .map((i) => ({
        descripcion: i.descripcion.trim(),
        cantidad: i.cantidad,
        proveedor_sugerido: i.proveedor_sugerido.trim() || null,
      }));

    if (items.length === 0) {
      this.saveError.set('Agrega al menos un artículo con descripción y cantidad válida.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      await this.tecnologia.crearCompraTec(this.form.value.notas ?? null, items);
      await this.loadAll();
      this.toast.success('Solicitud enviada', 'Enviada a Compras para aprobación.');
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al enviar la solicitud.');
    } finally {
      this.saving.set(false);
    }
  }
}
