import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { OdooSyncService } from '../../../../shared/services/odoo-sync.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  OdooAgregadoTipo,
  OdooEventoDetalle,
  OdooEventoEstado,
  OdooEventoFila,
  OdooEventosResumenFila,
  ODOO_AGREGADO_LABEL,
  ODOO_ESTADO_LABEL,
} from '../../../../shared/models/odoo-sync.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { FechaPipe } from '../../../../shared/i18n/fecha.pipe';
const REINTENTABLES: OdooEventoEstado[] = ['error', 'incierto', 'bloqueado'];
const ESTADOS_ORDEN: OdooEventoEstado[] = ['pendiente', 'procesando', 'completado', 'reintento', 'error', 'incierto', 'bloqueado', 'cancelado'];

/**
 * CY16 [HU-INV-14] — "qué documento ERP corresponde a cada operación SGC y
 * resolver errores autorizados" (#16). Solo lectura + reintento autorizado:
 * no crea monitores recurrentes ni cambia la autoridad de stock (nota técnica
 * de la issue) — muestra el outbox real (`sgc.odoo_eventos`) y reencola un
 * evento fallido para que lo recoja el MISMO procesador (`odoo-sync`).
 *
 * Alcance acotado a propósito (documentado en docs/ODOO-DIAGNOSTICO-CONTRATO.md):
 * la "conciliación" de esta pieza son los conteos del outbox, no una
 * comparación línea-por-línea contra Odoo real — nada se publica todavía
 * (Fase C, #24, bloqueada por D-08), así que no hay un documento Odoo real
 * contra el cual conciliar fuera del mock.
 */
