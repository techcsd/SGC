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
import { verificarMaestro } from "../_shared/odoo-maestros.ts";
import { clienteMaestros, depsMaestros } from "./maestros.ts";
import { configDesdeEntorno, OdooClient } from "../_shared/odoo-client.ts";
import { publicarSalida } from "../_shared/odoo-salidas.ts";
import { depsReales } from "./salidas.ts";
import { depsAjusteFaltante, depsConteo, depsEntrada, depsExterno, depsRetiro } from "./documentos.ts";
import { publicarEntrada } from "../_shared/odoo-recepciones.ts";
import { publicarConteo } from "../_shared/odoo-ajustes.ts";
import { publicarRetiro } from "../_shared/odoo-retiros.ts";
import { publicarConduceExterno } from "../_shared/odoo-externos.ts";
import { publicarAjusteFaltante } from "../_shared/odoo-faltantes.ts";
import { aplicarAperturaBodega } from "../_shared/odoo-corte.ts";
import { TrasladoError } from "../_shared/odoo-traslados.ts";
import { autorizadoWorker } from "../_shared/odoo-sync-auth.ts";

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = envRequerido("SUPABASE_SERVICE_ROLE_KEY");
const TIPOS_CIRCUITO2 = new Set(["entrada_inventario", "conteo_inventario", "retiro_material", "conduce_externo", "ajuste_faltante"]);
const SYNC_SECRET = Deno.env.get("ODOO_SYNC_SECRET"); // igual patrón que infra/weather/cronograma sync secrets

