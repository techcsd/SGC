// odoo-api/handler.ts — gateway: autentica al usuario SGC, exige el módulo
// `inventario` EN EL SERVIDOR y despacha solo acciones de la allowlist.
import { OdooClient, OdooError } from "../_shared/odoo-client.ts";
import { ACCIONES, type Accion, DESPACHO, ParamError } from "./acciones.ts";

export const MODULO_REQUERIDO = "inventario";

export interface Capacidades { es_admin: boolean; modulos: string[] }

export interface Deps {
  /** Valida el JWT y devuelve las capacidades del usuario (null = sesión inválida). */
  autenticar(authHeader: string): Promise<Capacidades | null>;
  /** Fábrica del cliente Odoo (lanza OdooError si falta configuración). */
  odoo(): OdooClient;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sgc-client",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const STATUS_ODOO: Record<string, number> = {
  odoo_timeout: 504, odoo_no_disponible: 502, odoo_auth: 502, odoo_config: 500, odoo_error: 502,
};

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "No autorizado." }, 401);
  const cap = await deps.autenticar(auth).catch(() => null);
  if (!cap) return json({ error: "Sesión inválida." }, 401);
  if (!(cap.es_admin || cap.modulos.includes(MODULO_REQUERIDO))) {
    return json({ error: "Tu rol no tiene acceso a esta información." }, 403);
  }

  let body: { accion?: unknown; params?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Body inválido." }, 400); }
  const accion = body.accion;
  if (typeof accion !== "string" || !(ACCIONES as readonly string[]).includes(accion)) {
    return json({ error: "Acción no permitida." }, 400);
  }
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params)
    ? body.params as Record<string, unknown> : {};

  try {
    const data = await DESPACHO[accion as Accion](deps.odoo(), params);
    return json({ data });
  } catch (e) {
    if (e instanceof ParamError) return json({ error: e.message }, 400);
    if (e instanceof OdooError) {
      console.error(`[odoo-api] ${accion}: ${e.codigo} ${e.message}`);
      return json({ error: e.message, codigo: e.codigo }, STATUS_ODOO[e.codigo] ?? 502);
    }
    console.error(`[odoo-api] ${accion}:`, e);
    return json({ error: "Error interno del gateway.", codigo: "interno" }, 500);
  }
}
