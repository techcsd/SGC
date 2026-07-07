import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  AprobacionLegal,
  AprobacionModulo,
  Contrato,
  ContratoEstado,
  ExpedienteArchivo,
  ExpedienteEstado,
  ExpedienteLegal,
  ExpedienteNota,
} from '../models/legal.model';

// expedientes_legales / contratos each have TWO fks to usuarios (responsable_id
// + creado_por), so the usuarios embed must name the fk explicitly or PostgREST
// 300s with an ambiguous-embedding error.
const EXPEDIENTE_SELECT =
  '*, proyecto:proyectos(nombre), responsable:usuarios!expedientes_legales_responsable_id_fkey(nombre)';
const CONTRATO_SELECT =
  '*, proyecto:proyectos(nombre), proveedor:proveedores(nombre), responsable:usuarios!contratos_responsable_id_fkey(nombre)';
const APROBACION_SELECT =
  '*, solicitante:usuarios!aprobaciones_legales_solicitado_por_fkey(nombre), revisor:usuarios!aprobaciones_legales_revisado_por_fkey(nombre)';

@Injectable({ providedIn: 'root' })
export class LegalService {
  private supabase = inject(SupabaseService);

  // ── Expedientes ──────────────────────────────────────────
  async getExpedientes(): Promise<ExpedienteLegal[]> {
    const { data, error } = await this.supabase.client
      .from('expedientes_legales')
      .select(EXPEDIENTE_SELECT)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ExpedienteLegal[];
  }

  async getExpediente(id: string): Promise<ExpedienteLegal> {
    const { data, error } = await this.supabase.client
      .from('expedientes_legales')
      .select(EXPEDIENTE_SELECT)
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ExpedienteLegal;
  }

