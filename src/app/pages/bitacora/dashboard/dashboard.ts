import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { Bitacora } from '../../../../shared/models/bitacora.model';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

const CAT = ['#1F4E79', '#2D7D46', '#B45309', '#5B3A8E', '#0E7490', '#C0392B', '#64748b'];
const GRAVEDAD_COLOR: Record<string, string> = {
  leve: '#2D7D46', moderado: '#B45309', grave: '#C0392B', critico: '#7c1d1d',
};
const GRAVEDAD_LABEL: Record<string, string> = {
  leve: 'Leve', moderado: 'Moderado', grave: 'Grave', critico: 'Crítico',
};

/** U14 — Dashboard de bitácoras: métricas agregadas de los partes/visitas/incidentes. */
@Component({
  selector: 'app-bitacora-dashboard',
  imports: [RouterLink, DecimalPipe, BarChart, DonutChart, Skeleton],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BitacoraDashboard implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private router = inject(Router);

  private bitacoras = signal<Bitacora[]>([]);
  loading = signal(true);
  error = signal('');

  // Q9 — filtro por obra: recalcula TODAS las métricas para la obra elegida.
  // Se mantiene la agregación en cliente (menor riesgo; getAll ya trae el embed
  // de proyecto). Elección documentada: NO se creó RPC de resumen.
  selectedProyecto = signal<string>('');

  /** Obras presentes en las bitácoras, para el selector (id + nombre). */
  obras = computed(() => {
    const map = new Map<string, string>();
    for (const b of this.bitacoras()) {
      if (b.proyecto_id) map.set(b.proyecto_id, b.proyecto?.nombre ?? 'Sin nombre');
    }
    return [...map.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  /** Bitácoras tras aplicar el filtro por obra (fuente de todas las métricas). */
  private filtradas = computed(() => {
    const proy = this.selectedProyecto();
    return proy ? this.bitacoras().filter((b) => b.proyecto_id === proy) : this.bitacoras();
  });

  onProyectoChange(v: string) { this.selectedProyecto.set(v); }

  total = computed(() => this.filtradas().length);
  partes = computed(() => this.filtradas().filter((b) => b.tipo === 'parte_diario').length);
  visitas = computed(() => this.filtradas().filter((b) => b.tipo === 'visita').length);
  incidentes = computed(() => this.filtradas().filter((b) => b.tipo === 'incidente').length);
  // R7 — días ÚNICOS con lluvia (no # de bitácoras). La lluvia es 100% MANUAL
  // (campo `llovio` del parte); el pronóstico del weather NUNCA la registra.
  diasLluvia = computed(
    () => new Set(this.filtradas().filter((b) => b.llovio === true).map((b) => b.fecha)).size,
  );
  obrerosMigracion = computed(() =>
    this.filtradas().reduce((acc, b) => acc + (Array.isArray(b.migracion_obreros) ? b.migracion_obreros.length : 0), 0),
  );
  // W2 — días (bitácoras) con equipos alquilados.
  diasEquipos = computed(() => this.filtradas().filter((b) => (b.equipos?.length ?? 0) > 0).length);

  // ── Q9 — drill-down: navegar al historial filtrado ────────
  /** Navega al historial filtrando por la obra seleccionada (si hay) + extra. */
  private irAlHistorial(extra: Record<string, string> = {}) {
    const qp: Record<string, string> = { ...extra };
    if (this.selectedProyecto()) qp['proyecto'] = this.selectedProyecto();
    this.router.navigate(['/bitacora/historial'], { queryParams: qp });
  }
  irAObra(proyectoId: string) {
    this.router.navigate(['/bitacora/historial'], { queryParams: { proyecto: proyectoId } });
  }
  irATipo(tipo: string) { this.irAlHistorial({ tipo }); }
  irAGravedad(_g: string) { this.irAlHistorial({ tipo: 'incidente' }); }
  /** KPI "Bitácoras" (total): abre el historial (respeta la obra filtrada). */
  verHistorial() { this.irAlHistorial({}); }

  private groupCount(values: string[]): { key: string; count: number }[] {
    const map = new Map<string, number>();
    for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  }

  /** Donut: bitácoras por tipo. */
  porTipo = computed<DonutDatum[]>(() => {
    const label: Record<string, string> = { parte_diario: 'Bitácora del día', visita: 'Visita', incidente: 'Incidente' };
    const color: Record<string, string> = { parte_diario: '#1F4E79', visita: '#0E7490', incidente: '#C0392B' };
    return this.groupCount(this.filtradas().map((b) => b.tipo)).map((g) => ({
      label: label[g.key] ?? g.key, value: g.count, color: color[g.key] ?? '#64748b', key: g.key,
    }));
  });

  /** Bar: bitácoras por obra (top 10). key = proyecto_id para el drill-down. */
  porObra = computed<BarDatum[]>(() => {
    const nombre = new Map<string, string>();
    for (const b of this.filtradas()) if (b.proyecto_id) nombre.set(b.proyecto_id, b.proyecto?.nombre ?? 'Sin obra');
    return this.groupCount(this.filtradas().map((b) => b.proyecto_id ?? ''))
      .filter((g) => g.key)
      .slice(0, 10)
      .map((g, i) => ({ label: nombre.get(g.key) ?? 'Sin obra', value: g.count, color: CAT[i % CAT.length], key: g.key }));
  });

  /** Donut: incidencias por gravedad. */
  porGravedad = computed<DonutDatum[]>(() =>
    this.groupCount(
      this.filtradas().filter((b) => b.tipo === 'incidente' && b.incidente_gravedad).map((b) => b.incidente_gravedad as string),
    ).map((g) => ({ label: GRAVEDAD_LABEL[g.key] ?? g.key, value: g.count, color: GRAVEDAD_COLOR[g.key] ?? '#64748b', key: g.key })),
  );

  /** W2 — Bar: equipos alquilados más usados (por # de bitácoras). */
  equiposMasUsados = computed<BarDatum[]>(() => {
    const all = this.filtradas().flatMap((b) => (b.equipos ?? []).map((e) => e.equipo));
    return this.groupCount(all)
      .slice(0, 8)
      .map((g, i) => ({ label: g.key, value: g.count, color: CAT[i % CAT.length] }));
  });

  /** W2 — Bar: días con equipos alquilados por obra (top 10). */
  equiposPorObra = computed<BarDatum[]>(() => {
    const nombre = new Map<string, string>();
    for (const b of this.filtradas()) if (b.proyecto_id) nombre.set(b.proyecto_id, b.proyecto?.nombre ?? 'Sin obra');
    return this.groupCount(
      this.filtradas().filter((b) => (b.equipos?.length ?? 0) > 0).map((b) => b.proyecto_id ?? ''),
    )
      .filter((g) => g.key)
      .slice(0, 10)
      .map((g, i) => ({ label: nombre.get(g.key) ?? 'Sin obra', value: g.count, color: CAT[i % CAT.length], key: g.key }));
  });

  /** Bar: restricciones por tipo (todas las bitácoras). */
  porRestriccion = computed<BarDatum[]>(() => {
    const all = this.filtradas().flatMap((b) => (b.restricciones ?? []).map((r) => r.tipo_restriccion));
    return this.groupCount(all)
      .filter((g) => g.key !== 'NINGUNA')
      .slice(0, 8)
      .map((g, i) => ({ label: g.key, value: g.count, color: CAT[i % CAT.length] }));
  });

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.bitacoras.set(await this.bitacoraService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las bitácoras.');
    } finally {
      this.loading.set(false);
    }
  }
}
