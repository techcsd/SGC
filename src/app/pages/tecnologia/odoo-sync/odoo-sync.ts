import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
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
  imports: [DatePipe, JsonPipe, FormDrawer, Skeleton],
  templateUrl: './odoo-sync.html',
  styleUrl: './odoo-sync.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecOdooSync implements OnInit {
  private svc = inject(OdooSyncService);
  private toast = inject(ToastService);

  readonly agregadoLabel = ODOO_AGREGADO_LABEL;
  readonly estadoLabel = ODOO_ESTADO_LABEL;
  readonly estadosOrden = ESTADOS_ORDEN;

  filas = signal<OdooEventoFila[]>([]);
  resumen = signal<OdooEventosResumenFila[]>([]);
  loading = signal(true);
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
      const [filas, resumen] = await Promise.all([this.svc.listar(null, null), this.svc.resumen()]);
      this.filas.set(filas);
      this.resumen.set(resumen);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la bandeja de sincronización.');
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
      this.detalleError.set(e instanceof Error ? e.message : 'No se pudo cargar el detalle.');
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
      this.toast.success('Reencolado', 'El procesador lo recogerá en su próxima pasada.');
      this.cerrarDetalle();
      await this.load();
    } catch (e: unknown) {
      this.toast.error('No se pudo reencolar', e instanceof Error ? e.message : undefined);
    } finally {
      this.reintentando.set(false);
    }
  }
}
