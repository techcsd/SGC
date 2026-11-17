import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { OdooSyncService } from '../../services/odoo-sync.service';
import { OdooDocumentoSyncEstado, OdooDocumentoTipo } from '../../models/odoo-sync.model';
import { UserService } from '../../../app/core/services/user.service';
import { ToastService } from '../../services/toast.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { I18nService } from '../../i18n/i18n.service';
import { humanizeError } from '../../utils/friendly-error.util';

/**
 * W2 (DS-16/18/19/21/22) — estado de sincronización con Odoo de UN documento
 * (entrada, retiro, conteo, conduce externo) + «Reintentar». Solo lo ve y lo
 * opera Tecnología/admin; para el resto no se pinta ni se consulta.
 */
@Component({
  selector: 'app-odoo-sync-estado',
  imports: [TranslatePipe],
  templateUrl: './odoo-sync-estado.html',
  styleUrl: './odoo-sync-estado.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OdooSyncEstado {
  private sync = inject(OdooSyncService);
  private user = inject(UserService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  tipo = input.required<OdooDocumentoTipo>();
  documentoId = input.required<string>();

  estado = signal<OdooDocumentoSyncEstado | null>(null);
  reintentando = signal(false);
  puede = computed(() => this.user.roles().includes('admin') || this.user.esTecnologia());
  puedeReintentar = computed(() => this.estado()?.estado === 'error' || this.estado()?.estado === 'incierto');

  readonly etiqueta: Record<string, string> = {
    pendiente: 'Pendiente',
    sincronizado: 'Sincronizado',
    incierto: 'Por verificar',
    error: 'Con error',
  };

  constructor() {
    effect(() => {
      const tipo = this.tipo();
      const id = this.documentoId();
      if (!this.puede() || !id) { this.estado.set(null); return; }
      this.cargar(tipo, id);
    });
  }

  private async cargar(tipo: OdooDocumentoTipo, id: string) {
    try {
      this.estado.set(await this.sync.estadoDocumento(tipo, id));
    } catch {
      this.estado.set(null);
    }
  }

  async reintentar() {
    if (this.reintentando()) return;
    this.reintentando.set(true);
    try {
      await this.sync.reintentarDocumento(this.tipo(), this.documentoId());
      this.toast.success(this.i18n.t('Reintento programado'));
      await this.cargar(this.tipo(), this.documentoId());
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo reintentar'), humanizeError(e).mensaje);
    } finally {
      this.reintentando.set(false);
    }
  }
}
