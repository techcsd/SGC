// _shared/odoo-cache.ts — caché de lectura del gateway Odoo (equivalente servidor de
// TanStack Query). Usa `lru-cache` (TTL + tamaño máximo + single-flight): peticiones
// idénticas simultáneas comparten UNA sola llamada a Odoo, y cada tipo de dato tiene
// su propio TTL. Es memoria efímera del isolate, NO una réplica: ningún dato dura más
// que su TTL y la respuesta declara cuándo se consultó (`consultado_en`).
import { LRUCache } from "npm:lru-cache@11.5.3";

export interface Entrada<T = unknown> {
  data: T;
  consultado_en: string; // ISO-8601: cuándo se leyó de Odoo
}
export type Origen = "miss" | "hit" | "inflight" | "refresh";

type Cargador = () => Promise<unknown>;

export class CacheOdoo {
  private lru: LRUCache<string, Entrada, Cargador>;

  constructor(private ttlMs: number, max = 500) {
    // ttl 0 = sin caché (cada lectura va a Odoo, pero aun así se agrupan las simultáneas).
    this.lru = new LRUCache<string, Entrada, Cargador>({
      max,
      ttl: Math.max(ttlMs, 1),
      ttlAutopurge: false,
      allowStale: false,
      // Sin fallback: si Odoo falla se propaga el error; nunca se sirve un dato vencido.
      allowStaleOnFetchRejection: false,
      noDeleteOnFetchRejection: false,
      fetchMethod: async (_k, _stale, { context }) => ({
        data: await context(),
        consultado_en: new Date().toISOString(),
      }),
    });
  }

  /** Lee `clave` del caché o la carga con `cargar`. `forzar` salta el caché (botón "Actualizar"). */
  async obtener<T>(clave: string, cargar: () => Promise<T>, forzar = false): Promise<{ entrada: Entrada<T>; origen: Origen }> {
    const status: LRUCache.Status<string, Entrada, Cargador> = {};
    const entrada = await this.lru.fetch(clave, { context: cargar, forceRefresh: forzar, status });
    if (!entrada) throw new Error("Caché Odoo devolvió vacío.");
    const origen: Origen = forzar ? "refresh" : status.fetch === "hit" ? "hit" : status.fetch === "inflight" ? "inflight" : "miss";
    return { entrada: entrada as Entrada<T>, origen };
  }

  clear() { this.lru.clear(); }
  get ttl() { return this.ttlMs; }
}

/** TTLs por tipo de dato (ms). Catálogo casi estático → largo; stock cambia → corto. */
export const TTL_MS = {
  "productos.buscar": 60_000,
  "ubicaciones.listar": 600_000,
  "stock.consultar": 15_000,
} as const;

/** Sobrescribible por entorno: ODOO_CACHE_TTL_S_<ACCION con . → _> (0 = sin caché). */
export function ttlDesdeEntorno(accion: keyof typeof TTL_MS, defecto: number = TTL_MS[accion]): number {
  const v = Deno.env.get(`ODOO_CACHE_TTL_S_${accion.toUpperCase().replace(/\./g, "_")}`);
  if (v === undefined) return defecto;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 86_400 ? n * 1000 : defecto;
}
