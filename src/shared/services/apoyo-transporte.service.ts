import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';
import { NotificacionesService } from './notificaciones.service';

// CK12 — "Apoyo de transporte" (evoluciona solicitudes_movimiento).
export type TipoApoyo = 'movimiento_interno' | 'retiro_material' | 'bote';
export type EstadoApoyo =
  | 'pendiente' | 'asignada' | 'en_proceso' | 'por_confirmar' | 'completada' | 'cancelada';

export interface ApoyoRow {
  id: string;
  tipo_apoyo: TipoApoyo;
  proyecto_id: string | null;
  proyecto: string | null;
  dia: string | null;
  descripcion: string | null;
  estado: EstadoApoyo;
  solicitante: string | null;
  conductor_id: string | null;
  ruta_id: string | null;
  foto_path: string | null;
  created_at: string;
}

export interface ApoyoEvento { de: string | null; a: string | null; nota: string | null; por: string | null; created_at: string; }
export interface ApoyoFoto { id: string; path: string; }
export interface ApoyoDetalle extends ApoyoRow {
  destino_tipo: string | null;
  destino_texto: string | null;
  fotos: ApoyoFoto[];
  eventos: ApoyoEvento[];
}

export interface CrearApoyo {
  tipo_apoyo: TipoApoyo;
  proyecto_id: string | null;
  dia: string | null;
  descripcion: string;
  destino_tipo?: string | null;
  destino_texto?: string | null;
  destino_bodega_id?: string | null;
  destino_proyecto_id?: string | null;
  es_danado?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApoyoTransporteService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);
  private notificaciones = inject(NotificacionesService);
  private readonly BUCKET = 'apoyo-transporte';

  async listar(f?: { tipo?: string | null; estado?: string | null; proyectoId?: string | null; dia?: string | null }): Promise<ApoyoRow[]> {
    const { data, error } = await this.supabase.client.rpc('apoyo_transporte_listado', {
      p_tipo: f?.tipo ?? null,
      p_estado: f?.estado ?? null,
      p_proyecto_id: f?.proyectoId ?? null,
      p_dia: f?.dia ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApoyoRow[];
  }

  async detalle(id: string): Promise<ApoyoDetalle> {
    const { data, error } = await this.supabase.client.rpc('apoyo_transporte_detalle', { p_id: id });
    if (error) throw new Error(error.message);
    return data as ApoyoDetalle;
  }

  async crear(p: CrearApoyo): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('apoyo_transporte_crear', {
      p_tipo_apoyo: p.tipo_apoyo,
      p_proyecto_id: p.proyecto_id,
      p_dia: p.dia,
      p_descripcion: p.descripcion,
      p_destino_tipo: p.destino_tipo ?? null,
      p_destino_texto: p.destino_texto ?? null,
      p_destino_bodega_id: p.destino_bodega_id ?? null,
      p_destino_proyecto_id: p.destino_proyecto_id ?? null,
      p_es_danado: p.es_danado ?? false,
      p_client_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  /** Sube una foto al bucket privado (carpeta = <solicitud_id>/…) y la registra. */
  async subirFoto(solicitudId: string, file: File): Promise<void> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `${solicitudId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from(this.BUCKET).upload(path, file);
    if (error) throw new Error(error.message);
    const { error: e2 } = await this.supabase.client.rpc('apoyo_transporte_agregar_foto', {
      p_solicitud_id: solicitudId,
      p_path: path,
      p_client_id: crypto.randomUUID(),
    });
    if (e2) throw new Error(e2.message);
  }

  async cambiarEstado(id: string, estado: EstadoApoyo, nota?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('apoyo_transporte_cambiar_estado', {
      p_id: id,
      p_estado: estado,
      p_nota: nota ?? null,
      p_client_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  fotoUrl(path: string | null | undefined): Promise<string> {
    return this.cache.signed(this.BUCKET, path ?? null);
  }
}
