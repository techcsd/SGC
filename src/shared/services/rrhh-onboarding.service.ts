import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { comprimirImagen } from '../utils/comprimir-imagen.util';
import {
  CandidatoEtapa, RrhhCandidato, RrhhCandidatoConVacante, RrhhVacante, VacanteEstado,
} from '../models/rrhh-onboarding.model';

const BUCKET_CV = 'sgc-rrhh';

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

  /** DO-07 — el pipeline por vacante solo muestra candidatos activos; los
   *  archivados viven en la vista global "Candidatos" (pestaña Archivados). */
  async listarCandidatos(vacanteId: string): Promise<RrhhCandidato[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_candidatos').select('*').eq('vacante_id', vacanteId).eq('archivado', false)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhCandidato[];
  }

  async crearCandidato(payload: {
    vacante_id: string; nombre: string; telefono: string | null; email: string | null; notas: string | null;
    // DO-05 — más datos de intake (opcionales, el formulario puede dejarlos en blanco).
    experiencia_resumen?: string | null; educacion?: string | null; expectativa_salarial?: number | null;
    fuente?: string | null; telefono_alterno?: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_candidatos').insert(payload);
    if (error) throw new Error(error.message);
  }

  /** DO-05 — editar los datos de intake de un candidato ya creado. */
  async actualizarCandidato(id: string, payload: Partial<{
    nombre: string; telefono: string | null; email: string | null; notas: string | null;
    experiencia_resumen: string | null; educacion: string | null; expectativa_salarial: number | null;
    fuente: string | null; telefono_alterno: string | null;
  }>): Promise<void> {
    const { error } = await this.supabase.client
      .from('rrhh_candidatos').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async cambiarEtapa(id: string, etapa: CandidatoEtapa): Promise<void> {
    const { error } = await this.supabase.client
      .from('rrhh_candidatos').update({ etapa, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** DO-05 — índice global de candidatos (todas las vacantes), con el título de
   *  la vacante ya resuelto para la vista "Candidatos". */
  async listarCandidatosGlobal(): Promise<RrhhCandidatoConVacante[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_candidatos')
      .select('*, rrhh_vacantes(titulo)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<RrhhCandidato & { rrhh_vacantes: { titulo: string } | null }>).map((c) => {
      const { rrhh_vacantes, ...resto } = c;
      return { ...resto, vacante_titulo: rrhh_vacantes?.titulo ?? null };
    });
  }

  /** DO-05 — sube el CV al mismo bucket privado que empleado_documentos
   *  (`EmpleadosService.subirDocumento`), bajo su propia carpeta. */
  async subirCv(candidatoId: string, file: File): Promise<string> {
    file = await comprimirImagen(file, 'documento');
    const path = `candidatos/${candidatoId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await this.supabase.client.storage.from(BUCKET_CV).upload(path, file);
    if (uploadError) throw new Error(uploadError.message);
    const { error } = await this.supabase.client.from('rrhh_candidatos').update({ cv_path: path }).eq('id', candidatoId);
    if (error) throw new Error(error.message);
    return path;
  }

  async getCvUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from(BUCKET_CV).createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  /** DO-07 — archivar (default de "eliminar"): conserva el historial por si
   *  RRHH reconsidera al candidato más adelante. */
  async archivarCandidato(id: string, usuarioId: string | null): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_candidatos')
      .update({ archivado: true, archivado_en: new Date().toISOString(), archivado_por: usuarioId })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** DO-07 — restaurar un candidato archivado. */
  async restaurarCandidato(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_candidatos')
      .update({ archivado: false, archivado_en: null, archivado_por: null })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** DO-07 — borrado físico real, detrás de una confirmación explícita de que no
   *  se puede deshacer (para limpiar registros de prueba). */
  async eliminarCandidatoFisico(id: string, cvPath: string | null): Promise<void> {
    if (cvPath) await this.supabase.client.storage.from(BUCKET_CV).remove([cvPath]);
    const { error } = await this.supabase.client.from('rrhh_candidatos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
