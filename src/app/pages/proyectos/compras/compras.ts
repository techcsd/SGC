import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  ProyectosService,
  CompraProyecto,
  GastoCategoria,
} from '../../../../shared/services/proyectos.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ToastService } from '../../../../shared/services/toast.service';
import { todayIso } from '../../../../shared/utils/fecha.util';

type FiltroTipo = 'todos' | 'orden_compra' | 'ferreteria' | 'gasto_directo';

const TIPO_LABEL: Record<string, string> = {
  orden_compra: 'Orden de compra',
  ferreteria: 'Ferretería',
  gasto_directo: 'Gasto directo',
};

/**
 * AH15 — Compras de un proyecto: órdenes de compra + compras de ferretería
 * ligadas a la obra, con filtro por tipo y período, total del período y
 * exportación a Excel. Respeta es_prueba y permisos (server-side).
 */
@Component({
  selector: 'app-proyecto-compras',
  imports: [RouterLink, DecimalPipe, FormDrawer],
  templateUrl: './compras.html',
  styleUrl: './compras.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectoCompras implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(ProyectosService);
  private toast = inject(ToastService);

  proyectoId = signal('');
  proyectoNombre = signal('');
  compras = signal<CompraProyecto[]>([]);
  desde = signal<string | null>(null);
  hasta = signal<string | null>(null);
  filtroTipo = signal<FiltroTipo>('todos');
  loading = signal(true);
  error = signal('');

  visibles = computed<CompraProyecto[]>(() => {
    const t = this.filtroTipo();
    return t === 'todos' ? this.compras() : this.compras().filter((c) => c.tipo === t);
  });

  totalPeriodo = computed(() =>
    this.visibles().reduce((s, c) => s + (c.total ?? 0), 0),
  );

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.proyectoId.set(id);
    void this.cargarNombre(id);
    void this.cargar();
  }

  private async cargarNombre(id: string) {
    try {
      const p = await this.service.getById(id);
      this.proyectoNombre.set(p?.nombre ?? '');
    } catch { /* cosmético */ }
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.compras.set(await this.service.getComprasProyecto(this.proyectoId(), this.desde(), this.hasta()));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las compras.');
    } finally {
      this.loading.set(false);
    }
  }

  aplicarFiltro(desde: string, hasta: string) {
    this.desde.set(desde || null);
    this.hasta.set(hasta || null);
    void this.cargar();
  }

  setTipo(t: FiltroTipo) {
    this.filtroTipo.set(t);
  }

  tipoLabel(t: string): string {
    return TIPO_LABEL[t] ?? t;
  }

  // ── AS14 — Registrar gasto directo (sin requisición) ──
  gastoOpen = signal(false);
  categorias = signal<GastoCategoria[]>([]);
  gConcepto = signal('');
  gCategoria = signal('misc');
  gMonto = signal<number | null>(null);
  gFecha = signal(todayIso());
  guardandoGasto = signal(false);
  gastoError = signal('');

  async abrirGasto() {
    this.gConcepto.set('');
    this.gCategoria.set('misc');
    this.gMonto.set(null);
    this.gFecha.set(todayIso());
    this.gastoError.set('');
    this.gastoOpen.set(true);
    if (this.categorias().length === 0) {
      try {
        this.categorias.set(await this.service.getGastoCategorias());
      } catch {
        /* el catálogo es complementario */
      }
    }
  }
  cerrarGasto() {
    if (!this.guardandoGasto()) this.gastoOpen.set(false);
  }

  async guardarGasto() {
    if (this.guardandoGasto()) return;
    const concepto = this.gConcepto().trim();
    const monto = Number(this.gMonto());
    if (!concepto) {
      this.gastoError.set('Indica el concepto del gasto.');
      return;
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      this.gastoError.set('El monto debe ser mayor que cero.');
      return;
    }
    this.guardandoGasto.set(true);
    this.gastoError.set('');
    try {
      await this.service.registrarGastoDirecto({
        proyecto_id: this.proyectoId(),
        categoria: this.gCategoria(),
        concepto,
        monto,
        fecha: this.gFecha() || null,
      });
      this.gastoOpen.set(false);
      this.toast.success('Gasto registrado', 'Se sumó al gasto real del proyecto.');
      await this.cargar();
    } catch (e) {
      this.gastoError.set(e instanceof Error ? e.message : 'No se pudo registrar el gasto.');
    } finally {
      this.guardandoGasto.set(false);
    }
  }

  exportar() {
    const rows = this.visibles().map((c) => ({
      Tipo: this.tipoLabel(c.tipo),
      Fecha: c.fecha ?? '',
      Proveedor: c.proveedor ?? '',
      Referencia: c.referencia ?? '',
      Estado: c.estado ?? '',
      'Total (RD$)': c.total ?? 0,
    }));
    exportarExcel(`compras-${this.proyectoNombre() || 'obra'}`, rows);
  }
}
