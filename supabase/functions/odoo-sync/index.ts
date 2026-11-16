// odoo-sync/index.ts — CY6: procesador del outbox. Server-to-server (cron o
// invocación manual de Tecnología), SIEMPRE con service_role — nunca con el
// JWT de un usuario. Reclama eventos pendientes (RPC `odoo_v1_reclamar_eventos`,
// que ya filtra por política habilitada + es_prueba=false + dependencia de
// revisión), intenta publicarlos (hoy MOCK, ver `_shared/odoo-inventario.ts`)
// y finaliza con `odoo_v1_finalizar_evento`. No crea su propio cron ni
// webhook (fuera de alcance de CY23); se invoca manualmente o desde un
// scheduler ya existente cuando Xaviel lo pida.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { publicarMock } from "../_shared/odoo-inventario.ts";
import { configDesdeEntorno, OdooClient } from "../_shared/odoo-client.ts";
import { publicarSalida } from "../_shared/odoo-salidas.ts";
import { depsReales } from "./salidas.ts";

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = envRequerido("SUPABASE_SERVICE_ROLE_KEY");
const SYNC_SECRET = Deno.env.get("ODOO_SYNC_SECRET"); // igual patrón que infra/weather/cronograma sync secrets

Deno.serve(async (req: Request) => {
  const corsHeaders = construirCors(req, { headersExtra: "x-sync-secret" });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  if (SYNC_SECRET && req.headers.get("x-sync-secret") !== SYNC_SECRET) {
    return json({ error: "No autorizado." }, 401);
  }

  let body: { instancia_id?: string; limite?: number } = {};
  try { body = await req.json(); } catch { /* body vacío también es válido */ }
  const instanciaId = body.instancia_id;
  if (!instanciaId) return json({ error: "Falta instancia_id." }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  const { data: eventos, error: errReclamar } = await admin.rpc("odoo_v1_reclamar_eventos", {
    p_instancia: instanciaId,
    p_procesador: "odoo-sync",
    p_limite: body.limite ?? 20,
    p_lease_segundos: 120,
  });
  if (errReclamar) {
    console.error("[odoo-sync] reclamar_eventos:", errReclamar);
    return json({ error: "No se pudo reclamar eventos." }, 500);
  }

  // DS-10: las salidas (conduces) se publican de verdad como traslados A/B, solo si la instancia permite salida.
  const { data: inst } = await admin.from("odoo_instancias").select("permitir_salida").eq("id", instanciaId).maybeSingle();
  let odooCliente: OdooClient | null = null;
  const resultados: Array<{ id: string; estado: string }> = [];
  for (const evento of eventos ?? []) {
    try {
      let r;
      if (evento.agregado_tipo === "salida_inventario") {
        if (!inst?.permitir_salida) r = { estado: "reintento" as const, error: "La instancia no permite salidas todavía.", reintentarEnMs: 3_600_000 };
        else {
          try { odooCliente ??= new OdooClient(configDesdeEntorno()); } catch (e) { r = { estado: "error" as const, error: e instanceof Error ? e.message : "Configuración de Odoo inválida." }; }
          if (!r) r = await publicarSalida(depsReales(admin, odooCliente!, instanciaId), evento.agregado_id, evento.intentos ?? 1);
        }
      } else {
        r = await publicarMock(evento);
      }
      const { data: ok, error: errFinalizar } = await admin.rpc("odoo_v1_finalizar_evento", {
        p_evento: evento.id,
        p_lease: evento.lease_token,
        p_estado: r.estado,
        p_resultado: r.resultado ?? null,
        p_error: r.error ?? null,
        p_reintentar_en: r.estado === "reintento" ? new Date(Date.now() + (r.reintentarEnMs ?? 60_000)).toISOString() : null,
      });
      if (errFinalizar) console.error(`[odoo-sync] finalizar_evento ${evento.id}:`, errFinalizar);
      resultados.push({ id: evento.id, estado: ok ? r.estado : "lease_perdido" });
    } catch (e) {
      console.error(`[odoo-sync] error procesando ${evento.id}:`, e);
      resultados.push({ id: evento.id, estado: "error_inesperado" });
    }
  }

  return json({ procesados: resultados.length, resultados, modo: inst?.permitir_salida ? "salidas_real" : "mock" });
});
