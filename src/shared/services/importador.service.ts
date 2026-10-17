import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  VEHICULO_TIPOS, VEHICULO_ESTADOS, VEHICULO_USOS, VEHICULO_MEDIDAS_USO,
  VEHICULO_ASEGURADORAS, CAPACIDAD_UNIDADES,
} from '../models/vehiculo.model';

/** BT1/CC4 — un campo destino de una entidad importable + los nombres de columna que
 *  reconoce automáticamente (incluye los exports de Odoo: etiquetas ES + EN + técnicos).
 *  CQ4-e/f — 'fecha'/'numero' para campos de fecha/numéricos de la plantilla propia
 *  (no vienen de Odoo); 'enum' para campos con lista de valores válidos (`opciones`). */
export type TransformOdoo = 'rnc' | 'telefono' | 'hoja' | 'uom' | 'bool' | 'fecha' | 'numero' | 'enum';
export interface CampoEntidad {
  t: string;            // nombre del campo destino (clave del jsonb que espera el RPC)
  label: string;
  alias: string[];      // nombres de columna que auto-mapean a este campo
  requerido?: boolean;
  transform?: TransformOdoo; // CC4 — transformación al importar un archivo de Odoo
  /** CQ4-e/f — valores válidos (transform:'enum' los normaliza; en los demás solo
   *  documentan la hoja "Instrucciones" de la plantilla, no se fuerzan). */
  opciones?: { value: string; label: string }[];
}
/** Foto por fila vía .zip (xlsx/SheetJS no lee imágenes embebidas en celdas): en vez de
 *  pedir una columna extra en la plantilla, el usuario nombra cada foto con el mismo
 *  dato que ya identifica la fila (cédula del chofer, placa del vehículo) y sube un
 *  .zip con todas — se empareja por ese valor, normalizado igual que el servidor. */
