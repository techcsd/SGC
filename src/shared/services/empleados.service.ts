import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { comprimirImagen } from '../utils/comprimir-imagen.util';
import { Empleado, EmpleadoDocumento, RrhhDocumentoPorVencer, RrhhOrganigramaNodo } from '../models/empleado.model';
import { RrhhCapacitacion } from '../models/rrhh-capacitacion.model';

/** AN1 — subconjunto seguro de un empleado para selects de referencia. */
export interface EmpleadoDirectorio {
  id: string;
  nombre: string;
  apellido: string | null;
  cargo: string | null;
  activo: boolean;
  usuario_id: string | null;
}

// No self-referential jefe embed here: PostgREST resolves the empleados→empleados
// self-join as to-many (returns an array) which doesn't match the model, so the
// supervisor's name is resolved client-side from the already-loaded list instead.
const EMPLEADO_SELECT = '*';

@Injectable({ providedIn: 'root' })
export class EmpleadosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Empleado[]> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .select(EMPLEADO_SELECT)
      .order('apellido')
      .order('nombre');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Empleado[];
  }

  /**
   * AN1 — directorio de referencia de empleados (subconjunto seguro) para
   * dropdowns "Asignado a" y resolución de nombres desde flujos que NO tienen el
   * módulo RRHH (p.ej. inventario tecnológico con rol Tecnología). Usa la RPC
   * SECURITY DEFINER `directorio_empleados`, que NO expone datos sensibles
   * (salario, banco, cédula…) ni requiere abrir la tabla `empleados`.
   */
  async getDirectorio(): Promise<EmpleadoDirectorio[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_empleados');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EmpleadoDirectorio[];
  }

  async create(payload: Partial<Empleado>): Promise<Empleado> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .insert(payload)
      .select(EMPLEADO_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Empleado;
  }

  async update(id: string, payload: Partial<Empleado>): Promise<Empleado> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(EMPLEADO_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Empleado;
  }

  // ── Employee documents ───────────────────────────────────
  async getDocumentos(empleadoId: string): Promise<EmpleadoDocumento[]> {
    const { data, error } = await this.supabase.client
      .from('empleado_documentos')
      .select('*')
      .eq('empleado_id', empleadoId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EmpleadoDocumento[];
  }

  async subirDocumento(empleadoId: string, tipo: string, file: File, subidoPor: string | null): Promise<EmpleadoDocumento> {
    file = await comprimirImagen(file, 'documento');
    const path = `${empleadoId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await this.supabase.client.storage.from('sgc-rrhh').upload(path, file);
    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await this.supabase.client
      .from('empleado_documentos')
      .insert({ empleado_id: empleadoId, tipo, nombre: file.name, archivo_path: path, tipo_mime: file.type || null, subido_por: subidoPor })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as EmpleadoDocumento;
  }

  async getDocumentoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from('sgc-rrhh').createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async eliminarDocumento(id: string, path: string): Promise<void> {
    await this.supabase.client.storage.from('sgc-rrhh').remove([path]);
    const { error } = await this.supabase.client.from('empleado_documentos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('empleados')
      .update({ activo, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // ── DN-27 — Contratos y documentos (submódulo sensible, vía RPC auditada) ──
  async documentosPorVencer(dias = 30): Promise<RrhhDocumentoPorVencer[]> {
    const { data, error } = await this.supabase.client.rpc('rrhh_documentos_por_vencer', { p_dias: dias });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhDocumentoPorVencer[];
  }

  async contratosDeEmpleado(empleadoId: string): Promise<EmpleadoDocumento[]> {
    const { data, error } = await this.supabase.client.rpc('rrhh_contratos_de_empleado', { p_empleado_id: empleadoId });
    if (error) throw new Error(error.message);
    return (data ?? []) as EmpleadoDocumento[];
  }

  async guardarVigenciaDocumento(documentoId: string, vigenciaDesde: string | null, vigenciaHasta: string | null, esContrato: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('rrhh_guardar_vigencia_documento', {
      p_documento_id: documentoId, p_vigencia_desde: vigenciaDesde, p_vigencia_hasta: vigenciaHasta, p_es_contrato: esContrato,
    });
    if (error) throw new Error(error.message);
  }

  // ── DN-27 — Organigrama (jefe_id/cargo ya existentes en sgc.empleados) ──
  async organigrama(): Promise<RrhhOrganigramaNodo[]> {
    const { data, error } = await this.supabase.client.rpc('rrhh_organigrama');
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhOrganigramaNodo[];
  }

  // ── DN-27 P2 — Capacitación (no sensible, permiso estándar) ──────────────
  async capacitacionesDeEmpleado(empleadoId: string): Promise<RrhhCapacitacion[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_capacitaciones').select('*').eq('empleado_id', empleadoId).order('fecha_vencimiento', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhCapacitacion[];
  }

  async capacitacionesPorVencer(dias = 30): Promise<RrhhCapacitacion[]> {
    const limite = new Date(); limite.setDate(limite.getDate() + dias);
    const { data, error } = await this.supabase.client
      .from('rrhh_capacitaciones')
      .select('*')
      .not('fecha_vencimiento', 'is', null)
      .gte('fecha_vencimiento', new Date().toISOString().slice(0, 10))
      .lte('fecha_vencimiento', limite.toISOString().slice(0, 10))
      .order('fecha_vencimiento');
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhCapacitacion[];
  }

  async crearCapacitacion(payload: {
    empleado_id: string; curso: string; institucion: string | null;
    fecha_obtencion: string | null; fecha_vencimiento: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_capacitaciones').insert(payload);
    if (error) throw new Error(error.message);
  }

  async eliminarCapacitacion(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_capacitaciones').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
