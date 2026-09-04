import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { BitacoraService, CoberturaObra } from '../../../../shared/services/bitacora.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { exportarExcelHojas } from '../../../../shared/utils/exportar-excel.util';

/**
 * BJ1 — Cobertura de bitácoras por obra y fecha. Pedido de Eduardo NG: ver qué
 * obras están al día, atrasadas o SIN bitácoras, para pasárselo a los ingenieros.
 * Matriz obra × fecha + resumen + export a Excel (dos hojas).
 */
@Component({
  selector: 'app-bitacora-cobertura',
  imports: [Skeleton],
  templateUrl: './cobertura.html',
  styleUrl: './cobertura.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BitacoraCobertura implements OnInit {
  private service = inject(BitacoraService);

  filas = signal<CoberturaObra[]>([]);
  loading = signal(true);
  error = signal('');
  exportando = signal(false);

  // Rango: por defecto, los últimos 30 días.
  desde = signal(this.hace(30));
  hasta = signal(this.hoy());

  private hoy(): string {
    // Sin `new Date()` global disponible en templates; en TS sí.
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  private hace(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  /** Columnas de fecha (todas las fechas con al menos una bitácora en el rango), desc. */
  fechas = computed<string[]>(() => {
    const set = new Set<string>();
    for (const f of this.filas()) for (const k of Object.keys(f.por_fecha ?? {})) set.add(k);
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  });

  // KPIs
  totalObras = computed(() => this.filas().length);
  obrasEnCero = computed(() => this.filas().filter((f) => f.total === 0).length);
  obrasAtrasadas = computed(() => this.filas().filter((f) => (f.dias_sin_reportar ?? 0) >= 3 && f.total > 0).length);
  obrasAlDia = computed(() => this.filas().filter((f) => f.total > 0 && (f.dias_sin_reportar ?? 99) < 3).length);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.filas.set(await this.service.getCobertura(this.desde(), this.hasta()));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el reporte.');
    } finally {
      this.loading.set(false);
    }
  }

  onDesde(v: string) { this.desde.set(v); }
  onHasta(v: string) { this.hasta.set(v); }

  celda(f: CoberturaObra, fecha: string): number {
    return f.por_fecha?.[fecha] ?? 0;
  }

  estado(f: CoberturaObra): { label: string; tone: string } {
    if (f.total === 0) return { label: 'Sin bitácoras', tone: 'danger' };
    const d = f.dias_sin_reportar ?? 0;
    if (d >= 3) return { label: `Atrasada (${d} días)`, tone: 'warning' };
    return { label: 'Al día', tone: 'success' };
  }

  async exportar() {
    this.exportando.set(true);
    try {
      const resumen = this.filas().map((f) => ({
        Obra: f.obra,
        'Total bitácoras': f.total,
        'Días con bitácora': f.dias_con_bitacora,
        'Primera': f.primera ?? '',
        'Última': f.ultima ?? '',
        'Días sin reportar': f.dias_sin_reportar ?? '',
        Estado: this.estado(f).label,
      }));
      const fechas = this.fechas();
      const matriz = this.filas().map((f) => {
        const fila: Record<string, unknown> = { Obra: f.obra };
        for (const fe of fechas) fila[fe] = this.celda(f, fe) || '';
        fila['Total'] = f.total;
        return fila;
      });
      await exportarExcelHojas('cobertura-bitacoras', [
        { nombre: 'Resumen por obra', filas: resumen },
        { nombre: 'Por fecha', filas: matriz },
      ]);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo exportar.');
    } finally {
      this.exportando.set(false);
    }
  }
}
