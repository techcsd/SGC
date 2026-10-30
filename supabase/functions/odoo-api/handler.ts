// odoo-api/handler.ts — gateway: autentica al usuario SGC, exige el módulo
// `inventario` EN EL SERVIDOR, limita por usuario y despacha solo acciones de la
// allowlist, con caché por tipo de dato. Nunca devuelve al cliente el texto crudo de Odoo
// (BS2): el detalle técnico queda en el log del servidor.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { OdooClient, OdooError } from "../_shared/odoo-client.ts";
import type { CacheOdoo } from "../_shared/odoo-cache.ts";
import type { LimitePorUsuario } from "../_shared/odoo-limite.ts";
import type { CircuitoOdoo } from "../_shared/odoo-circuito.ts";
import type { SemaforoOdoo } from "../_shared/odoo-semaforo.ts";
import { conReintentoLectura } from "../_shared/odoo-backoff.ts";
import { ACCIONES, type Accion, DEFINICIONES, ParamError } from "./acciones.ts";
import { ACCIONES_ESCRITURA, type AccionEscritura, type AdaptadoresOc, DEFINICIONES_ESCRITURA } from "./acciones-escritura.ts";

export const MODULO_REQUERIDO = "inventario";
export const MODULO_REQUERIDO_ESCRITURA = "compras"; // CY24 Fase C

export interface Capacidades { usuario_id: string; es_admin: boolean; modulos: string[] }

export interface Deps {
  /** Valida el JWT y devuelve las capacidades (null = sesión inválida). LANZA si la infraestructura falla. */
  autenticar(authHeader: string): Promise<Capacidades | null>;
  /** Fábrica del cliente Odoo (lanza OdooError si falta configuración). */
  odoo(): OdooClient;
  caches: Record<Accion, CacheOdoo>;
  limite: LimitePorUsuario;
  /** CY23 — circuit breaker + semáforo global, compartidos entre todas las acciones. */
  circuito: CircuitoOdoo;
  semaforo: SemaforoOdoo;
  /** Orígenes web permitidos (CORS). Vacío = solo sin cabecera Origin. */
  origenes: string[];
  /** CY24 Fase C — cliente service role para acciones de ESCRITURA (D5: el edge relee todo, nunca confía en el cliente). */
  admin(): SupabaseClient;
  /** Adaptador hacia Odoo para las escrituras de OC (mock hoy, D-08). Inyectable en tests. */
  adaptadorOc?: Partial<AdaptadoresOc>;
}

const CODIGOS_FALLO_INFRA = new Set(["odoo_timeout", "odoo_no_disponible"]);

/** CY23 — envuelve una lectura a Odoo con circuito + semáforo + backoff. */
async function conResiliencia<T>(deps: Deps, fn: () => Promise<T>, opts: { reintentar: boolean } = { reintentar: true }): Promise<T> {
  if (!deps.circuito.puedeIntentar()) {
    throw new OdooError("odoo_circuito_abierto", "Circuito abierto: demasiados fallos recientes hacia Odoo.");
  }
  if (!deps.semaforo.intentar()) {
    throw new OdooError("odoo_saturado", "Demasiadas consultas simultáneas a Odoo.");
  }
  try {
    // Las ESCRITURAS nunca se reintentan solas (D3 / #23): un timeout deja el estado incierto.
    const resultado = opts.reintentar ? await conReintentoLectura(fn) : await fn();
    deps.circuito.registrarExito();
    return resultado;
  } catch (e) {
    if (e instanceof OdooError && CODIGOS_FALLO_INFRA.has(e.codigo)) deps.circuito.registrarFallo();
    throw e;
  } finally {
    deps.semaforo.liberar();
  }
}

const baseHeaders = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sgc-client", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin" };

function corsPara(req: Request, origenes: string[]): Record<string, string> {
  const o = req.headers.get("Origin");
  return o && origenes.includes(o) ? { ...baseHeaders, "Access-Control-Allow-Origin": o } : baseHeaders;
}

