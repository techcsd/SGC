// odoo-api/handler.ts — gateway: autentica al usuario SGC, exige el módulo
// `inventario` EN EL SERVIDOR, limita por usuario y despacha solo acciones de la
// allowlist, con caché por tipo de dato. Nunca devuelve al cliente el texto crudo de Odoo
// (BS2): el detalle técnico queda en el log del servidor.
import { OdooClient, OdooError } from "../_shared/odoo-client.ts";
import type { CacheOdoo } from "../_shared/odoo-cache.ts";
import type { LimitePorUsuario } from "../_shared/odoo-limite.ts";
import { ACCIONES, type Accion, DEFINICIONES, ParamError } from "./acciones.ts";

export const MODULO_REQUERIDO = "inventario";

export interface Capacidades { usuario_id: string; es_admin: boolean; modulos: string[] }

export interface Deps {
  /** Valida el JWT y devuelve las capacidades (null = sesión inválida). LANZA si la infraestructura falla. */
  autenticar(authHeader: string): Promise<Capacidades | null>;
  /** Fábrica del cliente Odoo (lanza OdooError si falta configuración). */
  odoo(): OdooClient;
  caches: Record<Accion, CacheOdoo>;
  limite: LimitePorUsuario;
  /** Orígenes web permitidos (CORS). Vacío = solo sin cabecera Origin. */
  origenes: string[];
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
};
const STATUS_ODOO: Record<string, number> = {
  odoo_timeout: 504, odoo_no_disponible: 502, odoo_auth: 502, odoo_config: 500, odoo_error: 502,
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
  if (!(cap.es_admin || cap.modulos.includes(MODULO_REQUERIDO))) {
    return json({ error: "Tu rol no tiene acceso a esta información." }, 403);
  }

  const espera = deps.limite.intentar(cap.usuario_id);
  if (espera > 0) {
    return json({ error: "Demasiadas consultas seguidas. Espera un momento.", error_code: "limite" }, 429, { "Retry-After": String(espera) });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Body inválido." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Body inválido." }, 400);
  const { accion, params: rawParams } = body as { accion?: unknown; params?: unknown };
  if (typeof accion !== "string" || !(ACCIONES as readonly string[]).includes(accion)) {
    return json({ error: "Acción no permitida." }, 400);
  }
  const { refrescar, ...params } = rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)
    ? rawParams as Record<string, unknown> : {} as Record<string, unknown>;

  try {
    const def = DEFINICIONES[accion as Accion] as unknown as {
      normalizar(p: Record<string, unknown>): unknown;
      ejecutar(o: OdooClient, p: unknown): Promise<unknown>;
    };
    const norm = def.normalizar(params); // valida ANTES de tocar caché u Odoo
    const clave = `${accion}|${JSON.stringify(norm)}`;
    const { entrada, origen } = await deps.caches[accion as Accion].obtener(
      clave, () => def.ejecutar(deps.odoo(), norm), refrescar === true,
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
