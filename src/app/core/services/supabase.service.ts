import { Injectable, inject } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { PracticaClienteService } from '../practica/practica-cliente.service';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private practica = inject(PracticaClienteService);

  // Let TypeScript infer the full generic type from createClient
  private readonly realClient = this.crearCliente();

  /**
   * CM7 — mientras la práctica está activa, devuelve el **cliente de práctica**
   * (datos de mentira, nada sale a la red salvo la nota del intento); si no, el cliente
   * real. Para el 99,99 % del tiempo (práctica inactiva) es exactamente el cliente de antes.
   */
  get client() {
    const real = this.realClient;
    return this.practica.activa() ? (this.practica.client as unknown as typeof real) : real;
  }

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
