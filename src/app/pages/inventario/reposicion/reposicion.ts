import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { StockService, ReposicionRow } from '../../../../shared/services/stock.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { SolicitudesCompraService } from '../../../../shared/services/solicitudes-compra.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { Icon } from '../../../../shared/ui/icon/icon';

/**
 * A3.1 / Z8 — Reposición por almacén: artículos en o bajo el stock mínimo.
 * Acciones (Z8): seleccionar → generar solicitud de compra, editar mínimo,
 * posponer la sugerencia con motivo.
 */
@Component({
  selector: 'app-inventario-reposicion',
  imports: [Skeleton, Icon],
  templateUrl: './reposicion.html',
  styleUrl: './reposicion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reposicion implements OnInit {
  private stockService = inject(StockService);
  private bodegasService = inject(BodegasService);
  private articulosService = inject(ArticulosService);
  private solicitudesService = inject(SolicitudesCompraService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private datosPruebaView = inject(DatosPruebaViewService);

  bodegas = signal<Bodega[]>([]);
  // AT14/AT26 — datos de prueba fuera del selector de almacén para no-admin.
  bodegasVisibles = computed(() => this.datosPruebaView.visibles(this.bodegas()));
  selectedBodega = signal<string>('');
  rows = signal<ReposicionRow[]>([]);
  private snoozeIds = signal<Set<string>>(new Set());
  loading = signal(false);
  error = signal('');
  consultado = signal(false);

  puedeGestionar = computed(() => this.userService.hasRole('admin') || this.userService.hasModulo('inventario'));
  cargado = computed(() => !!this.selectedBodega());
  esGlobal = computed(() => this.selectedBodega() === 'ALL');

  /** Filas visibles = sugerencias no pospuestas. */
  visibleRows = computed(() => this.rows().filter((r) => !this.snoozeIds().has(r.articulo_id)));

  // ── Selección para generar solicitud ──
  selected = signal<Set<string>>(new Set());
  generando = signal(false);
  toggleSel(id: string) {
    this.selected.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  seleccionadas = computed(() => this.selected().size);

  // ── Edición de mínimo ──
  editMinId = signal<string | null>(null);
  editMinValue = signal<number | null>(null);

  // ── Posponer ──
  posponerId = signal<string | null>(null);
  posponerDias = signal(7);
  posponerMotivo = signal('');
  guardando = signal(false);

  async ngOnInit() {
    try {
      this.bodegas.set((await this.bodegasService.getAll()).filter((b) => b.activo));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los almacenes.');
    }
  }

  async onBodegaChange(bodegaId: string) {
    this.selectedBodega.set(bodegaId);
    this.rows.set([]);
    this.selected.set(new Set());
    this.consultado.set(false);
    if (!bodegaId) return;
    await this.recargar();
  }

  private async recargar() {
    const bodegaId = this.selectedBodega();
    this.loading.set(true);
    this.error.set('');
    try {
      const bid = bodegaId === 'ALL' ? null : bodegaId;
      const [rows, snoozes] = await Promise.all([
        this.stockService.getReposicion(bid),
        this.stockService.getSnoozes(bid),
      ]);
      this.rows.set(rows);
      this.snoozeIds.set(new Set(snoozes.map((s) => s.articulo_id)));
      this.consultado.set(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la reposición.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Z8 — generar solicitud de compra desde la selección ──
  async generarSolicitud() {
    const ids = this.selected();
    const items = this.visibleRows()
      .filter((r) => ids.has(r.articulo_id))
      .map((r) => ({ descripcion: `${r.nombre} (${r.codigo})`, cantidad: r.faltante || 1, proveedor_sugerido: null }));
    if (items.length === 0) return;

    const bodega = this.bodegas().find((b) => b.id === this.selectedBodega());
    const proyectoId = bodega?.proyecto_id ?? null;
    const solicitanteId = this.userService.profile()?.id ?? null;
    if (!proyectoId) {
      this.toast.error('Elige un almacén ligado a una obra', 'La solicitud de compra necesita un proyecto; para oficina/global créala desde Compras.');
      return;
    }
    if (!solicitanteId) {
      this.toast.error('Sesión inválida.');
      return;
    }
    this.generando.set(true);
    try {
      await this.solicitudesService.create({
        proyecto_id: proyectoId,
        solicitante_id: solicitanteId,
        notas: `Reposición — ${bodega?.nombre ?? ''}`,
        items,
      });
      this.selected.set(new Set());
      this.toast.success('Solicitud de compra creada', `${items.length} artículo(s)`);
    } catch (e: unknown) {
      this.toast.error('No se pudo crear la solicitud', e instanceof Error ? e.message : undefined);
    } finally {
      this.generando.set(false);
    }
  }

  // ── Z8 — editar mínimo ──
  abrirEditMin(r: ReposicionRow) {
    this.editMinId.set(r.articulo_id);
    this.editMinValue.set(r.minimo);
  }
  async guardarMinimo(r: ReposicionRow) {
    const val = this.editMinValue();
    if (val == null || val < 0) return;
    this.guardando.set(true);
    try {
      await this.articulosService.update(r.articulo_id, { stock_minimo: val } as never);
      this.editMinId.set(null);
      await this.recargar();
      this.toast.success('Mínimo actualizado');
    } catch (e: unknown) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Z8 — posponer ──
  abrirPosponer(r: ReposicionRow) {
    this.posponerId.set(r.articulo_id);
    this.posponerDias.set(7);
    this.posponerMotivo.set('');
  }
  async confirmarPosponer(r: ReposicionRow) {
    this.guardando.set(true);
    try {
      const bid = this.selectedBodega() === 'ALL' ? null : this.selectedBodega();
      await this.stockService.posponerReposicion(r.articulo_id, bid, this.posponerDias(), this.posponerMotivo().trim() || null);
      this.posponerId.set(null);
      await this.recargar();
      this.toast.success('Sugerencia pospuesta', `${this.posponerDias()} días`);
    } catch (e: unknown) {
      this.toast.error('No se pudo posponer', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }
}
