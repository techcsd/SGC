import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { CambioItem } from '../models/app-version.model';

export interface VersionNovedad {
  version: string;
  titulo: string | null;
  cambios: CambioItem[];
  fecha: string | null;
  url: string | null;
}

export interface NovedadesPendientes {
  tiene_pendientes: boolean;
  version_vista: string | null;
  versiones: VersionNovedad[];
  total_versiones: number;
  hay_mas: boolean;
  arreglado_para_ti: string[];
}

/** CO2 — "Novedades" a pantalla completa (web + app comparten el mismo contrato de servidor). */
@Injectable({ providedIn: 'root' })
export class NovedadesService {
  private supabase = inject(SupabaseService);

  async pendientes(plataforma: 'web' | 'app'): Promise<NovedadesPendientes> {
    const { data, error } = await this.supabase.client.rpc('novedades_pendientes', { p_plataforma: plataforma });
    if (error) throw new Error(error.message);
    return data as NovedadesPendientes;
  }

  async marcarVistas(plataforma: 'web' | 'app', version: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_novedades_vistas', {
      p_plataforma: plataforma,
      p_version: version,
    });
    if (error) throw new Error(error.message);
  }
}
