import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';

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

/** CK1/CK2 — ficha (detalle) del chofer privado. */
export interface ChoferPrivadoDetalle {
  chofer: { usuario_id: string; nombre: string; cedula: string | null; telefono: string | null };
  vigencias: {
    autorizacion_id: string; vehiculo_id: string; placa: string | null; marca: string | null;
    modelo: string | null; desde: string; hasta: string | null; activa: boolean; vigente: boolean;
  }[];
  usos: {
    id: string; vehiculo_id: string; placa: string | null; marca: string | null; modelo: string | null;
    inicio_at: string; fin_at: string | null; km_inicio: number | null; km_fin: number | null;
    recibido_de: string | null; activa: boolean;
  }[];
  entregas: {
    id: string; vehiculo_id: string; placa: string | null; tipo: string; estado: string;
    km: number | null; tiene_danos: boolean; observacion: string | null; capturado_en: string; fotos: string[];
  }[];
  echadas: {
    id: string; fecha: string; vehiculo_id: string; placa: string | null; galones: number | null;
    monto: number | null; kilometraje: number | null; foto_recibo_path: string | null;
    foto_tablero_path: string | null; foto_origen: string | null;
  }[];
  inspecciones: {
    id: string; fecha: string; tipo: string; vehiculo_id: string; placa: string | null;
    kilometraje: number | null; tiene_criticos: boolean; atendido: boolean;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ChoferesPrivadosService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);
  /** Las fotos de flota (echadas, entregas, inspecciones) viven en el bucket `vehiculos`. */
  private readonly BUCKET = 'vehiculos';

  async detalle(usuarioId: string): Promise<ChoferPrivadoDetalle> {
    const { data, error } = await this.supabase.client.rpc('chofer_privado_detalle', { p_usuario_id: usuarioId });
    if (error) throw error;
    return data as ChoferPrivadoDetalle;
  }

  /** URL firmada de una foto de flota (bucket `vehiculos`). */
  async fotoUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    return this.cache.signed(this.BUCKET, path);
  }

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
