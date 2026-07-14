import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { AppVersion, AppVersionFormData, VersionPublicada } from '../models/app-version.model';

/** Versionado por etapas de la app móvil (R15). Escritura sólo admin (RLS). */
@Injectable({ providedIn: 'root' })
export class AppVersionesService {
  private supabase = inject(SupabaseService);

  /** Versiones de la app móvil (para la gestión de rollout — solo 'movil'). */
  async getAll(): Promise<AppVersion[]> {
    const { data, error } = await this.supabase.client
      .from('app_versiones')
      .select('*')
      .eq('plataforma', 'movil')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AppVersion[];
  }

  /** Historial/timeline completo (ambas plataformas), más reciente primero. */
  async getHistorial(): Promise<AppVersion[]> {
    const { data, error } = await this.supabase.client
      .from('app_versiones')
      .select('*')
      .order('fecha', { ascending: false, nullsFirst: false })
      .order('version', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AppVersion[];
  }

  async create(payload: AppVersionFormData): Promise<AppVersion> {
    // La gestión de rollout es solo de la app móvil.
    const row: Record<string, unknown> = { ...payload, plataforma: 'movil' };
    if (payload.publicada) row['publicada_at'] = new Date().toISOString();
    const { data, error } = await this.supabase.client
      .from('app_versiones')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as AppVersion;
  }

  async update(id: string, payload: Partial<AppVersionFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('app_versiones')
      .update(payload)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Publica/despublica una versión (sella publicada_at al publicar). */
  async setPublicada(id: string, publicada: boolean): Promise<void> {
    const patch: Record<string, unknown> = { publicada };
    if (publicada) patch['publicada_at'] = new Date().toISOString();
    const { error } = await this.supabase.client
      .from('app_versiones')
      .update(patch)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async setMinima(id: string, minima: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('app_versiones')
      .update({ minima })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('app_versiones').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** RPC público: versión publicada + mínima (para la app móvil / About). */
  async versionPublicada(): Promise<VersionPublicada> {
    const { data, error } = await this.supabase.client.rpc('version_publicada');
    if (error) throw new Error(error.message);
    return (data ?? {}) as VersionPublicada;
  }
}
