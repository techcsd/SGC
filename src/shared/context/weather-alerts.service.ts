import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

export interface WeatherAlerta {
  id: string;
  proyectoId: string;
  codigo: string;
  nombre: string;
  tipo: string;
  nivel: 'peligro' | 'precaucion';
  titulo: string;
  detalle: string;
  creadoEn: string;
}

interface AlertaRow {
  id: string;
  proyecto_id: string;
  tipo: string;
  nivel: 'peligro' | 'precaucion';
  titulo: string;
  detalle: string;
  creado_en: string;
  proyecto?: { nombre: string; codigo: string } | null;
}

/** Reads the persisted severe-weather alerts maintained by the sync-weather-obras
 *  edge function. Kept tiny and separate from BI/aggregation so the alert feed can
 *  be reused (badge count lives in NotificacionesService; this powers the list). */
@Injectable({ providedIn: 'root' })
export class WeatherAlertsService {
  private supabase = inject(SupabaseService);

  async getVigentes(): Promise<WeatherAlerta[]> {
    const { data, error } = await this.supabase.client
      .from('weather_alerts')
      .select('id, proyecto_id, tipo, nivel, titulo, detalle, creado_en, proyecto:proyectos(nombre, codigo)')
      .eq('vigente', true)
      .order('creado_en', { ascending: false });

    if (error) throw new Error(error.message);

    return ((data ?? []) as unknown as AlertaRow[]).map((r) => ({
      id: r.id,
      proyectoId: r.proyecto_id,
      codigo: r.proyecto?.codigo ?? '—',
      nombre: r.proyecto?.nombre ?? 'Obra',
      tipo: r.tipo,
      nivel: r.nivel,
      titulo: r.titulo,
      detalle: r.detalle,
      creadoEn: r.creado_en,
    }));
  }
}
