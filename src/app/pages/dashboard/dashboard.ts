import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet, DecimalPipe } from '@angular/common';
import { UserService } from '../../core/services/user.service';
import { SupabaseService } from '../../core/services/supabase.service';

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
}

interface BarItem {
  label: string;
  value: number;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, NgTemplateOutlet, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements OnInit {
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);

  profile = this.userService.profile;

  loading = signal(true);
  error = signal('');

  allModules: ModuleCard[] = [
    {
      label: 'Inventario',
      description: 'Artículos, activos, entradas, salidas y bodegas.',
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
  ];

  isAdmin = computed(() => this.userService.hasRole('admin'));

  // ── Raw data signals ─────────────────────────────────────
  private articulos = signal<{ id: string; precio_estimado: number | null; stock_minimo: number; activo: boolean; categoria_id: number; categoria?: { nombre: string } }[]>([]);
  private stock = signal<{ articulo_id: string; cantidad: number }[]>([]);
  private movimientos7d = signal<DayMovement[]>([]);
  private ordenes = signal<{ estado: string; fecha: string; total: number }[]>([]);
  private empleados = signal<{ activo: boolean }[]>([]);
  private asistenciaHoy = signal<{ estado: string }[]>([]);
  private proyectos = signal<{ estado: string; presupuesto: number | null }[]>([]);
  private vehiculos = signal<{ estado: string; activo: boolean }[]>([]);
  private mantenimientos = signal<{ estado: string }[]>([]);

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
    return this.ordenes()
      .filter((o) => {
        const d = new Date(o.fecha);
        return (
          (o.estado === 'aprobada' || o.estado === 'recibida') &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      })
      .reduce((sum, o) => sum + o.total, 0);
  });

  empleadosActivos = computed(() => this.empleados().filter((e) => e.activo).length);

  proyectosActivos = computed(() => this.proyectos().filter((p) => p.estado === 'en_progreso').length);

  vehiculosActivos = computed(() => this.vehiculos().filter((v) => v.activo).length);

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
      .map(([estado, value]) => ({ label: labels[estado] ?? estado, value, color: colors[estado] ?? '#94a3b8' }));
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
      .map(([estado, value]) => ({ label: labels[estado] ?? estado, value, color: colors[estado] ?? '#94a3b8' }));
  });

  mantenimientosPendientes = computed(
    () => this.mantenimientos().filter((m) => m.estado === 'pendiente' || m.estado === 'en_proceso').length,
  );

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
      const hace7 = new Date();
      hace7.setDate(hace7.getDate() - 6);
      const fechaDesde = hace7.toISOString().split('T')[0];
      const hoy = new Date().toISOString().split('T')[0];

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
        this.supabase.client.from('empleados').select('activo'),
        this.supabase.client.from('asistencia').select('estado').eq('fecha', hoy),
        this.supabase.client.from('proyectos').select('estado, presupuesto'),
        this.supabase.client.from('vehiculos').select('estado, activo'),
        this.supabase.client.from('mantenimientos').select('estado'),
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
      this.empleados.set((empleadosRes.data ?? []) as { activo: boolean }[]);
      this.asistenciaHoy.set((asistenciaRes.data ?? []) as { estado: string }[]);
      this.proyectos.set((proyectosRes.data ?? []) as { estado: string; presupuesto: number | null }[]);
      this.vehiculos.set((vehiculosRes.data ?? []) as { estado: string; activo: boolean }[]);
      this.mantenimientos.set((mantenimientosRes.data ?? []) as { estado: string }[]);

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
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dias.push({
          label: dayNames[d.getDay()],
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
  }

  canAccess(modulo: string): boolean {
    return this.userService.hasModulo(modulo) || this.userService.hasRole('admin');
  }

  getGreeting(): string {
    const nombre = this.profile()?.nombre?.split(' ')[0] ?? 'Usuario';
    return `Bienvenido, ${nombre}`;
  }
}
