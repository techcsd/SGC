import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalidasService, ConfirmacionHistorial } from '../../../../shared/services/salidas.service';
import { conduceNumero } from '../../../../shared/models/salida.model';
import { formatFechaHumana } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/** AK1 — Historial de confirmaciones de entrega. Vive dentro de Inventario, junto a Conduces. */
@Component({
  selector: 'app-confirmaciones',
  imports: [RouterLink, Skeleton],
  templateUrl: './confirmaciones.html',
  styleUrl: './confirmaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Confirmaciones implements OnInit {
  private salidasService = inject(SalidasService);

  readonly formatFechaHora = formatFechaHumana;
  readonly numero = conduceNumero;

  filas = signal<ConfirmacionHistorial[]>([]);
  loading = signal(true);
  error = signal('');

  desde = signal<string>('');
  hasta = signal<string>('');
  proyectoId = signal<string>('');
  estado = signal<'' | 'completa' | 'incompleta'>('');

  // AQ12 — destinos presentes en el resultado (obras + Bodega Central) para el
  // filtro, sin RPC extra. Una obra = su almacén; un destino puede ser una bodega
  // central (proyecto_id null, destino_almacen_id set).
  proyectos = computed(() => {
    const map = new Map<string, string>();
    for (const f of this.filas()) {
      if (f.proyecto_id && f.proyecto) map.set(f.proyecto_id, f.proyecto);
      else if (f.destino_almacen_id && f.destino) map.set(f.destino_almacen_id, f.destino);
    }
    return [...map.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  filtered = computed(() => {
    const pid = this.proyectoId();
    const est = this.estado();
    return this.filas().filter((f) => {
      if (pid && f.proyecto_id !== pid && f.destino_almacen_id !== pid) return false;
      if (est === 'completa' && f.estado !== 'entregado') return false;
      if (est === 'incompleta' && f.estado !== 'entregado_incompleto') return false;
      return true;
    });
  });

  hasActiveFilters = computed(
    () => !!this.desde() || !!this.hasta() || !!this.proyectoId() || !!this.estado(),
  );

  async ngOnInit() {
    await this.recargar();
  }

  async recargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.filas.set(
        await this.salidasService.getConfirmacionesHistorial({
          desde: this.desde() || null,
          hasta: this.hasta() || null,
          proyectoId: null, // se filtra en cliente con el resultado ya visible
          estado: null,
        }),
      );
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el historial de confirmaciones.');
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(f: ConfirmacionHistorial): string {
    return f.estado === 'entregado_incompleto' ? 'Incompleta' : 'Confirmada';
  }

  estadoModifier(f: ConfirmacionHistorial): string {
    return f.estado === 'entregado_incompleto' ? 'danger' : 'success';
  }

  clearFilters() {
    this.desde.set('');
    this.hasta.set('');
    this.proyectoId.set('');
    this.estado.set('');
    this.recargar();
  }

  async exportar() {
    const rows = this.filtered().map((f) => ({
      'No. Conduce': this.numero(f.id),
      Destino: f.destino ?? f.proyecto ?? '',
      Almacén: f.bodega ?? '',
      Estado: this.estadoLabel(f),
      'Entregó': f.entregado_por_nombre ?? '',
      'Entregado': this.formatFechaHora(f.entregado_en),
      'Confirmó': f.recibido_por_nombre ?? '',
      'Confirmado': this.formatFechaHora(f.recibido_en),
      Foto: f.tiene_foto ? 'Sí' : 'No',
      Firma: f.tiene_firma ? 'Sí' : 'No',
    }));
    await exportarExcel('confirmaciones-entrega', rows);
  }
}
