import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CriteriosCanary, CorridaConciliacion, DiscrepanciaOdoo, OdooConciliacionService, ResumenPendientes } from '../../../../shared/services/odoo-conciliacion.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { FechaPipe } from '../../../../shared/i18n/fecha.pipe';
import { presentarError } from '../../../../shared/utils/friendly-error.util';

const ETIQUETAS: Record<string, string> = {
  sin_picking_a: 'Falta el traslado A en Odoo',
  picking_a_no_validado: 'Traslado A sin validar',
  cantidad_distinta: 'Cantidades distintas',
  sin_picking_b: 'Falta el traslado B en Odoo',
  picking_b_no_validado: 'Traslado B sin validar',
  picking_huerfano: 'Traslado sin conduce',
  transito_vencido: 'Material en tránsito vencido',
  fuera_de_canal: 'Movimiento fuera de SGC',
  saldo_distinto: 'Saldo distinto',
};

const TIPOS_PENDIENTE: Record<string, string> = { recepcion: 'Recepciones', entrega: 'Órdenes de entrega', interno: 'Traslados internos', otro: 'Otros' };

/** DS-13 — Conciliación SGC ↔ Odoo: hallazgos abiertos, últimas corridas y métricas del outbox. */
@Component({
  selector: 'app-tec-odoo-conciliacion',
  imports: [Skeleton, TranslatePipe, FechaPipe],
  templateUrl: './odoo-conciliacion.html',
  styleUrl: './odoo-conciliacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecOdooConciliacion implements OnInit {
  private svc = inject(OdooConciliacionService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  discrepancias = signal<DiscrepanciaOdoo[]>([]);
  corridas = signal<CorridaConciliacion[]>([]);
  retrasoOutbox = signal(0);
  inciertos = signal(0);
  hayInstancia = signal(true);
  criterios = signal<CriteriosCanary | null>(null);
  pendientes = signal<ResumenPendientes | null>(null);
  loading = signal(true);
  corriendo = signal(false);
  error = signal('');

  abiertas = computed(() => this.discrepancias().filter((d) => !d.resuelta_en));
  derivaMas24h = computed(() => this.abiertas().filter((d) => Date.now() - new Date(d.primera_vez).getTime() > 86_400_000).length);

  async ngOnInit() {
    await this.cargar();
  }

  etiqueta(tipo: string): string {
    return this.i18n.t(ETIQUETAS[tipo] ?? tipo);
  }

  etiquetaTipo(tipo: string): string {
    return this.i18n.t(TIPOS_PENDIENTE[tipo] ?? 'Otros');
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const e = await this.svc.estado();
      this.hayInstancia.set(e.instancia);
      this.discrepancias.set(e.discrepancias ?? []);
      this.corridas.set(e.corridas ?? []);
      this.retrasoOutbox.set(e.retraso_outbox_min ?? 0);
      this.inciertos.set(e.inciertos_abiertos ?? 0);
      this.criterios.set(await this.svc.criteriosCanary().catch(() => null));
      this.pendientes.set(await this.svc.pendientes().catch(() => null));
    } catch (e) {
      this.error.set(presentarError(e, { pantalla: 'la conciliación con Odoo' }).mensajeUsuario);
    } finally {
      this.loading.set(false);
    }
  }

  async conciliarAhora() {
    this.corriendo.set(true);
    try {
      await this.svc.conciliarAhora();
      this.toast.success(this.i18n.t('Conciliación terminada'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo conciliar'), presentarError(e, { pantalla: 'la conciliación con Odoo', accion: 'conciliar' }).mensajeUsuario);
    } finally {
      this.corriendo.set(false);
    }
  }
}
