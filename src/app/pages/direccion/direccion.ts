import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { ProyectosService, KpiProyectoRaw } from '../../../shared/services/proyectos.service';
import { BarChart, BarDatum } from '../../../shared/ui/bar-chart/bar-chart';
import { DonutChart, DonutDatum } from '../../../shared/ui/donut-chart/donut-chart';
import { ObrasClima } from '../../../shared/context/obras-clima/obras-clima';
import { ObrasClimaService } from '../../../shared/context/obras-clima.service';
import { AlertasCuadreService } from '../../../shared/services/alertas-cuadre.service';
import { NotificacionesService } from '../../../shared/services/notificaciones.service';
import { AlertaCuadre, AlertaEstado, ALERTA_SEVERIDADES } from '../../../shared/models/cuadre.model';
import { todayIso, daysFromNowIso, formatTimestampDisplay } from '../../../shared/utils/fecha.util';

interface Alerta {
  icono: string;
  texto: string;
  cantidad: number;
  ruta: string;
  nivel: 'peligro' | 'precaucion' | 'info';
}

@Component({
  selector: 'app-direccion',
  imports: [DecimalPipe, RouterLink, BarChart, DonutChart, ObrasClima],
  templateUrl: './direccion.html',
  styleUrl: './direccion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Direccion implements OnInit {
  private supabase = inject(SupabaseService);
  private proyectosService = inject(ProyectosService);
  private obrasClimaService = inject(ObrasClimaService);
  private alertasCuadreService = inject(AlertasCuadreService);
  private notificaciones = inject(NotificacionesService);

  // A4 — panel de alertas antifraude (silenciosas para obra; visibles aquí).
  alertasControl = signal<AlertaCuadre[]>([]);
  readonly ALERTA_SEV = ALERTA_SEVERIDADES;
  formatTimestamp = formatTimestampDisplay;

  loading = signal(true);
  error = signal('');

  private kpi = signal<KpiProyectoRaw[]>([]);
  private proyectosEstado = signal<{ estado: string }[]>([]);
  private tareas = signal<{ estado: string; fecha_limite: string | null }[]>([]);
  private empleados = signal<{ departamento: string | null }[]>([]);
  empleadosActivos = signal(0);
  expedientesAbiertos = signal(0);
  contratosPorVencer = signal(0);
  aprobacionesPendientes = signal(0);
  ausenciasPendientes = signal(0);
  solicitudesMaterial = signal(0);
  solicitudesCompra = signal(0);
  obrasClimaPeligro = signal(0);
  obrasClimaPrecaucion = signal(0);
  expedientesObraIncompletos = signal(0);

  // ── Stat tiles ───────────────────────────────────────────
  proyectosActivos = computed(() => this.kpi().length);
  incidentesTotal = computed(() => this.kpi().reduce((s, k) => s + k.incidentes_90d, 0));
  presupuestoTotal = computed(() => this.kpi().reduce((s, k) => s + Number(k.presupuesto ?? 0), 0));
  gastoTotal = computed(() => this.kpi().reduce((s, k) => s + Number(k.gasto_real ?? 0), 0));
  tareasVencidas = computed(() => {
    const hoy = todayIso();
    return this.tareas().filter(
      (t) => t.fecha_limite && t.fecha_limite < hoy && (t.estado === 'pendiente' || t.estado === 'en_progreso'),
    ).length;
  });

  // ── Alerts panel (attention needed) ──────────────────────
  alertas = computed<Alerta[]>(() => {
    const a: Alerta[] = [];
    if (this.obrasClimaPeligro() > 0)
      a.push({ icono: '🌩️', texto: 'Obras con clima peligroso', cantidad: this.obrasClimaPeligro(), ruta: '/proyectos', nivel: 'peligro' });
    else if (this.obrasClimaPrecaucion() > 0)
      a.push({ icono: '🌦️', texto: 'Obras con precaución climática', cantidad: this.obrasClimaPrecaucion(), ruta: '/proyectos', nivel: 'precaucion' });
    if (this.tareasVencidas() > 0)
      a.push({ icono: '⏰', texto: 'Tareas vencidas', cantidad: this.tareasVencidas(), ruta: '/tareas/gestion', nivel: 'peligro' });
    if (this.incidentesTotal() > 0)
      a.push({ icono: '⚠️', texto: 'Incidentes (90 días)', cantidad: this.incidentesTotal(), ruta: '/bitacora/historial', nivel: 'peligro' });
    if (this.contratosPorVencer() > 0)
      a.push({ icono: '📄', texto: 'Contratos por vencer (30 días)', cantidad: this.contratosPorVencer(), ruta: '/legal/contratos', nivel: 'precaucion' });
    if (this.aprobacionesPendientes() > 0)
      a.push({ icono: '⚖️', texto: 'Aprobaciones legales pendientes', cantidad: this.aprobacionesPendientes(), ruta: '/legal/aprobaciones', nivel: 'precaucion' });
    if (this.ausenciasPendientes() > 0)
      a.push({ icono: '🏖️', texto: 'Solicitudes de ausencia pendientes', cantidad: this.ausenciasPendientes(), ruta: '/rrhh/ausencias', nivel: 'precaucion' });
    if (this.solicitudesMaterial() > 0)
      a.push({ icono: '📦', texto: 'Requisiciones pendientes', cantidad: this.solicitudesMaterial(), ruta: '/inventario/salidas', nivel: 'info' });
    if (this.solicitudesCompra() > 0)
      a.push({ icono: '🛒', texto: 'Solicitudes de compra pendientes', cantidad: this.solicitudesCompra(), ruta: '/compras/ordenes', nivel: 'info' });
    if (this.expedientesObraIncompletos() > 0)
      a.push({ icono: '📋', texto: 'Obras con expediente de inicio incompleto', cantidad: this.expedientesObraIncompletos(), ruta: '/proyectos', nivel: 'precaucion' });
    return a;
  });

  // ── Charts ───────────────────────────────────────────────
  proyectosPorEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      planificacion: '#64748b', en_progreso: '#1F4E79', pausado: '#B45309', completado: '#2D7D46', cancelado: '#C0392B',
    };
    const labels: Record<string, string> = {
      planificacion: 'Planificación', en_progreso: 'En progreso', pausado: 'Pausado', completado: 'Completado', cancelado: 'Cancelado',
    };
    return this.groupCount(this.proyectosEstado().map((p) => p.estado)).map((g) => ({
      label: labels[g.key] ?? g.key,
      value: g.count,
      color: colors[g.key] ?? '#94a3b8',
    }));
  });

  tareasPorEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      pendiente: '#64748b', en_progreso: '#1F4E79', completada: '#2D7D46', cancelada: '#C0392B',
    };
    const labels: Record<string, string> = {
      pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', cancelada: 'Cancelada',
    };
    return this.groupCount(this.tareas().map((t) => t.estado)).map((g) => ({
      label: labels[g.key] ?? g.key,
      value: g.count,
      color: colors[g.key] ?? '#94a3b8',
    }));
  });

  empleadosPorDepto = computed<DonutDatum[]>(() => {
    const palette = ['#1F4E79', '#2D7D46', '#B45309', '#5B3A8E', '#0E7490', '#C0392B', '#64748b'];
    return this.groupCount(this.empleados().map((e) => e.departamento ?? 'Sin depto.')).map((g, i) => ({
      label: g.key,
      value: g.count,
      color: palette[i % palette.length],
    }));
  });

  scoresBars = computed<BarDatum[]>(() =>
    [...this.kpi()]
      .map((k) => ({ nombre: k.nombre, score: scoreTotal(k) }))
      .sort((a, b) => b.score - a.score)
      .map((k) => ({
        label: k.nombre,
        value: k.score,
        color: k.score >= 80 ? 'var(--sgc-success)' : k.score >= 50 ? 'var(--sgc-warning)' : 'var(--sgc-danger)',
      })),
  );

  // Budget usage % per project (gasto / presupuesto).
  presupuestoBars = computed<BarDatum[]>(() =>
    this.kpi()
      .filter((k) => k.presupuesto && k.presupuesto > 0)
      .map((k) => {
        const pct = Math.round((Number(k.gasto_real) / Number(k.presupuesto)) * 100);
        return { label: k.nombre, value: pct, color: pct > 100 ? 'var(--sgc-danger)' : pct > 80 ? 'var(--sgc-warning)' : 'var(--sgc-success)' };
      }),
  );

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [kpi, proyectos, tareas, empleados, empAct, expedientes, contratos, aprob, ausencias, solMat, solCom] =
        await Promise.all([
          this.proyectosService.getKpiProyectos(),
          this.supabase.client.from('proyectos').select('estado').eq('activo', true),
          this.supabase.client.from('tareas').select('estado, fecha_limite'),
          this.supabase.client.from('empleados').select('departamento').eq('activo', true),
          this.supabase.client.from('empleados').select('id', { count: 'exact', head: true }).eq('activo', true),
          this.supabase.client.from('expedientes_legales').select('id', { count: 'exact', head: true }).neq('estado', 'cerrado'),
          this.supabase.client
            .from('contratos')
            .select('id', { count: 'exact', head: true })
            .in('estado', ['firmado', 'en_revision'])
            .not('fecha_vencimiento', 'is', null)
            .lte('fecha_vencimiento', daysFromNowIso(30)),
          this.supabase.client.from('aprobaciones_legales').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
          this.supabase.client.from('solicitudes_ausencia').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
          this.supabase.client.from('solicitudes_material').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
          this.supabase.client.from('solicitudes_compra').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
        ]);
      this.kpi.set(kpi);
      this.proyectosEstado.set((proyectos.data ?? []) as { estado: string }[]);
      this.tareas.set((tareas.data ?? []) as { estado: string; fecha_limite: string | null }[]);
      this.empleados.set((empleados.data ?? []) as { departamento: string | null }[]);
      this.empleadosActivos.set(empAct.count ?? 0);
      this.expedientesAbiertos.set(expedientes.count ?? 0);
      this.contratosPorVencer.set(contratos.count ?? 0);
      this.aprobacionesPendientes.set(aprob.count ?? 0);
      this.ausenciasPendientes.set(ausencias.count ?? 0);
      this.solicitudesMaterial.set(solMat.count ?? 0);
      this.solicitudesCompra.set(solCom.count ?? 0);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el panel de dirección.');
    } finally {
      this.loading.set(false);
    }

    // Weather alerts across active obras — best-effort, never blocks the panel.
    try {
      const clima = await this.obrasClimaService.getClimaObrasActivas();
      this.obrasClimaPeligro.set(clima.filter((o) => o.peorNivel === 'peligro').length);
      this.obrasClimaPrecaucion.set(clima.filter((o) => o.peorNivel === 'precaucion').length);
    } catch {
      /* clima is enrichment only */
    }

    // A8 — obras con expediente de inicio incompleto (best-effort, no bloquea).
    try {
      const resumen = await this.proyectosService.getExpedienteResumen();
      this.expedientesObraIncompletos.set(resumen.filter((r) => !r.completo).length);
    } catch {
      /* vista de expediente: enrichment only */
    }

    // A4 — alertas antifraude abiertas (best-effort).
    try {
      this.alertasControl.set(await this.alertasCuadreService.getAlertas(true));
    } catch {
      /* alertas: enrichment only */
    }
  }

  async atenderAlerta(a: AlertaCuadre, estado: AlertaEstado) {
    const previo = a.estado;
    this.alertasControl.update((list) =>
      estado === 'resuelta' ? list.filter((x) => x.id !== a.id) : list.map((x) => (x.id === a.id ? { ...x, estado } : x)),
    );
    try {
      await this.alertasCuadreService.atender(a.id, estado, null);
      void this.notificaciones.refresh(); // mantener el badge de Dirección al día
    } catch {
      // rollback: recargar
      try {
        this.alertasControl.set(await this.alertasCuadreService.getAlertas(true));
      } catch {
        this.alertasControl.update((list) => list.map((x) => (x.id === a.id ? { ...x, estado: previo } : x)));
      }
    }
  }

  private groupCount(values: string[]): { key: string; count: number }[] {
    const map = new Map<string, number>();
    for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
    return [...map.entries()].map(([key, count]) => ({ key, count }));
  }

  alertaClass(nivel: string): string {
    return `alerta--${nivel}`;
  }
}

function scoreTotal(k: KpiProyectoRaw): number {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const avance = clamp(Number(k.avance_promedio));
  const bitacora = clamp((k.bitacoras_30d / 20) * 100);
  const seguridad = clamp(100 - k.incidentes_90d * 25);
  let presupuesto = 70;
  if (k.presupuesto && k.presupuesto > 0) {
    presupuesto = k.gasto_real <= k.presupuesto ? 100 : clamp(100 - ((k.gasto_real - k.presupuesto) / k.presupuesto) * 100);
  }
  return Math.round(avance * 0.3 + bitacora * 0.25 + seguridad * 0.25 + presupuesto * 0.2);
}
