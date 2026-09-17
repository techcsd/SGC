import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** BS3 — preferencias del usuario (Configuración). El idioma vive en usuarios.idioma
 *  (canónico, compartido con la app); el resto en usuario_preferencias. */
export interface MisPreferencias {
  idioma: 'es' | 'en' | 'ht';
  tema: 'claro' | 'oscuro' | 'sistema';
  densidad: 'compacta' | 'normal' | 'comoda';
  tamano_letra: 'pequena' | 'normal' | 'grande';
  modulo_inicio: string | null;
  idioma_elegido_at: string | null;
}

export type ClavePreferencia = 'idioma' | 'tema' | 'densidad' | 'tamano_letra' | 'modulo_inicio';

/**
 * BS3 — servicio de preferencias de Configuración. Lee/escribe vía RPCs
 * `mis_preferencias()` / `set_mi_preferencia(clave, valor)` (RLS: solo el propio
 * usuario). Cachea la última lectura en un signal para la UI.
 */
@Injectable({ providedIn: 'root' })
export class PreferenciasService {
  private supabase = inject(SupabaseService);

  private _prefs = signal<MisPreferencias | null>(null);
  prefs = this._prefs.asReadonly();

  async cargar(): Promise<MisPreferencias | null> {
    const { data, error } = await this.supabase.client.rpc('mis_preferencias');
    if (error) throw new Error(error.message);
    const p = (data ?? null) as MisPreferencias | null;
    this._prefs.set(p);
    return p;
  }

  async set(clave: ClavePreferencia, valor: string): Promise<void> {
    const { data, error } = await this.supabase.client.rpc('set_mi_preferencia', {
      p_clave: clave,
      p_valor: valor,
    });
    if (error) throw new Error(error.message);
    if (data) this._prefs.set(data as MisPreferencias);
  }
}
