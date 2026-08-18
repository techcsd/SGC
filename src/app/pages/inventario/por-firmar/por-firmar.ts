import {
  Component, ChangeDetectionStrategy, inject, signal, viewChild, OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { UpperCasePipe } from '@angular/common';
import {
  SalidasService, ConducePorFirmarRow, ConduceDetalleApp,
} from '../../../../shared/services/salidas.service';
import { NotificacionesService } from '../../../../shared/services/notificaciones.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaMedia, formatHoraTimestamp } from '../../../../shared/utils/fecha.util';

/**
 * AU1 — Bandeja "Conduces por firmar" del despachante (web, paridad con la app).
 * El flujo AS2 (firma remota del despachante) no tenía puerta de entrada: aquí el
 * despachante ve los conduces que le tocan y firma DESDE SU sesión. El chofer no
 * puede marcar "entregado" hasta esta firma (regla server-side AU1/DR456).
 */
@Component({
  selector: 'app-conduces-por-firmar',
  imports: [RouterLink, UpperCasePipe, SignaturePad, Skeleton],
  templateUrl: './por-firmar.html',
  styleUrl: './por-firmar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConducesPorFirmar implements OnInit {
  private svc = inject(SalidasService);
  private notificaciones = inject(NotificacionesService);
  private toast = inject(ToastService);
  readonly fechaMedia = formatFechaMedia;
  readonly hora = formatHoraTimestamp;

  private pad = viewChild<SignaturePad>('pad');

  filas = signal<ConducePorFirmarRow[]>([]);
  loading = signal(true);
  error = signal('');

  seleccion = signal<ConduceDetalleApp | null>(null);
  cargandoDetalle = signal(false);
  firmando = signal(false);

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.loading.set(true);
    try {
      this.filas.set(await this.svc.getConducesPorFirmar());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la bandeja.');
    } finally {
      this.loading.set(false);
    }
  }

  async abrir(fila: ConducePorFirmarRow) {
    this.seleccion.set(null);
    this.cargandoDetalle.set(true);
    try {
      this.seleccion.set(await this.svc.getConduceDetalleApp(fila.id));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo abrir el conduce.');
    } finally {
      this.cargandoDetalle.set(false);
    }
  }

  cerrar() {
    this.seleccion.set(null);
  }

  limpiarFirma() {
    this.pad()?.clear();
  }

  async firmar() {
    const det = this.seleccion();
    const pad = this.pad();
    if (!det || !pad) return;
    if (pad.isEmpty()) {
      this.toast.error('Dibuja tu firma antes de confirmar.');
      return;
    }
    this.firmando.set(true);
    try {
      const blob = await pad.toBlob();
      if (!blob) {
        this.toast.error('La firma está vacía.');
        return;
      }
      const path = await this.svc.subirEvidenciaConduce(det.id, 'firma-emisor', blob, 'png');
      const res = await this.svc.firmarComoDespachante(det.id, path);
      if (res === 'ya_firmado') {
        this.toast.info('Este conduce ya estaba firmado.');
      } else {
        this.toast.success('Conduce firmado. El chofer ya puede entregar.');
      }
      this.seleccion.set(null);
      await this.cargar();
      this.notificaciones.refresh();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo firmar el conduce.');
    } finally {
      this.firmando.set(false);
    }
  }
}
