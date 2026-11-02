import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { comprimirImagen } from '../utils/comprimir-imagen.util';

export interface GastoCategoria {
  clave: string;
  label: string;
}

export interface GastoDirecto {
  id: string;
  fecha: string;
  categoria_clave: string;
  categoria: string;
  concepto: string;
  monto: number;
  recibo_path: string | null;
  registrado_por: string | null;
  registrado_por_nombre: string | null;
  created_at: string;
  proveedor: string | null;
  rnc: string | null;
  ncf: string | null;
  numero_recibo: string | null;
}

export interface NuevoGasto {
  proyectoId: string;
  categoria: string;
  concepto: string;
  monto: number;
  fecha: string;
  reciboPath: string | null;
  proveedor: string | null;
  rnc: string | null;
  ncf: string | null;
  numeroRecibo: string | null;
}

export interface LecturaFactura {
  proveedor: string | null;
  rnc: string | null;
  ncf: string | null;
  fecha: string | null;
  subtotal: number | null;
  itbis: number | null;
  total: number | null;
  concepto: string | null;
  numero_recibo: string | null;
}

/** F2b/DF-gastos — pantalla de Gastos directos del proyecto (AS14 tenía el backend, sin UI). */
@Injectable({ providedIn: 'root' })
export class GastosService {
  private supabase = inject(SupabaseService);

  async categorias(): Promise<GastoCategoria[]> {
    const { data, error } = await this.supabase.client
      .from('gasto_categorias')
      .select('clave,label')
      .eq('activo', true)
      .order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as GastoCategoria[];
  }

  async deProyecto(proyectoId: string, desde?: string, hasta?: string): Promise<GastoDirecto[]> {
    const { data, error } = await this.supabase.client.rpc('gastos_directos_de_proyecto', {
      p_proyecto_id: proyectoId,
      p_desde: desde ?? null,
      p_hasta: hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as GastoDirecto[];
  }

  async crear(g: NuevoGasto): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('registrar_gasto_directo_v2', {
      p_id: null,
      p_proyecto_id: g.proyectoId,
      p_categoria: g.categoria,
      p_concepto: g.concepto,
      p_monto: g.monto,
      p_fecha: g.fecha,
      p_recibo_path: g.reciboPath,
      p_proveedor: g.proveedor,
      p_rnc: g.rnc,
      p_ncf: g.ncf,
      p_numero_recibo: g.numeroRecibo,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Sube la foto de la factura al bucket dedicado y devuelve su storage path. */
  async subirFoto(proyectoId: string, file: File): Promise<string> {
    const comprimido = await comprimirImagen(file, 'evidencia');
    const path = `gastos/${proyectoId}/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('sgc-gastos')
      .upload(path, comprimido, { upsert: true, contentType: comprimido.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
    return path;
  }

  /** Lee la foto de la factura con IA (contexto factura_general) — el usuario siempre confirma. */
  async leerFactura(file: File): Promise<{ ok: boolean; error?: string; lectura?: LecturaFactura; confianza?: Record<string, number> }> {
    const data = await this.aBase64(file);
    const { data: res, error } = await this.supabase.client.functions.invoke('leer-recibo', {
      body: { imagenes: [{ tipo: 'factura', data, mime: file.type || 'image/jpeg' }], contexto: 'factura_general' },
    });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed?.error) return { ok: false, error: parsed.error };
        } catch { /* ignore */ }
      }
      return { ok: false, error: 'No se pudo leer la factura.' };
    }
    return res as { ok: boolean; lectura?: LecturaFactura; confianza?: Record<string, number> };
  }

  private aBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = String(r.result);
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      r.readAsDataURL(file);
    });
  }
}
