import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReporteSemanalService } from '../../../../shared/services/reporte-semanal.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { ReporteSemanalFila } from '../../../../shared/models/vehiculo-asignacion.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/** Grupo de filas de una semana ISO (para historial + semana actual). */
interface SemanaGrupo {
  key: string;
  anio: number;
  semana: number;
  semana_inicio: string;
  semana_fin: string;
  filas: ReporteSemanalFila[];
  reportados: number;
  total: number;
}

const RESULTADO_BADGE: Record<string, string> = {
  aprobado: 'success',
  con_hallazgos: 'warning',
  bloqueado: 'danger',
};
const RESULTADO_LABEL: Record<string, string> = {
  aprobado: 'Aprobado',
  con_hallazgos: 'Con hallazgos',
  bloqueado: 'Bloqueado',
};

/** R3 — Dashboard de cumplimiento del reporte semanal de vehículos. */
@Component({
  selector: 'app-reporte-semanal',
  imports: [DatePipe, DecimalPipe, Skeleton, RouterLink],
  templateUrl: './reporte-semanal.html',
  styleUrl: './reporte-semanal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteSemanal implements OnInit {
  private reporteService = inject(ReporteSemanalService);
  private toast = inject(ToastService);

  filas = signal<ReporteSemanalFila[]>([]);
  loading = signal(true);
  error = signal('');

  /** Semana expandida en el historial (acordeón). */
  expandida = signal<string | null>(null);

  /** Evita regenerar avisos más de una vez por carga. */
  private avisosGenerados = false;

  /** Agrupa las filas por semana ISO, preservando el orden desc de la vista. */
  private grupos = computed<SemanaGrupo[]>(() => {
    const map = new Map<string, SemanaGrupo>();
    for (const f of this.filas()) {
      const key = `${f.anio}-${f.semana}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          anio: f.anio,
          semana: f.semana,
          semana_inicio: f.semana_inicio,
          semana_fin: f.semana_fin,
          filas: [],
          reportados: 0,
          total: 0,
        };
        map.set(key, g);
      }
      g.filas.push(f);
      g.total++;
      if (f.tiene_reporte) g.reportados++;
    }
    return [...map.values()];
  });

  /** Semana actual = grupo con el mayor (anio, semana) → primero por orden desc. */
  semanaActual = computed<SemanaGrupo | null>(() => this.grupos()[0] ?? null);

  /** Semanas anteriores (historial). */
  historial = computed<SemanaGrupo[]>(() => this.grupos().slice(1));

  /** Conteos de la semana actual para las tarjetas de resumen. */
  resumen = computed(() => {
    const r = { reportados: 0, total: 0, aprobado: 0, con_hallazgos: 0, bloqueado: 0, faltantes: 0 };
    const g = this.semanaActual();
    if (!g) return r;
    r.total = g.total;
    r.reportados = g.reportados;
    for (const f of g.filas) {
      if (!f.tiene_reporte) {
        r.faltantes++;
        continue;
      }
      if (f.resultado === 'aprobado') r.aprobado++;
      else if (f.resultado === 'con_hallazgos') r.con_hallazgos++;
      else if (f.resultado === 'bloqueado') r.bloqueado++;
    }
    return r;
  });

  /** Vehículos sin reporte de la semana actual. */
  faltantes = computed(() => this.semanaActual()?.filas.filter((f) => !f.tiene_reporte) ?? []);

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.filas.set(await this.reporteService.getCumplimiento());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el reporte semanal.');
    } finally {
      this.loading.set(false);
    }
    await this.generarAvisos();
  }

  /** Genera (idempotente) avisos para los faltantes de la semana actual — una sola vez. */
  private async generarAvisos() {
    if (this.avisosGenerados) return;
    this.avisosGenerados = true;
    const faltantes = this.faltantes();
    if (faltantes.length === 0) return;
    try {
      const nuevos = await this.reporteService.generarAvisosFaltantes(faltantes);
      if (nuevos > 0) {
        this.toast.info('Reporte semanal', `Se generaron ${nuevos} avisos de reporte pendiente.`);
      }
    } catch {
      /* nunca bloquea la página si falla la generación de avisos */
    }
  }

  toggle(key: string) {
    this.expandida.update((k) => (k === key ? null : key));
  }

  /** Construye un Date solo a partir del string de fecha (evita corrimientos UTC). */
  toDate(s: string | null): Date | null {
    return s ? new Date(s + 'T00:00:00') : null;
  }

  resultadoBadge(r: string | null): string {
    return r ? (RESULTADO_BADGE[r] ?? 'neutral') : 'neutral';
  }
  resultadoLabel(r: string | null): string {
    return r ? (RESULTADO_LABEL[r] ?? r) : '—';
  }
}
