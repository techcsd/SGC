// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Run this SQL once to enable full admin access to all modules:
//
// update sgc.roles
//   set modulos = array['inventario','compras','rrhh','proyectos','flota','admin']
//   where codigo = 'admin';
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  FaseProyecto,
  Proyecto,
  ProyectoEmpleado,
  ProyectoEstado,
  EquipoMiembroFormData,
  ExpedienteDoc,
  ExpedienteResumen,
  ProyectoReadiness,
  ProyectoResponsableLite,
  TipoResponsabilidad,
} from '../models/proyecto.model';
import {
  ProyectoPartida,
  ProyectoPartidaFormData,
  ProyectoAvance,
  AvisoProyecto,
} from '../models/proyecto-partida.model';

const EXPEDIENTE_BUCKET = 'sgc-documentos';

/** AP1 — obra de referencia (subconjunto seguro, sin financieros) para selectores. */
export interface ObraRef {
  id: string;
  codigo: string | null;
  nombre: string;
  estado: string | null;
  ubicacion: string | null;
  activo: boolean;
  latitud: number | null;
  longitud: number | null;
}

/** AA23 QW4 — costo de material real consumido por una obra. */
export interface CostoMaterialObra {
  total: number;
  por_articulo: {
    articulo_id: string;
    nombre: string;
    unidad: string;
    cantidad: number;
    costo_unit_prom: number;
    costo: number;
  }[];
}

/** AH15/AS14 — una compra ligada a un proyecto (OC, ferretería o gasto directo). */
export interface CompraProyecto {
  tipo: 'orden_compra' | 'ferreteria' | 'gasto_directo';
  id: string;
  fecha: string | null;
  proveedor: string | null;
  total: number | null;
  estado: string | null;
  referencia: string | null;
}

/** AS14 — categoría de gasto directo (catálogo flexible sgc.gasto_categorias). */
export interface GastoCategoria {
  clave: string;
  label: string;
}

