import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';

/** BO10 — catálogo de diámetros de acero (kg/m administrable). */
export interface AceroDiametro { codigo: string; mm: number | null; kg_por_m: number; activo: boolean; orden: number; }
/** BO10 — catálogo de figuras de doblado. */
export interface CartillaFigura { codigo: string; nombre: string; svg: string | null; activo: boolean; orden: number; }

export interface CartillaListItem {
  id: string; folio: string | null; proyecto_id: string; proyecto: string | null;
  ingeniero: string | null; fecha: string; estado: string; es_prueba: boolean;
  peso_total_kg: number; created_at: string;
}
export interface CartillaTramo { lado?: string; cm: number; }
export interface CartillaPieza {
  id?: string; marca: string | null; diametro_codigo: string | null; figura_codigo: string | null;
  tramos_cm: CartillaTramo[] | null; longitud_total_cm: number | null; cantidad: number; peso_kg: number | null;
}
export interface CartillaAtado {
  id?: string; identificador: string | null; elemento: string | null; cantidad_piezas: number | null;
  orden?: number; piezas: CartillaPieza[];
}
export interface CartillaEvento { estado_desde: string | null; estado_hasta: string | null; usuario: string | null; nota: string | null; created_at: string; }
export interface CartillaDetalle {
  id: string; folio: string | null; proyecto_id: string; proyecto: string | null;
  ingeniero_id: string; ingeniero: string | null; fecha: string; estado: string;
  observacion: string | null; notas: string | null; plano_path: string | null; es_prueba: boolean;
  created_at: string; peso_total_kg: number; atados: CartillaAtado[]; fotos: string[]; eventos: CartillaEvento[];
}

const BUCKET = 'sgc-cartillas';

@Injectable({ providedIn: 'root' })
export class CartillasService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async diametros(): Promise<AceroDiametro[]> {
    const { data, error } = await this.supabase.client.schema('sgc').from('acero_diametros')
      .select('*').eq('activo', true).order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as AceroDiametro[];
  }
  async figuras(): Promise<CartillaFigura[]> {
    const { data, error } = await this.supabase.client.schema('sgc').from('cartilla_figuras')
      .select('*').eq('activo', true).order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as CartillaFigura[];
  }

  async listado(f?: { proyectoId?: string | null; ingenieroId?: string | null; desde?: string | null; hasta?: string | null; estado?: string | null }): Promise<CartillaListItem[]> {
    const { data, error } = await this.supabase.client.rpc('cartillas_listado', {
      p_proyecto_id: f?.proyectoId ?? null, p_ingeniero_id: f?.ingenieroId ?? null,
      p_desde: f?.desde ?? null, p_hasta: f?.hasta ?? null, p_estado: f?.estado ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as CartillaListItem[];
  }

  async detalle(id: string): Promise<CartillaDetalle> {
    const { data, error } = await this.supabase.client.rpc('cartilla_detalle', { p_id: id });
    if (error) throw new Error(error.message);
    return data as CartillaDetalle;
  }

  async crear(payload: { id: string; proyectoId: string; fecha: string; atados: CartillaAtado[]; fotos?: { path: string }[]; planoPath?: string | null; notas?: string | null }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_cartilla', {
      p_id: payload.id, p_proyecto_id: payload.proyectoId, p_fecha: payload.fecha,
      p_atados: payload.atados, p_fotos: payload.fotos ?? [],
      p_plano_path: payload.planoPath ?? null, p_notas: payload.notas ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async cambiarEstado(id: string, estado: string, nota?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('cartilla_cambiar_estado', {
      p_id: id, p_estado: estado, p_nota: nota ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async resumenAcero(f?: { proyectoId?: string | null; desde?: string | null; hasta?: string | null }): Promise<{ diametro_codigo: string; piezas: number; peso_kg: number }[]> {
    const { data, error } = await this.supabase.client.rpc('cartillas_resumen_acero', {
      p_proyecto_id: f?.proyectoId ?? null, p_desde: f?.desde ?? null, p_hasta: f?.hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as { diametro_codigo: string; piezas: number; peso_kg: number }[];
  }

  async getFotoUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    return this.cache.signed(BUCKET, path);
  }

  async subirArchivo(kind: 'foto' | 'plano', cartillaId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${cartillaId}/${kind}-${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }
}
