import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProyectosService, CostoMaterialObra } from '../../../../shared/services/proyectos.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

/**
 * AA23 QW4 — Reporte de costo de material real por obra: total + desglose por
 * artículo (Σ cantidad × costo unitario congelado al despachar), con filtro de
 * fechas y exportación a Excel. El costo lo aporta el costeo QW1–QW3.
 */
@Component({
  selector: 'app-proyecto-costos',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './costos.html',
  styleUrl: './costos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectoCostos implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(ProyectosService);

  proyectoId = signal('');
  proyectoNombre = signal('');
  data = signal<CostoMaterialObra>({ total: 0, por_articulo: [] });
  desde = signal<string | null>(null);
  hasta = signal<string | null>(null);
  loading = signal(true);
  error = signal('');

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
      this.data.set(await this.service.getCostoMaterialObra(this.proyectoId(), this.desde(), this.hasta()));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el costo de material.');
    } finally {
      this.loading.set(false);
    }
  }

  aplicarFiltro(desde: string, hasta: string) {
    this.desde.set(desde || null);
    this.hasta.set(hasta || null);
    void this.cargar();
  }

  exportar() {
    const rows = this.data().por_articulo.map((a) => ({
      Artículo: a.nombre,
      Unidad: a.unidad,
      Cantidad: a.cantidad,
      'Costo unit. prom (RD$)': a.costo_unit_prom,
      'Costo total (RD$)': a.costo,
    }));
    exportarExcel(`costo-material-${this.proyectoNombre() || 'obra'}`, rows);
  }
}
