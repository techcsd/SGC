import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { daysAgoIso, yearsSince } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

interface EmpleadoReport {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string;
  departamento: string | null;
  tipo_contrato: string;
  salario: number;
  fecha_ingreso: string;
  activo: boolean;
}

interface AsistenciaReport {
  empleado_id: string;
  empleado?: { nombre: string; apellido: string };
  fecha: string;
  estado: string;
}

interface AsistenciaStat {
  presente: number;
  ausente: number;
  tardanza: number;
  permiso: number;
  feriado: number;
  total: number;
}

interface DeptStat {
  departamento: string;
  total: number;
  activos: number;
  salarioPromedio: number;
}

@Component({
  selector: 'app-rrhh-reportes',
  imports: [DecimalPipe, Skeleton],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhReportes implements OnInit {
  private supabase = inject(SupabaseService);

  empleados = signal<EmpleadoReport[]>([]);
  asistencia = signal<AsistenciaReport[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Summary ───────────────────────────────────────────────
  totalEmpleados = computed(() => this.empleados().length);
  empleadosActivos = computed(() => this.empleados().filter((e) => e.activo).length);

  salarioMasaNominal = computed(() =>
    this.empleados()
      .filter((e) => e.activo)
      .reduce((s, e) => s + (e.salario ?? 0), 0),
  );

  contratosTemporales = computed(() =>
    this.empleados().filter((e) => e.activo && e.tipo_contrato !== 'indefinido').length,
  );

  // ── Dept stats ────────────────────────────────────────────
  deptStats = computed((): DeptStat[] => {
    const map = new Map<string, { total: number; activos: number; salarios: number[] }>();
    for (const e of this.empleados()) {
      const dept = e.departamento || 'Sin departamento';
      if (!map.has(dept)) map.set(dept, { total: 0, activos: 0, salarios: [] });
      const d = map.get(dept)!;
      d.total++;
      if (e.activo) {
        d.activos++;
        d.salarios.push(e.salario ?? 0);
      }
    }
    return [...map.entries()]
      .map(([departamento, d]) => ({
        departamento,
        total: d.total,
        activos: d.activos,
        salarioPromedio: d.salarios.length
          ? d.salarios.reduce((a, b) => a + b, 0) / d.salarios.length
          : 0,
      }))
      .sort((a, b) => b.total - a.total);
  });

  // ── Asistencia stats (last 30 days) ───────────────────────
  asistenciaStats = computed((): AsistenciaStat => {
    const stats: AsistenciaStat = { presente: 0, ausente: 0, tardanza: 0, permiso: 0, feriado: 0, total: 0 };
    for (const a of this.asistencia()) {
      stats.total++;
      if (a.estado in stats) {
        (stats as unknown as Record<string, number>)[a.estado]++;
      }
    }
    return stats;
  });

  // ── Contrato breakdown ────────────────────────────────────
  contratoStats = computed(() => {
    const map: Record<string, number> = {};
    for (const e of this.empleados().filter((e) => e.activo)) {
      map[e.tipo_contrato] = (map[e.tipo_contrato] ?? 0) + 1;
    }
    return [
      { label: 'Indefinido', value: map['indefinido'] ?? 0 },
      { label: 'Temporal', value: map['temporal'] ?? 0 },
      { label: 'Por obra', value: map['obra'] ?? 0 },
    ];
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const fechaDesde = daysAgoIso(30);

      const [eRes, aRes] = await Promise.all([
        this.supabase.client
          .from('empleados')
          .select('id, nombre, apellido, cargo, departamento, tipo_contrato, salario, fecha_ingreso, activo')
          .order('apellido'),
        this.supabase.client
          .from('asistencia')
          .select('empleado_id, empleado:empleados(nombre, apellido), fecha, estado')
          .gte('fecha', fechaDesde),
      ]);

      if (eRes.error) throw new Error(eRes.error.message);
      if (aRes.error) throw new Error(aRes.error.message);

      this.empleados.set((eRes.data ?? []) as unknown as EmpleadoReport[]);
      this.asistencia.set((aRes.data ?? []) as unknown as AsistenciaReport[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al cargar datos.';
      if (!msg.includes('does not exist') && !msg.includes('relation')) {
        this.error.set(msg);
      }
    } finally {
      this.loading.set(false);
    }
  }

  getContratoLabel(tipo: string): string {
    const map: Record<string, string> = { indefinido: 'Indefinido', temporal: 'Temporal', obra: 'Por obra' };
    return map[tipo] ?? tipo;
  }

  getContratoBadge(tipo: string): string {
    const map: Record<string, string> = { indefinido: 'success', temporal: 'warning', obra: 'info' };
    return map[tipo] ?? 'neutral';
  }

  getAntiguedad(fecha: string): string {
    const years = yearsSince(fecha);
    return years === 0 ? '< 1 año' : `${years} año${years !== 1 ? 's' : ''}`;
  }
}
