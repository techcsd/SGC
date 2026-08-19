import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export type JiraTipo = 'tarea' | 'bug' | 'mejora' | 'epica';
export type JiraEstado = 'backlog' | 'por_hacer' | 'en_progreso' | 'en_revision' | 'hecho';
export type JiraPrioridad = 'baja' | 'media' | 'alta' | 'urgente';

export interface JiraIssue {
  id: string;
  tipo: JiraTipo;
  titulo: string;
  estado: JiraEstado;
  prioridad: JiraPrioridad;
  labels: string[];
  asignado_a: string | null;
  asignado: string | null;
  epica_id: string | null;
  epica: string | null;
  orden: number;
  origen_reporte_id: string | null;
  comentarios: number;
  created_at: string;
  updated_at: string;
}

export interface JiraEpica {
  id: string;
  titulo: string;
  descripcion: string | null;
  color: string;
  estado: string;
  issues: number;
  hechos: number;
}

export interface JiraDetalle {
  issue: JiraIssue & { descripcion: string | null };
  comentarios: { id: string; autor: string | null; texto: string; at: string }[];
  historial: { actor: string | null; campo: string; antes: string | null; despues: string | null; at: string }[];
  adjuntos: { id: string; path: string; nombre: string | null; size: number | null; mime: string | null }[];
}

@Injectable({ providedIn: 'root' })
export class JiraService {
  private supabase = inject(SupabaseService);

  async listar(f?: { tipo?: string; prioridad?: string; label?: string; epicaId?: string; q?: string }): Promise<JiraIssue[]> {
    const { data, error } = await this.supabase.client.rpc('jira_issues_listar', {
      p_tipo: f?.tipo || null,
      p_prioridad: f?.prioridad || null,
      p_label: f?.label || null,
      p_epica_id: f?.epicaId || null,
      p_q: f?.q || null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as JiraIssue[];
  }

  async detalle(id: string): Promise<JiraDetalle> {
    const { data, error } = await this.supabase.client.rpc('jira_issue_detalle', { p_id: id });
    if (error) throw new Error(error.message);
    return data as JiraDetalle;
  }

  async crear(i: {
    titulo: string; tipo: JiraTipo; descripcion: string | null; prioridad: JiraPrioridad;
    labels: string[]; asignado_a: string | null; epica_id: string | null; estado: JiraEstado;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('jira_issue_crear', {
      p_titulo: i.titulo, p_tipo: i.tipo, p_descripcion: i.descripcion, p_prioridad: i.prioridad,
      p_labels: i.labels, p_asignado_a: i.asignado_a, p_epica_id: i.epica_id, p_estado: i.estado, p_origen_reporte_id: null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async actualizar(id: string, i: {
    titulo: string; descripcion: string | null; tipo: JiraTipo; prioridad: JiraPrioridad;
    labels: string[]; asignado_a: string | null; epica_id: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.rpc('jira_issue_actualizar', {
      p_id: id, p_titulo: i.titulo, p_descripcion: i.descripcion, p_tipo: i.tipo,
      p_prioridad: i.prioridad, p_labels: i.labels, p_asignado_a: i.asignado_a, p_epica_id: i.epica_id,
    });
    if (error) throw new Error(error.message);
  }

  async mover(id: string, estado: JiraEstado, orden: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('jira_issue_mover', { p_id: id, p_estado: estado, p_orden: orden });
    if (error) throw new Error(error.message);
  }

  async comentar(id: string, texto: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('jira_issue_comentar', { p_id: id, p_texto: texto });
    if (error) throw new Error(error.message);
  }

  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('jira_issue_eliminar', { p_id: id });
    if (error) throw new Error(error.message);
  }

  async epicasListar(): Promise<JiraEpica[]> {
    const { data, error } = await this.supabase.client.rpc('jira_epicas_listar');
    if (error) throw new Error(error.message);
    return (data ?? []) as JiraEpica[];
  }

  async epicaCrear(titulo: string, descripcion?: string, color?: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('jira_epica_crear', {
      p_titulo: titulo, p_descripcion: descripcion ?? null, p_color: color ?? '#4a90e2',
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async crearDesdeReporte(reporteId: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('jira_crear_desde_reporte', { p_reporte_id: reporteId });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Sube un adjunto al bucket sgc-jira y lo registra. */
  async adjuntar(issueId: string, file: File): Promise<void> {
    const path = `${issueId}/${crypto.randomUUID()}-${file.name}`;
    const { error: up } = await this.supabase.client.storage.from('sgc-jira').upload(path, file);
    if (up) throw new Error(up.message);
    const { error } = await this.supabase.client.rpc('jira_adjuntar', {
      p_issue_id: issueId, p_path: path, p_nombre: file.name, p_size: file.size, p_mime: file.type || null,
    });
    if (error) throw new Error(error.message);
  }

  async adjuntoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from('sgc-jira').createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async directorio(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios');
    if (error) return [];
    return (data ?? []) as { id: string; nombre: string }[];
  }
}
