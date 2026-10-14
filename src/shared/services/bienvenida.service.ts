import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/**
 * CL3 — estado de la bienvenida web (flag EN SERVIDOR por usuario, no localStorage).
 * `bienvenida_estado()` dice si ya se vio; `marcar_bienvenida_vista('web')` la marca.
 * `reabrir` lo usan Soporte/Dudas para "Ver la bienvenida otra vez".
 */
@Injectable({ providedIn: 'root' })
export class BienvenidaService {
  private supabase = inject(SupabaseService);

  /** Se incrementa para forzar que la bienvenida se vuelva a mostrar (Soporte/Dudas). */
  reabrir = signal(0);

  /** CO2 — se pone en true cuando la bienvenida se cerró en ESTA sesión (aunque el
   *  flag del servidor tarde en reflejarse); Novedades espera esto antes de salir,
   *  para nunca pisar la bienvenida. */
  cerradaEnSesion = signal(false);

  /** ¿ya vio la bienvenida web? null = aún no (usuario nuevo). */
  async yaVistaWeb(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.client.rpc('bienvenida_estado');
      if (error) return true; // ante error, no molestar
      const row = Array.isArray(data) ? data[0] : data;
      return !!row?.web;
    } catch {
      return true;
    }
  }

  async marcarVistaWeb(): Promise<void> {
    try {
      await this.supabase.client.rpc('marcar_bienvenida_vista', { p_canal: 'web' });
    } catch {
      /* best-effort: si falla, se volverá a mostrar — no es grave */
    }
  }

  /** Forzar la bienvenida otra vez (desde Soporte/Dudas). */
  verOtraVez(): void {
    this.reabrir.update((n) => n + 1);
  }
}
