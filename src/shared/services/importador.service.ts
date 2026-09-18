import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** BT1 — un campo destino de una entidad importable + los nombres de columna que
 *  reconoce automáticamente (incluye los exports estándar de Odoo). */
export interface CampoEntidad {
  t: string;            // nombre del campo destino (clave del jsonb que espera el RPC)
  label: string;
  alias: string[];      // nombres de columna que auto-mapean a este campo
  requerido?: boolean;
}
export interface EntidadImportable {
  key: string;
  label: string;
  rpc: string;
  odoo?: string;        // modelo de Odoo del que suele venir
  soportaDeshacer: boolean;
  campos: CampoEntidad[];
}

export const ENTIDADES: EntidadImportable[] = [
  {
    key: 'proveedores', label: 'Proveedores', rpc: 'importar_proveedores', odoo: 'res.partner',
    soportaDeshacer: false,
    campos: [
      { t: 'nombre', label: 'Nombre', alias: ['name', 'nombre', 'razon_social', 'proveedor'], requerido: true },
      { t: 'rnc', label: 'RNC', alias: ['vat', 'rnc', 'tax_id'] },
      { t: 'telefono', label: 'Teléfono', alias: ['phone', 'telefono', 'mobile'] },
      { t: 'email', label: 'Email', alias: ['email', 'correo'] },
      { t: 'direccion', label: 'Dirección', alias: ['street', 'direccion', 'address'] },
    ],
  },
  {
    key: 'vehiculos', label: 'Vehículos', rpc: 'importar_vehiculos', odoo: 'fleet.vehicle',
    soportaDeshacer: true,
    campos: [
      { t: 'placa', label: 'Placa', alias: ['license_plate', 'placa', 'matricula', 'name'], requerido: true },
      { t: 'marca', label: 'Marca', alias: ['brand', 'make', 'marca', 'model_id'] },
      { t: 'modelo', label: 'Modelo', alias: ['model', 'modelo'] },
      { t: 'color', label: 'Color', alias: ['color'] },
      { t: 'tipo', label: 'Tipo', alias: ['vehicle_type', 'tipo'] },
    ],
  },
  {
    key: 'articulos', label: 'Artículos', rpc: 'importar_articulos', odoo: 'product.template',
    soportaDeshacer: true,
    campos: [
      { t: 'nombre', label: 'Nombre', alias: ['name', 'nombre', 'descripcion', 'product'], requerido: true },
      { t: 'codigo', label: 'Código', alias: ['default_code', 'codigo', 'sku', 'reference', 'internal_reference'] },
      { t: 'categoria', label: 'Categoría', alias: ['categ_id', 'categoria', 'category', 'product_category'] },
      { t: 'unidad', label: 'Unidad', alias: ['uom_id', 'unidad', 'unit', 'uom'] },
    ],
  },
];

export interface ResultadoImport {
  nuevos: number;
  actualizados: number;
  errores: { i: number; motivo: string }[];
}

@Injectable({ providedIn: 'root' })
export class ImportadorService {
  private supabase = inject(SupabaseService);

  /** Normaliza un encabezado para el auto-match (minúsculas, sin acentos ni símbolos). */
  private norm(s: string): string {
    return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Auto-mapea las columnas del archivo a los campos de la entidad (incl. Odoo). */
  autoMapeo(entidad: EntidadImportable, headers: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    const normHeaders = headers.map((h) => ({ h, n: this.norm(h) }));
    for (const campo of entidad.campos) {
      const objetivos = [campo.t, ...campo.alias].map((a) => this.norm(a));
      const found = normHeaders.find((h) => objetivos.includes(h.n));
      if (found) map[campo.t] = found.h;
    }
    return map;
  }

  /** Aplica el mapeo a las filas crudas → filas {campo: valor} para el RPC. */
  aplicarMapeo(rows: Record<string, unknown>[], mapeo: Record<string, string>): Record<string, unknown>[] {
    return rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [campo, col] of Object.entries(mapeo)) {
        if (col) out[campo] = r[col];
      }
      return out;
    });
  }

  async mapeoRecordado(entidad: string): Promise<Record<string, string>> {
    const { data } = await this.supabase.client.rpc('importaciones_mapeo_get', { p_entidad: entidad });
    return (data as Record<string, string>) ?? {};
  }
  async guardarMapeo(entidad: string, mapeo: Record<string, string>): Promise<void> {
    await this.supabase.client.rpc('importaciones_mapeo_set', { p_entidad: entidad, p_mapeo: mapeo });
  }

  async crearImportacion(entidad: string, filas: number): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_importacion', { p_entidad: entidad, p_filas: filas });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Ejecuta el RPC de la entidad y devuelve el resultado normalizado. */
  async importar(entidad: EntidadImportable, filas: Record<string, unknown>[], importacionId: string): Promise<ResultadoImport> {
    const params: Record<string, unknown> = { p_filas: filas };
    if (entidad.key === 'proveedores') params['p_modo'] = 'actualizar';
    else params['p_importacion_id'] = importacionId;
    const { data, error } = await this.supabase.client.rpc(entidad.rpc, params);
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as { nuevos?: number; actualizados?: number; insertados?: number; errores?: { i: number; motivo: string }[] };
    return {
      nuevos: d.nuevos ?? d.insertados ?? 0,
      actualizados: d.actualizados ?? 0,
      errores: d.errores ?? [],
    };
  }

  async registrarResultado(id: string, r: ResultadoImport): Promise<void> {
    await this.supabase.client.rpc('registrar_resultado_importacion', {
      p_id: id, p_nuevos: r.nuevos, p_actualizados: r.actualizados, p_errores: r.errores,
    });
  }

  async historial(): Promise<{ id: string; entidad: string; nuevos: number; actualizados: number; errores: unknown[]; deshecha_at: string | null; created_at: string }[]> {
    const { data, error } = await this.supabase.client
      .from('importaciones').select('id, entidad, nuevos, actualizados, errores, deshecha_at, created_at')
      .order('created_at', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; entidad: string; nuevos: number; actualizados: number; errores: unknown[]; deshecha_at: string | null; created_at: string }[];
  }

  async deshacer(id: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('deshacer_importacion', { p_id: id });
    if (error) throw new Error(error.message);
    return (data as { borradas?: number })?.borradas ?? 0;
  }
}
