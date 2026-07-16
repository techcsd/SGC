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
  foto?: File | null;      // U17 — archivo seleccionado (se sube al guardar)
  fotoPreview?: string | null; // data URL para vista previa en el form
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

  // U17 — detalle (solo lectura) con fotos firmadas de cada renglón.
  detailOpen = signal(false);
  detail = signal<SolicitudCompra | null>(null);
  private fotoUrls = signal<Record<string, string>>({});

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

  // U17 — seleccionar/quitar foto de un renglón (se sube al guardar).
  async onItemFoto(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    let preview: string | null = null;
    if (file) preview = await this.fileToDataUrl(file);
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, foto: file, fotoPreview: preview } : it)),
    );
  }

  clearItemFoto(index: number) {
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, foto: null, fotoPreview: null } : it)),
    );
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  updateItemDescripcion(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, descripcion: value } : it)),
    );
  }

  updateItemCantidad(index: number, value: string) {
    // QA-052 — vaciar el campo daba Number('') = NaN, y el renglón se descartaba
    // en silencio al guardar. Tratamos vacío/no-numérico como 0 y conservamos la fila;
    // onSave avisa si quedó en 0 en vez de dejarla desaparecer.
    const parsed = value.trim() === '' ? 0 : Number(value);
    const cantidad = Number.isNaN(parsed) ? 0 : parsed;
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, cantidad } : it)),
    );
  }

  updateItemProveedor(index: number, value: string) {
    this.formItems.update((items) =>
      items.map((it, i) => (i === index ? { ...it, proveedor_sugerido: value } : it)),
    );
  }

  async onSave() {
    if (this.saving()) return;

    // QA-052 — separamos filas con descripción de filas válidas para avisar (en vez
    // de descartar en silencio) cuando una fila con descripción quedó con cantidad 0.
    const conDescripcion = this.formItems().filter((i) => i.descripcion.trim());
    const validRows = conDescripcion.filter((i) => i.cantidad > 0);
    if (validRows.length === 0) {
      this.saveError.set('Agrega al menos un artículo con descripción y cantidad mayor a 0.');
      return;
    }
    if (validRows.length < conDescripcion.length) {
      this.saveError.set('Hay artículos con cantidad en 0. Corrige la cantidad o elimina esos renglones.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      // U17 — sube las fotos seleccionadas (si las hay) y arma los renglones.
      const items = await Promise.all(
        validRows.map(async (i) => ({
          descripcion: i.descripcion.trim(),
          cantidad: i.cantidad,
          proveedor_sugerido: i.proveedor_sugerido.trim() || null,
          foto_path: i.foto ? await this.tecnologia.uploadCompraTecFoto(i.foto) : null,
        })),
      );
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

  // ── U17 — Detalle (solo lectura) con fotos ────────────────
  async openDetail(c: SolicitudCompra) {
    this.detail.set(c);
    this.fotoUrls.set({});
    this.detailOpen.set(true);
    const map: Record<string, string> = {};
    await Promise.all(
      (c.items ?? [])
        .filter((it) => it.foto_path)
        .map(async (it) => {
          const url = await this.tecnologia.getEquipoFotoUrl(it.foto_path!);
          if (url) map[it.id] = url;
        }),
    );
    this.fotoUrls.set(map);
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  itemFotoUrl(itemId: string): string | null {
    return this.fotoUrls()[itemId] ?? null;
  }

  tieneFotos(c: SolicitudCompra): boolean {
    return (c.items ?? []).some((it) => it.foto_path);
  }
}
