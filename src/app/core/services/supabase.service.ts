import { Injectable } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  // Let TypeScript infer the full generic type from createClient
  readonly client = this.crearCliente();

  // BU1 F0 — si el environment no trae proyecto (local sin `sgc-dev` aún), falla
  // con un mensaje claro en vez de conectarse a prod con un anon key vacío. Esto
  // corta el riesgo de que `ng serve` local escriba en producción.
  private crearCliente() {
    const { supabaseUrl, supabaseAnonKey } = environment;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'environment.ts sin proyecto Supabase: corre `npm run env:dev` cuando exista sgc-dev (PROMPT-58 F1). ' +
          'El entorno local ya NO apunta a producción a propósito (BU1 F0). Ver docs/ENTORNOS.md.',
      );
    }
    return createClient(supabaseUrl, supabaseAnonKey, {
      db: { schema: 'sgc' },
    });
  }
}
