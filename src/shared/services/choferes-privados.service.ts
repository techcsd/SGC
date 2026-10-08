import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** CJ12 — gestión de choferes privados (Flota). */
export interface VehiculoAutorizado {
  autorizacion_id: string;
  vehiculo_id: string;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  desde: string;
  hasta: string | null;
}
export interface ChoferPrivado {
  usuario_id: string;
  nombre: string;
  cedula: string | null;
  telefono: string | null;
  autorizadas: VehiculoAutorizado[];
  en_uso: { vehiculo_id: string; placa: string | null; marca: string | null; modelo: string | null; desde: string } | null;
  ultimo_uso_at: string | null;
  n_autorizadas: number;
}

@Injectable({ providedIn: 'root' })
export class ChoferesPrivadosService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<ChoferPrivado[]> {
    const { data, error } = await this.supabase.client.rpc('listar_choferes_privados');
    if (error) throw error;
    return (data ?? []) as ChoferPrivado[];
  }

  async autorizarLote(usuarioId: string, vehiculos: string[], desde: string | null, hasta: string | null, nota: string | null): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('autorizar_vehiculos_privado_lote', {
      p_usuario: usuarioId,
      p_vehiculos: vehiculos,
      p_desde: desde,
      p_hasta: hasta,
      p_nota: nota,
    });
    if (error) throw error;
    return (data as number) ?? 0;
  }

  async retirar(autorizacionId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('retirar_vehiculo_privado', { p_id: autorizacionId });
    if (error) throw error;
  }

  async hacerPrivado(usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('hacer_conductor', { p_usuario: usuarioId, p_rol: 'chofer_privado' });
    if (error) throw error;
  }
}
