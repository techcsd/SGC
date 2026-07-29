import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AppVersionesService } from '../../../../shared/services/app-versiones.service';
import { AppVersion, CambioItem, CambioTag, CAMBIO_META, Plataforma } from '../../../../shared/models/app-version.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, formatFechaHumana } from '../../../../shared/utils/fecha.util';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { DonutChart, DonutDatum } from '../../../../shared/ui/donut-chart/donut-chart';

const TAGS: CambioTag[] = ['nuevo', 'mejora', 'arreglo', 'seguridad'];

/** Z27 — colores por tipo de cambio (paridad con los chips del historial). */
const TAG_COLORS: Record<CambioTag, string> = {
  nuevo: '#2d7d46',
  mejora: '#2e75b6',
  arreglo: '#b7791f',
  seguridad: '#7c3aed',
};

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

interface VersionVista extends AppVersion {
  cambiosVisibles: CambioItem[];
}

/**
 * Historial de versiones (línea de tiempo) de la plataforma. Solo admin.
 * Por plataforma (web / app móvil): cada versión con su fecha, los cambios
 * etiquetados (nuevo/mejora/arreglo/seguridad) y una acción — web: abrir esa
 * versión del sitio; móvil: descargar ese APK. Filtro por tipo de cambio.
 */
@Component({
  selector: 'app-historial-versiones',
  imports: [Skeleton, BarChart, DonutChart],
  templateUrl: './historial-versiones.html',
  styleUrl: './historial-versiones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminHistorialVersiones implements OnInit {
  private service = inject(AppVersionesService);

  formatFecha = formatFechaDisplay;
  formatFechaHora = formatFechaHumana; // X7 — fecha + hora
  readonly TAGS = TAGS;
  readonly CAMBIO_META = CAMBIO_META;

  private todas = signal<AppVersion[]>([]);
  loading = signal(true);
  error = signal('');
  plataforma = signal<Plataforma>('web');
  filtro = signal<CambioTag | null>(null);

  totalWeb = computed(() => this.todas().filter((v) => v.plataforma === 'web').length);
  totalMovil = computed(() => this.todas().filter((v) => v.plataforma === 'movil').length);

  /** Z27 — KPIs de la plataforma activa: total, última versión + fecha, conteo por tipo y releases 30/90 días. */
  kpis = computed(() => {
    const list = this.todas().filter((v) => v.plataforma === this.plataforma());
    const porTipo: Record<CambioTag, number> = { nuevo: 0, mejora: 0, arreglo: 0, seguridad: 0 };
    for (const v of list) {
      for (const c of v.cambios ?? []) {
        if (c.t in porTipo) porTipo[c.t as CambioTag]++;
      }
    }
    const ultima = list[0] ?? null; // getHistorial ya viene ordenado desc
    const now = Date.now();
    const dias = (v: AppVersion) => {
      const raw = v.created_at ?? v.fecha;
      if (!raw) return Infinity;
      const t = new Date(raw).getTime();
      return Number.isNaN(t) ? Infinity : (now - t) / 86_400_000;
    };
    return {
      total: list.length,
      ultimaVersion: ultima?.version ?? null,
      ultimaFecha: ultima?.created_at ?? ultima?.fecha ?? null,
      porTipo,
      totalCambios: Object.values(porTipo).reduce((a, b) => a + b, 0),
      releases30: list.filter((v) => dias(v) <= 30).length,
      releases90: list.filter((v) => dias(v) <= 90).length,
    };
  });

  /** Z27 — versión actual de AMBAS plataformas, mostradas a la vez (getHistorial viene ordenado desc). */
  ultimaWeb = computed(() => this.todas().find((v) => v.plataforma === 'web')?.version ?? null);
  ultimaMovil = computed(() => this.todas().find((v) => v.plataforma === 'movil')?.version ?? null);

  /** Z27 — mini-gráfico: releases por mes (últimos 6 meses) de la plataforma activa. */
  chartPorMes = computed<BarDatum[]>(() => {
    const list = this.todas().filter((v) => v.plataforma === this.plataforma());
    const conteo = new Map<string, number>();
    for (const v of list) {
      const raw = v.created_at ?? v.fecha;
      if (!raw || raw.length < 7) continue;
      const key = raw.slice(0, 7); // "YYYY-MM"
      conteo.set(key, (conteo.get(key) ?? 0) + 1);
    }
    const now = new Date();
    const bars: BarDatum[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      bars.push({
        label: `${MESES_CORTOS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
        value: conteo.get(key) ?? 0,
      });
    }
    return bars;
  });

  /** Z27 — mini-gráfico: distribución por tipo de cambio de la plataforma activa. */
  chartPorTipo = computed<DonutDatum[]>(() => {
    const { porTipo } = this.kpis();
    return TAGS.map((t) => ({ label: this.tagLabel(t), value: porTipo[t], color: TAG_COLORS[t] })).filter((d) => d.value > 0);
  });

  /** Versiones de la plataforma activa, aplicando el filtro de tipo de cambio. */
  versiones = computed<VersionVista[]>(() => {
    const f = this.filtro();
    return this.todas()
      .filter((v) => v.plataforma === this.plataforma())
      .map((v) => ({
        ...v,
        cambiosVisibles: f ? (v.cambios ?? []).filter((c) => c.t === f) : (v.cambios ?? []),
      }))
      // Sin filtro: mostrar TODAS (incluye versiones auto-registradas que solo
      // traen `notas` y aún no tienen cambios etiquetados). Con filtro activo:
      // solo las que tienen cambios de ese tipo.
      .filter((v) => (f ? v.cambiosVisibles.length > 0 : true));
  });

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.todas.set(await this.service.getHistorial());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }

  setPlataforma(p: Plataforma) {
    this.plataforma.set(p);
    this.filtro.set(null);
  }

  toggleFiltro(t: CambioTag) {
    this.filtro.update((f) => (f === t ? null : t));
  }

  tagLabel(t: string): string {
    return CAMBIO_META[t]?.label ?? t;
  }
}
