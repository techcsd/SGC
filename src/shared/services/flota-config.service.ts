import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/**
 * Umbrales configurables de Flota (tabla clave/valor `sgc.flota_config`).
 * Se carga una sola vez (lazy, cacheado). Si la tabla está vacía o no responde
 * se conservan los DEFAULTS, de modo que el comportamiento sea idéntico al
 * hardcodeo previo.
 */
@Injectable({ providedIn: 'root' })
export class FlotaConfigService {
  private supabase = inject(SupabaseService);

  // Defaults seguros (== a los literales que reemplazan).
  umbralConsumoPct = signal(20); // % bajo el promedio que dispara alerta de consumo
  umbralPrecitaKm = signal(500); // km restantes para sugerir pre-cita de mantenimiento
  umbralLicenciaDias = signal(90); // C6 — 3 meses antes del vencimiento de licencia (configurable en flota_config.umbral_licencia_dias)
  rendimientoMinimoKmGal = signal(10); // U10 — piso absoluto de coherencia de consumo (km/gal)
  umbralPorVencerDias = signal(30); // X1 — ventana "por vencer" (amarillo) de licencia/matrícula/seguro

  private loaded = false;

  constructor() {
    // Best-effort: nunca romper la UI por un fallo de config.
    void this.load();
  }

  /** Lee todas las filas una sola vez y setea los signals (ignora NaN). */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const { data, error } = await this.supabase.client
        .from('flota_config')
        .select('clave, valor');
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const n = Number((row as { valor: string }).valor);
        if (!Number.isFinite(n)) continue;
        switch ((row as { clave: string }).clave) {
          case 'umbral_consumo_pct':
            this.umbralConsumoPct.set(n);
            break;
          case 'umbral_precita_km':
            this.umbralPrecitaKm.set(n);
            break;
          case 'umbral_licencia_dias':
            this.umbralLicenciaDias.set(n);
            break;
          case 'rendimiento_minimo_km_gal':
            this.rendimientoMinimoKmGal.set(n);
            break;
          case 'umbral_por_vencer_licencia':
            // Los 3 documentos comparten el mismo umbral en la UI; toma cualquiera.
            this.umbralPorVencerDias.set(n);
            break;
        }
      }
    } catch {
      // Silencioso: se mantienen los defaults.
    }
  }

  /** X1 — set del umbral "por vencer" (admin/elevado) vía RPC; re-evalúa avisos. */
  async setUmbralPorVencer(dias: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_umbral_por_vencer', { p_dias: dias });
    if (error) throw new Error(error.message);
    this.umbralPorVencerDias.set(dias);
  }
}
