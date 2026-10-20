import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonDirective } from '../../../../shared/ui/button/button.directive';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { environment } from '../../../../environments/environment';
import { edgeErrorMessage } from '../../../../shared/utils/edge.util';

interface MiConexion {
  conectado: boolean;
  desde: string | null;
  ultima_actividad: string | null;
  consultas_7d: number;
  borradores_pendientes: number;
}
interface Llamada {
  herramienta: string;
  ok: boolean;
  creado_en: string;
}

/** CR1 (FASE 6) — Perfil › Claude (mock `Perfil-claude`). */
@Component({
  selector: 'app-configuracion-claude',
  imports: [ButtonDirective, TranslatePipe, RouterLink],
  templateUrl: './configuracion-claude.html',
  styleUrl: './configuracion-claude.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionClaude implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  enlace = `${environment.supabaseUrl}/functions/v1/mcp`;
  cargando = signal(true);
  conexion = signal<MiConexion | null>(null);
  llamadas = signal<Llamada[]>([]);
  mostrarActividad = signal(false);
  desconectando = signal(false);
  copiado = signal(false);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const { data } = await this.supabase.client.rpc('claude_mi_conexion');
      this.conexion.set(data as MiConexion);
    } catch {
      /* best-effort */
    } finally {
      this.cargando.set(false);
    }
  }

  async verActividad() {
    this.mostrarActividad.update((v) => !v);
    if (!this.mostrarActividad() || this.llamadas().length) return;
    const { data } = await this.supabase.client
      .from('claude_llamadas')
      .select('herramienta, ok, creado_en')
      .order('creado_en', { ascending: false })
      .limit(10);
    this.llamadas.set((data as Llamada[]) ?? []);
  }

  async copiarEnlace() {
    try {
      await navigator.clipboard.writeText(this.enlace);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    } catch {
      this.toast.error('No se pudo copiar. Copia el enlace manualmente.');
    }
  }

  async desconectar() {
    if (this.desconectando()) return;
    this.desconectando.set(true);
    try {
      const { data, error } = await this.supabase.client.functions.invoke('claude-conexiones', {
        body: { accion: 'desconectar' },
      });
      if (error) throw new Error(await edgeErrorMessage(error));
      this.toast.success('Claude desconectado del SGC.');
      await this.cargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo desconectar');
    } finally {
      this.desconectando.set(false);
    }
  }
}
