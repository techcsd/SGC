import { Component, ChangeDetectionStrategy, inject, signal, viewChild, OnInit } from '@angular/core';
import { identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { RouterLink } from '@angular/router';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { NotificarEntregaService } from '../../../../shared/services/notificar-entrega.service';
import { UserService } from '../../../core/services/user.service';
import { SalidaInventario } from '../../../../shared/models/salida.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
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
  imports: [FormDrawer, RouterLink, Skeleton, SignaturePad],
  templateUrl: './entregas.html',
  styleUrl: './entregas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Entregas implements OnInit {
  readonly idVehiculo = identificacionVehiculo;
  private salidasService = inject(SalidasService);
  private notificarEntregaService = inject(NotificarEntregaService);
  private userService = inject(UserService);

  formatFecha = formatFechaDisplay;
  // AY1 — la foto es obligatoria para confirmar, salvo admin (bypass AS15).
  esAdmin = () => this.userService.hasRole('admin');

  entregas = signal<SalidaInventario[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  saveError = signal('');

  drawerOpen = signal(false);
  selected = signal<SalidaInventario | null>(null);
  recepcionItems = signal<RecepcionItem[]>([]);
  notas = signal('');
  // AY1 — foto de evidencia de la recepción.
  foto = signal<File | null>(null);
  // AY2 — firma del receptor (pad reutilizable).
  private firmaPad = viewChild<SignaturePad>('firmaPad');

  onFotoChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.foto.set(input.files && input.files.length ? input.files[0] : null);
  }

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
    this.foto.set(null);
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

    if (this.recepcionItems().some((i) => i.cantidad_recibida > i.cantidad_enviada)) {
      this.saveError.set('La cantidad recibida no puede ser mayor a la enviada.');
      return;
    }

    // BD2 — foto OBLIGATORIA pero NO BLOQUEANTE: si no se pudo tomar (cámara/permiso/
    // sin señal) se acepta con una NOTA que lo explique. La firma sí es obligatoria.
    // Todo salvo admin (bypass AS15).
    const pad = this.firmaPad();
    if (!this.esAdmin()) {
      if (!this.foto() && !this.notas().trim()) {
        this.saveError.set('Toma una foto de la recepción; si no puedes, explica por qué en las notas.');
        return;
      }
      if (!pad || pad.isEmpty()) {
        this.saveError.set('Falta la firma del receptor.');
        return;
      }
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      let fotoPath: string | null = null;
      if (this.foto()) {
        fotoPath = await this.salidasService.subirFotoRecepcion(salida.id, this.foto()!);
      }
      let firmaPath: string | null = null;
      if (pad && !pad.isEmpty()) {
        const blob = await pad.toBlob();
        if (blob) firmaPath = await this.salidasService.subirEvidenciaConduce(salida.id, 'firma-receptor', blob, 'png');
      }
      const incompleto = await this.salidasService.confirmarRecepcion(
        salida.id,
        this.recepcionItems().map((i) => ({ detalle_id: i.detalle_id, cantidad_recibida: i.cantidad_recibida })),
        this.notas().trim() || null,
        fotoPath,
        firmaPath,
      );

      if (incompleto) {
        // Fire-and-forget: la notificación nunca debe bloquear ni romper la confirmación.
        try {
          this.notificarEntregaService.notificarEntregaIncompleta(salida.id);
        } catch (e) {
          console.error('No se pudo notificar la entrega incompleta:', e);
        }
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
