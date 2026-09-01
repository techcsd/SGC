import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AT23 — parámetro de notificación editable (CSV de roles). */
export interface NotifParam {
  clave: string;
  etiqueta: string;
  descripcion: string;
  valor: string; // CSV de códigos de rol
}

/** AT23 — matriz de notificaciones administrable (quién recibe qué, por rol). */
@Injectable({ providedIn: 'root' })
export class NotifMatrizService {
  private supabase = inject(SupabaseService);

  async config(): Promise<NotifParam[]> {
    const { data, error } = await this.supabase.client.rpc('notif_config');
    if (error) throw new Error(error.message);
    return (data ?? []) as NotifParam[];
  }

  async setParam(clave: string, valor: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_notif_param', { p_clave: clave, p_valor: valor });
    if (error) throw new Error(error.message);
  }

  /** BF4 — traza de entregas recientes (diagnóstico "no me llegó"). */
  async entregasRecientes(limite = 100): Promise<NotifEntrega[]> {
    const { data, error } = await this.supabase.client.rpc('notif_entregas_recientes', { p_limite: limite });
    if (error) throw new Error(error.message);
    return (data ?? []) as NotifEntrega[];
  }
}

/** BF4 — una fila de la traza de entrega de notificaciones. */
export interface NotifEntrega {
  canal: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  tipo: string | null;
  titulo: string | null;
  destino: string | null;
  estado: 'enviada' | 'entregada' | 'fallida' | 'omitida';
  motivo: string | null;
  created_at: string;
}
