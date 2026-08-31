import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

/**
 * BE2 — "Consultas no atendidas de Compa": el backlog automático de lo que la
 * gente le pide a Compa y no puede responder (sin herramienta / error / sin
 * permiso). Sustituye las capturas a mano de Xaviel: la próxima tanda de
 * capacidades de Compa sale de estos datos, no de screenshots. Gate: es_tecnologia.
 */
interface ConsultaNoAtendida {
  id: string;
  pregunta: string;
  motivo: 'sin_tool' | 'error_de_tool' | 'sin_permiso';
  tool: string | null;
  detalle: string | null;
  usuario_nombre: string | null;
  roles_snapshot: string | null;
  conversacion_id: string | null;
  resuelto: boolean;
  created_at: string;
}
interface Conteos {
  total: number;
  sin_tool: number;
  error_de_tool: number;
  sin_permiso: number;
  pendientes: number;
  ultimos_7d: number;
}

@Component({
  selector: 'app-tec-consultas-compa',
  imports: [DatePipe],
  templateUrl: './consultas-compa.html',
  styleUrl: './consultas-compa.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecConsultasCompa implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  filas = signal<ConsultaNoAtendida[]>([]);
  conteos = signal<Conteos | null>(null);
  loading = signal(true);
  error = signal('');

  // Filtros.
  filtroMotivo = signal<'todos' | 'sin_tool' | 'error_de_tool' | 'sin_permiso'>('todos');
  soloPendientes = signal(false);

  filasVisibles = computed(() => {
    const m = this.filtroMotivo();
    const p = this.soloPendientes();
    return this.filas().filter(
      (f) => (m === 'todos' || f.motivo === m) && (!p || !f.resuelto),
    );
  });

  motivoLabel(m: string): string {
    return m === 'sin_tool'
      ? 'Sin herramienta'
      : m === 'error_de_tool'
        ? 'Error de herramienta'
        : m === 'sin_permiso'
          ? 'Sin permiso'
          : m;
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [{ data: conteos }, { data: filas, error: e2 }] = await Promise.all([
        this.supabase.client.rpc('consultas_no_atendidas_conteos'),
        this.supabase.client.rpc('consultas_no_atendidas_listado', {
          p_motivo: null,
          p_solo_pendientes: false,
          p_limite: 300,
        }),
      ]);
      if (e2) throw e2;
      this.conteos.set((conteos as Conteos) ?? null);
      this.filas.set((filas as ConsultaNoAtendida[]) ?? []);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el backlog.');
    } finally {
      this.loading.set(false);
    }
  }

  setMotivo(m: 'todos' | 'sin_tool' | 'error_de_tool' | 'sin_permiso') {
    this.filtroMotivo.set(m);
  }

  togglePendientes() {
    this.soloPendientes.update((v) => !v);
  }

  async resolver(f: ConsultaNoAtendida, resuelto: boolean) {
    try {
      const { error } = await this.supabase.client.rpc('consulta_no_atendida_resolver', {
        p_id: f.id,
        p_resuelto: resuelto,
      });
      if (error) throw error;
      this.filas.update((fs) =>
        fs.map((x) => (x.id === f.id ? { ...x, resuelto } : x)),
      );
      this.toast.success(resuelto ? 'Marcada como resuelta' : 'Reabierta');
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }
}
