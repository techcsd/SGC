import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

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
}

/** CR1 (FASE 6) — Admin › Claude (mock `Admin-claude`). */
@Component({
  selector: 'app-admin-claude',
  imports: [TranslatePipe, DatePipe],
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

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const [{ data: param }, { data: resumen }, { data: conexiones }, { data: llamadas }] = await Promise.all([
        this.supabase.client.from('parametros').select('valor').eq('clave', 'claude_conector_activo').maybeSingle(),
        this.supabase.client.rpc('claude_admin_resumen'),
        this.supabase.client.rpc('claude_conexiones_listado'),
        this.supabase.client.rpc('claude_llamadas_recientes', { p_limite: 20 }),
      ]);
      this.activo.set((param?.valor ?? 'true') === 'true');
      this.resumen.set(resumen as Resumen);
      this.conexiones.set((conexiones as Conexion[]) ?? []);
      this.llamadas.set((llamadas as LlamadaReciente[]) ?? []);
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo cargar');
    } finally {
      this.cargando.set(false);
    }
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
      if (error) throw error;
      this.toast.success(`Conexión de ${nombre} revocada.`);
      await this.cargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo revocar');
    } finally {
      this.revocando.set(null);
    }
  }
}
