import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EstadisticasService, EstadisticasUso, DispositivoUsuario } from '../../../../shared/services/estadisticas.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { ExportExcel, ExportColumn, ExportSection } from '../../../../shared/components/export-excel/export-excel';
import { formatFechaHumana, formatFechaRelativa } from '../../../../shared/utils/fecha.util';

type OrdenCol = 'nombre' | 'plataforma' | 'version' | 'ultimo';
type OrdenDir = 'asc' | 'desc';

/**
 * AQ7/AS3 — Sistema › Estadísticas: uso de la web y la app. Rediseño AS3:
 * fila de KPIs + distribución de versiones (bar-chart) + tabla filtrable/ordenable
 * con export, señal de "obsoleta" y "última vez visto" (frescura). Gating es_tecnologia().
 */
@Component({
  selector: 'app-tec-estadisticas',
  imports: [DecimalPipe, FormsModule, Skeleton, BarChart, ExportExcel],
  templateUrl: './estadisticas.html',
  styleUrl: './estadisticas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecEstadisticas implements OnInit {
  private service = inject(EstadisticasService);

  readonly formatFechaHora = formatFechaHumana;
  /** AS3 — "hace N min/h/días" (mismo patrón que Seguimiento). */
  readonly haceCuanto = formatFechaRelativa;

  data = signal<EstadisticasUso | null>(null);
  loading = signal(true);
  error = signal('');

  // Dispositivos por usuario (AR2/AS3).
  dispositivos = signal<DispositivoUsuario[]>([]);
  busqueda = signal('');
  filtroPlataforma = signal<string>('');
  filtroRol = signal<string>('');
  ordenCol = signal<OrdenCol>('ultimo');
  ordenDir = signal<OrdenDir>('desc');
  expandido = signal<string | null>(null);

  // ── KPIs ────────────────────────────────────────────────────────────────
  /** Total de dispositivos registrados (suma por usuario). */
  totalDispositivos = computed(() =>
    this.dispositivos().reduce((s, d) => s + (d.dispositivos_total ?? 0), 0),
  );

  /** Nº de plataformas distintas realmente reportadas. */
  numPlataformas = computed(() => this.plataformas().length);

  /** % de usuarios (con versión conocida) que están en la última versión publicada. */
  pctUltimaVersion = computed(() => {
    const conVersion = this.dispositivos().filter((d) => !!d.app_version);
    if (!conVersion.length) return null;
    const alDia = conVersion.filter((d) => !d.obsoleta).length;
    return Math.round((100 * alDia) / conVersion.length);
  });

  // ── Distribución de versiones (bar-chart) ─────────────────────────────────
  /** Set de versiones "publicadas" (para resaltar la barra). */
  private publicadas = computed(() => {
    const vals = Object.values(this.data()?.versiones_ultimas ?? {});
    return new Set(vals);
  });

  versionBars = computed<BarDatum[]>(() => {
    const counts = new Map<string, number>();
    for (const d of this.dispositivos()) {
      const key = d.app_version ?? '__null__';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const pub = this.publicadas();
    return [...counts.entries()]
      .map(([ver, value]) => {
        const sinDato = ver === '__null__';
        return {
          label: sinDato ? 'Sin dato' : ver,
          value,
          color: sinDato
            ? 'var(--sgc-text-muted)'
            : pub.has(ver) ? 'var(--sgc-success)' : 'var(--sgc-primary)',
          key: ver,
        } satisfies BarDatum;
      })
      .sort((a, b) => {
        if (a.key === '__null__') return 1;
        if (b.key === '__null__') return -1;
        return this.compararVersion(b.key!, a.key!); // más nueva primero
      });
  });

  // ── Distribución de dispositivos (bar-chart) ──────────────────────────────
  dispositivoBars = computed<BarDatum[]>(() =>
    (this.data()?.dispositivos ?? []).map((d) => ({
      label: this.plataformaLabel(d.plataforma),
      value: d.total,
    })),
  );

  // ── Filtros de la tabla ───────────────────────────────────────────────────
  plataformas = computed(() => {
    const set = new Set<string>();
    for (const d of this.dispositivos()) if (d.plataforma) set.add(d.plataforma);
    return [...set].sort();
  });

  roles = computed(() => {
    const set = new Set<string>();
    for (const d of this.dispositivos()) for (const r of d.roles) set.add(r);
    return [...set].sort();
  });

  dispositivosFiltrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const plat = this.filtroPlataforma();
    const rol = this.filtroRol();
    const col = this.ordenCol();
    const dir = this.ordenDir() === 'asc' ? 1 : -1;

    const filtrados = this.dispositivos().filter((d) => {
      if (plat && d.plataforma !== plat) return false;
      if (rol && !d.roles.includes(rol)) return false;
      if (q) {
        const hay = `${d.nombre} ${d.email ?? ''} ${d.modelo ?? ''} ${d.app_version ?? ''} ${d.roles.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return filtrados.sort((a, b) => dir * this.comparar(a, b, col));
  });

  private comparar(a: DispositivoUsuario, b: DispositivoUsuario, col: OrdenCol): number {
    switch (col) {
      case 'nombre':
        return a.nombre.localeCompare(b.nombre, 'es');
      case 'plataforma':
        return this.plataformaLabel(a.plataforma ?? '').localeCompare(this.plataformaLabel(b.plataforma ?? ''), 'es');
      case 'version':
        return this.compararVersion(a.app_version, b.app_version);
      case 'ultimo': {
        const ta = a.last_seen_at ?? a.ultimo_uso;
        const tb = b.last_seen_at ?? b.ultimo_uso;
        return (ta ? new Date(ta).getTime() : 0) - (tb ? new Date(tb).getTime() : 0);
      }
    }
  }

  /** Compara versiones "1.86.0" numéricamente; nulls al final. */
  private compararVersion(a: string | null | undefined, b: string | null | undefined): number {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  ordenar(col: OrdenCol) {
    if (this.ordenCol() === col) {
      this.ordenDir.set(this.ordenDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.ordenCol.set(col);
      this.ordenDir.set(col === 'ultimo' ? 'desc' : 'asc');
    }
  }

  flecha(col: OrdenCol): string {
    if (this.ordenCol() !== col) return '';
    return this.ordenDir() === 'asc' ? '▲' : '▼';
  }

  toggleExpandido(id: string) {
    this.expandido.set(this.expandido() === id ? null : id);
  }

  plataformaLabel(p: string): string {
    switch (p) {
      case 'android': return 'Android (app)';
      case 'ios': return 'iPhone (app)';
      case 'ios-pwa': return 'iPhone (PWA)';
      case 'web': return 'Web';
      case '': return 'Sin reportar';
      default: return p;
    }
  }

  // ── Export (reutiliza app-export-excel) ───────────────────────────────────
  readonly exportCols: ExportColumn[] = [
    { key: 'nombre', label: 'Usuario', value: (r) => (r as DispositivoUsuario).nombre },
    { key: 'email', label: 'Correo', value: (r) => (r as DispositivoUsuario).email ?? '' },
    { key: 'roles', label: 'Roles', value: (r) => (r as DispositivoUsuario).roles.join(', ') },
    { key: 'plataforma', label: 'Plataforma', value: (r) => this.plataformaLabel((r as DispositivoUsuario).plataforma ?? '') },
    { key: 'modelo', label: 'Dispositivo', value: (r) => (r as DispositivoUsuario).modelo ?? '' },
    { key: 'version', label: 'Versión', value: (r) => (r as DispositivoUsuario).app_version ?? 'Sin dato' },
    { key: 'obsoleta', label: 'Estado versión', value: (r) => { const d = r as DispositivoUsuario; return !d.app_version ? 'Sin dato' : d.obsoleta ? 'Obsoleta' : 'Al día'; } },
    { key: 'ultimo', label: 'Última vez visto', value: (r) => { const d = r as DispositivoUsuario; return d.last_seen_at ?? d.ultimo_uso ?? ''; } },
    { key: 'dispositivos', label: 'Nº dispositivos', value: (r) => (r as DispositivoUsuario).dispositivos_total },
  ];
  readonly exportSecciones: ExportSection[] = [
    { key: 'plataforma', label: 'Plataforma', values: (r) => { const p = (r as DispositivoUsuario).plataforma; return p ? [this.plataformaLabel(p)] : ['Sin reportar']; } },
    { key: 'estado', label: 'Estado versión', values: (r) => { const d = r as DispositivoUsuario; return [!d.app_version ? 'Sin dato' : d.obsoleta ? 'Obsoleta' : 'Al día']; } },
    { key: 'roles', label: 'Roles', values: (r) => (r as DispositivoUsuario).roles },
  ];

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [uso, disp] = await Promise.all([
        this.service.getUso(),
        this.service.getDispositivosPorUsuario(),
      ]);
      this.data.set(uso);
      this.dispositivos.set(disp);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las estadísticas.');
    } finally {
      this.loading.set(false);
    }
  }
}
