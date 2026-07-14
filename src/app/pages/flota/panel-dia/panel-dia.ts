import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ChecklistsVehiculoService } from '../../../../shared/services/checklists-vehiculo.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { AvisosFlotaService } from '../../../../shared/services/avisos-flota.service';
import { ChecklistVehiculo, ChecklistResultado, RESULTADO_META } from '../../../../shared/models/flota-checklist.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import { AvisoFlota, AVISO_TIPO_LABEL, AVISO_SEVERIDAD_BADGE } from '../../../../shared/models/aviso-flota.model';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

@Component({
  selector: 'app-panel-dia',
  imports: [DecimalPipe, RouterLink, BarChart],
  templateUrl: './panel-dia.html',
  styleUrl: './panel-dia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelDia implements OnInit {
  private checklistsService = inject(ChecklistsVehiculoService);
  private conductoresService = inject(ConductoresService);
  private avisosService = inject(AvisosFlotaService);

  formatFecha = formatFechaDisplay;
  tipoLabel = AVISO_TIPO_LABEL;
  sevBadge = AVISO_SEVERIDAD_BADGE;
  readonly hoy = todayIso();

  checklists = signal<ChecklistVehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
  avisos = signal<AvisoFlota[]>([]);
  loading = signal(true);
  error = signal('');

  private resultadoDe(c: ChecklistVehiculo): ChecklistResultado {
    return c.resultado ?? (c.tiene_criticos ? 'bloqueado' : 'aprobado');
  }
  resultadoMeta(c: ChecklistVehiculo) { return RESULTADO_META[this.resultadoDe(c)]; }

  conductoresActivos = computed(() => this.conductores().filter((c) => c.activo));

  inspeccionesHoy = computed(() =>
    this.checklists()
      .filter((c) => c.fecha === this.hoy)
      .sort((a, b) => (b.capturado_en ?? '').localeCompare(a.capturado_en ?? '')),
  );

  private reportaronIds = computed(
    () => new Set(this.inspeccionesHoy().map((c) => c.conductor_id).filter(Boolean) as string[]),
  );

  choferesSinReportar = computed(() =>
    this.conductoresActivos().filter((c) => !this.reportaronIds().has(c.id)),
  );

  cobertura = computed(() => ({
    reportaron: this.reportaronIds().size,
    total: this.conductoresActivos().length,
  }));

  conteo = computed(() => {
    const c = { aprobado: 0, con_hallazgos: 0, bloqueado: 0 };
    for (const ch of this.inspeccionesHoy()) c[this.resultadoDe(ch)]++;
    return c;
  });

  alertasActivas = computed(() => this.avisos().filter((a) => a.estado === 'pendiente'));

  /** Inspecciones por día (últimos 7 días). */
  semanaChart = computed<BarDatum[]>(() => {
    const dias: BarDatum[] = [];
    const base = new Date(this.hoy + 'T00:00:00');
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const count = this.checklists().filter((c) => c.fecha === iso).length;
      dias.push({ label: DIAS[d.getDay()], value: count });
    }
    return dias;
  });

  async ngOnInit() {
    this.loading.set(true);
    try {
      const [checklists, conductores, avisos] = await Promise.all([
        this.checklistsService.getChecklists(),
        this.conductoresService.getAll(),
        this.avisosService.getActivas(),
      ]);
      this.checklists.set(checklists);
      this.conductores.set(conductores);
      this.avisos.set(avisos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el panel.');
    } finally {
      this.loading.set(false);
    }
  }

  hora(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
