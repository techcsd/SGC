import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { configDesdeEntorno, OdooClient } from "../_shared/odoo-client.ts";
import { CacheOdoo, ttlDesdeEntorno } from "../_shared/odoo-cache.ts";
import { LimitePorUsuario } from "../_shared/odoo-limite.ts";
import { CircuitoOdoo } from "../_shared/odoo-circuito.ts";
import { SemaforoOdoo } from "../_shared/odoo-semaforo.ts";
import { envRequerido } from "../_shared/env.ts";
import { ACCIONES, type Accion } from "./acciones.ts";
import { type Capacidades, type Deps, manejar } from "./handler.ts";

// PoC "Odoo como fuente de verdad" — gateway de SOLO LECTURA (stock). Ver
// docs/EVALUACION-ACCESO-DIRECTO-ODOO-2026-10-16.md. Secrets: ODOO_URL, ODOO_DB,
// ODOO_USER, ODOO_API_KEY, ODOO_COMPANY_ID (opcional, 1). Opcionales:
// ODOO_CACHE_TTL_S_<ACCION> (0 = sin caché), ODOO_CORS_ORIGINS (lista separada
// por comas), ODOO_CIRCUITO_UMBRAL/ODOO_CIRCUITO_ENFRIAMIENTO_MS (CY23) y
// ODOO_MAX_CONCURRENTE (CY23, semáforo global).
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");

const ORIGENES_POR_DEFECTO = [
  "https://sgcconstructorasd.com",
  "https://dev.sgcconstructorasd.com",
  "https://app.sgcconstructorasd.com",
  "https://app-dev.sgcconstructorasd.com",
  "http://localhost:4200",
];

let cliente: OdooClient | null = null; // reutiliza el uid autenticado entre requests del isolate

const caches = Object.fromEntries(
  ACCIONES.map((a) => [a, new CacheOdoo(ttlDesdeEntorno(a))]),
) as Record<Accion, CacheOdoo>;

const deps: Deps = {
  async autenticar(authHeader: string): Promise<Capacidades | null> {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr && (uErr.name === "AuthRetryableFetchError" || (uErr.status ?? 0) >= 500)) throw uErr; // infraestructura → 503
    if (uErr || !u?.user) return null; // JWT inválido o vencido
    const { data: cap, error } = await supabase.rpc("capacidades_asistente");
    if (error) throw new Error(`capacidades_asistente: ${error.message}`); // infraestructura → 503
    if (!cap) return null;
    return { usuario_id: u.user.id, es_admin: !!cap.es_admin, modulos: Array.isArray(cap.modulos) ? cap.modulos : [] };
  },
  odoo: () => (cliente ??= new OdooClient(configDesdeEntorno())),
  caches,
  limite: new LimitePorUsuario(),
  circuito: new CircuitoOdoo(
    Number(Deno.env.get("ODOO_CIRCUITO_UMBRAL") ?? "5"),
    Number(Deno.env.get("ODOO_CIRCUITO_ENFRIAMIENTO_MS") ?? "30000"),
  ),
  semaforo: new SemaforoOdoo(Number(Deno.env.get("ODOO_MAX_CONCURRENTE") ?? "8")),
  origenes: (Deno.env.get("ODOO_CORS_ORIGINS")?.split(",").map((s) => s.trim()).filter(Boolean)) ?? ORIGENES_POR_DEFECTO,
};

Deno.serve((req: Request) => manejar(req, deps));