// Mensajes seguros para el usuario por código; el detalle de Odoo NO sale del servidor.
const MENSAJE_ODOO: Record<string, string> = {
  odoo_timeout: "Odoo no respondió a tiempo.",
  odoo_no_disponible: "No se pudo conectar con Odoo.",
  odoo_auth: "El servicio de Odoo no está disponible por ahora.",
  odoo_config: "El servicio de Odoo no está disponible por ahora.",
  odoo_error: "El servicio de Odoo no está disponible por ahora.",
  odoo_circuito_abierto: "Odoo está fallando seguido ahora mismo — espera un momento y vuelve a intentar.",
  odoo_saturado: "Hay demasiadas consultas a Odoo en este momento. Intenta de nuevo en unos segundos.",
};
// Escritura sin respuesta: puede haberse aplicado. El usuario NO debe reenviar a ciegas.
const MENSAJE_INCIERTO = "Odoo no respondió y no sabemos si la acción se aplicó. No la reenvíes: Tecnología la conciliará con Odoo.";
const STATUS_ODOO: Record<string, number> = {
  odoo_timeout: 504, odoo_no_disponible: 502, odoo_auth: 502, odoo_config: 500, odoo_error: 502,
  odoo_circuito_abierto: 503, odoo_saturado: 429,
};

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  const cors = corsPara(req, deps.origenes);
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "No autorizado." }, 401);

  let cap: Capacidades | null;
  try {
    cap = await deps.autenticar(auth);
  } catch (e) {
    // Caída de Supabase/RPC: NO es "sesión inválida" (el cliente no debe forzar un relogin).
    console.error("[odoo-api] fallo al autenticar:", e);
    return json({ error: "No se pudo verificar tu sesión. Intenta de nuevo.", error_code: "auth_no_disponible" }, 503);
  }
  if (!cap) return json({ error: "Sesión inválida." }, 401);

  const espera = deps.limite.intentar(cap.usuario_id);
  if (espera > 0) {
    return json({ error: "Demasiadas consultas seguidas. Espera un momento.", error_code: "limite" }, 429, { "Retry-After": String(espera) });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Body inválido." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Body inválido." }, 400);
  const { accion, params: rawParams } = body as { accion?: unknown; params?: unknown };
  const esEscritura = typeof accion === "string" && (ACCIONES_ESCRITURA as readonly string[]).includes(accion);
  const esLectura = typeof accion === "string" && (ACCIONES as readonly string[]).includes(accion);
  if (typeof accion !== "string" || !(esEscritura || esLectura)) {
    return json({ error: "Acción no permitida." }, 400);
  }
  if (!(cap.es_admin || cap.modulos.includes(esEscritura ? MODULO_REQUERIDO_ESCRITURA : MODULO_REQUERIDO))) {
    return json({ error: "Tu rol no tiene acceso a esta información." }, 403);
  }
  const { refrescar, ...params } = rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)
    ? rawParams as Record<string, unknown> : {} as Record<string, unknown>;

  // CY24 Fase C — acciones de ESCRITURA: nunca pasan por caché (D3 ya las hace
  // idempotentes vía sgc.odoo_comandos_oc), siempre con service role (D5).
  if (esEscritura) {
    try {
      const def = DEFINICIONES_ESCRITURA[accion as AccionEscritura] as unknown as {
        normalizar(p: Record<string, unknown>): unknown;
        ejecutar(ctx: { admin: SupabaseClient; usuarioId: string; adaptador?: Partial<AdaptadoresOc> }, p: unknown): Promise<unknown>;
      };
      const norm = def.normalizar(params);
      const data = await conResiliencia(
        deps,
        () => def.ejecutar({ admin: deps.admin(), usuarioId: cap.usuario_id, adaptador: deps.adaptadorOc }, norm),
        { reintentar: false },
      );
      return json({ data });
    } catch (e) {
      if (e instanceof ParamError) return json({ error: e.message }, 400);
      if (e instanceof OdooError) {
        console.error(`[odoo-api] ${accion}: ${e.codigo} ${e.message}`);
        const incierto = e.codigo === "odoo_timeout" || e.codigo === "odoo_no_disponible";
        const mensaje = incierto ? MENSAJE_INCIERTO : (MENSAJE_ODOO[e.codigo] ?? MENSAJE_ODOO.odoo_error);
        return json({ error: mensaje, error_code: e.codigo }, STATUS_ODOO[e.codigo] ?? 502);
      }
      console.error(`[odoo-api] ${accion}:`, e);
      return json({ error: "Error interno del gateway.", error_code: "interno" }, 500);
    }
  }

  try {
    const def = DEFINICIONES[accion as Accion] as unknown as {
      normalizar(p: Record<string, unknown>): unknown;
      ejecutar(o: OdooClient, p: unknown): Promise<unknown>;
    };
    const norm = def.normalizar(params); // valida ANTES de tocar caché u Odoo
    const clave = `${accion}|${JSON.stringify(norm)}`;
    const { entrada, origen } = await deps.caches[accion as Accion].obtener(
      clave, () => conResiliencia(deps, () => def.ejecutar(deps.odoo(), norm)), refrescar === true,
    );
    return json({ data: entrada.data, consultado_en: entrada.consultado_en, cache: origen });
  } catch (e) {
    if (e instanceof ParamError) return json({ error: e.message }, 400);
    if (e instanceof OdooError) {
      console.error(`[odoo-api] ${accion}: ${e.codigo} ${e.message}`);
      return json({ error: MENSAJE_ODOO[e.codigo] ?? MENSAJE_ODOO.odoo_error, error_code: e.codigo }, STATUS_ODOO[e.codigo] ?? 502);
    }
    console.error(`[odoo-api] ${accion}:`, e);
    return json({ error: "Error interno del gateway.", error_code: "interno" }, 500);
  }
}
