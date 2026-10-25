import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { FlotaSubnav } from '../flota-subnav/flota-subnav';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';
import { CombustibleService, RendimientoVehiculoRow } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { formatFechaDisplay, todayIso, daysAgoIso } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

const CONFIANZA_LABEL: Record<string, string> = {
  sin_datos: 'Sin datos suficientes',
  baja: 'Confianza baja',
  media: 'Confianza media',
  alta: 'Confianza alta',
};

/**
 * CW4 — Rendimiento por vehículo (pedido de Eduardo): usa las mismas echadas de
 * combustible para mostrar Σkm÷Σgal por período, con nivel de confianza (nunca se
 * captura "tanque lleno", así que es una aproximación — se dice así en pantalla).
 * Exporta PDF (ventana imprimible) y Excel. El correo semanal se arma aparte en
 * sgc.envios_automaticos (familia 'rendimiento_vehiculos', apagada por defecto).
 */
@Component({
  selector: 'app-rendimiento-vehiculos',
  imports: [FormsModule, DecimalPipe, FlotaSubnav, Skeleton, Icon],
  templateUrl: './rendimiento-vehiculos.html',
  styleUrl: './rendimiento-vehiculos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RendimientoVehiculos implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private toast = inject(ToastService);

  readonly fmtFecha = formatFechaDisplay;
  readonly confianzaLabel = CONFIANZA_LABEL;

  desde = signal(daysAgoIso(30));
  hasta = signal(todayIso());
  vehiculoSel = signal<string>('');

  vehiculos = signal<Vehiculo[]>([]);
  filas = signal<RendimientoVehiculoRow[]>([]);
  loading = signal(true);

  totales = computed(() => {
    const fs = this.filas();
    const km = fs.reduce((a, f) => a + Number(f.total_km || 0), 0);
    const gal = fs.reduce((a, f) => a + Number(f.total_galones || 0), 0);
    return { km, gal, promedio: gal > 0 ? Math.round((km / gal) * 100) / 100 : null };
  });

  async ngOnInit() {
    try {
      this.vehiculos.set(await this.vehiculosService.getAll());
    } catch { /* el filtro de vehículo queda vacío; no bloquea el reporte */ }
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    try {
      this.filas.set(await this.combustibleService.reporteRendimiento(
        this.desde(), this.hasta(), this.vehiculoSel() || null,
      ));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el reporte.');
    } finally {
      this.loading.set(false);
    }
  }

  nombreVehiculo(f: RendimientoVehiculoRow): string {
    return f.alias || f.placa || '(sin placa)';
  }

  async exportarExcelReporte() {
    const rows = this.filas().map((f) => ({
      Vehículo: this.nombreVehiculo(f),
      Placa: f.placa ?? '',
      'Período desde': this.fmtFecha(this.desde()),
      'Período hasta': this.fmtFecha(this.hasta()),
      'Echadas en el período': f.echadas_total,
      'Echadas usadas en el cálculo': f.echadas_usadas,
      'Echadas excluidas (duplicadas)': f.echadas_excluidas_dup,
      [`Total ${f.medida_uso === 'horas' ? 'horas' : 'km'}`]: f.total_km,
      'Total galones': f.total_galones,
      Rendimiento: f.rendimiento ?? '—',
      Unidad: f.unidad,
      Confianza: this.confianzaLabel[f.confianza] ?? f.confianza,
      'Rendimiento esperado (referencia)': f.baseline ?? '—',
      'Estado de la última echada': f.estado_actual ?? '—',
    }));
    await exportarExcel('rendimiento-vehiculos', rows);
  }

  exportarPdf() {
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) return;
    const fila = (f: RendimientoVehiculoRow) => `<tr>
      <td>${this.nombreVehiculo(f)}</td>
      <td>${f.rendimiento ?? '—'} ${f.rendimiento != null ? f.unidad : ''}</td>
      <td>${this.confianzaLabel[f.confianza] ?? f.confianza}</td>
      <td>${f.echadas_usadas} de ${f.echadas_total}</td>
      <td>${Math.round(f.total_km)}</td>
      <td>${Number(f.total_galones).toFixed(1)}</td>
      <td>${f.baseline ?? '—'}</td>
    </tr>`;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Rendimiento por vehículo</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 28px; }
        h1 { font-size: 18px; margin-bottom: 2px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 4px; }
        .aviso { color: #8a5a00; font-size: 11.5px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 6px 8px; font-size: 12.5px; text-align: left; border-bottom: 1px solid #eee; }
        th { color: #777; font-weight: 600; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>CONSTRUCTORA SD — Rendimiento por vehículo</h1>
      <div class="sub">Período: ${this.fmtFecha(this.desde())} – ${this.fmtFecha(this.hasta())}</div>
      <div class="aviso">Aproximado: nunca se registra "tanque lleno", así que el rendimiento se calcula entre
        echadas y no es exacto. Mientras más echadas y más kilómetros, más confiable el número.</div>
      <table>
        <thead><tr><th>Vehículo</th><th>Rendimiento</th><th>Confianza</th><th>Echadas usadas</th>
          <th>Km/horas</th><th>Galones</th><th>Esperado</th></tr></thead>
        <tbody>${this.filas().map(fila).join('')}</tbody>
      </table>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
      </body></html>`);
    win.document.close();
  }
}
