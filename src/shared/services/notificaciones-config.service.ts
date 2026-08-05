import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AG14 — configuración de qué eventos notifican y por qué canal (admin). */
export interface NotificacionEventoConfig {
  evento: string;
  descripcion: string | null;
  in_app: boolean;
  push: boolean;
  email: boolean;
  activo: boolean;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesConfigService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<NotificacionEventoConfig[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('notificaciones_config')
      .select('*')
      .order('evento');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as NotificacionEventoConfig[];
  }

  async update(evento: string, patch: Partial<Pick<NotificacionEventoConfig, 'in_app' | 'push' | 'email' | 'activo'>>): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('notificaciones_config')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('evento', evento);
    if (error) throw new Error(error.message);
  }
}
