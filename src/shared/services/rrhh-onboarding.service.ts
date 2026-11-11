import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { CandidatoEtapa, RrhhCandidato, RrhhVacante, VacanteEstado } from '../models/rrhh-onboarding.model';

/** DN-27 P1 — Reclutamiento (onboarding): vacantes + pipeline de candidatos. */
@Injectable({ providedIn: 'root' })
export class RrhhOnboardingService {
  private supabase = inject(SupabaseService);

  async listarVacantes(): Promise<RrhhVacante[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_vacantes').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhVacante[];
  }

  async crearVacante(payload: { titulo: string; departamento: string | null; descripcion: string | null }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_vacantes').insert(payload);
    if (error) throw new Error(error.message);
  }

  async actualizarEstadoVacante(id: string, estado: VacanteEstado): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_vacantes').update({ estado }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listarCandidatos(vacanteId: string): Promise<RrhhCandidato[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_candidatos').select('*').eq('vacante_id', vacanteId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhCandidato[];
  }

  async crearCandidato(payload: {
    vacante_id: string; nombre: string; telefono: string | null; email: string | null; notas: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_candidatos').insert(payload);
    if (error) throw new Error(error.message);
  }

  async cambiarEtapa(id: string, etapa: CandidatoEtapa): Promise<void> {
    const { error } = await this.supabase.client
      .from('rrhh_candidatos').update({ etapa, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async eliminarCandidato(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_candidatos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