export interface FotoImportable {
  bucket: string;
  campoClave: string;     // 't' del CampoEntidad que identifica la fila (cedula/placa)
  campoDestino: string;   // columna de la tabla a actualizar con el path subido
  normalizar: (raw: string) => string; // mismo criterio de normalización que el RPC
  ruta: (id: string, filename: string) => string;
}
export interface EntidadImportable {
  key: string;
  label: string;
  rpc: string;
  odoo?: string;        // modelo de Odoo del que suele venir
  soportaDeshacer: boolean;
  campos: CampoEntidad[];
  foto?: FotoImportable;
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
      { t: 'anio', label: 'Año (si no se indica, usa el año actual)', alias: ['year', 'anio', 'año', 'model_year'] },
      { t: 'color', label: 'Color', alias: ['color'] },
      { t: 'tipo', label: 'Tipo', alias: ['vehicle_type', 'vehicle type', 'tipo', 'tipo de vehículo', 'tipo de vehiculo'], transform: 'enum', opciones: VEHICULO_TIPOS },
      // CQ4-e — campos nuevos del formulario real (vehiculos.html) que faltaban en la plantilla.
      { t: 'vin', label: 'VIN / Serial', alias: ['vin', 'serial', 'número de serial', 'numero de serial'] },
      { t: 'alias', label: 'Nombre / Alias', alias: ['alias', 'nombre del vehiculo', 'nombre del vehículo', 'apodo'] },
      { t: 'estado', label: 'Estado', alias: ['estado', 'status'], transform: 'enum', opciones: VEHICULO_ESTADOS },
      { t: 'uso', label: 'Uso (Obra/Oficina)', alias: ['uso', 'use'], transform: 'enum', opciones: VEHICULO_USOS },
      { t: 'medida_uso', label: 'Medida de uso (Km/Horas)', alias: ['medida_uso', 'medida de uso', 'unidad de lectura'], transform: 'enum', opciones: VEHICULO_MEDIDAS_USO },
      { t: 'kilometraje', label: 'Kilometraje / lectura actual', alias: ['kilometraje', 'km', 'odometro', 'odómetro', 'lectura'], transform: 'numero' },
      { t: 'capacidad_valor', label: 'Capacidad de carga (valor)', alias: ['capacidad_valor', 'capacidad de carga', 'capacidad'], transform: 'numero' },
      { t: 'capacidad_unidad', label: 'Unidad de capacidad', alias: ['capacidad_unidad', 'unidad de capacidad'], transform: 'enum', opciones: CAPACIDAD_UNIDADES },
      { t: 'numero_matricula', label: 'N° de matrícula', alias: ['numero_matricula', 'número de matrícula', 'no_matricula', 'matricula_numero'] },
      { t: 'vencimiento_matricula', label: 'Vencimiento de matrícula (AAAA-MM-DD)', alias: ['vencimiento_matricula', 'vencimiento matrícula'], transform: 'fecha' },
      { t: 'numero_seguro', label: 'N° de seguro (póliza)', alias: ['numero_seguro', 'número de póliza', 'poliza', 'póliza'] },
      { t: 'aseguradora', label: 'Compañía aseguradora', alias: ['aseguradora', 'compañía aseguradora', 'seguro'], opciones: VEHICULO_ASEGURADORAS.map((a) => ({ value: a, label: a })) },
      { t: 'vencimiento_seguro', label: 'Vencimiento de seguro (AAAA-MM-DD)', alias: ['vencimiento_seguro', 'vencimiento seguro'], transform: 'fecha' },
      { t: 'km_ultimo_mantenimiento', label: 'Km/horas último mantenimiento', alias: ['km_ultimo_mantenimiento', 'ultimo mantenimiento', 'último mantenimiento'], transform: 'numero' },
      { t: 'intervalo_mantenimiento_km', label: 'Intervalo de mantenimiento (km)', alias: ['intervalo_mantenimiento_km', 'intervalo km'], transform: 'numero' },
      { t: 'intervalo_mantenimiento_horas', label: 'Intervalo de mantenimiento (horas)', alias: ['intervalo_mantenimiento_horas', 'intervalo horas'], transform: 'numero' },
      { t: 'rendimiento_esperado_km_gal', label: 'Rendimiento esperado (km/gal)', alias: ['rendimiento_esperado_km_gal', 'rendimiento'], transform: 'numero' },
      { t: 'notas', label: 'Notas', alias: ['notas', 'nota', 'observaciones', 'observacion', 'observación'] },
      { t: 'es_prueba', label: 'Dato de prueba (sí/no)', alias: ['es_prueba', 'dato de prueba', 'prueba'], transform: 'bool' },
      CAMPO_ODOO_REF,
    ],
    foto: {
      bucket: 'vehiculos', campoClave: 'placa', campoDestino: 'foto_portada',
      normalizar: (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      ruta: (id, filename) => `vehiculo/${id}/import-${Date.now()}-${filename}`,
    },
  },
  {
    key: 'conductores', label: 'Choferes', rpc: 'importar_conductores',
    soportaDeshacer: true,
    campos: [
      { t: 'cedula', label: 'Cédula', alias: ['cedula', 'cédula', 'id', 'identificacion', 'identificación'], requerido: true },
      { t: 'nombre', label: 'Nombre', alias: ['nombre', 'name', 'chofer'], requerido: true },
      { t: 'telefono', label: 'Teléfono', alias: ['telefono', 'teléfono', 'phone', 'celular', 'movil', 'móvil'], transform: 'telefono' },
      { t: 'licencia_tipo', label: 'Categoría de licencia (código, ej. 02)', alias: ['licencia_tipo', 'categoria_licencia', 'categoría de licencia', 'cat_licencia'] },
      { t: 'licencia_numero', label: 'N° de licencia', alias: ['licencia_numero', 'numero_licencia', 'n° de licencia', 'no_licencia'] },
      { t: 'licencia_vencimiento', label: 'Vencimiento de licencia (AAAA-MM-DD)', alias: ['licencia_vencimiento', 'vencimiento_licencia', 'vencimiento'], transform: 'fecha' },
      { t: 'tipo_vehiculo_autorizado', label: 'Vehículo autorizado (Liviano/Pesado/Ambos)', alias: ['tipo_vehiculo_autorizado', 'vehiculo_autorizado'] },
      // CQ4-f — campos nuevos del formulario real (conductores.html) que faltaban en la plantilla.
      { t: 'vehiculo_id', label: 'Vehículo asignado (placa)', alias: ['vehiculo_id', 'vehiculo', 'placa_vehiculo', 'placa asignada'] },
      { t: 'tags', label: 'Tags (separados por coma)', alias: ['tags', 'etiquetas', 'roles'] },
      { t: 'activo', label: 'Activo (sí/no)', alias: ['activo', 'active'], transform: 'bool' },
      { t: 'nota', label: 'Nota', alias: ['nota', 'notas', 'observacion', 'observación'] },
    ],
    foto: {
      bucket: 'conductores', campoClave: 'cedula', campoDestino: 'foto_path',
      normalizar: (s) => s.replace(/\D/g, ''),
      ruta: (id, filename) => `conductor/${id}/import-${Date.now()}-${filename}`,
    },
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

/** CQ4-d — qué cambió un campo en una actualización: {campo: {antes, despues}}. */
export type CambiosFila = Record<string, { antes: unknown; despues: unknown }>;

export interface ResultadoImport {
  nuevos: number;
  actualizados: number;
  errores: { i: number; motivo: string }[];
  // Id real por fila (índice 1-based, igual al de `errores[].i`) — para emparejar
  // la foto del .zip con el registro ya creado/actualizado. CQ4-d — `accion` +
  // `cambios` (solo en 'actualizado') vienen del RPC, no se inventan en el cliente.
  filas: { i: number; id: string; accion?: 'creado' | 'actualizado'; cambios?: CambiosFila }[];
}

@Injectable({ providedIn: 'root' })
export class ImportadorService {
  private supabase = inject(SupabaseService);

  /** Normaliza un encabezado para el auto-match (minúsculas, sin acentos ni símbolos). */
  private norm(s: string): string {
    return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Auto-mapea las columnas del archivo a los campos de la entidad (incl. Odoo).
   *  CQ4-a — incluye `campo.label` entre los objetivos: la plantilla propia del SGC
   *  (`descargarPlantillaSgc`) usa el label TAL CUAL como encabezado de columna, así
   *  que esto garantiza que re-subir la plantilla siempre automapea el 100%, sin
   *  depender de que `alias` repita cada label verboso. */
  autoMapeo(entidad: EntidadImportable, headers: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    const normHeaders = headers.map((h) => ({ h, n: this.norm(h) }));
    for (const campo of entidad.campos) {
      const objetivos = [campo.t, campo.label, ...campo.alias].map((a) => this.norm(a));
      const found = normHeaders.find((h) => objetivos.includes(h.n));
      if (found) map[campo.t] = found.h;
    }
    return map;
  }

  /** CQ4-a — el auto-mapeo manda. Lo "recordado" (de una importación anterior,
   *  `importaciones_mapeo_get`) SOLO rellena un campo que el auto-mapeo NO encontró,
   *  y únicamente si (1) la columna recordada existe entre los headers de ESTE
   *  archivo y (2) el valor recordado no es ''. Antes era al revés: lo recordado
   *  pisaba el auto-mapeo fresco (incluso vacío o de un archivo con columnas
   *  distintas) → con un archivo nuevo casi todo salía sin mapear. */
  fusionarMapeoRecordado(auto: Record<string, string>, recordado: Record<string, string>, headers: string[]): Record<string, string> {
    const out = { ...auto };
    for (const [campo, col] of Object.entries(recordado ?? {})) {
      if (out[campo]) continue;        // el auto-mapeo ya lo encontró — gana
      if (!col) continue;              // recordado vacío
      if (!headers.includes(col)) continue; // columna de otro archivo
      out[campo] = col;
    }
    return out;
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

  /** CQ4-e — fecha a AAAA-MM-DD: ya en ISO, DD/MM/AAAA, o serie numérica de Excel
   *  (cuando SheetJS deja crudo el serial de una celda con formato de fecha). */
  private normFecha(raw: string): { valor: string; nota?: string } {
    const s = (raw ?? '').toString().trim();
    if (!s) return { valor: '' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { valor: s };
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      const [, d, mo, y] = m;
      const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      return { valor: iso, nota: `${s} → ${iso}` };
    }
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (n > 20000 && n < 60000) { // rango plausible de series de fecha de Excel
        const base = Date.UTC(1899, 11, 30);
        const d = new Date(base + n * 86400000);
        const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        return { valor: iso, nota: `serie Excel ${s} → ${iso}` };
      }
    }
    return { valor: s, nota: `fecha "${s}" no reconocida (usa AAAA-MM-DD)` };
  }
  /** CQ4-e — número con separador de miles/decimal común en RD ("84,200" → 84200). */
  private normNumero(raw: string): { valor: string; nota?: string } {
    const s = (raw ?? '').toString().trim();
    if (!s) return { valor: '' };
    const limpio = s.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number(limpio);
    if (!Number.isNaN(n) && limpio !== '') return { valor: String(n), nota: s !== String(n) ? `${s} → ${n}` : undefined };
    return { valor: s, nota: `número "${s}" no reconocido` };
  }
  /** CQ4-e — valor o etiqueta de una lista de opciones (tipo/estado/uso/unidad…) → `value` canónico. */
  private normEnum(raw: string, opciones: { value: string; label: string }[]): { valor: string; nota?: string } {
    const s = (raw ?? '').toString().trim();
    if (!s) return { valor: '' };
    const n = this.norm(s);
    const found = opciones.find((o) => this.norm(o.value) === n || this.norm(o.label) === n);
    if (found) return { valor: found.value, nota: s !== found.value ? `${s} → ${found.value}` : undefined };
    return { valor: s, nota: `"${s}" sin equivalencia (se usa tal cual)` };
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
      case 'fecha': return this.normFecha(String(raw));
      case 'numero': return this.normNumero(String(raw));
      case 'enum': return this.normEnum(String(raw), campo.opciones ?? []);
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

  /** CQ4-c — empareja cada foto del .zip con su fila por el campo clave normalizado
   *  (cédula/placa), SIN subir nada: puro cálculo, reutilizado por el preview de
   *  miniaturas (paso 4) y por la subida real tras importar. */
  emparejarFotos(entidad: EntidadImportable, filas: Record<string, unknown>[], zip: Map<string, Blob> | null): Map<number, string> {
    const out = new Map<number, string>();
    const foto = entidad.foto;
    if (!foto || !zip || zip.size === 0) return out;
    const usados = new Set<string>();
    for (let i = 0; i < filas.length; i++) {
      const claveRaw = String(filas[i][foto.campoClave] ?? '').trim();
      if (!claveRaw) continue;
      const clave = foto.normalizar(claveRaw);
      if (!clave) continue;
      const match = [...zip.keys()].find((nombre) => !usados.has(nombre) && foto.normalizar(nombre.replace(/\.[^.]+$/, '')) === clave);
      if (!match) continue;
      out.set(i, match);
      usados.add(match);
    }
    return out;
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
    const d = (data ?? {}) as {
      nuevos?: number; actualizados?: number; insertados?: number;
      errores?: { i: number; motivo: string }[];
      filas?: { i: number; id: string; accion?: 'creado' | 'actualizado'; cambios?: CambiosFila }[];
    };
    return {
      nuevos: d.nuevos ?? d.insertados ?? 0,
      actualizados: d.actualizados ?? 0,
      errores: d.errores ?? [],
      filas: d.filas ?? [],
    };
  }

  /** Sube la foto emparejada del .zip al bucket de la entidad y la enlaza a la fila. */
  async subirFoto(entidad: EntidadImportable, id: string, filename: string, blob: Blob): Promise<void> {
    const foto = entidad.foto;
    if (!foto) throw new Error(`${entidad.label} no admite foto por importación.`);
    const path = foto.ruta(id, filename);
    const { error: upErr } = await this.supabase.client.storage.from(foto.bucket).upload(path, blob, { upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error: dbErr } = await this.supabase.client.from(entidad.key).update({ [foto.campoDestino]: path }).eq('id', id);
    if (dbErr) throw new Error(dbErr.message);
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
