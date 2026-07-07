import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { interpretarCodigoTiempo } from './weather.model';

/** Per-obra weather-impact summary over a date range. */
export interface ReporteObra {
  proyectoId: string;
  codigo: string;
  nombre: string;
  diasMonitoreados: number;
  diasConLluvia: number;
  diasAdversos: number; // rain OR high wind — days work is likely affected
  pctAdverso: number; // diasAdversos / diasMonitoreados * 100
  ultimaLectura: string | null;
}

export interface ReporteClima {
  desde: string;
  hasta: string;
  totalSnapshots: number;
  obrasMonitoreadas: number;
  diasAdversosTotal: number;
  diasConLluviaTotal: number;
  porObra: ReporteObra[];
}

interface SnapshotRow {
  proyecto_id: string;
  capturado_en: string;
  precipitacion_mm: number | null;
  viento_kmh: number | null;
  codigo_tiempo: number | null;
  proyecto?: { nombre: string; codigo: string } | null;
}

// Umbrales — a snapshot counts as "adverso" (work likely affected) when it rains
// meaningfully or wind is high enough to suspend lifts/heights.
const LLUVIA_MM = 0.5;
const VIENTO_ALTO_KMH = 40;

/** Business-intelligence layer for the Intelligent Context System: turns the raw
 *  weather_snapshots history into construction impact metrics (días perdidos por
 *  lluvia, obras con más interrupciones climáticas). Read-only aggregation, kept
 *  separate from the live ContextService so reporting can evolve independently. */
@Injectable({ providedIn: 'root' })
export class WeatherBiService {
  private supabase = inject(SupabaseService);

  /** desde/hasta are inclusive YYYY-MM-DD dates. */
  async getReporteClima(desde: string, hasta: string): Promise<ReporteClima> {
    const { data, error } = await this.supabase.client
      .from('weather_snapshots')
      .select('proyecto_id, capturado_en, precipitacion_mm, viento_kmh, codigo_tiempo, proyecto:proyectos(nombre, codigo)')
      .gte('capturado_en', `${desde}T00:00:00`)
      .lte('capturado_en', `${hasta}T23:59:59`)
      .not('proyecto_id', 'is', null)
      .order('capturado_en', { ascending: true });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as SnapshotRow[];
    return this.agregar(rows, desde, hasta);
  }

  private esAdverso(r: SnapshotRow): { adverso: boolean; lluvia: boolean } {
    const lluvia =
      (r.precipitacion_mm ?? 0) >= LLUVIA_MM || interpretarCodigoTiempo(r.codigo_tiempo).lluvia;
    const viento = (r.viento_kmh ?? 0) >= VIENTO_ALTO_KMH;
    return { adverso: lluvia || viento, lluvia };
  }

  private agregar(rows: SnapshotRow[], desde: string, hasta: string): ReporteClima {
    // Per obra → set of calendar days, and which days were adverse / rainy.
    interface Acc {
      codigo: string;
      nombre: string;
      dias: Set<string>;
      diasAdversos: Set<string>;
      diasLluvia: Set<string>;
      ultima: string | null;
    }
    const porObra = new Map<string, Acc>();

    for (const r of rows) {
      const dia = r.capturado_en.slice(0, 10);
      let acc = porObra.get(r.proyecto_id);
      if (!acc) {
        acc = {
          codigo: r.proyecto?.codigo ?? '—',
          nombre: r.proyecto?.nombre ?? 'Obra',
          dias: new Set(),
          diasAdversos: new Set(),
          diasLluvia: new Set(),
          ultima: null,
        };
        porObra.set(r.proyecto_id, acc);
      }
      acc.dias.add(dia);
      const { adverso, lluvia } = this.esAdverso(r);
      if (adverso) acc.diasAdversos.add(dia);
      if (lluvia) acc.diasLluvia.add(dia);
      if (!acc.ultima || r.capturado_en > acc.ultima) acc.ultima = r.capturado_en;
    }

    const obras: ReporteObra[] = [...porObra.entries()]
      .map(([proyectoId, a]) => {
        const diasMonitoreados = a.dias.size;
        const diasAdversos = a.diasAdversos.size;
        return {
          proyectoId,
          codigo: a.codigo,
          nombre: a.nombre,
          diasMonitoreados,
          diasConLluvia: a.diasLluvia.size,
          diasAdversos,
          pctAdverso: diasMonitoreados > 0 ? Math.round((diasAdversos / diasMonitoreados) * 100) : 0,
          ultimaLectura: a.ultima,
        };
      })
      .sort((x, y) => y.diasAdversos - x.diasAdversos || y.pctAdverso - x.pctAdverso);

    return {
      desde,
      hasta,
      totalSnapshots: rows.length,
      obrasMonitoreadas: obras.length,
      diasAdversosTotal: obras.reduce((s, o) => s + o.diasAdversos, 0),
      diasConLluviaTotal: obras.reduce((s, o) => s + o.diasConLluvia, 0),
      porObra: obras,
    };
  }
}
