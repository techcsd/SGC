import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache, ImgTransform } from './signed-url-cache.service';
import { SalidaInventario, SalidaFormData } from '../models/salida.model';
import { NotificacionesService } from './notificaciones.service';

// usuarios is joined twice (creado_por, recibido_por) — must be disambiguated
// with !fkey_name or PostgREST rejects the embed as ambiguous.
const SELECT_QUERY =
  '*, bodega:bodegas(nombre), proyecto:proyectos(nombre), conductor:conductores(nombre), vehiculo:vehiculos(placa),' +
  ' recibido:usuarios!salidas_inventario_recibido_por_fkey(nombre),' +
  ' entregado:usuarios!salidas_inventario_entregado_por_fkey(nombre),' +
  ' detalle_salidas(*, articulo:articulos(nombre, codigo, unidad))';

@Injectable({ providedIn: 'root' })
export class SalidasService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);
  private notificaciones = inject(NotificacionesService);

  async getAll(): Promise<SalidaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaInventario[];
  }

  /** Sube una foto de evidencia (web) al bucket `inventario` y la enlaza a la salida.
   *  Paridad con la app de campo: lo que la móvil captura, la web también. */
  async subirFoto(salidaId: string, file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `salida/${salidaId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('inventario').upload(path, file);
    if (error) throw new Error(error.message);
    const { error: updErr } = await this.supabase.client
      .from('salidas_inventario')
      .update({ foto_path: path })
      .eq('id', salidaId);
    if (updErr) throw new Error(updErr.message);
    return path;
  }

  /** Sube evidencia de entrega del conduce (firma/foto) al bucket `conduces`. */
  async subirEvidenciaConduce(salidaId: string, tipo: 'firma' | 'foto', data: Blob | File, ext: string): Promise<string> {
    const path = `salida/${salidaId}/${tipo}-${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage.from('conduces').upload(path, data);
    if (error) throw new Error(error.message);
    return path;
  }

  /** Cierre de conduce por el chofer (paridad app de campo): registra receptor,
   *  firma, foto y cantidades entregadas. Devuelve el estado resultante. */
  async entregarConduce(
    salidaId: string,
    items: { detalle_id: string; cantidad_recibida: number }[],
    receptor: string,
    firmaPath: string | null,
    fotoPath: string | null,
    notas: string | null,
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('entregar_conduce', {
      p_salida_id: salidaId,
      p_items: items,
      p_receptor: receptor,
      p_firma_url: firmaPath,
      p_foto_url: fotoPath,
      p_notas: notas,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  /** Signed URL for the field-captured evidence photo (private `inventario` bucket). */
  async getFotoUrl(path: string, transform?: ImgTransform): Promise<string> {
    return this.cache.signed('inventario', path, transform);
  }

  async getById(id: string): Promise<SalidaInventario> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as SalidaInventario;
  }

  /** Atomic insert (header + items) with server-side stock validation, via RPC. */
  async create(payload: SalidaFormData, userId: string | null): Promise<SalidaInventario> {
    const { items, conductor_id, vehiculo_id, ...header } = payload;

    const { data: salidaId, error } = await this.supabase.client.rpc('registrar_salida_inventario', {
      p_fecha: header.fecha,
      p_bodega_id: header.bodega_id,
      p_proyecto_id: header.proyecto_id,
      p_motivo: header.motivo,
      p_responsable: header.responsable,
      p_observaciones: header.observaciones,
      p_creado_por: userId,
      p_items: items,
    });

    if (error) throw new Error(error.message);

    // Transporte is optional and recorded separately — registrar_salida_inventario
    // only handles the header + items RPC signature already in use elsewhere.
    if (conductor_id || vehiculo_id) {
      await this.supabase.client
        .from('salidas_inventario')
        .update({ conductor_id, vehiculo_id })
        .eq('id', salidaId as string);
    }

    const { data, error: fetchError } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('id', salidaId as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    this.notificaciones.refresh();
    return data as unknown as SalidaInventario;
  }

  /** Salidas awaiting confirmation for a given project (or all, for inventario/admin) — RLS scopes visibility. */
  async getDespachados(): Promise<SalidaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('estado', 'despachado')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaInventario[];
  }

  /** Dual-party confirmation: records actual received quantity per line; auto-detects an incomplete delivery. */
  async confirmarRecepcion(
    salidaId: string,
    items: { detalle_id: string; cantidad_recibida: number }[],
    notas: string | null,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('confirmar_recepcion_salida', {
      p_salida_id: salidaId,
      p_items: items,
      p_notas: notas,
    });

    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as boolean;
  }
}
