import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export type TipoConsentimiento = 'ia' | 'ubicacion_fondo';
export interface PoliticaPendiente {
  documento: 'privacidad' | 'terminos';
  version: string;
}

/**
 * CI3/CI4/CI10 — privacidad: aceptación de políticas, consentimientos de IA/ubicación
 * y solicitud de eliminación de cuenta. Envoltorio de los RPCs (web = app, docs/PARIDAD.md).
 */
@Injectable({ providedIn: 'root' })
export class PrivacidadService {
  private supabase = inject(SupabaseService);

  // ── Aceptación de políticas (CI3) ──────────────────────────────────────────
  async politicasPendientes(): Promise<PoliticaPendiente[]> {
    const { data, error } = await this.supabase.client.rpc('politicas_pendientes');
    if (error) throw error;
    return (data ?? []) as PoliticaPendiente[];
  }

  async aceptarPolitica(documento: string, version: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('aceptar_politica', {
      p_documento: documento,
      p_version: version,
      p_plataforma: 'web',
    });
    if (error) throw error;
  }

  // ── Consentimientos (CI10 / CI5) ───────────────────────────────────────────
  async miConsentimiento(tipo: TipoConsentimiento): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('mi_consentimiento', { p_tipo: tipo });
    if (error) throw error;
    return !!data;
  }

  async setConsentimiento(tipo: TipoConsentimiento, otorgado: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_consentimiento', {
      p_tipo: tipo,
      p_otorgado: otorgado,
      p_plataforma: 'web',
    });
    if (error) throw error;
  }

  // ── Eliminación de cuenta (CI4) ────────────────────────────────────────────
  async solicitarEliminacion(motivo: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('solicitar_eliminacion_cuenta', {
      p_motivo: motivo,
      p_plataforma: 'web',
    });
    if (error) throw error;
    return data as string;
  }
}
