import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { edgeErrorMessage } from '../../../../shared/utils/edge.util';

interface Resumen {
  personas_conectadas: number;
  consultas_7d: number;
  borradores_preparados: number;
  borradores_confirmados: number;
  con_error_7d: number;
}
interface Conexion {
  usuario_id: string;
  nombre: string;
  conectado_desde: string;
  ultima_actividad: string;
  consultas_7d: number;
  total_llamadas: number;
}
interface LlamadaReciente {
  hora: string;
  nombre: string;
  herramienta: string;
  ok: boolean;
  error: string | null;
  usuario_id: string;
  total: number;
}
interface FiltrosDisponibles {
  herramientas: string[];
  personas: { id: string; nombre: string }[];
}

/** CR1 (FASE 6) — Admin › Claude (mock `Admin-claude`). */
@Component({
  selector: 'app-admin-claude',
  imports: [TranslatePipe, DatePipe, RouterLink],
  templateUrl: './admin-claude.html',
  styleUrl: './admin-claude.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminClaude implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  cargando = signal(true);
  activo = signal(true);
  cambiandoActivo = signal(false);
  resumen = signal<Resumen | null>(null);
  conexiones = signal<Conexion[]>([]);
  llamadas = signal<LlamadaReciente[]>([]);
  revocando = signal<string | null>(null);

  // CX1 — hoy solo se veían las últimas 20 llamadas (sin filtro de error,
  // herramienta o persona), por eso los "con error" de la semana nunca se
  // llegaban a ver si no estaban entre esas 20 (casi todas de un solo usuario).
  filtros = signal<FiltrosDisponibles>({ herramientas: [], personas: [] });
  soloError = signal(false);
  filtroHerramienta = signal<string>('');
  filtroPersona = signal<string>('');
  readonly PAGE_SIZE = 20;
  pagina = signal(0);
  cargandoLlamadas = signal(false);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const [{ data: param }, { data: resumen }, { data: conexiones }, { data: filtros }] = await Promise.all([
        this.supabase.client.from('parametros').select('valor').eq('clave', 'claude_conector_activo').maybeSingle(),
        this.supabase.client.rpc('claude_admin_resumen'),
        this.supabase.client.rpc('claude_conexiones_listado'),
        this.supabase.client.rpc('claude_llamadas_filtros_disponibles'),
      ]);
      this.activo.set((param?.valor ?? 'true') === 'true');
      this.resumen.set(resumen as Resumen);
      this.conexiones.set((conexiones as Conexion[]) ?? []);
      this.filtros.set((filtros as FiltrosDisponibles) ?? { herramientas: [], personas: [] });
      await this.cargarLlamadas();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo cargar');
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarLlamadas(append = false) {
    this.cargandoLlamadas.set(true);
    try {
      const { data: llamadas, error } = await this.supabase.client.rpc('claude_llamadas_recientes', {
        p_limite: this.PAGE_SIZE,
        p_solo_error: this.soloError(),
        p_herramienta: this.filtroHerramienta() || null,
        p_usuario: this.filtroPersona() || null,
        p_offset: this.pagina() * this.PAGE_SIZE,
      });
      if (error) throw error;
      const nuevas = (llamadas as LlamadaReciente[]) ?? [];
      this.llamadas.set(append ? [...this.llamadas(), ...nuevas] : nuevas);
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudieron cargar las llamadas');
    } finally {
      this.cargandoLlamadas.set(false);
    }
  }

  totalLlamadas = computed(() => this.llamadas()[0]?.total ?? 0);
  hayMas = computed(() => (this.pagina() + 1) * this.PAGE_SIZE < this.totalLlamadas());

  /** El contador "Con error (7 días)" del resumen abre esta misma vista filtrada. */
  async verSoloErrores() {
    this.soloError.set(true);
    this.pagina.set(0);
    await this.cargarLlamadas();
  }

  async onSoloError(v: boolean) {
    this.soloError.set(v);
    this.pagina.set(0);
    await this.cargarLlamadas();
  }
  async onFiltroHerramienta(v: string) {
    this.filtroHerramienta.set(v);
    this.pagina.set(0);
    await this.cargarLlamadas();
  }
  async onFiltroPersona(v: string) {
    this.filtroPersona.set(v);
    this.pagina.set(0);
    await this.cargarLlamadas();
  }
  async verMas() {
    this.pagina.update((p) => p + 1);
    await this.cargarLlamadas(true);
  }

  async toggleActivo() {
    if (this.cambiandoActivo()) return;
    this.cambiandoActivo.set(true);
    const nuevo = !this.activo();
    try {
      const { error } = await this.supabase.client
        .from('parametros')
        .update({ valor: String(nuevo) })
        .eq('clave', 'claude_conector_activo');
      if (error) throw error;
      this.activo.set(nuevo);
      this.toast.success(nuevo ? 'Conector de Claude activado.' : 'Conector de Claude apagado.');
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo cambiar el interruptor');
    } finally {
      this.cambiandoActivo.set(false);
    }
  }

  async revocar(usuarioId: string, nombre: string) {
    if (!confirm(`¿Revocar la conexión de Claude de ${nombre}?`)) return;
    this.revocando.set(usuarioId);
    try {
      const { data, error } = await this.supabase.client.functions.invoke('claude-conexiones', {
        body: { accion: 'revocar', usuario_id: usuarioId },
      });
      if (error) throw new Error(await edgeErrorMessage(error));
      this.toast.success(`Conexión de ${nombre} revocada.`);
      await this.cargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo revocar');
    } finally {
      this.revocando.set(null);
    }
  }
}
