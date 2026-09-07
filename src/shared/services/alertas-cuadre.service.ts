import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { AlertaCuadre, AlertaEstado, Parametro } from '../models/cuadre.model';

const SELECT =
  '*, proyecto:proyectos(nombre), articulo:articulos(nombre), bodega:bodegas(nombre)';

@Injectable({ providedIn: 'root' })
export class AlertasCuadreService {
  private supabase = inject(SupabaseService);

  /** Alertas antifraude. RLS ya restringe a Dirección/Gerencia/Admin. */
  async getAlertas(soloAbiertas = false): Promise<AlertaCuadre[]> {
    let q = this.supabase.client.from('alertas_cuadre').select(SELECT).order('updated_at', { ascending: false }).limit(200);
    if (soloAbiertas) q = q.neq('estado', 'resuelta');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AlertaCuadre[];
  }

  async countAbiertas(): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('alertas_cuadre')
      .select('id', { count: 'exact', head: true })
      .neq('estado', 'resuelta');
    if (error) return 0;
    return count ?? 0;
  }

  async atender(id: string, estado: AlertaEstado, nota: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('atender_alerta_cuadre', {
      p_id: id,
      p_estado: estado,
      p_nota: nota,
    });
    if (error) throw new Error(error.message);
  }

  // ── Parámetros (umbrales configurables — Administración) ──
  async getParametros(): Promise<Parametro[]> {
    const { data, error } = await this.supabase.client.from('parametros').select('*').order('clave');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Parametro[];
  }

  async updateParametro(clave: string, valor: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('parametros')
      .update({ valor, updated_at: new Date().toISOString() })
      .eq('clave', clave);
    if (error) throw new Error(error.message);
  }

  // ── BK5 — flota_config (segunda tabla clave/valor, se edita por RPC) ──
  /** Lee todas las filas de flota_config (clave/valor). */
  async getFlotaConfig(): Promise<Parametro[]> {
    const { data, error } = await this.supabase.client
      .from('flota_config')
      .select('clave, valor')
      .order('clave');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Parametro[];
  }

  /** Escribe una clave de flota_config vía RPC (gate admin/flota). Solo numéricas. */
  async setFlotaConfig(clave: string, valor: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_flota_config', {
      p_clave: clave,
      p_valor: valor,
    });
    if (error) throw new Error(error.message);
  }
}
