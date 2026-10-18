// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// CR1 (FASE 0.5) — Servidor MCP remoto del SGC, mínimo.
//   Streamable HTTP sin estado. verify_jwt=false en config.toml a propósito:
//   withSupabase({ auth: 'user' }) valida el token él mismo contra el JWKS del
//   proyecto (requiere claves asimétricas — ya migradas, ver docs/CLAUDE-CONECTOR.md)
//   y devuelve 401 + WWW-Authenticate cuando no hay sesión, en vez de que el
//   gateway de Supabase lo haga de forma genérica.
//
//   Esta versión solo trae UNA herramienta (quien_soy) para probar el flujo
//   OAuth completo de punta a punta (FASE 0.6: MCP Inspector). El registro
//   real (todas las lecturas + proponer_* como borrador) llega en FASE 3,
//   una vez que `herramientas.ts` exista (FASE 1).
// ============================================================================
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@^2.0.0";
import { pipeline } from "npm:@supabase/middleware@1";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1";
import { z } from "npm:zod@^4.3.6";

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: "sgc", version: "0.0.1-fase0" });

        server.registerTool(
          "quien_soy",
          {
            description: "Quién eres en el SGC: tu nombre, rol(es), módulos con acceso y si eres admin. Úsala si dudas de con quién está conectado Claude.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, idempotentHint: true },
          },
          async () => {
            // sgc.* vive en el schema "sgc", no en "public" — withSupabase() no
            // expone una opción de schema por defecto (a diferencia de
            // createClient({db:{schema}})); .schema() cambia el schema por llamada.
            const { data, error } = await supabase.schema("sgc").rpc("quien_soy");
            if (error) throw new Error(error.message);
            return { content: [{ type: "text", text: JSON.stringify(data) }] };
          },
        );

        return server;
      });

      return handler.fetch(req);
    },
  ),
);
