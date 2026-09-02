import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { NotificacionesService } from './notificaciones.service';

const BUCKET = 'sgc-retiro';

export type RetiroEstado =
  | 'pendiente' | 'aprobada' | 'en_retiro' | 'en_cuarentena' | 'dispuesta' | 'rechazada' | 'cancelada';
export type MotivoDano = 'danado_obra' | 'defecto_fabrica' | 'vencido' | 'otro';
export type Disposicion = 'descarte' | 'reparacion' | 'devolucion';

export interface RetiroListItem {
  id: string;
  folio: number | null;
  proyecto_id: string;
  proyecto_nombre: string | null;
  solicitante_nombre: string | null;
  motivo_dano: MotivoDano;
  motivo_dano_detalle: string | null;
  estado: RetiroEstado;
  disposicion: Disposicion | null;
  items_count: number;
  fotos_count: number;
  es_prueba: boolean;
  created_at: string;
}

export interface RetiroItem {
  articulo_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad?: string | null;
}
export interface RetiroCrearData {
  proyecto_id: string;
  almacen_destino_id: string | null;
  motivo_dano: MotivoDano;
  motivo_dano_detalle?: string | null;
  notas?: string | null;
  items: RetiroItem[];
  fotos: { path: string; nombre?: string }[];
  es_prueba?: boolean;
}
export interface CuarentenaRow {
  bodega_id: string;
  bodega_nombre: string | null;
  articulo_id: string;
  articulo_nombre: string | null;
  codigo: string | null;
  cantidad: number;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class RetirosService {
  private supabase = inject(SupabaseService);
  private notificaciones = inject(NotificacionesService);

  nuevoId(): string {
    return crypto.randomUUID();
  }

  /** Sube una evidencia (foto/firma) al bucket sgc-retiro y devuelve el path. */
  async uploadEvidencia(carpeta: string, file: File | Blob, ext = 'jpg'): Promise<string> {
    const path = `${carpeta}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage.from(BUCKET).upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }

  async signedUrl(path: string): Promise<string | null> {
    const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }

  async listado(estado: RetiroEstado | null = null, soloMios = false): Promise<RetiroListItem[]> {
    const { data, error } = await this.supabase.client.rpc('retiros_listado', {
      p_estado: estado,
      p_solo_mios: soloMios,
      p_limite: 400,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as RetiroListItem[];
  }

  async detalle(id: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.client.rpc('retiro_detalle', { p_id: id });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
  }

  async crear(d: RetiroCrearData): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_retiro_material', {
      p_proyecto_id: d.proyecto_id,
      p_almacen_destino_id: d.almacen_destino_id,
      p_motivo_dano: d.motivo_dano,
      p_motivo_dano_detalle: d.motivo_dano_detalle ?? null,
      p_notas: d.notas ?? null,
      p_items: d.items,
      p_fotos: d.fotos,
      p_es_prueba: d.es_prueba ?? false,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  async aprobar(id: string, almacenId: string | null = null): Promise<void> {
    const { error } = await this.supabase.client.rpc('retiro_aprobar', {
      p_id: id,
      p_almacen_destino_id: almacenId,
    });
    if (error) throw new Error(error.message);
  }
  async rechazar(id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('retiro_rechazar', { p_id: id, p_motivo: motivo });
    if (error) throw new Error(error.message);
  }
  async cancelar(id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('retiro_cancelar', { p_id: id, p_motivo: motivo });
    if (error) throw new Error(error.message);
  }

  async generarConduce(
    id: string,
    d: {
      transporta_proveedor_id?: string | null;
      transporta_texto?: string | null;
      placa_foto_path?: string | null;
      carga_foto_path?: string | null;
      emisor_firma_path?: string | null;
    },
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('retiro_generar_conduce', {
      p_id: id,
      p_transporta_proveedor_id: d.transporta_proveedor_id ?? null,
      p_transporta_texto: d.transporta_texto ?? null,
      p_placa_foto_path: d.placa_foto_path ?? null,
      p_carga_foto_path: d.carga_foto_path ?? null,
      p_emisor_firma_path: d.emisor_firma_path ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async recibir(id: string, fotoPath: string | null, firmaPath: string | null, notas: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('retiro_recibir', {
      p_id: id,
      p_foto_path: fotoPath,
      p_firma_path: firmaPath,
      p_notas: notas,
    });
    if (error) throw new Error(error.message);
  }

  async disponer(id: string, disposicion: Disposicion, nota: string | null, proveedorId: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('retiro_disponer', {
      p_id: id,
      p_disposicion: disposicion,
      p_nota: nota,
      p_proveedor_id: proveedorId,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  async cuarentena(bodegaId: string | null = null): Promise<CuarentenaRow[]> {
    const { data, error } = await this.supabase.client.rpc('inventario_cuarentena', { p_bodega_id: bodegaId });
    if (error) throw new Error(error.message);
    return (data ?? []) as CuarentenaRow[];
  }
}
