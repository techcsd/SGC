import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** BT1/CC4 — un campo destino de una entidad importable + los nombres de columna que
 *  reconoce automáticamente (incluye los exports de Odoo: etiquetas ES + EN + técnicos). */
export type TransformOdoo = 'rnc' | 'telefono' | 'hoja' | 'uom' | 'bool';
export interface CampoEntidad {
  t: string;            // nombre del campo destino (clave del jsonb que espera el RPC)
  label: string;
  alias: string[];      // nombres de columna que auto-mapean a este campo
  requerido?: boolean;
  transform?: TransformOdoo; // CC4 — transformación al importar un archivo de Odoo
}
export interface EntidadImportable {
  key: string;
  label: string;
  rpc: string;
  odoo?: string;        // modelo de Odoo del que suele venir
  soportaDeshacer: boolean;
  campos: CampoEntidad[];
}

// CC4 — la columna del ID externo de Odoo (idempotencia). Reconoce las variantes
// que produce "Exportar → Exportar como ID".
const CAMPO_ODOO_REF: CampoEntidad = {
  t: 'odoo_ref', label: 'ID externo (Odoo)',
  alias: ['id', 'external id', 'external_id', 'id_externo', 'id externo', '__export__', 'xml id', 'xml_id', 'database id', 'database_id'],
};

export const ENTIDADES: EntidadImportable[] = [
  {
    key: 'proveedores', label: 'Proveedores', rpc: 'importar_proveedores', odoo: 'res.partner',
    soportaDeshacer: false,
    campos: [
      { t: 'nombre', label: 'Nombre', alias: ['name', 'nombre', 'razon_social', 'razón social', 'proveedor', 'contacto', 'display_name', 'nombre mostrado'], requerido: true },
      { t: 'rnc', label: 'RNC / Cédula', alias: ['vat', 'rnc', 'tax_id', 'tax id', 'nif', 'nif/rnc', 'nif / rnc', 'identificación fiscal', 'identificacion fiscal', 'cédula', 'cedula'], transform: 'rnc' },
      { t: 'telefono', label: 'Teléfono', alias: ['phone', 'telefono', 'teléfono', 'mobile', 'móvil', 'movil'], transform: 'telefono' },
      { t: 'email', label: 'Email', alias: ['email', 'correo', 'correo electrónico', 'correo electronico', 'e-mail'] },
      { t: 'direccion', label: 'Dirección', alias: ['street', 'direccion', 'dirección', 'address', 'calle'] },
      { t: 'is_company', label: '¿Es compañía?', alias: ['is_company', 'is company', 'es una compañía', 'es una compania', 'compañía', 'company_type'], transform: 'bool' },
      { t: 'activo', label: 'Activo', alias: ['active', 'activo'], transform: 'bool' },
      CAMPO_ODOO_REF,
    ],
  },
  {
    key: 'vehiculos', label: 'Vehículos', rpc: 'importar_vehiculos', odoo: 'fleet.vehicle',
    soportaDeshacer: true,
    campos: [
      { t: 'placa', label: 'Placa', alias: ['license_plate', 'license plate', 'placa', 'matricula', 'matrícula', 'name'], requerido: true },
      { t: 'marca', label: 'Marca', alias: ['brand', 'brand_id', 'make', 'marca', 'model_id', 'modelo/marca'], transform: 'hoja' },
      { t: 'modelo', label: 'Modelo', alias: ['model', 'model_id', 'modelo'], transform: 'hoja' },
      { t: 'color', label: 'Color', alias: ['color'] },
      { t: 'tipo', label: 'Tipo', alias: ['vehicle_type', 'vehicle type', 'tipo', 'tipo de vehículo', 'tipo de vehiculo'] },
      CAMPO_ODOO_REF,
    ],
  },
  {
    key: 'articulos', label: 'Artículos', rpc: 'importar_articulos', odoo: 'product.template',
    soportaDeshacer: true,
    campos: [
      { t: 'nombre', label: 'Nombre', alias: ['name', 'nombre', 'descripcion', 'descripción', 'product', 'producto'], requerido: true },
      { t: 'codigo', label: 'Código', alias: ['default_code', 'default code', 'codigo', 'código', 'sku', 'reference', 'referencia interna', 'internal_reference', 'internal reference', 'referencia'] },
      { t: 'categoria', label: 'Categoría', alias: ['categ_id', 'categoria', 'categoría', 'category', 'product_category', 'categoría de producto', 'categoria de producto'], transform: 'hoja' },
      { t: 'unidad', label: 'Unidad', alias: ['uom_id', 'unidad', 'unidad de medida', 'unit', 'uom', 'unit of measure', 'unidad de medida (uom)'], transform: 'uom' },
      CAMPO_ODOO_REF,
    ],
  },
];

