import { Injectable, signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/**
 * CM7 (F7a) — "escenario" de una misión: los datos de mentira que el cliente de práctica
 * sirve en vez de la red. Las LECTURAS salen de aquí; las ESCRITURAS se guardan en memoria
 * (nunca viajan). Lo que no está definido devuelve vacío o "No disponible en práctica".
 */
export interface EscenarioPractica {
  /** Respuesta por nombre de RPC (`/rest/v1/rpc/<name>`). */
  rpc?: Record<string, unknown>;
  /** Filas por tabla (`GET /rest/v1/<tabla>`). */
  tablas?: Record<string, unknown[]>;
  /** Respuesta por edge function (`/functions/v1/<name>`). */
  funciones?: Record<string, unknown>;
}

/** Una escritura que el usuario hizo durante la práctica (en memoria, nunca a la red). */
export interface EscrituraPractica {
  tabla: string;
  metodo: string;
  body: unknown;
}

/**
 * CM7 (F7a) — **Cliente Supabase de práctica**: un `supabase-js` real con un `fetch` propio
 * que responde desde el escenario de la misión (datos de mentira), guarda las escrituras en
 * memoria y NUNCA sale a la red, con una sola excepción: `practica_guardar_intento` (la nota).
 * Realtime apagado. `SupabaseService.client` devuelve este cliente mientras la práctica está
 * activa, así que las pantallas REALES funcionan sin cambiar una línea.
 *
 * Candado de red: `salidasReales` registra toda petición que de verdad salió; la prueba
 * `practica-cliente.spec.ts` falla si sale algo distinto de `practica_guardar_intento`.
 */
@Injectable({ providedIn: 'root' })
export class PracticaClienteService {
  /** ¿El cliente de práctica está interceptando la red ahora mismo? */
  readonly activa = signal(false);

  private escenario: EscenarioPractica = {};
  /** Escrituras hechas durante la práctica (para evaluar la misión). */
  readonly escrituras: EscrituraPractica[] = [];
  /** Se incrementa con cada escritura — para que la UI de práctica reaccione en vivo. */
  readonly cambios = signal(0);
  /** Candado: nombres de peticiones que SÍ salieron a la red (debe ser solo guardar_intento). */
  readonly salidasReales: string[] = [];

  /** `fetch` real; se puede sustituir en pruebas. */
  private realFetch: typeof fetch = (...a: Parameters<typeof fetch>) => fetch(...a);

  private crear() {
    return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      db: { schema: 'sgc' },
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 1 } },
      global: { fetch: (input, init) => this.practicaFetch(input as RequestInfo | URL, init) },
    });
  }
  private _client: ReturnType<PracticaClienteService['crear']> | null = null;
  /** Cliente de práctica (perezoso: solo se crea la primera vez que se usa). */
  get client() {
    if (!this._client) this._client = this.crear();
    return this._client;
  }

  /** Entra en práctica con un escenario (reinicia escrituras y el candado). */
  entrar(escenario: EscenarioPractica = {}) {
    this.escenario = escenario ?? {};
    this.escrituras.length = 0;
    this.salidasReales.length = 0;
    this.activa.set(true);
  }

  salir() {
    this.activa.set(false);
    this.escenario = {};
  }

  /** `fetch` de práctica: nunca sale a la red salvo `practica_guardar_intento`. */
  private async practicaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET') || 'GET').toUpperCase();
    let path = href;
    try { path = new URL(href, environment.supabaseUrl).pathname; } catch { /* href ya es path */ }

    // ── La ÚNICA petición real permitida: guardar la nota del intento ──
    if (path.endsWith('/rest/v1/rpc/practica_guardar_intento')) {
      this.salidasReales.push('practica_guardar_intento');
      return this.realFetch(input, init);
    }

    // ── RPC: respuesta del escenario (o vacío) ──
    const mRpc = path.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    if (mRpc) {
      const name = mRpc[1];
      // Un RPC con cuerpo (POST) suele ser una ESCRITURA (crear/aprobar/despachar…):
      // guárdala también en memoria para poder evaluar la misión por lo que el usuario hizo.
      if ((method === 'POST' || method === 'PATCH') && init?.body) {
        let body: unknown;
        try { body = JSON.parse(init.body as string); } catch { body = undefined; }
        this.escrituras.push({ tabla: `rpc:${name}`, metodo: method, body });
        this.cambios.update((n) => n + 1);
      }
      return this.json(this.escenario.rpc?.[name] ?? []);
    }

    // ── Edge functions: escenario o "No disponible en práctica" ──
    const mFn = path.match(/\/functions\/v1\/([^/?]+)/);
    if (mFn) {
      const name = mFn[1];
      if (this.escenario.funciones && name in this.escenario.funciones) return this.json(this.escenario.funciones[name]);
      return this.json({ error: 'No disponible en práctica' });
    }

    // ── Tablas REST ──
    const mTab = path.match(/\/rest\/v1\/([^/?]+)/);
    if (mTab) {
      const tabla = mTab[1];
      if (method === 'GET' || method === 'HEAD') {
        const filas = this.escenario.tablas?.[tabla] ?? [];
        // `.single()`/`.maybeSingle()` piden un objeto (Accept pgrst.object), no un arreglo.
        if (this.pideObjeto(init)) return this.json(filas[0] ?? { id: `practica-${tabla}` });
        return this.json(filas);
      }
      // Escritura: guárdala en memoria y devuelve una fila simulada.
      let body: unknown;
      try { body = init?.body ? JSON.parse(init.body as string) : undefined; } catch { body = undefined; }
      this.escrituras.push({ tabla, metodo: method, body });
      this.cambios.update((n) => n + 1);
      const filas = Array.isArray(body) ? body : [body ?? {}];
      const rows = filas.map((r, i) => ({ id: `practica-${tabla}-${i}`, ...(r as object) }));
      return this.json(rows, method === 'POST' ? 201 : 200);
    }

    // ── Cualquier otra cosa: no sale a la red ──
    return this.json({ error: 'No disponible en práctica' });
  }

  /** ¿La petición pide un objeto único (`.single()` → Accept pgrst.object)? */
  private pideObjeto(init?: RequestInit): boolean {
    const h = init?.headers;
    let accept = '';
    if (h instanceof Headers) accept = h.get('Accept') ?? '';
    else if (Array.isArray(h)) accept = (h.find(([k]) => k.toLowerCase() === 'accept')?.[1]) ?? '';
    else if (h) { const o = h as Record<string, string>; accept = o['Accept'] ?? o['accept'] ?? ''; }
    return accept.includes('pgrst.object');
  }

  private json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data ?? null), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