  async createExpediente(payload: Partial<ExpedienteLegal>): Promise<ExpedienteLegal> {
    const { data, error } = await this.supabase.client
      .from('expedientes_legales')
      .insert(payload)
      .select(EXPEDIENTE_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ExpedienteLegal;
  }

  async updateExpediente(id: string, payload: Partial<ExpedienteLegal>): Promise<ExpedienteLegal> {
    const { data, error } = await this.supabase.client
      .from('expedientes_legales')
      .update(payload)
      .eq('id', id)
      .select(EXPEDIENTE_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ExpedienteLegal;
  }

  async cambiarEstadoExpediente(id: string, estado: ExpedienteEstado): Promise<ExpedienteLegal> {
    const payload: Partial<ExpedienteLegal> = { estado };
    if (estado === 'cerrado') payload.fecha_cierre = new Date().toISOString().slice(0, 10);
    return this.updateExpediente(id, payload);
  }

  async getNotas(expedienteId: string): Promise<ExpedienteNota[]> {
    const { data, error } = await this.supabase.client
      .from('expediente_notas')
      .select('*, usuario:usuarios(nombre)')
      .eq('expediente_id', expedienteId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ExpedienteNota[];
  }

  async addNota(expedienteId: string, usuarioId: string | null, nota: string): Promise<ExpedienteNota> {
    const { data, error } = await this.supabase.client
      .from('expediente_notas')
      .insert({ expediente_id: expedienteId, usuario_id: usuarioId, nota })
      .select('*, usuario:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ExpedienteNota;
  }

  async getArchivos(expedienteId: string): Promise<ExpedienteArchivo[]> {
    const { data, error } = await this.supabase.client
      .from('expediente_archivos')
      .select('*')
      .eq('expediente_id', expedienteId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ExpedienteArchivo[];
  }

  async subirArchivo(expedienteId: string, file: File, subidoPor: string | null): Promise<ExpedienteArchivo> {
    const path = `${expedienteId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await this.supabase.client.storage.from('sgc-legal').upload(path, file);
    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await this.supabase.client
      .from('expediente_archivos')
      .insert({
        expediente_id: expedienteId,
        nombre: file.name,
        archivo_path: path,
        tipo_mime: file.type || null,
        subido_por: subidoPor,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as ExpedienteArchivo;
  }

  async getArchivoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from('sgc-legal').createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async eliminarArchivo(id: string, path: string): Promise<void> {
    await this.supabase.client.storage.from('sgc-legal').remove([path]);
    const { error } = await this.supabase.client.from('expediente_archivos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async countAbiertos(): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('expedientes_legales')
      .select('id', { count: 'exact', head: true })
      .neq('estado', 'cerrado');
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  // ── Contratos ────────────────────────────────────────────
  async getContratos(): Promise<Contrato[]> {
    const { data, error } = await this.supabase.client
      .from('contratos')
      .select(CONTRATO_SELECT)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Contrato[];
  }

  async getContrato(id: string): Promise<Contrato> {
    const { data, error } = await this.supabase.client
      .from('contratos')
      .select(CONTRATO_SELECT)
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Contrato;
  }

  async createContrato(payload: Partial<Contrato>): Promise<Contrato> {
    const { data, error } = await this.supabase.client
      .from('contratos')
      .insert(payload)
      .select(CONTRATO_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Contrato;
  }

  async updateContrato(id: string, payload: Partial<Contrato>): Promise<Contrato> {
    const { data, error } = await this.supabase.client
      .from('contratos')
      .update(payload)
      .eq('id', id)
      .select(CONTRATO_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Contrato;
  }

  async cambiarEstadoContrato(id: string, estado: ContratoEstado): Promise<Contrato> {
    const payload: Partial<Contrato> = { estado };
    if (estado === 'firmado') payload.fecha_firma = new Date().toISOString().slice(0, 10);
    return this.updateContrato(id, payload);
  }

  /** Contracts expiring within `dias` days (defaults to 30) and not already closed out. */
  async countPorVencer(dias = 30): Promise<number> {
    const limite = new Date();
    limite.setDate(limite.getDate() + dias);
    const { count, error } = await this.supabase.client
      .from('contratos')
      .select('id', { count: 'exact', head: true })
      .in('estado', ['firmado', 'en_revision'])
      .not('fecha_vencimiento', 'is', null)
      .lte('fecha_vencimiento', limite.toISOString().slice(0, 10));
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  // ── Aprobaciones legales ─────────────────────────────────
  async getAprobaciones(): Promise<AprobacionLegal[]> {
    const { data, error } = await this.supabase.client
      .from('aprobaciones_legales')
      .select(APROBACION_SELECT)
      .order('fecha_solicitud', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AprobacionLegal[];
  }

  async solicitarAprobacion(payload: {
    moduloOrigen: AprobacionModulo;
    referenciaTipo?: string | null;
    referenciaId?: string | null;
    titulo: string;
    descripcion?: string | null;
    solicitadoPor: string;
  }): Promise<AprobacionLegal> {
    const { data, error } = await this.supabase.client
      .from('aprobaciones_legales')
      .insert({
        modulo_origen: payload.moduloOrigen,
        referencia_tipo: payload.referenciaTipo ?? null,
        referencia_id: payload.referenciaId ?? null,
        titulo: payload.titulo,
        descripcion: payload.descripcion ?? null,
        solicitado_por: payload.solicitadoPor,
      })
      .select(APROBACION_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as AprobacionLegal;
  }

  async resolverAprobacion(
    id: string,
    estado: 'aprobado' | 'rechazado',
    revisadoPor: string,
    comentario: string | null,
  ): Promise<AprobacionLegal> {
    const { data, error } = await this.supabase.client
      .from('aprobaciones_legales')
      .update({
        estado,
        revisado_por: revisadoPor,
        comentario_revisor: comentario,
        fecha_resolucion: new Date().toISOString(),
      })
      .eq('id', id)
      .select(APROBACION_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as AprobacionLegal;
  }

  async getAprobacionesPorReferencia(referenciaId: string): Promise<AprobacionLegal[]> {
    const { data, error } = await this.supabase.client
      .from('aprobaciones_legales')
      .select(APROBACION_SELECT)
      .eq('referencia_id', referenciaId)
      .order('fecha_solicitud', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AprobacionLegal[];
  }

  async countPendientes(): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('aprobaciones_legales')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente');
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
