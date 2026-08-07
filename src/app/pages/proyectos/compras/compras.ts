import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProyectosService, CompraProyecto } from '../../../../shared/services/proyectos.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

type FiltroTipo = 'todos' | 'orden_compra' | 'ferreteria';

const TIPO_LABEL: Record<string, string> = {
  orden_compra: 'Orden de compra',
  ferreteria: 'Ferretería',
};

/**
 * AH15 — Compras de un proyecto: órdenes de compra + compras de ferretería
 * ligadas a la obra, con filtro por tipo y período, total del período y
 * exportación a Excel. Respeta es_prueba y permisos (server-side).
 */
@Component({
  selector: 'app-proyecto-compras',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './compras.html',
  styleUrl: './compras.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectoCompras implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(ProyectosService);

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
