// _shared/edge-seguro.ts -- EB-03/EB21: red de seguridad común para las edges.
// Una excepción no atrapada hacía que el gateway devolviera un 500 SIN cabeceras CORS: el navegador lo
// ve como fallo de red y la UI mostraba «No se pudo contactar el servicio [transporte]», ocultando el
// error real. Este envoltorio devuelve SIEMPRE JSON + CORS + error_code + id de correlación, y deja el
// detalle en el log (console.error) para Tecnología.
import { corsHeaders } from "./cors.ts";

export interface OpcionesEdgeSeguro { nombre: string; headersExtra?: string; origenes?: string[] }

export function idCorrelacion(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Respuesta 500 estándar para un error inesperado. Nunca incluye el detalle técnico en el cuerpo. */
export function respuestaErrorInterno(req: Request, e: unknown, o: OpcionesEdgeSeguro): Response {
  const correlacion = idCorrelacion();
  console.error(`[${o.nombre}] error_interno correlacion=${correlacion}:`, e instanceof Error ? (e.stack ?? e.message) : e);
  return new Response(
    JSON.stringify({ error: "Ocurrió un error inesperado en el servidor.", error_code: "error_interno", correlacion }),
    { status: 500, headers: { ...corsHeaders(req, { headersExtra: o.headersExtra, origenes: o.origenes }), "Content-Type": "application/json" } },
  );
}

/** Envuelve un handler: cualquier excepción sale como JSON con CORS (no como corte de transporte). */
export function edgeSeguro(o: OpcionesEdgeSeguro, handler: (req: Request) => Promise<Response> | Response): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (e) {
      return respuestaErrorInterno(req, e, o);
    }
  };
}