// CC4 — equivalencias de unidad de medida de Odoo → unidad SGC.
const UOM_MAP: Record<string, string> = {
  'unidades': 'ud', 'unidad': 'ud', 'unidad(es)': 'ud', 'units': 'ud', 'unit': 'ud', 'ud': 'ud', 'uds': 'ud', 'each': 'ud', 'pcs': 'ud',
  'kg': 'kg', 'kilogramos': 'kg', 'kilogramo': 'kg', 'kilogram': 'kg', 'kgs': 'kg',
  'g': 'g', 'gramos': 'g', 'gramo': 'g',
  'm': 'm', 'metros': 'm', 'metro': 'm', 'meter': 'm', 'meters': 'm', 'mts': 'm',
  'cm': 'cm', 'centimetros': 'cm', 'centímetros': 'cm',
  'l': 'l', 'litro': 'l', 'litros': 'l', 'litro(s)': 'l', 'liter': 'l', 'liters': 'l', 'lt': 'l',
  'gal': 'gal', 'galon': 'gal', 'galón': 'gal', 'galones': 'gal', 'gallon': 'gal', 'gallons': 'gal',
  'saco': 'saco', 'sacos': 'saco', 'funda': 'funda', 'fundas': 'funda', 'caja': 'caja', 'cajas': 'caja',
  'lb': 'lb', 'libra': 'lb', 'libras': 'lb', 'quintal': 'quintal', 'quintales': 'quintal',
};

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

  /** CC4 — normaliza un RNC/cédula: solo dígitos; válido si tiene 9 (RNC) u 11 (cédula). */
  private normRnc(raw: string): { valor: string; nota?: string } {
    const d = (raw ?? '').replace(/\D/g, '');
    if (!d) return { valor: '' };
    if (d.length === 9 || d.length === 11) return { valor: d, nota: raw !== d ? `${raw} → ${d}` : undefined };
    return { valor: raw, nota: `RNC/cédula con ${d.length} dígitos (¿revisar?)` };
  }
  /** CC4 — teléfono RD best-effort (solo formatea si tiene 10 dígitos). */
  private normTel(raw: string): { valor: string; nota?: string } {
    const d = (raw ?? '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    if (d.length === 10) {
      const f = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
      return { valor: f, nota: raw !== f ? `${raw} → ${f}` : undefined };
    }
    return { valor: (raw ?? '').toString().trim() };
  }
  /** CC4 — relacional "A / B / C" → última hoja. */
  private hojaRelacional(raw: string): { valor: string; nota?: string } {
    const s = (raw ?? '').toString();
    if (!s.includes('/')) return { valor: s.trim() };
    const hoja = s.split('/').map((x) => x.trim()).filter(Boolean).pop() ?? s.trim();
    return { valor: hoja, nota: `'${s.trim()}' → ${hoja}` };
  }
  /** CC4 — UoM de Odoo → unidad SGC. */
  private mapUom(raw: string): { valor: string; nota?: string } {
    const key = (raw ?? '').toString().trim().toLowerCase();
    if (!key) return { valor: '' };
    const u = UOM_MAP[key];
    if (u) return { valor: u, nota: key !== u ? `${raw} → ${u}` : undefined };
    return { valor: key, nota: `unidad "${raw}" sin equivalencia (se usa tal cual)` };
  }
  /** CC4 — booleano de Odoo (VERDADERO/True/1/Sí…). */
  private toBool(raw: unknown): boolean {
    const s = (raw ?? '').toString().trim().toLowerCase();
    return ['true', 'verdadero', '1', 'si', 'sí', 'yes', 'x', 'company'].includes(s);
  }

  /** CC4 — transforma un valor crudo según el campo; devuelve {valor, nota} (nota = para el preview). */
  transformar(campo: CampoEntidad, raw: unknown): { valor: unknown; nota?: string } {
    if (raw == null || raw === '') return { valor: campo.transform === 'bool' ? false : '' };
    switch (campo.transform) {
      case 'rnc': return this.normRnc(String(raw));
      case 'telefono': return this.normTel(String(raw));
      case 'hoja': return this.hojaRelacional(String(raw));
      case 'uom': return this.mapUom(String(raw));
      case 'bool': return { valor: this.toBool(raw) };
      default: return { valor: typeof raw === 'string' ? raw.trim() : raw };
    }
  }

  /** CC4 — fusiona filas de continuación de Odoo (clave/ID vacíos) con la fila anterior. */
  fusionarContinuacion(entidad: EntidadImportable, rows: Record<string, unknown>[], mapeo: Record<string, string>): Record<string, unknown>[] {
    const colClave = mapeo[entidad.campos.find((c) => c.requerido)?.t ?? ''] ?? '';
    const colRef = mapeo['odoo_ref'] ?? '';
    if (!colClave && !colRef) return rows;
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      const claveVacia = (!colClave || !String(r[colClave] ?? '').trim()) && (!colRef || !String(r[colRef] ?? '').trim());
      if (claveVacia && out.length) {
        const prev = out[out.length - 1];
        for (const [k, v] of Object.entries(r)) if (v != null && String(v).trim() && !String(prev[k] ?? '').trim()) prev[k] = v;
      } else {
        out.push({ ...r });
      }
    }
    return out;
  }

  /** Aplica el mapeo (+ transformaciones Odoo + fusión de continuación) → filas para el RPC. */
  aplicarMapeo(entidad: EntidadImportable, rows: Record<string, unknown>[], mapeo: Record<string, string>): Record<string, unknown>[] {
    const fusionadas = this.fusionarContinuacion(entidad, rows, mapeo);
    const porT = new Map(entidad.campos.map((c) => [c.t, c]));
    return fusionadas.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [campo, col] of Object.entries(mapeo)) {
        if (!col) continue;
        const def = porT.get(campo);
        out[campo] = def ? this.transformar(def, r[col]).valor : r[col];
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
