import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EstadisticasService, EstadisticasUso, DispositivoUsuario } from '../../../../shared/services/estadisticas.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaHumana } from '../../../../shared/utils/fecha.util';

/**
 * AQ7 — Sistema > Estadísticas: uso de la web y la app (usuarios activos D/S/M,
 * split web-vs-app, distribución de dispositivos y versiones). Gating es_tecnologia().
 */
@Component({
  selector: 'app-tec-estadisticas',
  imports: [DecimalPipe, FormsModule, Skeleton],
  templateUrl: './estadisticas.html',
  styleUrl: './estadisticas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecEstadisticas implements OnInit {
  private service = inject(EstadisticasService);

  readonly formatFechaHora = formatFechaHumana;

  data = signal<EstadisticasUso | null>(null);
  loading = signal(true);
  error = signal('');

  // AR2 — dispositivos por usuario
  dispositivos = signal<DispositivoUsuario[]>([]);
  busqueda = signal('');
  filtroPlataforma = signal<string>('');
  filtroRol = signal<string>('');
  expandido = signal<string | null>(null);

  /** Plataformas presentes (para el filtro). */
  plataformas = computed(() => {
    const set = new Set<string>();
    for (const d of this.dispositivos()) if (d.plataforma) set.add(d.plataforma);
    return [...set].sort();
  });

  /** Roles presentes (para el filtro). */
  roles = computed(() => {
    const set = new Set<string>();
    for (const d of this.dispositivos()) for (const r of d.roles) set.add(r);
    return [...set].sort();
  });

  dispositivosFiltrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const plat = this.filtroPlataforma();
    const rol = this.filtroRol();
    return this.dispositivos().filter((d) => {
      if (plat && d.plataforma !== plat) return false;
      if (rol && !d.roles.includes(rol)) return false;
      if (q) {
        const hay = `${d.nombre} ${d.email ?? ''} ${d.modelo ?? ''} ${d.roles.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  toggleExpandido(id: string) {
    this.expandido.set(this.expandido() === id ? null : id);
  }

  // Total para calcular porcentajes de la distribución de dispositivos.
  private totalDispositivos = computed(() =>
    (this.data()?.dispositivos ?? []).reduce((s, d) => s + d.total, 0),
  );

  pctDispositivo(total: number): number {
    const t = this.totalDispositivos();
    return t > 0 ? Math.round((100 * total) / t) : 0;
  }

  plataformaLabel(p: string): string {
    switch (p) {
      case 'android': return 'Android (app)';
      case 'ios': return 'iPhone (app)';
      case 'ios-pwa': return 'iPhone (PWA)';
      case 'web': return 'Web';
      default: return p;
    }
  }

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
