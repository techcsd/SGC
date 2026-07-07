import { Injectable, inject } from '@angular/core';
import { ProyectosService } from '../services/proyectos.service';
import { ContextService, ContextoObra } from './context.service';
import { RiesgoNivel } from './weather.model';

/** Weather context for a single active obra, plus the worst risk level detected —
 *  so consumers can sort/highlight the obras that need attention. */
export interface ObraClima {
  proyectoId: string;
  codigo: string;
  nombre: string;
  contexto: ContextoObra;
  peorNivel: RiesgoNivel;
}

const ORDEN_NIVEL: Record<RiesgoNivel, number> = { peligro: 3, precaucion: 2, info: 1 };

/** Domain aggregator for the Intelligent Context System: combines ProyectosService
 *  (which obras are live + where) with ContextService (real-world context per
 *  location) to answer "what is the weather across all active obras, and which ones
 *  are at risk right now". Kept thin and separate so the generic ContextService
 *  stays free of the proyectos domain, and so dashboards/alerts share one source. */
@Injectable({ providedIn: 'root' })
export class ObrasClimaService {
  private proyectos = inject(ProyectosService);
  private context = inject(ContextService);

  /** Loads current weather + recommendations for every active obra with coordinates.
   *  Individual failures are skipped (best-effort) so one bad location never blanks
   *  the whole panel. Results are sorted worst-risk first. */
  async getClimaObrasActivas(opts: { force?: boolean } = {}): Promise<ObraClima[]> {
    const obras = await this.proyectos.getActivasConUbicacion();

    const resultados = await Promise.all(
      obras.map(async (p): Promise<ObraClima | null> => {
        if (p.latitud == null || p.longitud == null) return null;
        try {
          const contexto = await this.context.getContexto(
            { latitud: p.latitud, longitud: p.longitud },
            opts,
          );
          return {
            proyectoId: p.id,
            codigo: p.codigo,
            nombre: p.nombre,
            contexto,
            peorNivel: this.peorNivel(contexto),
          };
        } catch {
          return null;
        }
      }),
    );

    return resultados
      .filter((r): r is ObraClima => r !== null)
      .sort((a, b) => ORDEN_NIVEL[b.peorNivel] - ORDEN_NIVEL[a.peorNivel]);
  }

  private peorNivel(contexto: ContextoObra): RiesgoNivel {
    let peor: RiesgoNivel = 'info';
    for (const r of contexto.recomendaciones) {
      if (ORDEN_NIVEL[r.nivel] > ORDEN_NIVEL[peor]) peor = r.nivel;
    }
    return peor;
  }
}
