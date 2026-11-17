import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** DS-33/34/35 — flags de interfaz editables en sgc.parametros (RPC `parametros_ui`, lista cerrada).
 *  Los valores faltantes o ilegibles equivalen a "apagado": el sistema se comporta como antes. */
@Injectable({ providedIn: 'root' })
export class UiFlagsService {
  private supabase = inject(SupabaseService);
  private _valores = signal<Record<string, string>>({});
  private cargado: Promise<void> | null = null;

  /** DS-35/#59 — oculta el módulo de solicitudes de movimiento y redirige al conduce. */
  movimientoOculto = computed(() => this.bool('solicitud_movimiento_oculta'));
  /** DS-35/#59 — aviso de legado dentro del módulo mientras siga visible. */
  movimientoAvisoLegado = computed(() => this.bool('solicitud_movimiento_aviso_legado'));
  /** DS-34/#74 — QR en el conduce. */
  conduceQrActivo = computed(() => this.bool('conduce_qr_activo'));
  /** DS-36/#61 — tipos de aviso de flota informativos (no accionables), CSV. */
  avisosInformativos = computed(() =>
    (this._valores()['avisos_flota_informativos'] ?? 'reporte_semanal')
      .split(',').map((s) => s.trim()).filter(Boolean),
  );

  private bool(clave: string): boolean {
    return ['true', 't', '1', 'si', 'sí'].includes((this._valores()[clave] ?? '').toLowerCase());
  }

  /** Carga una sola vez por sesión (idempotente). */
  cargar(): Promise<void> {
    this.cargado ??= (async () => {
      try {
        const { data, error } = await this.supabase.client.rpc('parametros_ui');
        if (!error && data && typeof data === 'object') this._valores.set(data as Record<string, string>);
      } catch {
        // sin flags = comportamiento anterior
      }
    })();
    return this.cargado;
  }
}
