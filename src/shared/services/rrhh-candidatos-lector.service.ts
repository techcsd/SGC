import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { RrhhCandidatoCvExtraido } from '../models/rrhh-onboarding.model';

/**
 * DO-06 — CV leído por IA: mismo patrón async/polling que
 * `FlotaDocumentosLectorService` (DB3). El RPC `rrhh_candidato_lectura_crear`
 * crea el trabajo (rápido) y dispara la edge `rrhh-leer-cv` en segundo plano
 * (pg_net); el navegador hace polling de la fila — nunca sostiene una llamada
 * larga contra la edge. La edge ya guarda el resultado en
 * `rrhh_candidatos.cv_extraido`; el polling solo espera a que termine.
 */
@Injectable({ providedIn: 'root' })
export class RrhhCandidatosLectorService {
  private supabase = inject(SupabaseService);

  async leer(candidatoId: string, archivo: { data: string; mime: string }): Promise<RrhhCandidatoCvExtraido> {
    const { data: jobId, error } = await this.supabase.client.rpc('rrhh_candidato_lectura_crear', {
      p_candidato_id: candidatoId,
      p_archivo: archivo,
    });
    if (error) throw new Error(error.message);
    return this.esperarLectura(jobId as string);
  }

  private async esperarLectura(jobId: string, maxEsperaMs = 60_000): Promise<RrhhCandidatoCvExtraido> {
    const inicio = Date.now();
    while (Date.now() - inicio < maxEsperaMs) {
      const { data, error } = await this.supabase.client
        .from('rrhh_candidatos_lecturas')
        .select('estado, resultado')
        .eq('id', jobId)
        .single();
      if (error) throw new Error(error.message);
      const fila = data as { estado: 'procesando' | 'listo' | 'error'; resultado: Record<string, unknown> | null };
      if (fila.estado === 'listo') {
        const r = fila.resultado as { extraido?: RrhhCandidatoCvExtraido };
        if (!r?.extraido) throw new Error('No se pudo interpretar el CV. Llena los campos a mano.');
        return r.extraido;
      }
      if (fila.estado === 'error') {
        throw new Error((fila.resultado as { error?: string } | null)?.error || 'No se pudo leer el CV.');
      }
      await new Promise((res) => setTimeout(res, 1200));
    }
    throw new Error('La lectura está tardando más de lo normal. Inténtalo de nuevo en unos minutos.');
  }

  /** Convierte un File a base64 puro (sin el prefijo data:...;base64,). */
  async archivoABase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}