/** AS14 — payload para registrar un gasto directo del proyecto. */
export interface GastoDirectoPayload {
  proyecto_id: string;
  categoria: string;
  concepto: string;
  monto: number;
  fecha?: string | null;
  recibo_path?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProyectosService {
  private supabase = inject(SupabaseService);

  /** AH15 — compras de un proyecto (OC + ferretería), filtro de fechas opcional. */
  async getComprasProyecto(
    proyectoId: string,
    desde?: string | null,
    hasta?: string | null,
  ): Promise<CompraProyecto[]> {
    const { data, error } = await this.supabase.client.rpc('compras_de_proyecto', {
      p_proyecto_id: proyectoId,
      p_desde: desde ?? null,
      p_hasta: hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as CompraProyecto[];
  }

  /** AS14 — categorías de gasto directo (catálogo flexible). */
  async getGastoCategorias(): Promise<GastoCategoria[]> {
    const { data, error } = await this.supabase.client
      .from('gasto_categorias')
      .select('clave, label')
      .eq('activo', true)
      .order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as GastoCategoria[];
  }

  /** AS14 — registra un gasto directo (sin requisición) del proyecto. */
  async registrarGastoDirecto(p: GastoDirectoPayload): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('registrar_gasto_directo', {
      p_id: crypto.randomUUID(),
      p_proyecto_id: p.proyecto_id,
      p_categoria: p.categoria,
      p_concepto: p.concepto,
      p_monto: p.monto,
      p_fecha: p.fecha ?? null,
      p_recibo_path: p.recibo_path ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** AA23 QW4 — costo de material real por obra (Σ cantidad × costo_unit de salidas). */
  async getCostoMaterialObra(
    proyectoId: string,
    desde?: string | null,
    hasta?: string | null,
  ): Promise<CostoMaterialObra> {
    const { data, error } = await this.supabase.client.rpc('costo_material_obra', {
      p_proyecto_id: proyectoId,
      p_desde: desde ?? null,
      p_hasta: hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? { total: 0, por_articulo: [] }) as CostoMaterialObra;
  }

  async getAll(): Promise<Proyecto[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .select(
        '*, responsable:usuarios(nombre), fases:fases_proyecto(*), ' +
          'responsables:proyecto_responsables(id, tipo_responsabilidad, activo, usuario:usuarios!usuario_id(nombre))',
      )
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Proyecto[];
  }

  /**
   * AP1 — directorio de referencia de obras (id/código/nombre/estado/ubicación/
   * activo/lat/lng) desacoplado del módulo Proyectos. Es el contrato único para
   * los selectores de "obra destino" (conduce/ruta), donde un chofer no tiene
   * el módulo Proyectos pero SÍ debe poder referenciar la obra. SECURITY DEFINER
   * en la BD → nunca depende de la RLS (frágil) de la tabla proyectos.
   */
  async getDirectorio(): Promise<ObraRef[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .rpc('directorio_proyectos');
    if (error) throw new Error(error.message);
    return (data ?? []) as ObraRef[];
  }

  /** Active, in-progress projects that have geographic coordinates — used by the
   *  Intelligent Context System to show weather across all live obras without
   *  loading heavy joins (fases/responsable). */
  async getActivasConUbicacion(): Promise<
    Pick<Proyecto, 'id' | 'codigo' | 'nombre' | 'latitud' | 'longitud' | 'direccion_geo'>[]
  > {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .select('id, codigo, nombre, latitud, longitud, direccion_geo')
      .eq('activo', true)
      .eq('estado', 'en_progreso')
      .not('latitud', 'is', null)
      .not('longitud', 'is', null)
      .order('nombre', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Pick<
      Proyecto,
      'id' | 'codigo' | 'nombre' | 'latitud' | 'longitud' | 'direccion_geo'
    >[];
  }

  async getById(id: string): Promise<Proyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .select('*, responsable:usuarios(nombre), fases:fases_proyecto(*)')
      .eq('id', id)
      .order('orden', { referencedTable: 'fases_proyecto', ascending: true })
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proyecto;
  }

  async generateNextCode(): Promise<string> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .select('codigo')
      .like('codigo', 'PROY-%')
      .order('codigo', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

    const last = data?.[0]?.codigo as string | undefined;
    const lastNumber = last ? parseInt(last.replace('PROY-', ''), 10) || 0 : 0;
    return `PROY-${String(lastNumber + 1).padStart(4, '0')}`;
  }

  async create(payload: Partial<Proyecto>): Promise<Proyecto> {
    const codigo = await this.generateNextCode();
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .insert({ ...payload, codigo })
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proyecto;
  }

  async update(id: string, payload: Partial<Proyecto>): Promise<Proyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proyecto;
  }

  /**
   * AM7 — fija/valida la ubicación estructurada de la obra vía la RPC canónica
   * `set_proyecto_ubicacion`. Valida en el servidor coords faltantes (DR471) y
   * fuera de rango (DR472), y redondea a 6 decimales. Web y app usan esta misma
   * RPC — NUNCA un update() directo de latitud/longitud, que saltaría la
   * validación de rango del servidor.
   */
  async setUbicacion(
    proyectoId: string,
    lat: number,
    lng: number,
    direccion?: string | null,
    metodo?: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .rpc('set_proyecto_ubicacion', {
        p_proyecto_id: proyectoId,
        p_lat: lat,
        p_lng: lng,
        p_direccion: direccion ?? null,
        p_metodo: metodo ?? null,
      });
    if (error) throw new Error(error.message);
  }

  async updateEstado(id: string, estado: ProyectoEstado): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async createFase(fase: Partial<FaseProyecto>): Promise<FaseProyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .insert(fase)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as FaseProyecto;
  }

  async updateFase(id: string, payload: Partial<FaseProyecto>): Promise<FaseProyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as FaseProyecto;
  }

  async deleteFase(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async updateProgreso(id: string, progreso: number): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .update({ progreso })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  /** Real spend: sum of approved/received órdenes de compra tagged to this project. */
  async getGastoReal(proyectoId: string): Promise<number> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('ordenes_compra')
      .select('total, estado')
      .eq('proyecto_id', proyectoId)
      .in('estado', ['aprobada', 'recibida']);

    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum, o) => sum + (o.total ?? 0), 0);
  }

  async getEquipo(proyectoId: string): Promise<ProyectoEmpleado[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_empleados')
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProyectoEmpleado[];
  }

  /**
   * A3.2 — Agrega un miembro al Equipo de Obra: empleado de RRHH o entidad externa
   * (topógrafo/subcontratista), con rol del catálogo y vigencia opcional.
   */
  async addMiembro(proyectoId: string, m: EquipoMiembroFormData): Promise<ProyectoEmpleado> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_empleados')
      .insert({
        proyecto_id: proyectoId,
        empleado_id: m.empleado_id,
        externo_nombre: m.externo_nombre,
        externo_tipo: m.externo_tipo,
        rol: m.rol,
        desde: m.desde,
        hasta: m.hasta,
        notas: m.notas,
      })
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ProyectoEmpleado;
  }

