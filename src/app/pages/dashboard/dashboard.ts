import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet, DecimalPipe } from '@angular/common';
import { UserService } from '../../core/services/user.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ProyectosService, KpiProyectoRaw } from '../../../shared/services/proyectos.service';
import { ObrasClima } from '../../../shared/context/obras-clima/obras-clima';
import { daysAgoIso, daysFromNowIso, todayIso, formatFechaDisplay } from '../../../shared/utils/fecha.util';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';

interface ModuleCard {
  label: string;
  description: string;
  route: string;
  modulo: string;
  icon: string;
  color: string;
}

interface DayMovement {
  label: string;
  entradas: number;
  salidas: number;
}

interface DonutSlice {
  label: string;
  value: number;
  color: string;
  key?: string; // Q3 — clave de estado para drill-down filtrado
}

interface BarItem {
  label: string;
  value: number;
  color: string;
  key?: string; // Q3 — clave de estado para drill-down filtrado
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, NgTemplateOutlet, DecimalPipe, ObrasClima, Skeleton],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements OnInit {
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);
  private proyectosService = inject(ProyectosService);

  formatFecha = formatFechaDisplay;

  profile = this.userService.profile;

  /** El dashboard varía por rol: cada usuario solo ve las áreas de sus módulos. */
  canSee(modulo: string): boolean {
    return this.userService.hasRole('admin') || this.userService.hasModulo(modulo);
  }
  /** Montos de contrato: solo Dirección/Admin (regla dura — obra nunca ve montos). */
  canVerMontos = computed(() => this.userService.hasRole('admin') || this.userService.hasModulo('direccion'));

  loading = signal(true);
  error = signal('');

  allModules: ModuleCard[] = [
    {
      label: 'Inventario',
      description: 'Artículos, activos, entradas, salidas y almacenes.',
      route: '/inventario',
      modulo: 'inventario',
      icon: 'inventory',
      color: '#1F4E79',
    },
    {
      label: 'Compras',
      description: 'Proveedores y órdenes de compra.',
      route: '/compras',
      modulo: 'compras',
      icon: 'purchases',
      color: '#5B3A8E',
    },
    {
      label: 'RRHH',
      description: 'Empleados, asistencia y nómina.',
      route: '/rrhh',
      modulo: 'rrhh',
      icon: 'hr',
      color: '#2D7D46',
    },
    {
      label: 'Proyectos',
      description: 'Obras en ejecución, fases y presupuestos.',
      route: '/proyectos',
      modulo: 'proyectos',
      icon: 'projects',
      color: '#B45309',
    },
    {
      label: 'Flota',
      description: 'Vehículos, mantenimientos y combustible.',
      route: '/flota',
      modulo: 'flota',
      icon: 'fleet',
      color: '#C0392B',
    },
    {
      label: 'Bitácora',
      description: 'Registro diario de obra e ingenieros de campo.',
      route: '/bitacora',
      modulo: 'bitacora',
      icon: 'bitacora',
      color: '#0E7490',
    },
    {
      label: 'Documentos',
      description: 'Plantillas, contratos y documentos generados.',
      route: '/documentos',
      modulo: 'documentos',
      icon: 'documentos',
      color: '#4D4D4D',
    },
    {
      label: 'Legal',
      description: 'Expedientes, contratos y aprobaciones legales.',
      route: '/legal',
      modulo: 'legal',
      icon: 'legal',
      color: '#6B4226',
    },
    {
      label: 'Tareas',
      description: 'Asigna y da seguimiento a las tareas del equipo.',
      route: '/tareas/gestion',
      modulo: 'tareas',
      icon: 'tareas',
      color: '#0F766E',
    },
    {
      label: 'Tecnología',
      description: 'Homologación de herramientas, inventario tecnológico y compras.',
      route: '/tecnologia/homologacion',
      modulo: 'tecnologia',
      icon: 'tecnologia',
      color: '#1D4ED8',
    },
  ];

  isAdmin = computed(() => this.userService.hasRole('admin'));

  canSeeSolicitudes = computed(
    () => this.isAdmin() || this.canAccess('inventario') || this.canAccess('compras'),
  );
  canSeeBitacora = computed(
    () => this.isAdmin() || this.canAccess('proyectos') || this.canAccess('bitacora'),
  );
  canSeeEntregas = computed(
    () => this.isAdmin() || this.canAccess('inventario') || this.canAccess('proyectos'),
  );

  // ── Raw data signals ─────────────────────────────────────
  private articulos = signal<{ id: string; precio_estimado: number | null; stock_minimo: number; activo: boolean; categoria_id: number; categoria?: { nombre: string } }[]>([]);
  private stock = signal<{ articulo_id: string; cantidad: number }[]>([]);
  private movimientos7d = signal<DayMovement[]>([]);
  private ordenes = signal<{ estado: string; fecha: string; total: number }[]>([]);
  private empleados = signal<{ activo: boolean; departamento: string | null }[]>([]);
  private asistenciaHoy = signal<{ estado: string }[]>([]);
  private proyectos = signal<{ estado: string; presupuesto: number | null }[]>([]);
  private vehiculos = signal<{ estado: string; activo: boolean }[]>([]);
  private mantenimientos = signal<{ estado: string; fecha: string; vehiculo?: { placa: string } }[]>([]);
  private solicitudesMaterialCount = signal(0);
  private solicitudesCompraCount = signal(0);
  solicitudesRecientes = signal<
    { tipo: 'material' | 'compra'; proyecto: string; solicitante: string; urgencia: string; created_at: string }[]
  >([]);
  bitacorasSemana = signal(0);
  entregasPendientesCount = signal(0);
  entregasIncompletasCount = signal(0);
  expedientesLegalesAbiertos = signal(0);
  contratosPorVencer = signal(0);
  misTareasPendientes = signal(0);
  ausenciasPendientes = signal(0);

  // ── KPIs ─────────────────────────────────────────────────
  private stockMap = computed(() => {
    const map = new Map<string, number>();
    for (const s of this.stock()) {
      map.set(s.articulo_id, (map.get(s.articulo_id) ?? 0) + s.cantidad);
    }
    return map;
  });

  valorInventario = computed(() =>
    this.articulos().reduce((sum, a) => {
      if (a.precio_estimado == null) return sum;
      return sum + (this.stockMap().get(a.id) ?? 0) * a.precio_estimado;
    }, 0),
  );

  stockCritico = computed(
    () => this.articulos().filter((a) => a.activo && (this.stockMap().get(a.id) ?? 0) <= a.stock_minimo).length,
  );

  gastoComprasDelMes = computed(() => {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.ordenes()
      .filter((o) => {
        return (
          (o.estado === 'aprobada' || o.estado === 'recibida') &&
          o.fecha.slice(0, 7) === currentYearMonth
        );
      })
      .reduce((sum, o) => sum + o.total, 0);
  });

  empleadosActivos = computed(() => this.empleados().filter((e) => e.activo).length);

  proyectosActivos = computed(() => this.proyectos().filter((p) => p.estado === 'en_progreso').length);

  vehiculosActivos = computed(() => this.vehiculos().filter((v) => v.activo).length);

  solicitudesPendientesTotal = computed(() => this.solicitudesMaterialCount() + this.solicitudesCompraCount());

  // ── Chart: movimientos de inventario (7 días) ─────────────
  movimientosChart = computed(() => this.movimientos7d());

  movimientosMax = computed(() =>
    Math.max(1, ...this.movimientos7d().map((d) => Math.max(d.entradas, d.salidas))),
  );

  // ── Chart: stock por categoría (top 6) ────────────────────
  stockPorCategoria = computed((): BarItem[] => {
    const map = new Map<string, number>();
    for (const a of this.articulos()) {
      const nombre = a.categoria?.nombre ?? 'Sin categoría';
      map.set(nombre, (map.get(nombre) ?? 0) + (this.stockMap().get(a.id) ?? 0));
    }
    const colors = ['#1F4E79', '#2E75B6', '#5B3A8E', '#2D7D46', '#B45309', '#C0392B'];
    return [...map.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }));
  });

  stockPorCategoriaMax = computed(() => Math.max(1, ...this.stockPorCategoria().map((c) => c.value)));

  // ── Chart: órdenes de compra por estado (donut) ───────────
  ordenesPorEstado = computed((): DonutSlice[] => {
    const colors: Record<string, string> = {
      borrador: '#94a3b8',
      aprobada: '#0284c7',
      recibida: '#2d7d46',
      cancelada: '#c0392b',
    };
    const labels: Record<string, string> = {
      borrador: 'Borrador',
      aprobada: 'Aprobada',
      recibida: 'Recibida',
      cancelada: 'Cancelada',
    };
    const map = new Map<string, number>();
    for (const o of this.ordenes()) {
      map.set(o.estado, (map.get(o.estado) ?? 0) + 1);
    }
    return [...map.entries()]
      .filter(([, v]) => v > 0)
      .map(([estado, value]) => ({ label: labels[estado] ?? estado, value, color: colors[estado] ?? '#94a3b8' }));
  });

  // ── Chart: asistencia de hoy (donut) ──────────────────────
  asistenciaChart = computed((): DonutSlice[] => {
    const colors: Record<string, string> = {
      presente: '#2d7d46',
      ausente: '#c0392b',
      tardanza: '#b45309',
      permiso: '#0284c7',
      feriado: '#94a3b8',
    };
    const labels: Record<string, string> = {
      presente: 'Presente',
      ausente: 'Ausente',
      tardanza: 'Tardanza',
      permiso: 'Permiso',
      feriado: 'Feriado',
    };
    const map = new Map<string, number>();
    for (const a of this.asistenciaHoy()) {
      map.set(a.estado, (map.get(a.estado) ?? 0) + 1);
    }
    return [...map.entries()]
      .filter(([, v]) => v > 0)
      .map(([estado, value]) => ({ label: labels[estado] ?? estado, value, color: colors[estado] ?? '#94a3b8' }));
  });

  // ── Chart: proyectos por estado ────────────────────────────
  proyectosPorEstado = computed((): BarItem[] => {
    const colors: Record<string, string> = {
      planificacion: '#94a3b8',
      en_progreso: '#0284c7',
      pausado: '#b45309',
      completado: '#2d7d46',
      cancelado: '#c0392b',
    };
    const labels: Record<string, string> = {
      planificacion: 'Planificación',
      en_progreso: 'En progreso',
      pausado: 'Pausado',
      completado: 'Completado',
      cancelado: 'Cancelado',
    };
    const map = new Map<string, number>();
    for (const p of this.proyectos()) {
      map.set(p.estado, (map.get(p.estado) ?? 0) + 1);
    }
    return [...map.entries()]
      .filter(([, v]) => v > 0)
      .map(([estado, value]) => ({ label: labels[estado] ?? estado, value, color: colors[estado] ?? '#94a3b8', key: estado }));
  });

  proyectosPorEstadoMax = computed(() => Math.max(1, ...this.proyectosPorEstado().map((p) => p.value)));

  presupuestoTotalProyectos = computed(() =>
    this.proyectos().reduce((sum, p) => sum + (p.presupuesto ?? 0), 0),
  );

  // ── Chart: flota (vehículos por estado + mantenimientos) ──
  vehiculosPorEstado = computed((): DonutSlice[] => {
    const colors: Record<string, string> = {
      activo: '#2d7d46',
      mantenimiento: '#b45309',
      baja: '#c0392b',
    };
    const labels: Record<string, string> = {
      activo: 'Activo',
      mantenimiento: 'En mantenimiento',
      baja: 'Dado de baja',
    };
    const map = new Map<string, number>();
    for (const v of this.vehiculos()) {
      map.set(v.estado, (map.get(v.estado) ?? 0) + 1);
    }
    return [...map.entries()]
      .filter(([, v]) => v > 0)
      .map(([estado, value]) => ({ label: labels[estado] ?? estado, value, color: colors[estado] ?? '#94a3b8', key: estado }));
  });

  mantenimientosPendientes = computed(
    () => this.mantenimientos().filter((m) => m.estado === 'pendiente' || m.estado === 'en_proceso').length,
  );

  // ── Chart: empleados por departamento ─────────────────────
  empleadosPorDepartamento = computed((): BarItem[] => {
    const colors = ['#1F4E79', '#2E75B6', '#5B3A8E', '#2D7D46', '#B45309', '#C0392B'];
    const map = new Map<string, number>();
    for (const e of this.empleados()) {
      if (!e.activo) continue;
      const dept = e.departamento || 'Sin departamento';
      map.set(dept, (map.get(dept) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }));
  });

  empleadosPorDepartamentoMax = computed(() => Math.max(1, ...this.empleadosPorDepartamento().map((d) => d.value)));

  // ── Alerta: próximos mantenimientos (7 días) ──────────────
  proximosMantenimientos = computed(() => {
    const today = todayIso();
    const in7Str = daysFromNowIso(7);

    return this.mantenimientos()
      .filter((m) => m.estado !== 'completado' && m.fecha >= today && m.fecha <= in7Str)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  });

  // ── Ranking de Encargados (compacto; sin exponer montos) ──
  private kpiRaw = signal<KpiProyectoRaw[]>([]);
  canSeeRanking = computed(() => this.canSee('proyectos') || this.canSee('direccion'));
  ranking = computed(() => {
    return [...this.kpiRaw()]
      .map((k) => {
        const avance = Math.max(0, Math.min(100, Number(k.avance_promedio ?? 0)));
        const bitacora = Math.min(1, Number(k.bitacoras_30d ?? 0) / 20) * 100;
        const seguridad = Math.max(0, 100 - Number(k.incidentes_90d ?? 0) * 25);
        const score = Math.round(avance * 0.4 + bitacora * 0.3 + seguridad * 0.3);
        return { proyecto: k.nombre, encargado: k.responsable_nombre || '—', avance: Math.round(avance), score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r, i) => ({ ...r, pos: i + 1 }));
  });

  // ── Donut helper (conic-gradient background) ──────────────
  donutBackground(slices: DonutSlice[]): string {
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (total === 0) return 'conic-gradient(var(--sgc-border) 0deg 360deg)';
    let acc = 0;
    const stops: string[] = [];
    for (const s of slices) {
      const start = (acc / total) * 360;
      acc += s.value;
      const end = (acc / total) * 360;
      stops.push(`${s.color} ${start}deg ${end}deg`);
    }
    return `conic-gradient(${stops.join(', ')})`;
  }

  donutTotal(slices: DonutSlice[]): number {
    return slices.reduce((s, x) => s + x.value, 0);
  }

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const fechaDesde = daysAgoIso(6);
      const hoy = todayIso();

      const [
        articulosRes,
        stockRes,
        entradasRes,
        salidasRes,
        ordenesRes,
        empleadosRes,
        asistenciaRes,
        proyectosRes,
        vehiculosRes,
        mantenimientosRes,
        solicitudesMaterialRes,
        solicitudesCompraRes,
        bitacorasSemanaRes,
        entregasPendientesRes,
        entregasIncompletasRes,
        expedientesLegalesRes,
        contratosPorVencerRes,
        misTareasRes,
        ausenciasPendientesRes,
      ] = await Promise.all([
        this.supabase.client.from('articulos').select('id, precio_estimado, stock_minimo, activo, categoria_id, categoria:categorias_inventario(nombre)'),
        this.supabase.client.from('stock_por_bodega').select('articulo_id, cantidad'),
        this.supabase.client
          .from('entradas_inventario')
          .select('fecha, detalle_entradas(cantidad)')
          .gte('fecha', fechaDesde),
        this.supabase.client
          .from('salidas_inventario')
          .select('fecha, detalle_salidas(cantidad)')
          .gte('fecha', fechaDesde),
        this.supabase.client.from('ordenes_compra').select('estado, fecha, total'),
        this.supabase.client.from('empleados').select('activo, departamento'),
        this.supabase.client.from('asistencia').select('estado').eq('fecha', hoy),
        this.supabase.client.from('proyectos').select('estado, presupuesto'),
        this.supabase.client.from('vehiculos').select('estado, activo'),
        this.supabase.client.from('mantenimientos').select('estado, fecha, vehiculo:vehiculos(placa)'),
        this.supabase.client
          .from('solicitudes_material')
          .select('proyecto:proyectos(nombre), solicitante:usuarios!solicitudes_material_solicitante_id_fkey(nombre), urgencia, created_at', { count: 'exact' })
          .eq('estado', 'pendiente')
          .order('created_at', { ascending: false })
          .limit(5),
        this.supabase.client
          .from('solicitudes_compra')
          .select('proyecto:proyectos(nombre), solicitante:usuarios!solicitudes_compra_solicitante_id_fkey(nombre), created_at', { count: 'exact' })
          .eq('estado', 'pendiente')
          .order('created_at', { ascending: false })
          .limit(5),
        this.supabase.client
          .from('bitacoras')
          .select('id', { count: 'exact', head: true })
          .gte('fecha', fechaDesde),
        this.supabase.client
          .from('salidas_inventario')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'despachado'),
        this.supabase.client
          .from('salidas_inventario')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'entregado_incompleto')
          .gte('fecha', daysAgoIso(29)),
        this.supabase.client
          .from('expedientes_legales')
          .select('id', { count: 'exact', head: true })
          .neq('estado', 'cerrado'),
        this.supabase.client
          .from('contratos')
          .select('id', { count: 'exact', head: true })
          .in('estado', ['firmado', 'en_revision'])
          .not('fecha_vencimiento', 'is', null)
          .lte('fecha_vencimiento', daysFromNowIso(30)),
        this.supabase.client
          .from('tareas')
          .select('id', { count: 'exact', head: true })
          .eq('asignado_a', this.profile()?.id ?? '00000000-0000-0000-0000-000000000000')
          .in('estado', ['pendiente', 'en_progreso']),
        this.supabase.client
          .from('solicitudes_ausencia')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente'),
      ]);

      this.articulos.set(
        (articulosRes.data ?? []) as unknown as {
          id: string;
          precio_estimado: number | null;
          stock_minimo: number;
          activo: boolean;
          categoria_id: number;
          categoria?: { nombre: string };
        }[],
      );
      this.stock.set((stockRes.data ?? []) as { articulo_id: string; cantidad: number }[]);
      this.ordenes.set((ordenesRes.data ?? []) as { estado: string; fecha: string; total: number }[]);
      this.empleados.set((empleadosRes.data ?? []) as unknown as { activo: boolean; departamento: string | null }[]);
      this.asistenciaHoy.set((asistenciaRes.data ?? []) as { estado: string }[]);
      this.proyectos.set((proyectosRes.data ?? []) as { estado: string; presupuesto: number | null }[]);
      this.vehiculos.set((vehiculosRes.data ?? []) as { estado: string; activo: boolean }[]);
      this.mantenimientos.set(
        (mantenimientosRes.data ?? []) as unknown as { estado: string; fecha: string; vehiculo?: { placa: string } }[],
      );

      this.solicitudesMaterialCount.set(solicitudesMaterialRes.count ?? 0);
      this.solicitudesCompraCount.set(solicitudesCompraRes.count ?? 0);
      this.bitacorasSemana.set(bitacorasSemanaRes.count ?? 0);
      this.entregasPendientesCount.set(entregasPendientesRes.count ?? 0);
      this.entregasIncompletasCount.set(entregasIncompletasRes.count ?? 0);
      this.expedientesLegalesAbiertos.set(expedientesLegalesRes.count ?? 0);
      this.contratosPorVencer.set(contratosPorVencerRes.count ?? 0);
      this.misTareasPendientes.set(misTareasRes.count ?? 0);
      this.ausenciasPendientes.set(ausenciasPendientesRes.count ?? 0);

      const materialItems = (
        (solicitudesMaterialRes.data ?? []) as unknown as {
          proyecto?: { nombre: string }; solicitante?: { nombre: string }; urgencia: string; created_at: string;
        }[]
      ).map((s) => ({
        tipo: 'material' as const,
        proyecto: s.proyecto?.nombre ?? '—',
        solicitante: s.solicitante?.nombre ?? '—',
        urgencia: s.urgencia,
        created_at: s.created_at,
      }));
      const compraItems = (
        (solicitudesCompraRes.data ?? []) as unknown as {
          proyecto?: { nombre: string }; solicitante?: { nombre: string }; created_at: string;
        }[]
      ).map((s) => ({
        tipo: 'compra' as const,
        proyecto: s.proyecto?.nombre ?? '—',
        solicitante: s.solicitante?.nombre ?? '—',
        urgencia: 'normal',
        created_at: s.created_at,
      }));
      this.solicitudesRecientes.set(
        [...materialItems, ...compraItems].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
      );

      // Build 7-day movement series
      const entradasByDay = new Map<string, number>();
      for (const row of (entradasRes.data ?? []) as { fecha: string; detalle_entradas: { cantidad: number }[] }[]) {
        const total = (row.detalle_entradas ?? []).reduce((s, d) => s + d.cantidad, 0);
        entradasByDay.set(row.fecha, (entradasByDay.get(row.fecha) ?? 0) + total);
      }
      const salidasByDay = new Map<string, number>();
      for (const row of (salidasRes.data ?? []) as { fecha: string; detalle_salidas: { cantidad: number }[] }[]) {
        const total = (row.detalle_salidas ?? []).reduce((s, d) => s + d.cantidad, 0);
        salidasByDay.set(row.fecha, (salidasByDay.get(row.fecha) ?? 0) + total);
      }

      const dias: DayMovement[] = [];
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      for (let i = 6; i >= 0; i--) {
        const key = daysAgoIso(i);
        const [y, m, day] = key.split('-').map(Number);
        dias.push({
          label: dayNames[new Date(y, m - 1, day).getDay()],
          entradas: entradasByDay.get(key) ?? 0,
          salidas: salidasByDay.get(key) ?? 0,
        });
      }
      this.movimientos7d.set(dias);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los indicadores del sistema.');
    } finally {
      this.loading.set(false);
    }

    // Ranking de Encargados — solo para quien ve proyectos/dirección (best-effort).
    if (this.canSeeRanking()) {
      try {
        this.kpiRaw.set(await this.proyectosService.getKpiProyectos());
      } catch {
        /* ranking is enrichment only */
      }
    }
  }

  canAccess(modulo: string): boolean {
    return this.userService.hasModulo(modulo);
  }

  getGreeting(): string {
    const nombre = this.profile()?.nombre?.split(' ')[0] ?? 'Usuario';
    return `Bienvenido, ${nombre}`;
  }
}
