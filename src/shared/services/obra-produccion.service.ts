import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  ObraNC,
  ObraNCFormData,
  AccionCorrectiva,
  ObraIncidente,
  ObraIncidenteFormData,
  PlanDelDia,
  CharlaSeguridad,
  ClPlantilla,
  ClPlantillaItem,
  ClRegistro,
  ChecklistRespuestaInput,
  ObraSubcontratista,
  SubcontratistaFrente,
  ObraCubicacion,
  CubicacionEvento,
  CubicacionEstado,
  AvanceActual,
  AvanceSnapshot,
  CronogramaTareaAvance,
  ManoObra,
  PruebaCampo,
  CostoMaterial,
  OCProgramada,
  ReportePerdida,
  InformeSemanal,
} from '../models/obra-produccion.model';

export interface DirectorioUsuario {
  id: string;
  nombre: string | null;
}

/**
 * AG16 · Gestión de Producción de Obra — FASE 1 (No Conformidades e Incidentes).
 * El cliente ya usa el esquema `sgc`. Las escrituras van por RPCs SECURITY DEFINER
 * (levantar_nc / asignar_accion_correctiva / marcar_accion_hecha /
 * verificar_cerrar_nc / registrar_incidente_obra) para respetar validaciones,
 * idempotencia (p_id cliente-UUID) y notificaciones en la BD.
 */
@Injectable({ providedIn: 'root' })
export class ObraProduccionService {
  private supabase = inject(SupabaseService);
  private readonly BUCKET = 'obra';

  private nuevoId(): string {
    return crypto.randomUUID();
  }

