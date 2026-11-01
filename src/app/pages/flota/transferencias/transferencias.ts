import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Icon } from '../../../../shared/ui/icon/icon';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';

interface TransferenciaPendiente {
  id: string;
  salida_id: string;
  ofrecida_en: string;
  antiguedad_horas: number;
  de_nombre: string | null;
  a_nombre: string | null;
  a_tiene_usuario: boolean;
  notas: string | null;
  conduce_obra: string | null;
  conduce_bodega: string | null;
}

/**
 * DE4 (Ronda DE, PROMPT-128 F5, DE-12e) — Flota/admin: transferencias de
 * conduce "ofrecida" con antigüedad, para poder cancelar las que se atascaron.
 * Antes de esta pantalla, quien ofrecía no tenía NINGUNA forma de saber si su
 * oferta quedó pendiente, aceptada o nunca se creó (causa real de DE4).
 */
@Component({
  selector: 'app-flota-transferencias',
  templateUrl: './transferencias.html',
  styleUrl: './transferencias.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, TranslatePipe],
})
export class FlotaTransferencias implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  filas = signal<TransferenciaPendiente[]>([]);
  loading = signal(true);
  error = signal('');
  cancelando = signal<string | null>(null);

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data, error } = await this.supabase.client.rpc('transferencias_pendientes_flota');
      if (error) throw new Error(error.message);
      this.filas.set((data ?? []) as TransferenciaPendiente[]);
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las transferencias.');
    } finally {
      this.loading.set(false);
    }
  }

  antiguedadLabel(horas: number): string {
    if (horas < 1) return `${Math.round(horas * 60)} min`;
    if (horas < 24) return `${Math.round(horas)} h`;
    return `${Math.round(horas / 24)} d`;
  }

  async cancelar(f: TransferenciaPendiente) {
    if (!confirm(`¿Cancelar la transferencia hacia ${f.a_nombre ?? 'este chofer'}?`)) return;
    this.cancelando.set(f.id);
    try {
      const { error } = await this.supabase.client.rpc('cancelar_transferencia_conduce', { p_id: f.id });
      if (error) throw new Error(error.message);
      this.filas.update((fs) => fs.filter((x) => x.id !== f.id));
      this.toast.success('Transferencia cancelada', '');
    } catch (e) {
      this.toast.error('No se pudo cancelar', e instanceof Error ? humanizeError(e).mensaje : '');
    } finally {
      this.cancelando.set(null);
    }
  }
}
