import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';

export type AsignacionEstado = 'asignado' | 'devuelto' | 'perdido' | 'dañado';
export type AsignacionItemTipo = 'activo_fijo' | 'articulo' | 'libre';

export interface EmpleadoAsignacion {
  id: string;
  empleado_id: string;
  item_tipo: AsignacionItemTipo;
  item_id: string | null;
  item_nombre: string;
  categoria: string | null;
  foto_path: string | null;
  estado: AsignacionEstado;
  asignado_por: string | null;
  asignado_en: string;
  devuelto_en: string | null;
  notas: string | null;
  es_prueba: boolean;
  created_at: string;
}

export interface AsignacionEvento {
  estado: AsignacionEstado;
  nota: string | null;
  por_nombre: string | null;
  created_at: string;
}

/** AF33 — asignaciones de la empresa a empleados (equipos, uniformes, cascos…). */
@Injectable({ providedIn: 'root' })
export class EmpleadoAsignacionesService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async getByEmpleado(empleadoId: string): Promise<EmpleadoAsignacion[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('empleado_asignaciones')
      .select('*')
      .eq('empleado_id', empleadoId)
      .order('asignado_en', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EmpleadoAsignacion[];
  }

  async asignar(payload: {
    empleado_id: string;
    item_nombre: string;
    item_tipo?: AsignacionItemTipo;
    item_id?: string | null;
    categoria?: string | null;
    foto_path?: string | null;
    notas?: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('asignar_item_empleado', {
      p_empleado_id: payload.empleado_id,
      p_item_nombre: payload.item_nombre,
      p_item_tipo: payload.item_tipo ?? 'libre',
      p_item_id: payload.item_id ?? null,
      p_categoria: payload.categoria ?? null,
      p_foto_path: payload.foto_path ?? null,
      p_notas: payload.notas ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async cambiarEstado(asignacionId: string, estado: AsignacionEstado, nota?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('cambiar_estado_asignacion', {
      p_asignacion_id: asignacionId,
      p_estado: estado,
      p_nota: nota ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async getEventos(asignacionId: string): Promise<AsignacionEvento[]> {
    const { data, error } = await this.supabase.client.rpc('asignacion_eventos_de', { p_asignacion_id: asignacionId });
    if (error) throw new Error(error.message);
    return (data ?? []) as AsignacionEvento[];
  }

  /** Sube una foto opcional del item al bucket sgc-rrhh. */
  async subirFoto(empleadoId: string, file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `asignaciones/${empleadoId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('sgc-rrhh').upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }

  async getFotoUrl(path: string): Promise<string> {
    return this.cache.signed('sgc-rrhh', path);
  }
}
