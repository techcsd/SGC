import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { NotificarEntregaService } from '../../../../shared/services/notificar-entrega.service';
import { SalidaInventario } from '../../../../shared/models/salida.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

interface RecepcionItem {
  detalle_id: string;
  articulo_nombre: string;
  unidad: string;
  cantidad_enviada: number;
  cantidad_recibida: number;
}

@Component({
  selector: 'app-bitacora-entregas',
  imports: [FormDrawer],
  templateUrl: './entregas.html',
  styleUrl: './entregas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Entregas implements OnInit {
  private salidasService = inject(SalidasService);
  private notificarEntregaService = inject(NotificarEntregaService);

  formatFecha = formatFechaDisplay;

  entregas = signal<SalidaInventario[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  saveError = signal('');

  drawerOpen = signal(false);
  selected = signal<SalidaInventario | null>(null);
  recepcionItems = signal<RecepcionItem[]>([]);
  notas = signal('');

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.entregas.set(await this.salidasService.getDespachados());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las entregas pendientes.');
    } finally {
      this.loading.set(false);
    }
  }

  openConfirm(salida: SalidaInventario) {
    this.selected.set(salida);
    this.saveError.set('');
    this.notas.set('');
    this.recepcionItems.set(
      (salida.detalle_salidas ?? []).map((d) => ({
        detalle_id: d.id,
        articulo_nombre: d.articulo?.nombre ?? 'Artículo',
        unidad: d.articulo?.unidad ?? '',
        cantidad_enviada: d.cantidad,
        cantidad_recibida: d.cantidad,
      })),
    );
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  updateCantidadRecibida(index: number, value: string) {
    this.recepcionItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad_recibida: Number(value) } : item)),
    );
  }

  marcarCompleto(index: number) {
    this.recepcionItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, cantidad_recibida: item.cantidad_enviada } : item)),
    );
  }

  hayFaltante(): boolean {
    return this.recepcionItems().some((i) => i.cantidad_recibida < i.cantidad_enviada);
  }

  async onConfirm() {
    const salida = this.selected();
    if (!salida || this.saving()) return;

    if (this.recepcionItems().some((i) => i.cantidad_recibida < 0)) {
      this.saveError.set('La cantidad recibida no puede ser negativa.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const incompleto = await this.salidasService.confirmarRecepcion(
        salida.id,
        this.recepcionItems().map((i) => ({ detalle_id: i.detalle_id, cantidad_recibida: i.cantidad_recibida })),
        this.notas().trim() || null,
      );

      if (incompleto) {
        this.notificarEntregaService.notificarEntregaIncompleta(salida.id);
      }

      this.entregas.update((list) => list.filter((s) => s.id !== salida.id));
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al confirmar la recepción.');
    } finally {
      this.saving.set(false);
    }
  }
}
