import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/**
 * CP2/CP3 — "Conversaciones de Compa": vista de admin para revisar lo que la
 * gente habla con el asistente, con marcas automáticas (contradicción, prometió
 * y no hizo, herramienta con error) derivadas de sgc.assistant_acciones. Cada
 * vez que se abre el detalle de una conversación queda en assistant_acciones
 * (tool='admin_vio_conversacion') — RPC compa_conversacion_admin lo hace solo.
 */
interface ConversacionAdmin {
  conversacion_id: string;
  usuario_id: string;
  usuario_nombre: string;
  titulo: string | null;
  created_at: string;
  updated_at: string;
  mensajes_n: number;
  contradicciones: number;
  promesas_sin_accion: number;
  errores_tool: number;
}
interface MensajeAdmin {
  mensaje_id: string;
  rol: 'user' | 'assistant';
  contenido: string;
  herramientas: { tool: string; ok: boolean }[] | null;
  created_at: string;
  es_contradiccion: boolean;
  es_promesa_sin_accion: boolean;
}

@Component({
  selector: 'app-admin-compa-conversaciones',
  imports: [DatePipe, FormsModule, TranslatePipe],
  templateUrl: './compa-conversaciones.html',
  styleUrl: './compa-conversaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCompaConversaciones implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  loading = signal(true);
  error = signal('');
  lista = signal<ConversacionAdmin[]>([]);
  seleccion = signal<ConversacionAdmin | null>(null);
  mensajes = signal<MensajeAdmin[]>([]);
  cargandoDetalle = signal(false);

  soloConProblemas = signal(true);
  filtroUsuario = signal<string>('');

  // KPIs de los últimos 7 días (sobre la lista cargada, sin filtrar por el toggle).
  todas = signal<ConversacionAdmin[]>([]);
  conteos = computed(() => {
    const hace7d = Date.now() - 7 * 86_400_000;
    const recientes = this.todas().filter((c) => new Date(c.created_at).getTime() >= hace7d);
    return {
      total7d: recientes.length,
      contradicciones: recientes.filter((c) => c.contradicciones > 0).length,
      promesas: recientes.filter((c) => c.promesas_sin_accion > 0).length,
      errores: recientes.filter((c) => c.errores_tool > 0).length,
    };
  });

  listaVisible = computed(() => {
    const q = this.filtroUsuario().trim().toLowerCase();
    return this.lista().filter((c) => !q || c.usuario_nombre.toLowerCase().includes(q));
  });

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data: todas, error: e1 } = await this.supabase.client.rpc('compa_conversaciones_admin', {
        p_usuario_id: null, p_desde: null, p_hasta: null, p_solo_con_problemas: false, p_limite: 300,
      });
      if (e1) throw e1;
      this.todas.set((todas ?? []) as ConversacionAdmin[]);
      this.aplicarFiltroProblemas();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la lista.');
    } finally {
      this.loading.set(false);
    }
  }

  private aplicarFiltroProblemas() {
    const base = this.todas();
    this.lista.set(this.soloConProblemas()
      ? base.filter((c) => c.contradicciones > 0 || c.promesas_sin_accion > 0 || c.errores_tool > 0)
      : base);
  }

  toggleConProblemas() {
    this.soloConProblemas.update((v) => !v);
    this.aplicarFiltroProblemas();
  }

  async abrir(c: ConversacionAdmin) {
    this.seleccion.set(c);
    this.cargandoDetalle.set(true);
    this.mensajes.set([]);
    try {
      const { data, error } = await this.supabase.client.rpc('compa_conversacion_admin', { p_id: c.conversacion_id });
      if (error) throw error;
      this.mensajes.set((data ?? []) as MensajeAdmin[]);
    } catch (e) {
      this.toast.error('No se pudo abrir', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargandoDetalle.set(false);
    }
  }

  async guardarComoCaso(m: MensajeAdmin) {
    const sel = this.seleccion();
    if (!sel) return;
    try {
      const { error } = await this.supabase.client.rpc('compa_guardar_caso_prueba', {
        p_conversacion_id: sel.conversacion_id, p_mensaje_id: m.mensaje_id, p_mensaje: m.contenido, p_nota: null,
      });
      if (error) throw error;
      this.toast.success('Guardado', 'Queda en el backlog de casos de prueba para curar en los evals.');
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    }
  }

  async enviarAConsultas(m: MensajeAdmin) {
    const sel = this.seleccion();
    if (!sel) return;
    try {
      const motivo = m.es_contradiccion || m.es_promesa_sin_accion ? 'sin_tool' : 'error_de_tool';
      const { error } = await this.supabase.client.rpc('compa_enviar_a_consultas', {
        p_conversacion_id: sel.conversacion_id, p_pregunta: m.contenido, p_motivo: motivo,
      });
      if (error) throw error;
      this.toast.success('Enviado', 'Ya está en Consultas de Compa.');
    } catch (e) {
      this.toast.error('No se pudo enviar', e instanceof Error ? e.message : undefined);
    }
  }
}