  /** @deprecated Usa addMiembro (A3.2). Se conserva por compatibilidad. */
  async addEmpleado(proyectoId: string, empleadoId: string, rol: string | null): Promise<ProyectoEmpleado> {
    return this.addMiembro(proyectoId, {
      empleado_id: empleadoId,
      externo_nombre: null,
      externo_tipo: null,
      rol: rol ?? '',
      desde: null,
      hasta: null,
      notas: null,
    });
  }

  /**
   * P2 — Proyectos del usuario: donde es responsable_id O miembro del equipo
   * (con o sin ficha de empleado). RPC SECURITY DEFINER que une ambas
   * condiciones y trae las fases embebidas. Reemplaza a getAsignadosA para "Mi
   * proyecto". Sin p_usuario, el RPC usa el usuario autenticado.
   */
  async misProyectos(usuarioId?: string): Promise<Proyecto[]> {
    const { data, error } = await this.supabase.client.rpc('mis_proyectos', {
      p_usuario: usuarioId ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Proyecto[];
  }

  /**
   * @deprecated Usa misProyectos (P2). Solo miraba proyecto_empleados vía
   * empleados.usuario_id; ignoraba responsable_id y usuarios sin ficha.
   */
  async getAsignadosA(usuarioId: string): Promise<Proyecto[]> {
    const { data: empleado, error: empError } = await this.supabase.client
      .schema('sgc')
      .from('empleados')
      .select('id')
      .eq('usuario_id', usuarioId)
      .maybeSingle();

    if (empError) throw new Error(empError.message);
    if (!empleado) return [];

    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_empleados')
      .select('proyecto:proyectos(*, fases:fases_proyecto(*))')
      .eq('empleado_id', (empleado as { id: string }).id);

    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as { proyecto: Proyecto }[])
      .map((row) => row.proyecto)
      .filter(Boolean);
  }

  async removeEmpleado(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_empleados')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // ── Z2 — Ingenieros responsables vinculados (firmantes de liberación) ───────
  /** Responsables activos de la obra (RPC definer que trae nombre/email). */
  async getResponsables(proyectoId: string): Promise<ProyectoResponsableLite[]> {
    const { data, error } = await this.supabase.client.rpc('responsables_de_proyecto', {
      p_proyecto_id: proyectoId,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ProyectoResponsableLite[];
  }

  /** Vincula un usuario como responsable/residente de la obra. */
  async addResponsable(
    proyectoId: string,
    usuarioId: string,
    tipo: TipoResponsabilidad,
  ): Promise<void> {
    const creadoPor = (await this.supabase.client.auth.getUser()).data.user?.id ?? null;
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_responsables')
      .insert({
        proyecto_id: proyectoId,
        usuario_id: usuarioId,
        tipo_responsabilidad: tipo,
        creado_por: creadoPor,
      });
    if (error) throw new Error(error.message);
  }

  /** Desvincula un responsable (soft: activo=false, libera el índice único). */
  async removeResponsable(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_responsables')
      .update({ activo: false })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Directorio de usuarios activos (para el selector de responsables). */
  async getDirectorioUsuarios(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios');
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; nombre: string }[];
  }

  /** Raw per-project KPI metrics for the Encargados leaderboard (SECURITY DEFINER RPC). */
  async getKpiProyectos(): Promise<KpiProyectoRaw[]> {
    const { data, error } = await this.supabase.client.rpc('kpi_proyectos');
    if (error) throw new Error(error.message);
    return (data ?? []) as KpiProyectoRaw[];
  }

  // ── A8 — Expediente de inicio de obra ──────────────────────
  async getExpediente(proyectoId: string): Promise<ExpedienteDoc[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('expediente_obra')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ExpedienteDoc[];
  }

  /** Siembra los 11 documentos estándar (idempotente). Devuelve nº insertados. */
  async sembrarExpediente(proyectoId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('sembrar_expediente_obra', {
      p_proyecto_id: proyectoId,
    });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  async updateExpedienteDoc(
    id: string,
    patch: Partial<Pick<ExpedienteDoc, 'estado' | 'responsable_id' | 'notas' | 'archivo_path' | 'enlace'>>,
    userId: string | null,
  ): Promise<void> {
    const extra: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
    if (patch.estado === 'validado') {
      extra['validado_por'] = userId;
      extra['validado_en'] = new Date().toISOString();
    }
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('expediente_obra')
      .update(extra)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async uploadExpedienteArchivo(proyectoId: string, codigo: string, file: File): Promise<string> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `expediente/${proyectoId}/${codigo}-${safe}`;
    const { error } = await this.supabase.client.storage
      .from(EXPEDIENTE_BUCKET)
      .upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }

  async getExpedienteArchivoUrl(path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from(EXPEDIENTE_BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  /** Estrellas de preparación por proyecto (para el gate de "iniciar obra"). */
  async getReadiness(): Promise<ProyectoReadiness[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('v_proyecto_readiness')
      .select('*');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProyectoReadiness[];
  }

  async getExpedienteResumen(): Promise<ExpedienteResumen[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('v_expediente_obra_resumen')
      .select('*');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ExpedienteResumen[];
  }

  // ── Partidas planeadas (R24) ───────────────────────────────────────────────
  async getPartidas(proyectoId: string): Promise<ProyectoPartida[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_partidas')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .eq('activa', true)
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProyectoPartida[];
  }

  async crearPartida(proyectoId: string, payload: ProyectoPartidaFormData): Promise<ProyectoPartida> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_partidas')
      .insert({ ...payload, proyecto_id: proyectoId })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ProyectoPartida;
  }

  async actualizarPartida(id: string, payload: Partial<ProyectoPartidaFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_partidas')
      .update(payload)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async eliminarPartida(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyecto_partidas')
      .update({ activa: false })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Avance físico vs pagado (R25) ──────────────────────────────────────────
  async getAvance(): Promise<ProyectoAvance[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('v_proyecto_avance')
      .select('*');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProyectoAvance[];
  }

  async getAvanceById(proyectoId: string): Promise<ProyectoAvance | null> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('v_proyecto_avance')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as ProyectoAvance) ?? null;
  }

  /** Actualiza el % pagado del contrato (Dirección/Admin). */
  async setPorcentajePagado(proyectoId: string, pct: number | null): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .update({ porcentaje_pagado: pct })
      .eq('id', proyectoId);
    if (error) throw new Error(error.message);
  }

  /** Genera avisos idempotentes de "pagado > trabajado" (patrón vencimientos). */
  async evaluarAvisosProyecto(): Promise<number> {
    const { data, error } = await this.supabase.client.schema('sgc').rpc('evaluar_avisos_proyecto');
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  async getAvisosProyecto(soloPendientes = true): Promise<AvisoProyecto[]> {
    let q = this.supabase.client
      .schema('sgc')
      .from('avisos_proyecto')
      .select('*, proyecto:proyectos(nombre, codigo)')
      .order('created_at', { ascending: false });
    if (soloPendientes) q = q.eq('estado', 'pendiente');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AvisoProyecto[];
  }

  async atenderAvisoProyecto(id: string, nota: string | null): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .rpc('atender_aviso_proyecto', { p_id: id, p_nota: nota });
    if (error) throw new Error(error.message);
  }
}

export interface KpiProyectoRaw {
  proyecto_id: string;
  codigo: string;
  nombre: string;
  responsable_id: string | null;
  responsable_nombre: string | null;
  avance_promedio: number;
  bitacoras_30d: number;
  incidentes_90d: number;
  presupuesto: number | null;
  gasto_real: number;
}
