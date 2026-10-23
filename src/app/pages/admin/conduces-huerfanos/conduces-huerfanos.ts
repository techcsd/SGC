import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SalidasService, ConduceHuerfano } from '../../../../shared/services/salidas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';

/**
 * CW1 — Conduces huérfanos: lista de solo lectura (ensayo en seco) de conduces que
 * se quedaron atascados en "despachado" sin confirmación ni recepción. Nace del
 * diagnóstico de Carlos Encarnacion (chofer privado, conduces que "reaparecían"):
 * en producción no había ninguno a su nombre, pero el mecanismo es general — esta
 * pantalla le da visibilidad de TODOS los choferes, no solo uno.
 * "Anular con motivo" reusa sgc.anular_conduce (misma regla: sin confirmaciones).
 * Solo admin (CW8): anular_conduce ya solo deja pasar a is_admin(), así que la
 * lista no se ofrece a flota-elevado no-admin (el botón siempre fallaría).
 * D2 (CONTEXTO-56): ejecutar sobre producción requiere el OK explícito de Xaviel.
 */
@Component({
  selector: 'app-admin-conduces-huerfanos',
  imports: [Skeleton, DatePipe, Icon],
  templateUrl: './conduces-huerfanos.html',
  styleUrl: './conduces-huerfanos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminConducesHuerfanos implements OnInit {
  private svc = inject(SalidasService);
  private toast = inject(ToastService);

  filas = signal<ConduceHuerfano[]>([]);
  loading = signal(true);
  anulando = signal<string | null>(null);
  diasMin = signal(3);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    try {
      this.filas.set(await this.svc.conducesHuerfanos(this.diasMin()));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el reporte.');
    } finally {
      this.loading.set(false);
    }
  }

  async cambiarDias(dias: number) {
    this.diasMin.set(dias);
    await this.cargar();
  }

  async anular(f: ConduceHuerfano) {
    if (this.anulando()) return;
    const motivo = window.prompt(
      `Vas a ANULAR el conduce ${f.codigo} (${f.dias_atascado} días atascado, chofer: ${f.chofer_nombre ?? '—'}).\n\n` +
      `Escribe el motivo (obligatorio):`,
    );
    if (!motivo || !motivo.trim()) return;
    this.anulando.set(f.id);
    try {
      await this.svc.anularConduce(f.id, motivo.trim());
      this.toast.success('Conduce anulado', `${f.codigo} se anuló.`);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo anular.');
    } finally {
      this.anulando.set(null);
    }
  }
}
