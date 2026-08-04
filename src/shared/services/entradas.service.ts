import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache, ImgTransform } from './signed-url-cache.service';
import { EntradaInventario, EntradaFormData, EntradaItemFormData } from '../models/entrada.model';

const SELECT_QUERY =
  '*, bodega:bodegas(nombre), proveedor:proveedores(nombre), orden_compra:ordenes_compra(numero), origen_proyecto:proyectos!entradas_inventario_origen_proyecto_id_fkey(nombre), detalle_entradas(*, articulo:articulos(nombre, codigo, unidad))';

/** AF2 — registro de confirmación de recepción con evidencia (compartido web+app). */
export interface RecepcionConfirmacion {
  id: string;
  entidad_tipo: 'entrada' | 'salida' | 'conduce';
  entidad_id: string;
  confirmado_por: string;
  modo: 'presencial' | 'remota';
  aportado_por: string | null;
  fecha: string;
  fotos: string[];
  notas: string | null;
  checklist: unknown;
  created_at: string;
  confirmador?: { nombre: string } | null;
}

@Injectable({ providedIn: 'root' })
export class EntradasService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async getAll(): Promise<EntradaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EntradaInventario[];
  }

  /**
   * AD6 — Almacén confirma (y opcionalmente ajusta) una recepción/compra que un
   * chofer dejó PENDIENTE. Materializa el stock vía RPC `confirmar_entrada_chofer`.
   */
  async confirmarChofer(entradaId: string, items?: EntradaItemFormData[]): Promise<void> {
    const { error } = await this.supabase.client.rpc('confirmar_entrada_chofer', {
      p_entrada_id: entradaId,
      p_items: items ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /**
   * AF2 — Confirma una entrada con evidencia (proceso, no botón). Sube las fotos
   * del confirmador al bucket `inventario` y llama al RPC unificado
   * `confirmar_entrada_evidencia` (materializa stock si estaba pendiente +
   * registra quién/cuándo/fotos/checklist/modo). Devuelve el id de la confirmación.
   */
  async confirmarConEvidencia(
    entradaId: string,
    opts: {
      items?: { articulo_id: string; cantidad: number; precio_unit?: number | null }[] | null;
      fotos?: File[];
      notas?: string | null;
      modo?: 'presencial' | 'remota';
      aportadoPor?: string | null;
    },
  ): Promise<string> {
    const paths: string[] = [];
    for (const f of opts.fotos ?? []) {
      paths.push(await this.subirFotoConfirmacion(entradaId, f));
    }
    const { data, error } = await this.supabase.client.rpc('confirmar_entrada_evidencia', {
      p_entrada_id: entradaId,
      p_items: opts.items ?? null,
      p_fotos: paths,
      p_notas: opts.notas ?? null,
      p_modo: opts.modo ?? 'presencial',
      p_aportado_por: opts.aportadoPor ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Sube una foto de evidencia de confirmación al bucket `inventario`. */
  async subirFotoConfirmacion(entradaId: string, file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `confirmacion/${entradaId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('inventario').upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }

  /** AF2 — Confirmaciones (evidencia) registradas para una entidad. */
  async getConfirmaciones(entidadTipo: 'entrada' | 'salida' | 'conduce', entidadId: string): Promise<RecepcionConfirmacion[]> {
    const { data, error } = await this.supabase.client.rpc('confirmaciones_de', {
      p_entidad_tipo: entidadTipo,
      p_entidad_id: entidadId,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RecepcionConfirmacion[];
    // Resolver nombre del confirmador (una consulta liviana).
    const ids = [...new Set(rows.map((r) => r.confirmado_por).filter(Boolean))];
    if (ids.length) {
      const { data: us } = await this.supabase.client.from('usuarios').select('id, nombre').in('id', ids);
      const byId = new Map((us ?? []).map((u: { id: string; nombre: string }) => [u.id, u.nombre]));
      for (const r of rows) r.confirmador = { nombre: byId.get(r.confirmado_por) ?? '—' };
    }
    return rows;
  }

  /** AF15 — ¿el usuario actual puede confirmar de forma remota? */
  async puedeConfirmarRemoto(): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('puede_confirmar_remoto');
    if (error) return false;
    return data === true;
  }

  /** Sube una foto de evidencia (web) al bucket `inventario` y la enlaza a la entrada.
   *  Paridad con la app de campo: lo que la móvil captura, la web también. */
  async subirFoto(entradaId: string, file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `entrada/${entradaId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('inventario').upload(path, file);
    if (error) throw new Error(error.message);
    const { error: updErr } = await this.supabase.client
      .from('entradas_inventario')
      .update({ foto_path: path })
      .eq('id', entradaId);
    if (updErr) throw new Error(updErr.message);
    return path;
  }

  /** Signed URL for the field-captured evidence photo (private `inventario` bucket). */
  async getFotoUrl(path: string, transform?: ImgTransform): Promise<string> {
    return this.cache.signed('inventario', path, transform);
  }

  async getByOrdenCompra(ordenCompraId: string): Promise<EntradaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .eq('orden_compra_id', ordenCompraId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EntradaInventario[];
  }

  async create(payload: EntradaFormData, userId: string | null): Promise<EntradaInventario> {
    const { items, ...header } = payload;
    let entradaId: unknown;

    if (header.origen_tipo === 'devolucion_obra') {
      // P12 — traspaso atómico desde el almacén de la obra de origen (RPC nuevo).
      const { data, error } = await this.supabase.client.rpc('registrar_devolucion_obra', {
        p_fecha: header.fecha,
        p_bodega_destino_id: header.bodega_id,
        p_origen_proyecto_id: header.origen_proyecto_id ?? null,
        p_descontar: header.descontar_origen ?? false,
        p_referencia: header.referencia,
        p_observaciones: header.observaciones,
        p_creado_por: userId,
        p_items: items,
      });
      if (error) throw new Error(error.message);
      entradaId = data;
    } else {
      const { data, error } = await this.supabase.client.rpc('registrar_entrada_inventario', {
        p_fecha: header.fecha,
        p_bodega_id: header.bodega_id,
        p_proveedor_id: header.proveedor_id,
        p_orden_compra_id: header.orden_compra_id,
        p_referencia: header.referencia,
        p_observaciones: header.observaciones,
        p_creado_por: userId,
        p_items: items,
        p_origen_tipo: header.origen_tipo ?? null,
        p_origen_proyecto_id: header.origen_proyecto_id ?? null,
      });
      if (error) throw new Error(error.message);
      entradaId = data;
    }

    const { data, error: fetchError } = await this.supabase.client
      .from('entradas_inventario')
      .select(SELECT_QUERY)
      .eq('id', entradaId as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    return data as unknown as EntradaInventario;
  }
}