Deno.serve(async (req: Request) => {
  const corsHeaders = construirCors(req, { headersExtra: "x-sync-secret" });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  // W3: falla cerrado (verify_jwt=false para que el cron entre con x-sync-secret; sin secreto ni service_role no entra nadie).
  if (!autorizadoWorker({
    secretHeader: req.headers.get("x-sync-secret"), authHeader: req.headers.get("Authorization"),
    syncSecret: SYNC_SECRET, infraSecret: Deno.env.get("INFRA_SYNC_SECRET"), serviceKey: SUPABASE_SERVICE_ROLE_KEY,
  })) {
    return json({ error: "No autorizado." }, 401);
  }

  let body: { instancia_id?: string; limite?: number; accion?: string; bodega_id?: string; modo?: string; tope?: number } = {};
  try { body = await req.json(); } catch { /* body vacío también es válido */ }
  const instanciaId = body.instancia_id;
  if (!instanciaId) return json({ error: "Falta instancia_id." }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  // DS-29: apertura de UNA bodega en Odoo. Solo por servidor-a-servidor CON secreto (nunca abierta), con la fase corte encendida y ambos sentidos permitidos.
  // modo "plan" (por defecto) solo calcula; "aplicar" escribe en Odoo con la accion de negocio de inventario.
  if (body.accion === "apertura") {
    if (!SYNC_SECRET) return json({ error: "La apertura exige ODOO_SYNC_SECRET configurado." }, 403);
    if (!body.bodega_id) return json({ error: "Falta bodega_id." }, 400);
    const modo = body.modo === "aplicar" ? "aplicar" : "plan";
    const { data: ins } = await admin.from("odoo_instancias").select("permitir_salida, permitir_entrada").eq("id", instanciaId).maybeSingle();
    if (modo === "aplicar" && !(ins?.permitir_entrada && ins?.permitir_salida)) return json({ error: "La instancia no permite movimientos de inventario todavía." }, 409);
    try {
      const { data: datos, error: eDatos } = await admin.rpc("odoo_corte_apertura_preparar", { p_bodega: body.bodega_id });
      if (eDatos || !datos) return json({ error: "No se pudo preparar la apertura." }, 500);
      const cliente = new OdooClient(configDesdeEntorno());
      const r = await aplicarAperturaBodega(cliente, body.bodega_id, datos, modo, typeof body.tope === "number" && body.tope > 0 ? body.tope : 0.5);
      if (modo === "aplicar") await admin.rpc("odoo_corte_apertura_marcar", { p_bodega: body.bodega_id, p_ok: true, p_resultado: { ajustes: r.ajustes.length, aplicadas: r.aplicadas, solo_odoo: r.solo_odoo, fecha_corte: r.fecha_corte }, p_error: null });
      return json({ ok: true, ...r });
    } catch (e) {
      const msg = e instanceof TrasladoError ? e.message : "No se pudo aplicar la apertura en Odoo.";
      if (modo === "aplicar") await admin.rpc("odoo_corte_apertura_marcar", { p_bodega: body.bodega_id, p_ok: false, p_resultado: null, p_error: msg });
      return json({ ok: false, error: msg }, e instanceof TrasladoError ? 422 : 502);
    }
  }

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
  const { data: inst } = await admin.from("odoo_instancias").select("permitir_salida, permitir_entrada").eq("id", instanciaId).maybeSingle();
  let odooCliente: OdooClient | null = null;
  let maestrosCliente: OdooClient | null = null;
  const resultados: Array<{ id: string; estado: string }> = [];
  for (const evento of eventos ?? []) {
    try {
      let r;
      if (evento.agregado_tipo === "salida_inventario") {
        // DS-27: con el canary encendido solo el piloto (par de almacenes, artículos y usuarios) se publica; el resto espera.
        const { data: permiteCanary } = await admin.rpc("odoo_canary_permite", { p_salida: evento.agregado_id });
        if (!inst?.permitir_salida) r = { estado: "reintento" as const, error: "La instancia no permite salidas todavía.", reintentarEnMs: 3_600_000 };
        else if (permiteCanary === false) r = { estado: "reintento" as const, error: "Fuera del piloto del canary.", reintentarEnMs: 3_600_000 };
        else {
          try { odooCliente ??= new OdooClient(configDesdeEntorno()); } catch (e) { r = { estado: "error" as const, error: e instanceof Error ? e.message : "Configuración de Odoo inválida." }; }
          if (!r) r = await publicarSalida(depsReales(admin, odooCliente!, instanciaId), evento.agregado_id, evento.intentos ?? 1);
        }
      } else if (TIPOS_CIRCUITO2.has(evento.agregado_tipo)) {
        // DS-16..DS-22: entradas (recepcion de OC / devolucion / libre), retiros, conduces externos y conteos. Solo con la instancia habilitada
        // para el sentido que el documento mueve (entrada = suma, salida = resta; ajustes y retiros pueden hacer ambas -> exigen las dos).
        const permite = evento.agregado_tipo === "entrada_inventario" ? !!inst?.permitir_entrada
          : evento.agregado_tipo === "conduce_externo" ? !!(inst?.permitir_entrada || inst?.permitir_salida)
          : !!(inst?.permitir_entrada && inst?.permitir_salida);
        if (!permite) r = { estado: "reintento" as const, error: "La instancia no permite este tipo de movimiento todavía.", reintentarEnMs: 3_600_000 };
        else {
          try { odooCliente ??= new OdooClient(configDesdeEntorno()); } catch (e) { r = { estado: "error" as const, error: e instanceof Error ? e.message : "Configuración de Odoo inválida." }; }
          if (!r) {
            const intentos = evento.intentos ?? 1;
            switch (evento.agregado_tipo) {
              case "entrada_inventario": r = await publicarEntrada(depsEntrada(admin, odooCliente!, instanciaId), evento.agregado_id, intentos); break;
              case "ajuste_faltante": r = await publicarAjusteFaltante(depsAjusteFaltante(admin, odooCliente!, instanciaId), evento.agregado_id, intentos); break;
              case "conteo_inventario": r = await publicarConteo(depsConteo(admin, odooCliente!, instanciaId), evento.agregado_id, intentos); break;
              case "retiro_material": r = await publicarRetiro(depsRetiro(admin, odooCliente!, instanciaId), evento.agregado_id, intentos); break;
              default: r = await publicarConduceExterno(depsExterno(admin, instanciaId), evento.agregado_id, intentos);
            }
          }
        }
      } else {
        // Maestros (articulo, categoria, unidad, proveedor): sin simulador. Se verifica el vinculo contra el Odoo real (Odoo es la autoridad).
        try {
          maestrosCliente ??= clienteMaestros();
          r = await verificarMaestro(depsMaestros(admin, maestrosCliente), evento);
        } catch (e) { r = { estado: "error" as const, error: e instanceof Error ? e.message : "No se pudo verificar el maestro en Odoo." }; }
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

  return json({ procesados: resultados.length, resultados, modo: inst?.permitir_salida ? "real" : "sin_permiso" });
});
