import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { ReporteSemanalFila } from '../models/vehiculo-asignacion.model';

/** Cumplimiento del reporte semanal por vehículo (R3). */
@Injectable({ providedIn: 'root' })
export class ReporteSemanalService {
  private supabase = inject(SupabaseService);

  /** Últimas 12 semanas ISO x vehículo activo (vista de cumplimiento). */
  async getCumplimiento(): Promise<ReporteSemanalFila[]> {
    const { data, error } = await this.supabase.client
      .from('v_reporte_semanal_cumplimiento')
      .select('*')
      .order('anio', { ascending: false })
      .order('semana', { ascending: false })
      .order('placa', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ReporteSemanalFila[];
  }

  /**
   * Genera avisos (idempotentes por vehículo/semana) para los vehículos sin
   * reporte de la semana dada. Patrón de vencimientos de Flota v2.
   * Devuelve cuántos avisos nuevos se crearon.
   */
  async generarAvisosFaltantes(faltantes: ReporteSemanalFila[]): Promise<number> {
    const rows = faltantes
      .filter((f) => !f.tiene_reporte)
      .map((f) => ({
        tipo: 'reporte_semanal',
        vehiculo_id: f.vehiculo_id,
        mensaje: `Reporte semanal pendiente del vehículo ${f.placa}${
          f.chofer_nombre ? ` (chofer: ${f.chofer_nombre})` : ''
        } — semana ${f.semana}/${f.anio}.`,
        severidad: 'media',
        dedup_key: `reporte_semanal:${f.vehiculo_id}:${f.anio}-${f.semana}`,
      }));
    if (rows.length === 0) return 0;
    const { count, error } = await this.supabase.client
      .from('avisos_flota')
      .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true, count: 'exact' });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
