import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CriteriosCanary, CorridaConciliacion, DiscrepanciaOdoo, OdooConciliacionService, ResumenPendientes } from '../../../../shared/services/odoo-conciliacion.service';
import { OdooSyncService } from '../../../../shared/services/odoo-sync.service';
import { ODOO_AGREGADO_LABEL, OdooEventoFila } from '../../../../shared/models/odoo-sync.model';
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

/** DS-13 / #204 — Conciliación SGC ↔ Odoo: hallazgos, SLO de publicación, errores del outbox y corridas. */
@Component({
  selector: 'app-tec-odoo-conciliacion',
  imports: [Skeleton, TranslatePipe, FechaPipe, RouterLink],
  templateUrl: './odoo-conciliacion.html',
  styleUrl: './odoo-conciliacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecOdooConciliacion implements OnInit {
  private svc = inject(OdooConciliacionService);
  private sync = inject(OdooSyncService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  discrepancias = signal<DiscrepanciaOdoo[]>([]);
  corridas = signal<CorridaConciliacion[]>([]);
  retrasoOutbox = signal(0);
  inciertos = signal(0);
  hayInstancia = signal(true);
  criterios = signal<CriteriosCanary | null>(null);
  pendientes = signal<ResumenPendientes | null>(null);
  erroresOutbox = signal<OdooEventoFila[]>([]);
  loading = signal(true);
  corriendo = signal(false);
  error = signal('');

  abiertas = computed(() => this.discrepancias().filter((d) => !d.resuelta_en));
  derivaMas24h = computed(() => this.abiertas().filter((d) => Date.now() - new Date(d.primera_vez).getTime() > 86_400_000).length);
  erroresOutboxCount = computed(() => this.criterios()?.outbox_errores ?? this.erroresOutbox().length);
  sloFuera = computed(() => {
    const c = this.criterios();
    return !!c && !(c.cumple_slo ?? c.cumple_p99);
  });

  cumpleSlo(c: CriteriosCanary): boolean {
    return c.cumple_slo ?? c.cumple_p99;
  }

  inciertosCriterio(c: CriteriosCanary): number {
    return c.inciertos_abiertos ?? this.inciertos();
  }

  async ngOnInit() {
    await this.cargar();
  }

  etiqueta(tipo: string): string {
    return this.i18n.t(ETIQUETAS[tipo] ?? tipo);
  }

  etiquetaTipo(tipo: string): string {
    return this.i18n.t(TIPOS_PENDIENTE[tipo] ?? 'Otros');
  }

  etiquetaAgregado(tipo: OdooEventoFila['agregado_tipo']): string {
    return this.i18n.t(ODOO_AGREGADO_LABEL[tipo] ?? tipo);
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
      const [err, bloq] = await Promise.all([
        this.sync.listar('salida_inventario', 'error').catch(() => [] as OdooEventoFila[]),
        this.sync.listar('salida_inventario', 'bloqueado').catch(() => [] as OdooEventoFila[]),
      ]);
      this.erroresOutbox.set(
        [...err, ...bloq].sort((a, b) => +new Date(b.actualizado_en) - +new Date(a.actualizado_en)),
      );
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
