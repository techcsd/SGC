import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { MODULOS_DISPONIBLES } from '../../../shared/services/roles.service';
import { TareasService } from '../../../shared/services/tareas.service';
import { ReportesUsuarioService } from '../../../shared/services/reportes-usuario.service';
import { Tarea } from '../../../shared/models/tarea.model';
import { ReporteUsuario } from '../../../shared/models/reporte-usuario.model';
import { DonutChart, DonutDatum } from '../../../shared/ui/donut-chart/donut-chart';
import { BarChart, BarDatum } from '../../../shared/ui/bar-chart/bar-chart';

interface ActividadItem {
  fecha: string;
  icono: string;
  texto: string;
  tipo: string;
}

@Component({
  selector: 'app-perfil',
  imports: [DatePipe, RouterLink, DonutChart, BarChart],
  templateUrl: './perfil.html',
  styleUrl: './perfil.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Perfil implements OnInit {
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);
  private tareasService = inject(TareasService);
  private reportesService = inject(ReportesUsuarioService);

  profile = this.userService.profile;
  avatarUrl = this.userService.avatarUrl;

  uploading = signal(false);
  error = signal('');
  loadingStats = signal(true);

  private tareas = signal<Tarea[]>([]);
  private reportes = signal<ReporteUsuario[]>([]);
  bitacorasCount = signal(0);

  roles = computed(() => this.profile()?.roles?.map((r) => r.rol) ?? []);

  // ── Stat tiles ───────────────────────────────────────────
  tareasActivas = computed(() => this.tareas().filter((t) => t.estado === 'pendiente' || t.estado === 'en_progreso').length);
  tareasCompletadas = computed(() => this.tareas().filter((t) => t.estado === 'completada').length);
  reportesEnviados = computed(() => this.reportes().length);

  // ── Charts ───────────────────────────────────────────────
  tareasPorEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      pendiente: '#64748b', en_progreso: '#1F4E79', completada: '#2D7D46', cancelada: '#C0392B',
    };
    const labels: Record<string, string> = {
      pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', cancelada: 'Cancelada',
    };
    return (['pendiente', 'en_progreso', 'completada', 'cancelada'] as const)
      .map((e) => ({ label: labels[e], value: this.tareas().filter((t) => t.estado === e).length, color: colors[e] }))
      .filter((d) => d.value > 0);
  });

  tareasPorPrioridad = computed<BarDatum[]>(() => {
    const colors: Record<string, string> = {
      urgente: 'var(--sgc-danger)', alta: 'var(--sgc-warning)', media: 'var(--sgc-primary)', baja: '#64748b',
    };
    const labels: Record<string, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Media', baja: 'Baja' };
    return (['urgente', 'alta', 'media', 'baja'] as const)
      .map((p) => ({ label: labels[p], value: this.tareas().filter((t) => t.prioridad === p).length, color: colors[p] }))
      .filter((d) => d.value > 0);
  });

  // ── Activity feed (recent tasks + reports) ───────────────
  actividad = computed<ActividadItem[]>(() => {
    const items: ActividadItem[] = [];
    for (const t of this.tareas()) {
      items.push({ fecha: t.created_at, icono: '📋', tipo: 'tarea', texto: `Tarea asignada: ${t.titulo}` });
      if (t.fecha_completada) {
        items.push({ fecha: t.fecha_completada, icono: '✅', tipo: 'tarea', texto: `Tarea completada: ${t.titulo}` });
      }
    }
    for (const r of this.reportes()) {
      items.push({ fecha: r.created_at, icono: '💬', tipo: 'reporte', texto: `Reporte enviado: ${r.asunto}` });
    }
    return items.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 15);
  });

  async ngOnInit() {
    const userId = this.profile()?.id;
    if (!userId) {
      this.loadingStats.set(false);
      return;
    }
    this.loadingStats.set(true);
    try {
      const [tareas, reportes, bitacoras] = await Promise.all([
        this.tareasService.getAsignadasA(userId),
        this.reportesService.getMisReportes(),
        this.supabase.client.from('bitacoras').select('id', { count: 'exact', head: true }).eq('usuario_id', userId),
      ]);
      this.tareas.set(tareas);
      this.reportes.set(reportes);
      this.bitacorasCount.set(bitacoras.count ?? 0);
    } catch {
      // stats are best-effort; profile still renders
    } finally {
      this.loadingStats.set(false);
    }
  }

  async onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploading.set(true);
    this.error.set('');
    try {
      await this.userService.uploadAvatar(file);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al subir la imagen.');
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  iniciales(): string {
    const nombre = this.profile()?.nombre ?? '';
    return nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  moduloLabel(key: string): string {
    return MODULOS_DISPONIBLES.find((m) => m.key === key)?.label ?? key;
  }
}