  // ── Fotos (bucket `obra`) ─────────────────────────────────────
  async subirFotos(files: File[], carpeta: string): Promise<string[]> {
    const paths: string[] = [];
    for (const file of files) {
      const path = `${carpeta}/${this.nuevoId()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error } = await this.supabase.client.storage.from(this.BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      });
      if (error) throw new Error(error.message);
      paths.push(path);
    }
    return paths;
  }

  // ── Directorio de usuarios (para asignar responsable) ─────────
  async getDirectorio(): Promise<DirectorioUsuario[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios');
    if (error) throw new Error(error.message);
    return (data ?? []) as DirectorioUsuario[];
  }

  // ── No Conformidades ──────────────────────────────────────────
  async getNoConformidades(proyectoId?: string): Promise<ObraNC[]> {
    let q = this.supabase.client
      .from('obra_no_conformidades')
      .select('*, proyecto:proyectos(id,nombre), responsable:usuarios!responsable_id(id,nombre)')
      .order('created_at', { ascending: false });
    if (proyectoId) q = q.eq('proyecto_id', proyectoId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ObraNC[];
  }

  async levantarNC(payload: ObraNCFormData, fotos: string[]): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('levantar_nc', {
      p_id: this.nuevoId(),
      p_proyecto_id: payload.proyecto_id,
      p_tipo: payload.tipo,
      p_titulo: payload.titulo,
      p_descripcion: payload.descripcion,
      p_severidad: payload.severidad,
      p_ubicacion: payload.ubicacion,
      p_elemento_id: payload.elemento_id ?? null,
      p_vaciado_id: null,
      p_responsable_id: payload.responsable_id,
      p_fotos: fotos,
      p_bloquea_vaciado: payload.bloquea_vaciado,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async verificarCerrarNC(ncId: string, nota?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('verificar_cerrar_nc', {
      p_nc_id: ncId,
      p_nota: nota ?? null,
    });
    if (error) throw new Error(error.message);
  }

  // ── Acciones correctivas ──────────────────────────────────────
  /** Todas las acciones visibles (para KPIs y detección de vencidas en la bandeja). */
  async getAccionesTodas(): Promise<AccionCorrectiva[]> {
    const { data, error } = await this.supabase.client
      .from('obra_acciones_correctivas')
      .select('id, proyecto_id, origen_tipo, origen_id, descripcion, responsable_id, fecha_compromiso, estado, evidencia_fotos, hecha_en, hecha_por, verificada_en, verificada_por, creado_por, created_at')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AccionCorrectiva[];
  }

  async getAcciones(origenTipo: 'nc' | 'incidente', origenId: string): Promise<AccionCorrectiva[]> {
    const { data, error } = await this.supabase.client
      .from('obra_acciones_correctivas')
      .select('*, responsable:usuarios!responsable_id(id,nombre)')
      .eq('origen_tipo', origenTipo)
      .eq('origen_id', origenId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AccionCorrectiva[];
  }

  async asignarAccion(input: {
    proyectoId: string;
    origenTipo: 'nc' | 'incidente';
    origenId: string;
    descripcion: string;
    responsableId: string | null;
    fechaCompromiso: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('asignar_accion_correctiva', {
      p_id: this.nuevoId(),
      p_proyecto_id: input.proyectoId,
      p_origen_tipo: input.origenTipo,
      p_origen_id: input.origenId,
      p_descripcion: input.descripcion,
      p_responsable_id: input.responsableId,
      p_fecha_compromiso: input.fechaCompromiso,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async marcarAccionHecha(accionId: string, evidencia: string[]): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_accion_hecha', {
      p_accion_id: accionId,
      p_evidencia_fotos: evidencia,
    });
    if (error) throw new Error(error.message);
  }

  // ── Incidentes / casi-accidentes ─────────────────────────────
  async getIncidentes(proyectoId?: string): Promise<ObraIncidente[]> {
    let q = this.supabase.client
      .from('obra_incidentes')
      .select('*, proyecto:proyectos(id,nombre)')
      .order('created_at', { ascending: false });
    if (proyectoId) q = q.eq('proyecto_id', proyectoId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ObraIncidente[];
  }

  async registrarIncidente(payload: ObraIncidenteFormData, fotos: string[]): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('registrar_incidente_obra', {
      p_id: this.nuevoId(),
      p_proyecto_id: payload.proyecto_id,
      p_tipo: payload.tipo,
      p_descripcion: payload.descripcion,
      p_gravedad: payload.gravedad,
      p_lesionados: payload.lesionados,
      p_ubicacion: payload.ubicacion,
      p_investigacion: payload.investigacion,
      p_fotos: fotos,
      p_elemento_id: null,
      p_bitacora_id: null,
      p_fecha: payload.fecha,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async cerrarIncidente(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cerrar_incidente_obra', { p_id: id });
    if (error) throw new Error(error.message);
  }

  // ── FASE 2: Plan del día + Charla de seguridad ────────────────
  async getPlanDelDia(proyectoId: string, fecha: string): Promise<PlanDelDia> {
    const { data, error } = await this.supabase.client.rpc('plan_del_dia', {
      p_proyecto_id: proyectoId,
      p_fecha: fecha,
    });
    if (error) throw new Error(error.message);
    return (data ?? { charla: null, tareas: [] }) as PlanDelDia;
  }

  async registrarCharla(input: {
    id?: string;
    proyectoId: string;
    fecha: string;
    tema: string;
    duracionMin: number;
    notas: string | null;
    asistentes: number | null;
    fotos: string[];
    firmas: string[];
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('registrar_charla_seguridad', {
      p_id: input.id ?? this.nuevoId(),
      p_proyecto_id: input.proyectoId,
      p_fecha: input.fecha,
      p_tema: input.tema,
      p_duracion_min: input.duracionMin,
      p_notas: input.notas,
      p_asistentes: input.asistentes,
      p_fotos: input.fotos,
      p_firmas: input.firmas,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── FASE 2: Checklists de calidad ─────────────────────────────
  async getPlantillasCalidad(): Promise<ClPlantilla[]> {
    const { data, error } = await this.supabase.client
      .from('cl_plantillas')
      .select('*')
      .eq('categoria', 'calidad')
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ClPlantilla[];
  }

  async getPlantillaItems(plantillaId: string): Promise<ClPlantillaItem[]> {
    const { data, error } = await this.supabase.client
      .from('cl_plantilla_items')
      .select('*')
      .eq('plantilla_id', plantillaId)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ClPlantillaItem[];
  }

  async crearPlantillaCalidad(nombre: string, fase: string | null): Promise<ClPlantilla> {
    const codigo = 'QA-' + this.nuevoId().slice(0, 8);
    const { data, error } = await this.supabase.client
      .from('cl_plantillas')
      .insert({ codigo, nombre, fase, categoria: 'calidad', orden: 200 })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ClPlantilla;
  }

  async agregarItemPlantilla(plantillaId: string, seccion: string | null, etiqueta: string, orden: number): Promise<void> {
    const { error } = await this.supabase.client
      .from('cl_plantilla_items')
      .insert({ plantilla_id: plantillaId, seccion, etiqueta, orden });
    if (error) throw new Error(error.message);
  }

  async eliminarItemPlantilla(itemId: string): Promise<void> {
    const { error } = await this.supabase.client.from('cl_plantilla_items').delete().eq('id', itemId);
    if (error) throw new Error(error.message);
  }

  async getChecklistsEjecutados(proyectoId?: string): Promise<ClRegistro[]> {
    let q = this.supabase.client
      .from('cl_registros')
      .select('*, plantilla:cl_plantillas(nombre,codigo), proyecto:proyectos(id,nombre)')
      .eq('categoria', 'calidad')
      .order('created_at', { ascending: false });
    if (proyectoId) q = q.eq('proyecto_id', proyectoId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ClRegistro[];
  }

  async ejecutarChecklistCalidad(input: {
    plantillaId: string;
    proyectoId: string;
    elementoId?: string | null;
    respuestas: ChecklistRespuestaInput[];
    fotos: { storage_path: string; correcto: boolean | null; descripcion: string | null }[];
    observaciones: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('ejecutar_checklist_calidad', {
      p_id: this.nuevoId(),
      p_plantilla_id: input.plantillaId,
      p_proyecto_id: input.proyectoId,
      p_elemento_id: input.elementoId ?? null,
      p_respuestas: input.respuestas,
      p_fotos: input.fotos,
      p_observaciones: input.observaciones,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── FASE 3: Subcontratistas ───────────────────────────────────
  async getSubcontratistas(): Promise<ObraSubcontratista[]> {
    const { data, error } = await this.supabase.client
      .from('obra_subcontratistas')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ObraSubcontratista[];
  }

  async crearSubcontratista(payload: Partial<ObraSubcontratista>): Promise<ObraSubcontratista> {
    const { data, error } = await this.supabase.client
      .from('obra_subcontratistas')
      .insert({
        nombre: payload.nombre,
        rnc: payload.rnc ?? null,
        especialidad: payload.especialidad ?? null,
        contacto: payload.contacto ?? null,
        telefono: payload.telefono ?? null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ObraSubcontratista;
  }

  async getFrentes(subcontratistaId: string): Promise<SubcontratistaFrente[]> {
    const { data, error } = await this.supabase.client
      .from('obra_subcontratista_frentes')
      .select('*, proyecto:proyectos(id,nombre)')
      .eq('subcontratista_id', subcontratistaId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SubcontratistaFrente[];
  }

  async crearFrente(input: { subcontratistaId: string; proyectoId: string; descripcion: string | null; avancePct: number }): Promise<void> {
    const { error } = await this.supabase.client.from('obra_subcontratista_frentes').insert({
      subcontratista_id: input.subcontratistaId,
      proyecto_id: input.proyectoId,
      descripcion: input.descripcion,
      avance_pct: input.avancePct,
    });
    if (error) throw new Error(error.message);
  }

  async actualizarAvanceFrente(id: string, avancePct: number): Promise<void> {
    const { error } = await this.supabase.client
      .from('obra_subcontratista_frentes')
      .update({ avance_pct: avancePct })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── FASE 3: Cubicaciones ──────────────────────────────────────
  async getCubicaciones(proyectoId?: string): Promise<ObraCubicacion[]> {
    let q = this.supabase.client
      .from('obra_cubicaciones')
      .select('*, subcontratista:obra_subcontratistas(nombre), proyecto:proyectos(id,nombre)')
      .order('created_at', { ascending: false });
    if (proyectoId) q = q.eq('proyecto_id', proyectoId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ObraCubicacion[];
  }

  async crearCubicacion(input: {
    subcontratistaId: string;
    proyectoId: string;
    periodoInicio: string | null;
    periodoFin: string | null;
    descripcion: string | null;
    monto: number;
    avancePct: number | null;
    soportes: string[];
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_cubicacion', {
      p_id: this.nuevoId(),
      p_subcontratista_id: input.subcontratistaId,
      p_proyecto_id: input.proyectoId,
      p_periodo_inicio: input.periodoInicio,
      p_periodo_fin: input.periodoFin,
      p_descripcion: input.descripcion,
      p_monto: input.monto,
      p_avance_pct: input.avancePct,
      p_detalle: [],
      p_soportes: input.soportes,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async enviarCubicacion(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('enviar_cubicacion', { p_id: id });
    if (error) throw new Error(error.message);
  }

  async revisarCubicacion(id: string, estado: 'aprobada' | 'rechazada', nota: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('revisar_cubicacion', {
      p_id: id, p_estado: estado, p_nota: nota,
    });
    if (error) throw new Error(error.message);
  }

  async getCubicacionEventos(cubicacionId: string): Promise<CubicacionEvento[]> {
    const { data, error } = await this.supabase.client
      .from('obra_cubicacion_eventos')
      .select('*')
      .eq('cubicacion_id', cubicacionId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CubicacionEvento[];
  }

  // ── FASE 4: Avance ────────────────────────────────────────────
  async getAvanceActual(proyectoId: string): Promise<AvanceActual> {
    const { data, error } = await this.supabase.client.rpc('calcular_avance_obra', { p_proyecto_id: proyectoId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? { avance_plan_pct: 0, avance_real_pct: 0 }) as AvanceActual;
  }

  async getAvanceSnapshots(proyectoId: string): Promise<AvanceSnapshot[]> {
    const { data, error } = await this.supabase.client
      .from('obra_avance_snapshots')
      .select('fecha, avance_plan_pct, avance_real_pct')
      .eq('proyecto_id', proyectoId)
      .order('fecha', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AvanceSnapshot[];
  }

  async capturarBaseline(proyectoId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('capturar_baseline_cronograma', { p_proyecto_id: proyectoId });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  async getCronogramaTareas(proyectoId: string): Promise<CronogramaTareaAvance[]> {
    const { data, error } = await this.supabase.client
      .from('cronograma_tareas')
      .select('id, nombre, estado, avance_pct, fecha_fin_plan')
      .eq('proyecto_id', proyectoId)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CronogramaTareaAvance[];
  }

  async reportarAvanceTarea(tareaId: string, avancePct: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('reportar_avance_tarea', { p_tarea_id: tareaId, p_avance_pct: avancePct });
    if (error) throw new Error(error.message);
  }

  // ── FASE 4: Costos ────────────────────────────────────────────
  async getCostoMaterial(proyectoId: string): Promise<CostoMaterial> {
    const { data, error } = await this.supabase.client.rpc('costo_material_obra', {
      p_proyecto_id: proyectoId, p_desde: null, p_hasta: null,
    });
    if (error) throw new Error(error.message);
    return (data ?? { total: 0, por_articulo: [] }) as CostoMaterial;
  }

  async getManoObra(proyectoId: string): Promise<ManoObra[]> {
    const { data, error } = await this.supabase.client
      .from('obra_mano_obra')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ManoObra[];
  }

  async registrarManoObra(input: {
    proyectoId: string; fecha: string; actividad: string | null; cantidadTrabajadores: number; horas: number; notas: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('registrar_mano_obra', {
      p_id: this.nuevoId(), p_proyecto_id: input.proyectoId, p_fecha: input.fecha,
      p_actividad: input.actividad, p_cantidad_trabajadores: input.cantidadTrabajadores,
      p_horas: input.horas, p_notas: input.notas,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async getReportesPerdidas(proyectoId: string): Promise<ReportePerdida[]> {
    const { data, error } = await this.supabase.client
      .from('reportes_perdidas')
      .select('id, proyecto_id, tipo, descripcion, fecha, fotos, created_at')
      .eq('proyecto_id', proyectoId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ReportePerdida[];
  }

  // ── FASE 4: Logística ─────────────────────────────────────────
  async getOCProgramadas(proyectoId: string): Promise<OCProgramada[]> {
    const { data, error } = await this.supabase.client
      .from('ordenes_compra')
      .select('id, numero, estado, total, fecha_programada, destino')
      .eq('proyecto_id', proyectoId)
      .not('fecha_programada', 'is', null)
      .order('fecha_programada', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as OCProgramada[];
  }

  async getPruebasCampo(proyectoId: string): Promise<PruebaCampo[]> {
    const { data, error } = await this.supabase.client
      .from('obra_pruebas_campo')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PruebaCampo[];
  }

  async registrarPruebaCampo(input: {
    proyectoId: string; tipo: string; fecha: string; resultado: string | null; notas: string | null; fotos: string[];
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('registrar_prueba_campo', {
      p_id: this.nuevoId(), p_proyecto_id: input.proyectoId, p_tipo: input.tipo, p_fecha: input.fecha,
      p_resultado: input.resultado, p_notas: input.notas, p_fotos: input.fotos,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── FASE 5: Informe semanal ───────────────────────────────────
  async compilarInforme(proyectoId: string, periodoInicio: string, periodoFin: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('compilar_informe_semanal', {
      p_proyecto_id: proyectoId, p_periodo_inicio: periodoInicio, p_periodo_fin: periodoFin,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async getInforme(id: string): Promise<InformeSemanal | null> {
    const { data, error } = await this.supabase.client
      .from('informes_semanales')
      .select('*, proyecto:proyectos(id,nombre)')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as InformeSemanal | null;
  }

  async getInformes(proyectoId: string): Promise<InformeSemanal[]> {
    const { data, error } = await this.supabase.client.rpc('informes_de_obra', { p_proyecto_id: proyectoId });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as InformeSemanal[];
  }

  async guardarInformeManual(id: string, campos: Record<string, string>, contenido: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('guardar_informe_manual', {
      p_id: id, p_campos: campos, p_contenido: contenido,
    });
    if (error) throw new Error(error.message);
  }

  async enviarInforme(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('enviar_informe_semanal', { p_id: id });
    if (error) throw new Error(error.message);
  }

  /** Firma varias fotos del bucket sgc-bitacora (para el preview del informe). */
  async signedBitacoraUrls(paths: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const p of paths) {
      const { data } = await this.supabase.client.storage.from('sgc-bitacora').createSignedUrl(p, 3600);
      if (data?.signedUrl) out.push(data.signedUrl);
    }
    return out;
  }

  // ── Firma de URLs (fotos) ────────────────────────────────────
  async signedUrl(path: string): Promise<string> {
    const { data } = await this.supabase.client.storage.from(this.BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ?? '';
  }
}
