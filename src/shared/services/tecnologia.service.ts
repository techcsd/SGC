import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  TecHerramienta,
  TecHerramientaFormData,
  TecMatrizEntry,
  TecEquipo,
  TecEquipoFormData,
  TecEquipoHistorial,
  TecCompraOpcion,
  TecCategoria,
  TEC_CATEGORIAS,
  TEC_EQUIPO_ESTADOS,
  TEC_EQUIPO_CONDICIONES,
  TecEquipoEstadoCat,
  TecEquipoSpecs,
  TecEquipoSpecsFormData,
  TecGrupoCampos,
  TecKitEstado,
  TecEquipoClaveResultado,
  TecCotizacion,
  TecCotizacionFormData,
} from '../models/tecnologia.model';
import { pickColumns } from '../utils/pick-columns.util';

/** BN3 (regla 10) — columnas reales de prod (verificadas). */
const TEC_HERRAMIENTA_COLS = new Set<string>([
  'nombre', 'categoria', 'para_que', 'quien_usa', 'url', 'activo', 'orden', 'updated_at',
]);
const TEC_EQUIPO_COLS = new Set<string>([
  'codigo', 'nombre', 'tipo', 'marca', 'modelo', 'serie', 'estado', 'condicion', 'empleado_id',
  'asignado_en', 'ubicacion', 'notas', 'activo', 'updated_at', 'foto_path', 'costo',
  'fecha_compra', 'garantia_hasta', 'origen_solicitud_compra_id', 'tipo_id', 'bodega_id',
  'moneda', 'fotos', 'foto_portada',
  // DA2 — identificación + DA-11/DA-12/DA-14
  'service_tag', 'codigo_servicio', 'numero_parte', 'modelo_regulatorio', 'anio_fabricacion',
  'codigo_anterior', 'imei', 'etiqueta_taller', 'responsable_externo',
  'costo_origen', 'fecha_compra_desconocida', 'garantia_desconocida', 'fotos_specs',
  // DA-10 — kits
  'kit_padre_id', 'presente',
]);
const TEC_EQUIPO_SPECS_COLS = new Set<string>([
  'procesador', 'ram_gb', 'ram_velocidad', 'almacenamiento_tipo', 'almacenamiento_gb',
  'gpu_integrada', 'gpu_dedicada', 'gpu_memoria_gb', 'so', 'so_version',
  'pantalla_pulgadas', 'resolucion', 'tactil', 'nombre_windows', 'usuario_windows',
  'cargador_voltaje', 'cargador_amperaje', 'frecuencia', 'potencia_w', 'tipo_radio',
  'sello_telserdom_radio', 'sello_telserdom_bateria', 'bateria_modelo', 'bateria_capacidad',
  'bateria_unidad', 'bateria_voltaje', 'bateria_sello', 'accesorios', 'camara_specs',
]);
import { formatFechaMedia } from '../utils/fecha.util';
import { SolicitudCompra, LecturaCotizacion } from '../models/solicitud.model';

/** CQ1 — payload del encabezado + renglones de una compra tecnológica (crear/editar). */
export interface CompraTecFormPayload {
  notas: string | null;
  titulo: string | null;
  urgencia: 'normal' | 'urgente';
  proyecto_id: string | null;
  itbis_incluido: boolean;
  items: {
    descripcion: string;
    cantidad: number;
    unidad: string | null;
    precio_unitario: number | null;
    proveedor_sugerido?: string | null;
    foto_path?: string | null;
  }[];
}

/** CQ1 — respuesta de la edge `leer-cotizacion`. */
export interface LeerCotizacionResultado {
  ok: boolean;
  lectura?: LecturaCotizacion;
  confianza?: Record<string, number>;
  modelo?: string;
  costo_usd?: number;
  error?: string;
  error_code?: string;
}

@Injectable({ providedIn: 'root' })
export class TecnologiaService {
  private supabase = inject(SupabaseService);

