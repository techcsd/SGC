// odoo-conciliar/index.ts -- DS-13: conciliador SGC <-> Odoo (SOLO LECTURA sobre Odoo, salvo la tarea de reglas de reabastecimiento de la diaria).
// Tareas (POST {tarea, instancia_id}):
//   diaria  -> cada salida publicada contra sus pickings A/B, pickings huerfanos, transito vencido, saldos de bodegas piloto.
//   sondeo  -> Odoo->SGC cada 5 min: pickings SGC con write_date >= marca de agua (editados a mano) + pickings fuera de canal en bodegas piloto
//              + foto de «Pendientes en Odoo» (recepciones/entregas/internos por procesar y atrasados, cruzados con OC y conduces de SGC).
//   diaria  -> ademas sincroniza los minimos de SGC como reglas de reabastecimiento de Odoo (disparador manual, almacen central).
// Invocada por pg_cron (x-sync-secret = INFRA_SYNC_SECRET) o a mano por Tecnologia (JWT de usuario con es_tecnologia).
// Los hallazgos se guardan en sgc.odoo_discrepancias (visibles en Tecnologia > Conciliacion con Odoo, AT11).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { configDesdeEntorno, OdooClient } from "../_shared/odoo-client.ts";
import {
  avanzarMarca, claveDiscrepancia, conciliarSaldos, conciliarSalidas, contarPorTipo, fueraDeCanal, HORAS_TRANSITO_MAX,
  leerPickingsFueraDeCanal, leerQuants, leerTrasladosSgc, type Discrepancia, type PickingOdoo, type SalidaConciliable,
} from "../_shared/odoo-conciliacion.ts";
import { leerPendientes } from "../_shared/odoo-pendientes.ts";
import { aplicarReglas, planificarReglas } from "../_shared/odoo-reabastecimiento.ts";

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SERVICE_KEY = envRequerido("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// deno-lint-ignore no-explicit-any
type Any = any;

const aFilaDb = (d: Discrepancia) => ({ clave: claveDiscrepancia(d), tipo: d.tipo, salida_id: d.salidaId ?? null, picking_id: d.pickingId ?? null, detalle: d.detalle });

/** DS-29: stock_por_bodega como proyección de Odoo, solo para bodegas con fuente_odoo. Devuelve cuántas bodegas proyectó. */
async function proyectarStock(admin: Any, odoo: OdooClient, instancia: string): Promise<number> {
  const { data: cortes } = await admin.from("odoo_corte_bodega").select("bodega_id").eq("fuente_odoo", true);
  let n = 0;
  for (const c of (cortes ?? []) as Any[]) {
    const { data: b } = await admin.from("bodegas").select("odoo_location_id").eq("id", c.bodega_id).eq("odoo_instancia_id", instancia).maybeSingle();
    if (!b?.odoo_location_id) continue;
    const quants = await leerQuants(odoo, [Number(b.odoo_location_id)]);
    await admin.rpc("odoo_stock_proyectar", { p_bodega: c.bodega_id, p_filas: quants.map((q) => ({ odoo_product_id: q.productId, cantidad: q.cantidad })) });
    n++;
  }
  return n;
}

/** Minimos de SGC -> reglas de reabastecimiento del almacen central de Odoo. Solo si la instancia permite entradas y salidas. */
async function sincronizarReglas(admin: Any, odoo: OdooClient, instancia: string): Promise<Record<string, unknown>> {
  const { data: inst } = await admin.from("odoo_instancias").select("permitir_entrada, permitir_salida").eq("id", instancia).maybeSingle();
  if (!inst?.permitir_entrada || !inst?.permitir_salida) return { omitido: "instancia_sin_escritura" };
  const { data: par } = await admin.from("parametros").select("valor").eq("clave", "odoo_reabastecimiento_almacen").maybeSingle();
  const codigo = String(par?.valor ?? "WH");
  const { data: b } = await admin.from("bodegas").select("odoo_warehouse_id, odoo_location_id").eq("odoo_instancia_id", instancia).eq("codigo_odoo", codigo).maybeSingle();
  if (!b?.odoo_warehouse_id || !b?.odoo_location_id) return { omitido: "almacen_sin_vincular" };
  const { data: cargado, error } = await admin.rpc("odoo_reabastecimiento_cargar", { p_instancia: instancia });
  if (error) throw new Error(error.message);
  const articulos = ((cargado?.articulos ?? []) as Any[]).map((a) => ({ articuloId: a.articulo_id, productId: Number(a.odoo_product_id), minimo: Number(a.minimo), maximo: Number(a.maximo) }));
  const reglas = ((cargado?.reglas ?? []) as Any[]).map((r) => ({ articuloId: r.articulo_id, orderpointId: Number(r.orderpoint_id), productId: Number(r.odoo_product_id), minimo: Number(r.minimo), maximo: Number(r.maximo), activa: !!r.activa }));
  const plan = planificarReglas(articulos, reglas);
  const hechas = await aplicarReglas(odoo, { warehouseId: Number(b.odoo_warehouse_id), locationId: Number(b.odoo_location_id) }, plan);
  for (const h of hechas) await admin.rpc("odoo_reabastecimiento_registrar", { p_instancia: instancia, p_articulo: h.articuloId, p_orderpoint: h.orderpointId, p_minimo: h.minimo, p_maximo: h.maximo, p_activa: h.activa });
  return { reglas_vigentes: articulos.length, cambios: hechas.length };
}

Deno.serve(async (req: Request) => {
  const cors = construirCors(req, { headersExtra: "x-sync-secret" });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  // Autorizacion: cron (secreto, falla cerrado si no esta configurado) o usuario de Tecnologia.
  const secreto = Deno.env.get("INFRA_SYNC_SECRET");
  const hdr = req.headers.get("x-sync-secret");
  let autorizado = !!secreto && hdr === secreto;
  if (!autorizado) {
    const auth = req.headers.get("Authorization");
    if (auth && ANON_KEY) {
      const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, db: { schema: "sgc" } });
      const { data } = await u.rpc("es_tecnologia");
      autorizado = data === true;
    }
  }
  if (!autorizado) return json({ error: "No autorizado." }, 401);

  let body: { tarea?: string; instancia_id?: string } = {};
  try { body = await req.json(); } catch { /* vacio */ }
  const tarea = body.tarea === "sondeo" ? "sondeo" : body.tarea === "diaria" ? "diaria" : null;
  if (!tarea) return json({ error: "Falta tarea (diaria|sondeo)." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "sgc" } });
  // Sin instancia_id (llamada manual de Tecnologia) se usa la unica instancia habilitada.
  let instancia = body.instancia_id;
  if (!instancia) {
    const { data: hab } = await admin.from("odoo_instancias").select("id").eq("habilitada", true).limit(2);
    if (hab?.length !== 1) return json({ error: "No hay una única instancia de Odoo habilitada." }, 409);
    instancia = hab[0].id as string;
  }
  const registrar = (tipo: string, ds: Discrepancia[], alcance: string[], resumen: Record<string, unknown>, marca: string | null = null, error: string | null = null) =>
    admin.rpc("odoo_conciliar_registrar", {
      p_instancia: instancia, p_tipo: tipo, p_discrepancias: ds.map(aFilaDb), p_alcance: alcance, p_resumen: resumen, p_marca: marca, p_error: error,
    });

  try {
    const { data: params } = await admin.from("parametros").select("clave, valor").in("clave", ["odoo_bodegas_piloto", "odoo_transito_horas_max"]);
    const p = new Map((params ?? []).map((r: Any) => [r.clave, String(r.valor ?? "")]));
    const codigos = (p.get("odoo_bodegas_piloto") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const horasMax = Number(p.get("odoo_transito_horas_max")) > 0 ? Number(p.get("odoo_transito_horas_max")) : HORAS_TRANSITO_MAX;

    const odoo = new OdooClient(configDesdeEntorno());
    // Cuenta tecnica de la integracion (para detectar ediciones de otros usuarios). ODOO_USER es el login.
    const login = Deno.env.get("ODOO_USER");
    let tecnicoUid = -1;
    if (login) {
      const u = await odoo.call("res.users", "search_read", [[["login", "=", login]]], { fields: ["id"], limit: 1 });
      tecnicoUid = u?.[0]?.id ?? -1;
    }
    const { data: bod } = codigos.length
      ? await admin.from("bodegas").select("odoo_warehouse_id, odoo_location_id").eq("odoo_instancia_id", instancia).in("codigo_odoo", codigos)
      : { data: [] as Any[] };
    const warehouseIds = (bod ?? []).map((b: Any) => b.odoo_warehouse_id).filter((x: unknown) => typeof x === "number") as number[];

    if (tarea === "sondeo") {
      const { data: marca } = await admin.rpc("odoo_conciliar_marca", { p_instancia: instancia });
      const aOdoo = (iso: string) => iso.replace("T", " ").replace(/(\.\d+)?(\+00:00|Z)?$/, "").slice(0, 19); // dominio de Odoo: UTC sin zona
      const desde = marca ? aOdoo(marca as string) : aOdoo(new Date(Date.now() - 3_600_000).toISOString());
      const sgc = await leerTrasladosSgc(odoo, { desde });
      const ajenos = await leerPickingsFueraDeCanal(odoo, warehouseIds, desde);
      const ds = fueraDeCanal(tecnicoUid < 0 ? ajenos : [...sgc, ...ajenos], tecnicoUid); // sin cuenta tecnica identificada no se acusa a nadie
      // El sondeo solo agrega hallazgos (no resuelve los de la diaria): alcance vacio.
      const nuevaMarca = avanzarMarca([...sgc, ...ajenos], desde) ?? desde;
      // DS-29: proyección del stock desde Odoo para las bodegas con fuente_odoo (no hace nada si ninguna).
      const proyectadas = await proyectarStock(admin, odoo, instancia);
      // «Pendientes en Odoo»: foto de lo que el tablero de Inventario cuenta como por procesar / atrasado (best-effort: no tumba el sondeo).
      let pendientes: Record<string, unknown> = {};
      try {
        const filas = await leerPendientes(odoo);
        const { data: pr } = await admin.rpc("odoo_pendientes_sincronizar", { p_instancia: instancia, p_filas: filas });
        pendientes = (pr ?? {}) as Record<string, unknown>;
      } catch (e) { console.error("[odoo-conciliar] pendientes", e instanceof Error ? e.message : e); }
      const { data: r } = await registrar("sondeo", ds, [], { pickings_sgc: sgc.length, fuera_de_canal: ds.length, bodegas_piloto: codigos.length, bodegas_proyectadas: proyectadas, pendientes_odoo: pendientes.pendientes ?? null, pendientes_conocidos: pendientes.conocidos ?? null }, nuevaMarca);
      return json({ tarea, ...r });
    }

    // diaria
    const { data: salidasRaw, error: eSal } = await admin.rpc("odoo_conciliar_cargar", { p_instancia: instancia });
    if (eSal) throw new Error(eSal.message);
    const salidas: SalidaConciliable[] = (salidasRaw as Any[] ?? []).map((s) => ({
      id: s.id, estado: s.estado, esPrueba: !!s.es_prueba, despachadaEn: s.despachada_en ?? null,
      lineas: (s.lineas ?? []).map((l: Any) => ({ odooProductId: Number(l.odoo_product_id), cantidad: Number(l.cantidad), cantidadRecibida: l.cantidad_recibida == null ? null : Number(l.cantidad_recibida) })),
    }));
    const pickings: PickingOdoo[] = await leerTrasladosSgc(odoo);
    const ds: Discrepancia[] = [...conciliarSalidas(salidas, pickings, new Date(), horasMax), ...(tecnicoUid < 0 ? [] : fueraDeCanal(pickings.filter((x) => x.origin.startsWith("SGC-TRAS-")), tecnicoUid))];

    // Saldo SGC vs quant en bodegas piloto (si hay).
    let saldosComparados = 0;
    if (codigos.length) {
      const { data: saldos } = await admin.rpc("odoo_conciliar_saldos", { p_instancia: instancia, p_codigos: codigos });
      const sgcSaldos = (saldos as Any[] ?? []).map((s) => ({ bodegaId: s.bodega_id, bodega: s.bodega, locationId: Number(s.odoo_location_id), articuloId: s.articulo_id, productId: Number(s.odoo_product_id), cantidad: Number(s.cantidad) }));
      const quants = await leerQuants(odoo, [...new Set(sgcSaldos.map((s) => s.locationId))]);
      saldosComparados = sgcSaldos.length;
      ds.push(...conciliarSaldos(sgcSaldos, quants));
    }
    // Reglas de reabastecimiento (best-effort: no tumba la conciliacion).
    let reglas: Record<string, unknown> = {};
    try { reglas = await sincronizarReglas(admin, odoo, instancia); } catch (e) { reglas = { error: e instanceof Error ? e.message.slice(0, 200) : "error" }; console.error("[odoo-conciliar] reglas", reglas); }
    const alcance = ["sin_picking_a", "picking_a_no_validado", "cantidad_distinta", "sin_picking_b", "picking_b_no_validado", "picking_huerfano", "transito_vencido", "saldo_distinto"];
    const { data: r, error: eReg } = await registrar("diaria", ds, alcance, { salidas: salidas.length, pickings: pickings.length, saldos_comparados: saldosComparados, por_tipo: contarPorTipo(ds), reabastecimiento: reglas });
    if (eReg) throw new Error(eReg.message);
    await admin.rpc("odoo_slo_evaluar"); // DS-28: alerta si la expansión está encendida y el SLO de publicación no se cumple
    return json({ tarea, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido.";
    console.error("[odoo-conciliar]", msg);
    try { await registrar(tarea, [], [], {}, null, msg.slice(0, 500)); } catch { /* ya se registro en consola */ }
    return json({ error: "No se pudo conciliar con Odoo.", tarea }, 500);
  }
});
