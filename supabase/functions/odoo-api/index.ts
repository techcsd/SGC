import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { configDesdeEntorno, OdooClient } from "../_shared/odoo-client.ts";
import { type Capacidades, type Deps, manejar } from "./handler.ts";

// PoC "Odoo como fuente de verdad" — gateway de SOLO LECTURA (stock). Ver
// docs/EVALUACION-ACCESO-DIRECTO-ODOO-2026-10-16.md. Secrets: ODOO_URL, ODOO_DB,
// ODOO_USER, ODOO_API_KEY, ODOO_COMPANY_ID (opcional, 1).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

let cliente: OdooClient | null = null; // reutiliza el uid autenticado entre requests del isolate

const deps: Deps = {
  async autenticar(authHeader: string): Promise<Capacidades | null> {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return null;
    const { data: cap, error } = await supabase.rpc("capacidades_asistente");
    if (error || !cap) return null;
    return { es_admin: !!cap.es_admin, modulos: Array.isArray(cap.modulos) ? cap.modulos : [] };
  },
  odoo: () => (cliente ??= new OdooClient(configDesdeEntorno())),
};

Deno.serve((req: Request) => manejar(req, deps));
