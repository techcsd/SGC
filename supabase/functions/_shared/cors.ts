// _shared/cors.ts — CY21 punto 1. CORS por lista de orígenes permitidos, en vez
// de "Access-Control-Allow-Origin": "*". Mismo patrón que ya probó la edge
// odoo-api (PR #22): Vary: Origin + Access-Control-Max-Age + headers/métodos
// explícitos, origen reflejado SOLO si está en la lista.
//
// Nota: esto solo importa para llamadas desde un NAVEGADOR (la web y la app
// PWA). Llamadas servidor-a-servidor (pg_cron, otra edge, webhooks de
// terceros) no envían `Origin` y no aplican CORS — restringir la lista no les
// afecta en nada.

export const ORIGENES_SGC = [
  "https://sgcconstructorasd.com",
  "https://dev.sgcconstructorasd.com",
  "https://app.sgcconstructorasd.com",
  "https://app-dev.sgcconstructorasd.com",
  "http://localhost:4200",
];

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sgc-client",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

/**
 * Cabeceras CORS para una request puntual. Si el `Origin` está en la lista
 * (o en `extra`, para edges que necesitan un header adicional como
 * `x-sync-secret`), se refleja; si no, se omite `Access-Control-Allow-Origin`
 * (el navegador bloqueará la respuesta, como se espera de un origen no
 * autorizado).
 */
export function corsHeaders(req: Request, opts: { origenes?: string[]; headersExtra?: string } = {}): Record<string, string> {
  const origenes = opts.origenes ?? ORIGENES_SGC;
  const base = opts.headersExtra
    ? { ...BASE_HEADERS, "Access-Control-Allow-Headers": `${BASE_HEADERS["Access-Control-Allow-Headers"]}, ${opts.headersExtra}` }
    : BASE_HEADERS;
  const origen = req.headers.get("Origin");
  return origen && origenes.includes(origen) ? { ...base, "Access-Control-Allow-Origin": origen } : base;
}