  // ── AD5 — Catálogo administrable de categorías ────────────
  /**
   * Categorías activas del catálogo `sgc.tec_categorias`. Cae al fallback local
   * (TEC_CATEGORIAS) si la tabla no responde, para no dejar el select vacío.
   */
  async getCategorias(): Promise<{ value: string; label: string }[]> {
    const { data, error } = await this.supabase.client
      .from('tec_categorias')
      .select('clave, label, orden, activo')
      .eq('activo', true)
      .order('orden', { ascending: true });
    if (error || !data || data.length === 0) return TEC_CATEGORIAS;
    return (data as unknown as TecCategoria[]).map((c) => ({ value: c.clave, label: c.label }));
  }

  /** AD5 — alta de una categoría nueva (admin/tecnología). Devuelve la clave. */
  async addCategoria(label: string): Promise<{ value: string; label: string }> {
    const clave = label
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    const { data, error } = await this.supabase.client
      .from('tec_categorias')
      .insert({ clave, label: label.trim(), orden: 150 })
      .select('clave, label')
      .single();
    if (error) throw new Error(error.message);
    return { value: (data as { clave: string }).clave, label: (data as { label: string }).label };
  }

  // ── AL1 — Catálogo administrable de TIPOS de equipo tecnológico ───────────
  /** Tipos activos de `sgc.tec_equipo_tipos` (Walkie-talkie, Laptop, …). DA-03:
   *  incluye `grupos_campos` para que el formulario sepa qué bloque de specs mostrar. */
  async getEquipoTipos(): Promise<{ value: string; label: string; grupos_campos: TecGrupoCampos[] }[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipo_tipos')
      .select('id, clave, label, orden, activo, grupos_campos')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('label', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((t) => {
      const row = t as { id: string; label: string; grupos_campos: TecGrupoCampos[] | null };
      return { value: row.id, label: row.label, grupos_campos: row.grupos_campos ?? [] };
    });
  }

  /** AL1 — alta de un tipo nuevo (admin/tecnología). Devuelve {value:id, label}. */
  async addEquipoTipo(label: string): Promise<{ value: string; label: string; grupos_campos: TecGrupoCampos[] }> {
    const clave = this.slugClave(label);
    const { data, error } = await this.supabase.client
      .from('tec_equipo_tipos')
      .insert({ clave, label: label.trim(), orden: 200 })
      .select('id, label')
      .single();
    if (error) throw new Error(error.message);
    return { value: (data as { id: string }).id, label: (data as { label: string }).label, grupos_campos: [] };
  }

  // ── DA7/DA-04 — Catálogos administrables de situación/condición ──────────
  async getEquipoEstados(): Promise<{ value: string; label: string }[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipo_estados')
      .select('clave, label, orden, activo')
      .eq('activo', true)
      .order('orden', { ascending: true });
    if (error || !data || data.length === 0) return TEC_EQUIPO_ESTADOS;
    return (data as unknown as TecEquipoEstadoCat[]).map((e) => ({ value: e.clave, label: e.label }));
  }

  async addEquipoEstado(label: string): Promise<{ value: string; label: string }> {
    const clave = this.slugClave(label);
    const { data, error } = await this.supabase.client
      .from('tec_equipo_estados')
      .insert({ clave, label: label.trim(), orden: 200 })
      .select('clave, label')
      .single();
    if (error) throw new Error(error.message);
    return { value: (data as { clave: string }).clave, label: (data as { label: string }).label };
  }

  async getEquipoCondiciones(): Promise<{ value: string; label: string }[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipo_condiciones')
      .select('clave, label, orden, activo')
      .eq('activo', true)
      .order('orden', { ascending: true });
    if (error || !data || data.length === 0) return TEC_EQUIPO_CONDICIONES;
    return (data as unknown as TecEquipoEstadoCat[]).map((c) => ({ value: c.clave, label: c.label }));
  }

  async addEquipoCondicion(label: string): Promise<{ value: string; label: string }> {
    const clave = this.slugClave(label);
    const { data, error } = await this.supabase.client
      .from('tec_equipo_condiciones')
      .insert({ clave, label: label.trim(), orden: 200 })
      .select('clave, label')
      .single();
    if (error) throw new Error(error.message);
    return { value: (data as { clave: string }).clave, label: (data as { label: string }).label };
  }

  private slugClave(label: string): string {
    return label
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
  }

  // ── Homologación de herramientas ──────────────────────────
  async getHerramientas(soloActivas = false): Promise<TecHerramienta[]> {
    let q = this.supabase.client.from('tec_herramientas').select('*').order('orden', { ascending: true });
    if (soloActivas) q = q.eq('activo', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecHerramienta[];
  }

  async createHerramienta(payload: TecHerramientaFormData): Promise<TecHerramienta> {
    const { data, error } = await this.supabase.client
      .from('tec_herramientas')
      .insert(pickColumns(payload, TEC_HERRAMIENTA_COLS))
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as TecHerramienta;
  }

  async updateHerramienta(id: string, payload: Partial<TecHerramientaFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('tec_herramientas')
      .update(pickColumns({ ...payload, updated_at: new Date().toISOString() }, TEC_HERRAMIENTA_COLS))
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async removeHerramienta(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_herramientas').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Matriz puesto × herramienta ───────────────────────────
  async getMatriz(): Promise<TecMatrizEntry[]> {
    const { data, error } = await this.supabase.client
      .from('tec_matriz')
      .select('*, herramienta:tec_herramientas(nombre, categoria)')
      .order('puesto', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecMatrizEntry[];
  }

  async addMatriz(payload: {
    puesto: string;
    herramienta_id: string;
    obligatorio: boolean;
    notas: string | null;
  }): Promise<TecMatrizEntry> {
    const { data, error } = await this.supabase.client
      .from('tec_matriz')
      .insert(payload)
      .select('*, herramienta:tec_herramientas(nombre, categoria)')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as TecMatrizEntry;
  }

  async removeMatriz(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_matriz').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // QA-080 — puestos distintos (union de empleados.cargo + tec_matriz.puesto)
  // para alimentar el <datalist> del campo puesto y así deduplicar tipeos.
  // Best-effort: cualquier fallo devuelve [] sin romper la pantalla.
  async getPuestosSugeridos(): Promise<string[]> {
    try {
      const [cargosRes, matrizRes] = await Promise.all([
        this.supabase.client.from('empleados').select('cargo'),
        this.supabase.client.from('tec_matriz').select('puesto'),
      ]);
      const set = new Set<string>();
      for (const r of cargosRes.data ?? []) {
        const c = (r as { cargo?: string | null }).cargo?.trim();
        if (c) set.add(c);
      }
      for (const r of matrizRes.data ?? []) {
        const p = (r as { puesto?: string | null }).puesto?.trim();
        if (p) set.add(p);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
    } catch {
      return [];
    }
  }

  // ── Inventario tecnológico ────────────────────────────────
  async getEquipos(): Promise<TecEquipo[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipos')
      .select('*, empleado:empleados(nombre, apellido, cargo), specs:tec_equipo_specs(*)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    // PostgREST entrega el 1:1 como arreglo de 0/1 — se aplana a objeto|null.
    return ((data ?? []) as unknown as (TecEquipo & { specs: TecEquipoSpecs[] | null })[]).map((e) => ({
      ...e,
      specs: Array.isArray(e.specs) ? (e.specs[0] ?? null) : e.specs,
    }));
  }

  /** QA-072 — Equipos TI activos asignados a un empleado (solo lectura, para RRHH). */
  async getEquiposByEmpleado(empleadoId: string): Promise<TecEquipo[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipos')
      .select('*')
      .eq('empleado_id', empleadoId)
      .eq('activo', true)
      .order('codigo', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecEquipo[];
  }

  // DA9 — el código TEC-#### ya no lo calcula el navegador (condición de carrera
  // real con altas simultáneas/lote/app): se omite `codigo` en el insert y lo
  // asigna la secuencia+trigger del servidor (sql/2026-10-27-da1-base-equipos.sql).
  async createEquipo(payload: TecEquipoFormData): Promise<TecEquipo> {
    const { data, error } = await this.supabase.client
      .from('tec_equipos')
      .insert(pickColumns({ ...payload }, TEC_EQUIPO_COLS))
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as TecEquipo;
  }

  // DA8 — el historial ya no lo escribe el navegador (solo web, ciego a la app y
  // al conector): lo escribe un trigger del servidor en cada INSERT/UPDATE real.
  async updateEquipo(id: string, payload: Partial<TecEquipoFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('tec_equipos')
      .update(pickColumns({ ...payload, updated_at: new Date().toISOString() }, TEC_EQUIPO_COLS))
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async removeEquipo(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_equipos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── DA2 — Especificaciones técnicas (1:1, sgc.tec_equipo_specs) ──────────
  /** Upsert (crea o actualiza) la fila 1:1 de specs. Payload parcial: solo lo
   *  que viene se guarda, el resto queda null/como estaba (whitelist de columnas). */
  async guardarSpecs(equipoId: string, payload: Partial<TecEquipoSpecsFormData>): Promise<void> {
    const row = pickColumns(payload, TEC_EQUIPO_SPECS_COLS);
    const tieneAlgo = Object.values(row).some((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (!tieneAlgo) return; // nada que guardar — no crea una fila vacía
    const { error } = await this.supabase.client
      .from('tec_equipo_specs')
      .upsert({ equipo_id: equipoId, ...row }, { onConflict: 'equipo_id' });
    if (error) throw new Error(error.message);
  }

  // ── DA-18 — alerta de garantía por vencer ─────────────────────────────────
  async getGarantiaAlertaDias(): Promise<number> {
    try {
      const { data } = await this.supabase.client.from('parametros').select('valor').eq('clave', 'tec_garantia_alerta_dias').maybeSingle();
      const n = data ? Number((data as { valor?: string }).valor) : NaN;
      return Number.isFinite(n) ? n : 30;
    } catch {
      return 30;
    }
  }

  // ── DA9/DA-13 — Lector de capturas de "Información del sistema" de Windows ──
  /** Lee hasta 3 capturas; SOLO precarga para revisar, nunca guarda sola. */
  async leerEspecificacionesEquipo(files: File[]): Promise<{
    ok: boolean; specs?: Partial<TecEquipoSpecsFormData>; error?: string; error_code?: string;
  }> {
    const archivos = await Promise.all(
      files.slice(0, 3).map(async (file) => ({ data: await this.fileToBase64(file), mime: file.type || 'image/jpeg' })),
    );
    const { data, error } = await this.supabase.client.functions.invoke('leer-especificaciones-equipo', {
      body: { archivos },
    });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed && typeof parsed === 'object') return { ok: false, ...parsed };
        } catch { /* cae al mensaje genérico */ }
      }
      return { ok: false, error: 'No se pudo leer la captura.' };
    }
    return data as { ok: boolean; specs?: Partial<TecEquipoSpecsFormData>; error?: string };
  }

  // ── DA-10 — Kits ───────────────────────────────────────────────────────────
  /** Componentes de un kit (equipos con kit_padre_id = kitId). */
  async getComponentesDeKit(kitId: string): Promise<TecEquipo[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipos')
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .eq('kit_padre_id', kitId)
      .order('codigo', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecEquipo[];
  }

  async getKitEstado(kitId: string): Promise<TecKitEstado | null> {
    const { data, error } = await this.supabase.client
      .from('tec_kits_estado')
      .select('*')
      .eq('kit_id', kitId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as TecKitEstado | null;
  }

  /** Mueve el kit completo: cascada a todos los componentes PRESENTES. */
  async moverKit(kitId: string, empleadoId: string | null, bodegaId: string | null, ubicacion: string | null, motivo: string | null = null): Promise<void> {
    const { error } = await this.supabase.client.rpc('tec_kit_mover', {
      p_kit_id: kitId, p_empleado_id: empleadoId, p_bodega_id: bodegaId, p_ubicacion: ubicacion, p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  /** Mueve o suelta una pieza individual del kit. */
  async moverPiezaDeKit(
    componenteId: string,
    quitarDelKit: boolean,
    empleadoId: string | null = null,
    bodegaId: string | null = null,
    motivo: string | null = null,
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('tec_kit_mover_pieza', {
      p_componente_id: componenteId, p_quitar_del_kit: quitarDelKit,
      p_empleado_id: empleadoId, p_bodega_id: bodegaId, p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  /** Marca presente/falta un componente (sin moverlo). */
  async marcarPresenteComponente(componenteId: string, presente: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('tec_equipos').update({ presente }).eq('id', componenteId);
    if (error) throw new Error(error.message);
  }

  // ── DA-06 — Clave del equipo (cifrada, solo vía edge equipos-clave) ───────
  async verClaveEquipo(equipoId: string): Promise<TecEquipoClaveResultado> {
    return this.invokeClave('ver', equipoId);
  }
  async guardarClaveEquipo(equipoId: string, tipoClave: 'personal' | 'compartida', valor: string): Promise<TecEquipoClaveResultado> {
    return this.invokeClave('guardar', equipoId, { tipo_clave: tipoClave, valor });
  }
  async quitarClaveEquipo(equipoId: string): Promise<TecEquipoClaveResultado> {
    return this.invokeClave('quitar', equipoId);
  }
  private async invokeClave(accion: string, equipoId: string, extra: Record<string, unknown> = {}): Promise<TecEquipoClaveResultado> {
    const { data, error } = await this.supabase.client.functions.invoke('equipos-clave', {
      body: { accion, equipo_id: equipoId, ...extra },
    });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed && typeof parsed === 'object') return { ok: false, ...parsed };
        } catch { /* cae al mensaje genérico */ }
      }
      return { ok: false, error: 'No se pudo completar la operación.' };
    }
    return data as TecEquipoClaveResultado;
  }

  // ── U17 — Foto del equipo (bucket privado `inventario`) ───────────────────
  async uploadEquipoFoto(equipoId: string, file: File): Promise<string> {
    const path = `tec-equipo/${equipoId}/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('inventario')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw new Error(error.message);
    return path;
  }

  // DA-14 — foto "especificaciones" (captura de Windows), bucket/carpeta
  // separada de la portada (AL1) para no competir con ella.
  async uploadEquipoFotoSpecs(equipoId: string, file: File): Promise<string> {
    const path = `tec-equipo/${equipoId}/specs/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('inventario')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw new Error(error.message);
    return path;
  }

  async getEquipoFotoUrl(path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from('inventario')
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  async getHistorial(equipoId: string): Promise<TecEquipoHistorial[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipo_historial')
      .select('*')
      .eq('equipo_id', equipoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecEquipoHistorial[];
  }

  // ── Compras tecnológicas (usa solicitudes_compra, categoria='tecnologia') ──
  // CO8 — dos FKs a usuarios además de solicitante/atendido (aprobador_id,
  // decidida_por): hay que nombrar el fk o PostgREST da embed ambiguo.
  private readonly COMPRA_TEC_SELECT =
    '*, items:solicitud_compra_items(*), adjuntos:solicitud_compra_adjuntos(*), ' +
    'aprobador:usuarios!solicitudes_compra_aprobador_id_fkey(nombre), ' +
    'decidida:usuarios!solicitudes_compra_decidida_por_fkey(nombre)';

  async getComprasTec(): Promise<SolicitudCompra[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select(this.COMPRA_TEC_SELECT)
      .eq('categoria', 'tecnologia')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SolicitudCompra[];
  }

  /** CQ1 — una compra tecnológica por id (para la página de edición de borrador). */
  async getCompraTecById(id: string): Promise<SolicitudCompra | null> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select(this.COMPRA_TEC_SELECT)
      .eq('id', id)
      .eq('categoria', 'tecnologia')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as SolicitudCompra | null;
  }

  /** CQ1 — nombre de quien aprueba compras tecnológicas hoy (para mostrarlo en el
   *  botón "Enviar a <nombre> para aprobar" ANTES de crear la solicitud). Best-effort:
   *  null si no hay parámetro configurado o la lectura falla (el botón cae a un
   *  texto genérico). */
  async getAprobadorCompraTecNombre(): Promise<string | null> {
    try {
      const { data: param } = await this.supabase.client
        .from('parametros')
        .select('valor')
        .eq('clave', 'compras_tec_aprobador')
        .maybeSingle();
      const aprobadorId = (param as { valor?: string } | null)?.valor;
      if (!aprobadorId) return null;
      const { data: usuario } = await this.supabase.client
        .from('usuarios')
        .select('nombre')
        .eq('id', aprobadorId)
        .maybeSingle();
      return (usuario as { nombre?: string } | null)?.nombre ?? null;
    } catch {
      return null;
    }
  }

  // CO8 — flujo borrador → esperando aprobación → aprobada/rechazada → comprada.
  async enviarAprobacionCompraTec(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('compra_tec_enviar_aprobacion', { p_id: id });
    if (error) throw new Error(error.message);
  }
  async decidirCompraTec(id: string, aprobar: boolean, motivo: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('compra_tec_decidir', { p_id: id, p_aprobar: aprobar, p_motivo: motivo });
    if (error) throw new Error(error.message);
  }
  async marcarCompradaCompraTec(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('compra_tec_marcar_comprada', { p_id: id });
    if (error) throw new Error(error.message);
  }

  /** CO8/CQ1 — sube la cotización (PDF/imagen) al bucket privado y la registra,
   *  incluyendo lo que leyó la IA (CQ1, para auditoría — AT11: todo lo que se envía
   *  debe poder verse; `lectura` queda guardada tal cual en el adjunto). */
  async subirCotizacion(
    solicitudId: string,
    file: File,
    datos: {
      tipo: 'cotizacion' | 'factura' | 'otro';
      proveedor: string | null;
      monto: number | null;
      fecha?: string | null;
      lectura?: LecturaCotizacion | null;
      lectura_costo_usd?: number | null;
    },
  ): Promise<string> {
    const path = `${solicitudId}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await this.supabase.client.storage.from('compras-cotizaciones').upload(path, file);
    if (upErr) throw new Error(upErr.message);
    const { data, error } = await this.supabase.client.rpc('compra_tec_adjuntar_cotizacion', {
      p_id: solicitudId, p_tipo: datos.tipo, p_proveedor: datos.proveedor, p_monto: datos.monto,
      p_path: path, p_nombre: file.name,
      p_fecha: datos.fecha ?? null, p_lectura: datos.lectura ?? null, p_lectura_costo_usd: datos.lectura_costo_usd ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** CQ1 — lee una cotización (PDF/foto) con IA; NUNCA bloquea el flujo: si falla,
   *  el llamador deja al usuario llenar a mano. Convierte el File a base64 aquí
   *  para que la página no repita ese código. */
  async leerCotizacion(file: File): Promise<LeerCotizacionResultado> {
    const base64 = await this.fileToBase64(file);
    const mime = file.type || 'application/pdf';
    const { data, error } = await this.supabase.client.functions.invoke('leer-cotizacion', {
      body: { archivo: { data: base64, mime } },
    });
    if (error) {
      // La edge devuelve un cuerpo JSON incluso en 4xx/5xx (error_code incluido); intenta leerlo.
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed && typeof parsed === 'object') return { ok: false, ...parsed };
        } catch { /* cae al mensaje genérico */ }
      }
      return { ok: false, error: 'No se pudo leer la cotización.' };
    }
    return data as LeerCotizacionResultado;
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  async elegirCotizacion(adjuntoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('compra_tec_elegir_cotizacion', { p_adjunto_id: adjuntoId });
    if (error) throw new Error(error.message);
  }
  async getCotizacionUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from('compras-cotizaciones').createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  // QA-070 — opciones ligeras para el selector "Origen: compra tecnológica".
  // Lista las solicitudes de compra tecnológicas más recientes con una etiqueta
  // legible (fecha + resumen de renglones). Best-effort: [] ante cualquier error.
  async getComprasTecOpciones(limite = 30): Promise<TecCompraOpcion[]> {
    try {
      const { data, error } = await this.supabase.client
        .from('solicitudes_compra')
        .select('id, created_at, notas, items:solicitud_compra_items(descripcion)')
        .eq('categoria', 'tecnologia')
        .order('created_at', { ascending: false })
        .limit(limite);
      if (error) return [];
      return (data ?? []).map((row) => {
        const r = row as {
          id: string;
          created_at: string;
          notas: string | null;
          items?: { descripcion: string }[];
        };
        const resumen =
          r.items?.map((i) => i.descripcion).filter(Boolean).slice(0, 3).join(', ') ||
          r.notas ||
          'Compra tecnológica';
        return { id: r.id, label: `${formatFechaMedia(r.created_at)} — ${resumen}` };
      });
    } catch {
      return [];
    }
  }

  /** CQ1 — crea el borrador con encabezado completo (título/urgencia/obra/ITBIS).
   *  El subtotal/ITBIS/total los calcula el SERVIDOR a partir de `items` (regla 3 —
   *  integridad: nunca se confía en un total mandado por el cliente). */
  async crearCompraTec(payload: CompraTecFormPayload): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_solicitud_compra_tec', {
      p_notas: payload.notas,
      p_items: payload.items,
      p_titulo: payload.titulo,
      p_urgencia: payload.urgencia,
      p_proyecto_id: payload.proyecto_id,
      p_itbis_incluido: payload.itbis_incluido,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** CQ1 — edita un borrador existente (servidor valida estado='borrador' + dueño/admin).
   *  Reemplaza los renglones (borra + reinserta, mismo patrón que otros módulos). */
  async actualizarBorradorCompraTec(id: string, payload: CompraTecFormPayload): Promise<void> {
    const { error } = await this.supabase.client.rpc('compra_tec_actualizar_borrador', {
      p_id: id,
      p_notas: payload.notas,
      p_titulo: payload.titulo,
      p_urgencia: payload.urgencia,
      p_proyecto_id: payload.proyecto_id,
      p_itbis_incluido: payload.itbis_incluido,
      p_items: payload.items,
    });
    if (error) throw new Error(error.message);
  }

  // ── CZ1/CZ2 — biblioteca de Cotizaciones de Tecnología ─────────────────────
  private readonly COTIZACION_SELECT =
    '*, compras:tec_cotizacion_compras(solicitud_compra_id), equipos:tec_cotizacion_equipos(equipo_id, linea_idx)';

  async getCotizaciones(): Promise<TecCotizacion[]> {
    const { data, error } = await this.supabase.client
      .from('tec_cotizaciones')
      .select(this.COTIZACION_SELECT)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecCotizacion[];
  }

  async getCotizacionById(id: string): Promise<TecCotizacion | null> {
    const { data, error } = await this.supabase.client
      .from('tec_cotizaciones')
      .select(this.COTIZACION_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as TecCotizacion | null;
  }

  /** CZ1 — crea el registro de biblioteca; si viene `file`, lo sube primero al
   *  bucket ya existente `compras-cotizaciones` bajo `biblioteca/<id>/…`
   *  (reusa el bucket de CO8, no crea uno nuevo — DZ-02). */
  async crearCotizacion(payload: TecCotizacionFormData, archivo?: { file: File; lectura?: LecturaCotizacion | null; lecturaCostoUsd?: number | null }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('cotizacion_crear', {
      p_titulo: payload.titulo,
      p_proveedor: payload.proveedor,
      p_fecha: payload.fecha,
      p_moneda: payload.moneda,
      p_subtotal: payload.subtotal,
      p_itbis: payload.itbis,
      p_total: payload.total,
      p_archivo_path: null,
      p_archivo_nombre: null,
      p_lectura: archivo?.lectura ?? null,
      p_lectura_costo_usd: archivo?.lecturaCostoUsd ?? null,
      p_notas: payload.notas,
    });
    if (error) throw new Error(error.message);
    const id = data as string;
    if (archivo?.file) {
      const path = `biblioteca/${id}/${crypto.randomUUID()}-${archivo.file.name}`;
      const { error: upErr } = await this.supabase.client.storage.from('compras-cotizaciones').upload(path, archivo.file);
      if (upErr) throw new Error(upErr.message);
      await this.cotizacionActualizarArchivo(id, path, archivo.file.name);
    }
    return id;
  }

  private async cotizacionActualizarArchivo(id: string, path: string, nombre: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_setear_archivo', {
      p_id: id, p_archivo_path: path, p_archivo_nombre: nombre,
    });
    if (error) throw new Error(error.message);
  }

  async actualizarCotizacion(id: string, payload: TecCotizacionFormData): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_actualizar', {
      p_id: id,
      p_titulo: payload.titulo,
      p_proveedor: payload.proveedor,
      p_fecha: payload.fecha,
      p_moneda: payload.moneda,
      p_subtotal: payload.subtotal,
      p_itbis: payload.itbis,
      p_total: payload.total,
      p_notas: payload.notas,
    });
    if (error) throw new Error(error.message);
  }

  async descartarCotizacion(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_descartar', { p_id: id });
    if (error) throw new Error(error.message);
  }
  async restaurarCotizacion(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_restaurar', { p_id: id });
    if (error) throw new Error(error.message);
  }

  async vincularCotizacionCompra(cotizacionId: string, solicitudCompraId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_vincular_compra', {
      p_cotizacion_id: cotizacionId,
      p_solicitud_compra_id: solicitudCompraId,
    });
    if (error) throw new Error(error.message);
  }
  async desvincularCotizacionCompra(cotizacionId: string, solicitudCompraId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_desvincular_compra', {
      p_cotizacion_id: cotizacionId,
      p_solicitud_compra_id: solicitudCompraId,
    });
    if (error) throw new Error(error.message);
  }
  async vincularCotizacionEquipo(cotizacionId: string, equipoId: string, lineaIdx: number | null = null): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_vincular_equipo', {
      p_cotizacion_id: cotizacionId,
      p_equipo_id: equipoId,
      p_linea_idx: lineaIdx,
    });
    if (error) throw new Error(error.message);
  }
  async desvincularCotizacionEquipo(cotizacionId: string, equipoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cotizacion_desvincular_equipo', {
      p_cotizacion_id: cotizacionId,
      p_equipo_id: equipoId,
    });
    if (error) throw new Error(error.message);
  }

  /** DZ-06 — ficha del equipo: cotización de origen (directa, o si no hay, la
   *  elegida/usada de su `origen_solicitud_compra_id`). Best-effort. */
  async getCotizacionDeEquipo(equipoId: string): Promise<{ cotizacion_id: string; titulo: string; directa: boolean } | null> {
    try {
      const { data, error } = await this.supabase.client.rpc('cotizacion_de_equipo', { p_equipo_id: equipoId });
      if (error || !data || !(data as unknown[]).length) return null;
      return (data as { cotizacion_id: string; titulo: string; directa: boolean }[])[0];
    } catch {
      return null;
    }
  }

  /** DZ-02 (ficha de la compra): link a la biblioteca para cada adjunto que
   *  tenga una entrada registrada. Best-effort: {} si falla. */
  async getCotizacionIdsPorAdjuntos(adjuntoIds: string[]): Promise<Record<string, string>> {
    if (!adjuntoIds.length) return {};
    try {
      const { data, error } = await this.supabase.client
        .from('tec_cotizaciones')
        .select('id, adjunto_id')
        .in('adjunto_id', adjuntoIds);
      if (error) return {};
      const out: Record<string, string> = {};
      for (const row of (data ?? []) as { id: string; adjunto_id: string | null }[]) {
        if (row.adjunto_id) out[row.adjunto_id] = row.id;
      }
      return out;
    } catch {
      return {};
    }
  }

}
