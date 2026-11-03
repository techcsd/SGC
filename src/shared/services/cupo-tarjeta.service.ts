import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** DI4 — cupo opcional por tarjeta de combustible + solicitudes manuales de los choferes. */

export type EstadoSolicitudCupo = 'pendiente' | 'ampliada' | 'rechazada' | 'cancelada';
export type MotivoSolicitudCupo = 'llego_limite' | 'bomba_rechazo' | 'pocos_galones' | 'otro';

export interface SolicitudCupoRow {
  id: string;
  codigo_tarjeta: string;
  vehiculo_id: string | null;
  vehiculo_placa: string | null;
  solicitante_id: string;
  solicitante_nombre: string | null;
  galones_pedidos: number | null;
  monto_pedido: number | null;
  motivo: MotivoSolicitudCupo;
  nota: string | null;
  foto_rechazo_path: string | null;
  estado: EstadoSolicitudCupo;
  respuesta: string | null;
  nuevo_cupo_gal: number | null;
  nuevo_cupo_monto: number | null;
  atendida_por: string | null;
  atendida_at: string | null;
  es_prueba: boolean;
  created_at: string;
}

export interface CupoTarjetaRow {
  codigo_tarjeta: string;
  titular_nombre: string | null;
  es_persona: boolean;
  vehiculo_id: string | null;
  vehiculo_placa: string | null;
  cupo_gal: number | null;
  cupo_monto: number | null;
  cupo_dia_corte: number | null;
  periodo: string;
  consumo_gal: number;
  consumo_monto: number;
  pct_gal: number | null;
  pct_monto: number | null;
}

@Injectable({ providedIn: 'root' })
export class CupoTarjetaService {
  private supabase = inject(SupabaseService);

  async solicitudesListado(estado: EstadoSolicitudCupo | null = null): Promise<SolicitudCupoRow[]> {
    const { data, error } = await this.supabase.client.schema('sgc')
      .rpc('combustible_solicitudes_cupo_listado', { p_estado: estado });
    if (error) throw new Error(error.message);
    return (data ?? []) as SolicitudCupoRow[];
  }

  async tarjetasListado(): Promise<CupoTarjetaRow[]> {
    const { data, error } = await this.supabase.client.schema('sgc').rpc('combustible_cupo_tarjetas_listado');
    if (error) throw new Error(error.message);
    return (data ?? []) as CupoTarjetaRow[];
  }

  async atender(id: string, estado: 'ampliada' | 'rechazada', respuesta: string | null, nuevoCupoGal: number | null, nuevoCupoMonto: number | null): Promise<void> {
    const { error } = await this.supabase.client.schema('sgc').rpc('atender_solicitud_cupo', {
      p_solicitud_id: id, p_estado: estado, p_respuesta: respuesta,
      p_nuevo_cupo_gal: nuevoCupoGal, p_nuevo_cupo_monto: nuevoCupoMonto,
    });
    if (error) throw new Error(error.message);
  }

  async editarCupo(codigoTarjeta: string, cupoGal: number | null, cupoMonto: number | null, cupoDiaCorte: number | null): Promise<void> {
    const { error } = await this.supabase.client.schema('sgc').rpc('editar_cupo_tarjeta', {
      p_codigo_tarjeta: codigoTarjeta, p_cupo_gal: cupoGal, p_cupo_monto: cupoMonto, p_cupo_dia_corte: cupoDiaCorte,
    });
    if (error) throw new Error(error.message);
  }
}
