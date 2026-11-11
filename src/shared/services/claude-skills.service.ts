import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { environment } from '../../environments/environment';
import { ClaudeSkill, ClaudePack, ClaudeProgreso, ClaudeEncuestaRespuesta, ClaudeOrgInfo } from '../models/claude-skill.model';

/** DM1 — módulo Claude: biblioteca de skills, paquetes, progreso del Setup,
 *  encuesta de auditoría y organización. Escritura de archivos vía edges
 *  (claude-skill-validar/descargar, claude-pack-zip); el resto, RPC/tablas. */
@Injectable({ providedIn: 'root' })
export class ClaudeSkillsService {
  private supabase = inject(SupabaseService);

  async misSkills(): Promise<ClaudeSkill[]> {
    const { data, error } = await this.supabase.client
      .from('claude_skills')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ClaudeSkill[];
  }

  async proponer(skillId: string, ambito: 'rol' | 'empresa'): Promise<void> {
    const { error } = await this.supabase.client.rpc('claude_skill_proponer', { p_skill_id: skillId, p_ambito: ambito });
    if (error) throw new Error(error.message);
  }

  async decidir(skillId: string, decision: 'publicada' | 'borrador' | 'archivada', motivo?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('claude_skill_decidir', { p_skill_id: skillId, p_decision: decision, p_motivo: motivo ?? null });
    if (error) throw new Error(error.message);
  }

  async validarYGuardar(archivo: File, slug: string, nombre: string, descripcion: string, skillId?: string): Promise<{
    ok: boolean; errores: string[]; avisos: string[]; skill_id?: string; tieneCodigoEjecutable?: boolean;
  }> {
    const form = new FormData();
    form.append('archivo', archivo);
    form.append('slug', slug);
    form.append('nombre', nombre);
    form.append('descripcion', descripcion);
    if (skillId) form.append('skill_id', skillId);
    const { data: session } = await this.supabase.client.auth.getSession();
    const res = await fetch(`${environment.supabaseUrl}/functions/v1/claude-skill-validar`, {
      method: 'POST',
      headers: { apikey: environment.supabaseAnonKey, Authorization: `Bearer ${session.session?.access_token}` },
      body: form,
    });
    return res.json();
  }

  async descargarSkill(skillId: string): Promise<Blob> {
    const { data: session } = await this.supabase.client.auth.getSession();
    const res = await fetch(`${environment.supabaseUrl}/functions/v1/claude-skill-descargar`, {
      method: 'POST',
      headers: { apikey: environment.supabaseAnonKey, Authorization: `Bearer ${session.session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: skillId }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({ error: 'Error al descargar.' }))).error);
    return res.blob();
  }

  async descargarPack(packId: string): Promise<Blob> {
    const { data: session } = await this.supabase.client.auth.getSession();
    const res = await fetch(`${environment.supabaseUrl}/functions/v1/claude-pack-zip`, {
      method: 'POST',
      headers: { apikey: environment.supabaseAnonKey, Authorization: `Bearer ${session.session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack_id: packId }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({ error: 'Error al descargar.' }))).error);
    return res.blob();
  }

  async packs(): Promise<ClaudePack[]> {
    const { data, error } = await this.supabase.client.from('claude_packs').select('*').order('tipo');
    if (error) throw new Error(error.message);
    return (data ?? []) as ClaudePack[];
  }

  async miProgreso(): Promise<ClaudeProgreso | null> {
    const { data, error } = await this.supabase.client.from('claude_progreso').select('*').maybeSingle();
    if (error) throw new Error(error.message);
    return data as ClaudeProgreso | null;
  }

  async marcarProgreso(campo: keyof Omit<ClaudeProgreso, 'usuario_id'>, valor = true): Promise<void> {
    const { error } = await this.supabase.client.rpc('claude_progreso_marcar', { p_campo: campo, p_valor: valor });
    if (error) throw new Error(error.message);
  }

  async miEncuesta(): Promise<ClaudeEncuestaRespuesta | null> {
    const { data, error } = await this.supabase.client.from('claude_encuesta_respuestas').select('*').maybeSingle();
    if (error) throw new Error(error.message);
    return data as ClaudeEncuestaRespuesta | null;
  }

  async guardarEncuesta(r: Omit<ClaudeEncuestaRespuesta, 'usuario_id' | 'rol_snapshot'>): Promise<void> {
    const { error } = await this.supabase.client.rpc('claude_encuesta_guardar', {
      p_usa_hoy: r.usa_hoy, p_tareas: r.tareas, p_tarea_repetida: r.tarea_repetida,
      p_que_frena: r.que_frena, p_documento_semanal: r.documento_semanal, p_que_deberia_hacer: r.que_deberia_hacer,
    });
    if (error) throw new Error(error.message);
  }

  async resultadosEncuesta(): Promise<{ rol_snapshot: string | null; respuestas: number }[]> {
    const { data, error } = await this.supabase.client.rpc('claude_encuesta_resultados');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async orgInfo(): Promise<ClaudeOrgInfo | null> {
    const { data, error } = await this.supabase.client.from('claude_org_info').select('*').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    return data as ClaudeOrgInfo | null;
  }

  async guardarOrgInfo(info: Partial<ClaudeOrgInfo>): Promise<void> {
    const { error } = await this.supabase.client.from('claude_org_info').update({ ...info, actualizado_en: new Date().toISOString() }).eq('id', 1);
    if (error) throw new Error(error.message);
  }
}