@Component({
  selector: 'app-tec-odoo-sync',
  imports: [FechaPipe, JsonPipe, FormDrawer, Skeleton, TranslatePipe],
  templateUrl: './odoo-sync.html',
  styleUrl: './odoo-sync.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecOdooSync implements OnInit {
  private svc = inject(OdooSyncService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  readonly agregadoLabel = ODOO_AGREGADO_LABEL;
  readonly estadoLabel = ODOO_ESTADO_LABEL;
  readonly estadosOrden = ESTADOS_ORDEN;

  filas = signal<OdooEventoFila[]>([]);
  resumen = signal<OdooEventosResumenFila[]>([]);
  loading = signal(true);
  degradados = signal<{ salida_id: string; horas_sin_sondeo: number | null; creado_en: string }[]>([]);
  degradados24h = computed(() => this.degradados().filter((d) => Date.now() - new Date(d.creado_en).getTime() < 24 * 3600 * 1000).length);
  error = signal('');

  filtroTipo = signal<OdooAgregadoTipo | null>(null);
  filtroEstado = signal<OdooEventoEstado | null>(null);

  tiposPresentes = computed(() => [...new Set(this.filas().map((f) => f.agregado_tipo))].sort());
  estadosPresentes = computed(() => [...new Set(this.filas().map((f) => f.estado))].sort());

  filasVisibles = computed(() => {
    const tipo = this.filtroTipo();
    const estado = this.filtroEstado();
    return this.filas().filter((f) => (!tipo || f.agregado_tipo === tipo) && (!estado || f.estado === estado));
  });

  totalPorEstado = computed(() => {
    const totales: Partial<Record<OdooEventoEstado, number>> = {};
    for (const r of this.resumen()) totales[r.estado] = (totales[r.estado] ?? 0) + r.total;
    return totales;
  });

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [filas, resumen, degradados] = await Promise.all([
        this.svc.listar(null, null),
        this.svc.resumen(),
        this.svc.conducesDegradados().catch(() => []),
      ]);
      this.filas.set(filas);
      this.resumen.set(resumen);
      this.degradados.set(degradados);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : this.i18n.t('No se pudo cargar la bandeja de sincronización.'));
    } finally {
      this.loading.set(false);
    }
  }

  setFiltroTipo(v: string) {
    this.filtroTipo.set((v || null) as OdooAgregadoTipo | null);
  }
  setFiltroEstado(v: string) {
    this.filtroEstado.set((v || null) as OdooEventoEstado | null);
  }

  esReintentable(estado: OdooEventoEstado): boolean {
    return REINTENTABLES.includes(estado);
  }

  seleccion = signal<Record<string, boolean>>({});
  reintentandoLote = signal(false);

  visiblesReintentables = computed(() => this.filasVisibles().filter((f) => this.esReintentable(f.estado)));
  idsSeleccionados = computed(() => this.visiblesReintentables().filter((f) => this.seleccion()[f.id]).map((f) => f.id));

  toggleSeleccion(id: string, on: boolean) {
    this.seleccion.update((s) => ({ ...s, [id]: on }));
  }

  toggleTodosVisibles(on: boolean) {
    const next = { ...this.seleccion() };
    for (const f of this.visiblesReintentables()) next[f.id] = on;
    this.seleccion.set(next);
  }

  todosVisiblesMarcados(): boolean {
    const vis = this.visiblesReintentables();
    return vis.length > 0 && vis.every((f) => this.seleccion()[f.id]);
  }

  folioDe(f: OdooEventoFila): string {
    return f.folio || (f.agregado_tipo === 'salida_inventario' ? `CND-${f.agregado_id.replace(/-/g, '').slice(0, 8).toUpperCase()}` : f.agregado_id);
  }

  folioSalida(id: string): string {
    return `CND-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  estadoBadgeClass(estado: OdooEventoEstado): string {
    switch (estado) {
      case 'completado': return 'sgc-badge sgc-badge--success';
      case 'pendiente':
      case 'procesando':
      case 'reintento': return 'sgc-badge sgc-badge--info';
      case 'incierto':
      case 'bloqueado': return 'sgc-badge sgc-badge--warning';
      case 'error': return 'sgc-badge sgc-badge--danger';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  // ── Detalle ──────────────────────────────────────────────
  detalleOpen = signal(false);
  detalleFila = signal<OdooEventoFila | null>(null);
  detalle = signal<OdooEventoDetalle | null>(null);
  detalleLoading = signal(false);
  detalleError = signal('');
  reintentando = signal(false);

  async abrirDetalle(fila: OdooEventoFila) {
    this.detalleFila.set(fila);
    this.detalleOpen.set(true);
    this.detalleLoading.set(true);
    this.detalleError.set('');
    this.detalle.set(null);
    try {
      this.detalle.set(await this.svc.detalle(fila.id));
    } catch (e: unknown) {
      this.detalleError.set(e instanceof Error ? e.message : this.i18n.t('No se pudo cargar el detalle.'));
    } finally {
      this.detalleLoading.set(false);
    }
  }

  cerrarDetalle() {
    this.detalleOpen.set(false);
    this.detalleFila.set(null);
    this.detalle.set(null);
  }

  async confirmarReintentar() {
    const fila = this.detalleFila();
    if (!fila || this.reintentando()) return;
    this.reintentando.set(true);
    try {
      await this.svc.reintentar(fila.id);
      this.toast.success(this.i18n.t('Reencolado'), this.i18n.t('El procesador lo recogerá en su próxima pasada.'));
      this.cerrarDetalle();
      await this.load();
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo reencolar'), e instanceof Error ? e.message : undefined);
    } finally {
      this.reintentando.set(false);
    }
  }

  async reintentarSeleccionados() {
    const ids = this.idsSeleccionados();
    if (!ids.length || this.reintentandoLote()) return;
    this.reintentandoLote.set(true);
    try {
      const n = await this.svc.reintentarLote(ids);
      this.toast.success(this.i18n.t('Reencolados'), this.i18n.t('{n} evento{plural} volverán a publicarse en la próxima pasada.', { n, plural: n === 1 ? '' : 's' }));
      this.seleccion.set({});
      await this.load();
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo reencolar'), e instanceof Error ? e.message : undefined);
    } finally {
      this.reintentandoLote.set(false);
    }
  }
}
