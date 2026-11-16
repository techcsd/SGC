// deno-lint-ignore-file no-explicit-any
// W3 -- E2E de punta a punta: documentos REALES de SGC dev -> outbox -> worker odoo-sync (edge de dev) -> Odoo STAGING -> conciliador.
// Nunca toca prod ni el Odoo real: exige --env dev, que la cuenta de integracion identifique un staging y que el host no este en ODOO_HOSTS_PROD.
// Requiere haber corrido antes (dev): ds-homologacion, odoo-cuarentena-staging + ds-cuarentena, ds-encender (politicas, fases, instancia).
// Todo lo creado lleva la marca E2E-<run> y se REVIERTE al final (compensacion por «pasar a prueba» = la via de DS-19; residuos declarados).
//   deno run --no-check --allow-env --allow-net --allow-read --allow-sys scripts/odoo-e2e-dev-staging.ts --env dev [--sin-limpiar] [--solo=conduces,entradas,retiros,conteos,externos]
// Sin hosts, usuarios, claves ni ids en este archivo: todo se resuelve en vivo por nombre/codigo.
// @ts-ignore modulos .mjs sin tipos
import { resolverEnv } from "./lib/entorno.mjs";
// @ts-ignore
import { consulta } from "./lib/dbq-dev.mjs";
import { OdooClient, POLITICA_POR_DEFECTO } from "../supabase/functions/_shared/odoo-client.ts";
import { crearAdaptadoresOcReales } from "../supabase/functions/_shared/odoo-oc.ts";
import { devolverTraslado } from "../supabase/functions/_shared/odoo-traslados.ts";
import { ajustarArticulo } from "../supabase/functions/_shared/odoo-ajustes.ts";

const argv = Deno.args;
const env = await resolverEnv(argv);
if (env.entorno !== "dev") { console.error("Solo dev contra staging."); Deno.exit(1); }
const limpiar = !argv.includes("--sin-limpiar");
const solo = (argv.find((a) => a.startsWith("--solo=")) ?? "").slice(7).split(",").filter(Boolean);
const quiere = (g: string) => solo.length === 0 || solo.includes(g);

// ── guardia de host (mismo criterio que scripts/odoo-cuarentena-staging.mjs) ──
const E = (k: string) => Deno.env.get(`SGC_INTEGRATION_ODOO_${k}`) ?? "";
const prodHosts = (Deno.env.get("ODOO_HOSTS_PROD") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!/stag/i.test(`${E("URL")} ${E("DB")}`) || prodHosts.includes(new URL(E("URL")).host.toLowerCase())) { console.error("Guardia: la cuenta de integracion no apunta a un staging reconocible."); Deno.exit(1); }
Deno.env.set("ODOO_HOSTS_ESCRITURA", new URL(E("URL")).host);
const politica = {
  lectura: { ...POLITICA_POR_DEFECTO.lectura, "stock.location": ["search_read", "read"], "purchase.order.line": ["search_read"], "account.analytic.account": ["search_read"] },
  escritura: { ...POLITICA_POR_DEFECTO.escritura },
};
const c = new OdooClient({ url: E("URL"), db: E("DB"), user: E("USER"), apiKey: E("API_KEY"), companyId: 1, politica });

// ── utilidades ──
const run = Date.now().toString(36);
const TAG = `E2E-${run}`;
const resultados: Array<{ ok: boolean; n: string; extra: string }> = [];
const ok = (n: string, b: boolean, extra = "") => { resultados.push({ ok: b, n, extra }); console.log(b ? "  OK " : "  FALLA", n, extra); return b; };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lit = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`;
const sqlq = (q: string): Promise<any[]> => consulta(env, q);

const [admin] = await sqlq(`select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre ilike 'QA admin' limit 1`);
const claims = JSON.stringify({ sub: admin.id, role: "authenticated" });
/** Ejecuta SQL como el usuario QA admin (auth.uid()); la ULTIMA sentencia debe ser un select que devuelva el resultado. Todo en una transaccion. */
const sqlA = (q: string) => sqlq(`select set_config('request.jwt.claims', ${lit(claims)}, true);\n${q}`);
const val = async (q: string) => { const r = await sqlA(q); const o = r[0] ?? {}; return o[Object.keys(o)[0]]; };

const [inst] = await sqlq(`select id from sgc.odoo_instancias where habilitada and permitir_salida and permitir_entrada and entorno='dev' limit 1`);
if (!inst) { console.error("La instancia de staging no esta encendida (correr data-fixes/2026-11-16-ds-encender-dev.mjs)."); Deno.exit(1); }
const pol = await sqlq(`select agregado_tipo from sgc.odoo_publicacion_politica where habilitada`);
const fases = await sqlq(`select clave, habilitada, config from sgc.odoo_fases where clave in ('canary','expansion')`);
const canary = fases.find((f: any) => f.clave === "canary");
if (!canary?.habilitada || !fases.find((f: any) => f.clave === "expansion")?.habilitada) { console.error("Faltan canary/expansion encendidas."); Deno.exit(1); }
console.log(`Politicas habilitadas: ${pol.map((p: any) => p.agregado_tipo).join(", ")}; fases canary+expansion ON. Marca de la corrida: ${TAG}`);

const piloto: string[] = canary.config.articulos_piloto;
const arts = await sqlq(`select id, nombre, odoo_product_id as p from sgc.articulos where id = any(${lit(`{${piloto.join(",")}}`)}::uuid[]) order by nombre`);
const [WH] = await sqlq(`select id, odoo_location_id as loc, odoo_warehouse_id as wh from sgc.bodegas where codigo_odoo='WH'`);
const [TA] = await sqlq(`select id, odoo_location_id as loc, odoo_warehouse_id as wh, odoo_cuarentena_location_id as cuar, proyecto_id from sgc.bodegas where codigo_odoo='TA'`);
if (!TA.cuar) { console.error("Torre Alpha sin ubicacion de cuarentena enlazada."); Deno.exit(1); }
const [P1, P2, P3] = arts;
const WHL = Number(WH.loc), TAL = Number(TA.loc), CUAR = Number(TA.cuar);
const [transitoLoc] = await c.call("stock.location", "search_read", [[["usage", "=", "transit"], ["company_id", "in", [1, false]]]], { fields: ["id", "complete_name"], limit: 1 });
const TRANSITO = transitoLoc.id as number;

const saldo = async (loc: number, prod: number): Promise<number> =>
  (await c.call("stock.quant", "search_read", [[["location_id", "=", loc], ["product_id", "=", prod]]], { fields: ["quantity"] })).reduce((s: number, q: any) => s + q.quantity, 0);
const snapshot = async () => {
  const o: Record<string, number> = {};
  for (const a of [P1, P2, P3]) for (const [k, l] of [["WH", WHL], ["TA", TAL], ["TR", TRANSITO], ["CU", CUAR]] as const) o[`${a.p}@${k}`] = await saldo(l, Number(a.p));
  return o;
};
const stockSgc = async () => (await sqlq(`select s.articulo_id, b.codigo_odoo cod, s.cantidad::float c from sgc.stock_por_bodega s join sgc.bodegas b on b.id=s.bodega_id where b.codigo_odoo in ('WH','TA') and s.articulo_id = any(${lit(`{${piloto.join(",")}}`)}::uuid[])`));
const s0 = await snapshot();
const sgc0 = await stockSgc();

const docs = { salidas: [] as string[], entradas: [] as string[], retiros: [] as string[], conteos: [] as string[], externos: [] as string[], solicitudes: [] as string[] };
const todosIds = () => [...docs.salidas, ...docs.entradas, ...docs.retiros, ...docs.conteos, ...docs.externos, ...docs.solicitudes];

/** Invoca el worker (edge de dev) hasta que no quede nada reclamable de MIS documentos. El cron tambien lo invoca; el lease evita duplicados. */
async function drenar(etiqueta: string, maxIt = 30) {
  const ids = todosIds();
  for (let i = 0; i < maxIt; i++) {
    const r = await fetch(`${env.url}/functions/v1/odoo-sync`, { method: "POST", headers: { "Content-Type": "application/json", "x-sync-secret": Deno.env.get("INFRA_SYNC_SECRET_DEV") ?? "" }, body: JSON.stringify({ instancia_id: inst.id, limite: 20 }) });
    if (r.status !== 200) { console.log(`  worker HTTP ${r.status}`); await dormir(2000); continue; }
    const j = await r.json();
    const quedan = ids.length ? await sqlq(`select count(*)::int n from sgc.odoo_eventos where agregado_id = any(${lit(`{${ids.join(",")}}`)}::text[]) and not es_prueba and estado in ('pendiente','procesando') and (proximo_intento_en is null or proximo_intento_en <= now())`) : [{ n: 0 }];
    if (j.procesados === 0 && quedan[0].n === 0) break;
    await dormir(1500);
  }
  console.log(`  (worker drenado: ${etiqueta})`);
}
const eventosDe = (id: string) => sqlq(`select agregado_tipo t, estado, error, intentos, es_prueba from sgc.odoo_eventos where agregado_id = ${lit(id)} order by creado_en`);
const syncSalida = async (id: string) => (await sqlq(`select odoo_sync_estado e, odoo_sync_error er, odoo_picking_salida_id a, odoo_picking_entrada_id b, estado from sgc.salidas_inventario where id=${lit(id)}`))[0];
const pk = async (origin: string) => (await c.call("stock.picking", "search_read", [[["origin", "like", origin]]], { fields: ["id", "name", "state", "origin", "location_id", "location_dest_id"], context: { active_test: false } })) as any[];
const mueve = async (pickingId: number) => (await c.call("stock.move", "search_read", [[["picking_id", "=", pickingId]]], { fields: ["product_id", "product_uom_qty", "quantity", "state"] })) as any[];

// ── helpers de documentos ──
async function nuevoConduce(items: Array<[any, number]>, obs: string): Promise<string> {
  const id = crypto.randomUUID();
  const its = JSON.stringify(items.map(([a, q]) => ({ articulo_id: a.id, cantidad: q })));
  await sqlA(`select sgc.crear_conduce_simple(${lit(id)}, current_date, ${lit(WH.id)}, null, ${lit(`${TAG} ${obs}`)}, null, null, ${lit(its)}::jsonb, 'QA E2E', null, null, null, null, null, ${lit(TA.id)}::uuid)::text r`);
  docs.salidas.push(id);
  return id;
}
async function entregar(id: string, recibidos?: number[]) {
  const det = await sqlq(`select id, cantidad::float c from sgc.detalle_salidas where salida_id=${lit(id)} order by id`);
  const its = det.map((d: any, i: number) => ({ detalle_id: d.id, cantidad_recibida: recibidos ? recibidos[i] : d.c }));
  return await val(`select sgc.entregar_conduce(${lit(id)}, ${lit(JSON.stringify(its))}::jsonb, 'Receptor E2E', 'e2e/firma.png', 'e2e/foto.jpg', ${lit(TAG)})`);
}
const flipPrueba = (tabla: string, id: string) => sqlq(`update sgc.${tabla} set es_prueba=true where id=${lit(id)}`);

const conciliar = async (tarea: string) => {
  const r = await fetch(`${env.url}/functions/v1/odoo-conciliar`, { method: "POST", headers: { "Content-Type": "application/json", "x-sync-secret": Deno.env.get("INFRA_SYNC_SECRET_DEV") ?? "" }, body: JSON.stringify({ tarea, instancia_id: inst.id }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const pickingsOc: number[] = []; let ocOdooId = 0;
try {
/* ====================================================================== */
if (quiere("conduces")) {
  console.log("\n[1] Conduces (traslado A/B por transito)");
  // 1a despachado -> A
  const q1 = 5;
  const sA = await nuevoConduce([[P1, q1]], "despachado");
  await drenar("conduce despachado");
  let st = await syncSalida(sA);
  ok("1a despachado: sincronizado con picking A validado", st.e === "sincronizado" && !!st.a && !st.b, JSON.stringify({ e: st.e, a: !!st.a, b: !!st.b, er: st.er }));
  const pA = await pk(`SGC-TRAS-${sA}-A`);
  ok("1a picking A en Odoo hecho: WH -> transito, cantidad exacta", pA.length === 1 && pA[0].state === "done" && pA[0].location_id[0] === WHL && pA[0].location_dest_id[0] === TRANSITO && (await mueve(pA[0].id))[0]?.quantity === q1);
  ok("1a saldo WH bajo y transito subio exactamente", (await saldo(WHL, Number(P1.p))) - s0[`${P1.p}@WH`] === -q1 && (await saldo(TRANSITO, Number(P1.p))) - s0[`${P1.p}@TR`] === q1);
  // 1b entregado completo -> B
  console.log("  entregando completo...");
  const est = await entregar(sA);
  await drenar("conduce entregado");
  st = await syncSalida(sA);
  const pB = await pk(`SGC-TRAS-${sA}-B`);
  ok("1b entregado: B validado transito -> TA con lo recibido", est === "entregado" && st.e === "sincronizado" && !!st.b && pB.length === 1 && pB[0].state === "done" && pB[0].location_dest_id[0] === TAL, JSON.stringify({ est, e: st.e, er: st.er }));
  ok("1b saldos finales: WH -5, TA +5, transito igual al inicial", (await saldo(WHL, Number(P1.p))) - s0[`${P1.p}@WH`] === -q1 && (await saldo(TAL, Number(P1.p))) - s0[`${P1.p}@TA`] === q1 && (await saldo(TRANSITO, Number(P1.p))) === s0[`${P1.p}@TR`]);
  // idempotencia: re-encolar y reprocesar no duplica
  await sqlq(`select sgc.odoo_v1_encolar_salida(${lit(sA)}, 'e2e_idempotencia')`);
  await drenar("reproceso");
  ok("1b reproceso del mismo conduce no duplica pickings ni saldo", (await pk(`SGC-TRAS-${sA}-`)).length === 2 && (await saldo(TAL, Number(P1.p))) - s0[`${P1.p}@TA`] === q1);

  // 1c entregado incompleto + faltante APROBADO
  const sC = await nuevoConduce([[P2, 6]], "incompleto-aprobado");
  await drenar("incompleto A");
  const estC = await entregar(sC, [4]);
  await drenar("incompleto B");
  st = await syncSalida(sC);
  {
    ok("1c incompleto: estado entregado_incompleto y B solo con lo recibido (4 de 6)", estC === "entregado_incompleto" && st.e === "sincronizado" && (await saldo(TAL, Number(P2.p))) - s0[`${P2.p}@TA`] === 4 && (await saldo(TRANSITO, Number(P2.p))) - s0[`${P2.p}@TR`] === 2, JSON.stringify({ e: st.e, er: st.er }));
  }
  const sol = await sqlq(`select id, estado, faltante::float f from sgc.odoo_solicitudes_ajuste where salida_id=${lit(sC)}`);
  ok("1c nace UNA solicitud de ajuste por el faltante (2)", sol.length === 1 && sol[0].estado === "pendiente" && sol[0].f === 2, JSON.stringify(sol));
  if (sol[0]) {
    docs.solicitudes.push(sol[0].id);
    await sqlA(`select sgc.odoo_ajuste_decidir(${lit(sol[0].id)}, true, ${lit("E2E aprobado")})::text r`);
    await drenar("faltante aprobado");
    const r = (await sqlq(`select estado, odoo_sync_estado e, odoo_sync_error er from sgc.odoo_solicitudes_ajuste where id=${lit(sol[0].id)}`))[0];
    ok("1c faltante APROBADO: baja desde transito aplicada (transito = inicial)", r.e === "sincronizado" && (await saldo(TRANSITO, Number(P2.p))) === s0[`${P2.p}@TR`], JSON.stringify(r));
  }

  // 1d entregado incompleto + faltante RECHAZADO -> devuelve a origen
  const sD = await nuevoConduce([[P3, 4]], "incompleto-rechazado");
  await drenar("rechazo A");
  await entregar(sD, [1]);
  await drenar("rechazo B");
  const solD = await sqlq(`select id from sgc.odoo_solicitudes_ajuste where salida_id=${lit(sD)}`);
  if (solD[0]) {
    docs.solicitudes.push(solD[0].id);
    const sgcAntes = (await stockSgc()).find((x: any) => x.articulo_id === P3.id && x.cod === "WH")?.c ?? 0;
    await sqlA(`select sgc.odoo_ajuste_decidir(${lit(solD[0].id)}, false, ${lit("E2E rechazado: se devuelve al origen")})::text r`);
    await drenar("faltante rechazado");
    const r = (await sqlq(`select estado, odoo_sync_estado e, odoo_sync_error er from sgc.odoo_solicitudes_ajuste where id=${lit(solD[0].id)}`))[0];
    const sgcDespues = (await stockSgc()).find((x: any) => x.articulo_id === P3.id && x.cod === "WH")?.c ?? 0;
    ok("1d faltante RECHAZADO: devuelto a origen en Odoo (WH -1 neto, transito inicial) y en SGC (+3)", r.e === "sincronizado" && (await saldo(WHL, Number(P3.p))) - s0[`${P3.p}@WH`] === -1 && (await saldo(TRANSITO, Number(P3.p))) === s0[`${P3.p}@TR`] && sgcDespues - sgcAntes === 3, JSON.stringify({ r, sgcAntes, sgcDespues }));
  } else ok("1d nace solicitud de ajuste", false);

  // 1e anulado antes de entregar -> devuelve A
  const sE = await nuevoConduce([[P1, 2]], "anulado");
  await drenar("anulado A");
  ok("1e despachado antes de anular: A hecho", (await pk(`SGC-TRAS-${sE}-A`))[0]?.state === "done");
  await sqlA(`select sgc.anular_conduce(${lit(sE)}, ${lit("E2E anulacion de prueba contra staging")})::text r`);
  await drenar("anulado");
  const pE = await pk(`SGC-TRAS-${sE}-`);
  st = await syncSalida(sE);
  ok("1e anulado: devolucion A hecha (saldo WH/transito vuelve) y sincronizado", st.e === "sincronizado" && pE.some((p: any) => p.origin.includes("-D")) && (await saldo(TRANSITO, Number(P1.p))) === s0[`${P1.p}@TR`], JSON.stringify({ e: st.e, er: st.er, pickings: pE.map((p: any) => p.origin.slice(-6) + ":" + p.state) }));

  // 1f fuera del piloto: otro articulo no piloto no se publica (canary)
  const [fuera] = await sqlq(`select a.id, a.nombre from sgc.articulos a join sgc.stock_por_bodega s on s.articulo_id=a.id where s.bodega_id=${lit(WH.id)} and s.cantidad>=5 and a.odoo_product_id is not null and not (a.id = any(${lit(`{${piloto.join(",")}}`)}::uuid[])) limit 1`);
  if (fuera) {
    const sF = await nuevoConduce([[{ id: fuera.id }, 1]], "fuera-canary");
    await drenar("fuera canary", 3);
    st = await syncSalida(sF);
    ok("1f articulo fuera del piloto: el canary lo retiene (nada en Odoo)", !st.a && (await pk(`SGC-TRAS-${sF}-`)).length === 0, JSON.stringify({ e: st.e }));
    await sqlA(`select sgc.anular_conduce(${lit(sF)}, ${lit("E2E: limpieza del caso fuera de canary")})::text r`);
  }
}

/* ====================================================================== */
if (quiere("entradas")) {
  console.log("\n[2] Entrada con OC (recepcion parcial -> backorder -> completa) y entrada libre");
  const ad = crearAdaptadoresOcReales(() => c);
  const [prov] = await c.call("res.partner", "search_read", [[["supplier_rank", ">", 0]]], { fields: ["id"], limit: 1 });
  const [ana] = await c.call("account.analytic.account", "search_read", [[]], { fields: ["id"], limit: 1 });
  const oc = await ad.crear({ orden_id: `e2e-${run}`, numero: `${TAG}`, odoo_proveedor_id: prov.id, odoo_analytic_id: ana.id, odoo_entorno: "dev", fecha: new Date().toISOString().slice(0, 10), notas: `${TAG} (staging)`, lineas: [{ odoo_product_id: Number(P2.p), cantidad: 10, precio_unitario: 1, descripcion: P2.nombre }] });
  ok("OC de prueba creada en staging", oc.estado === "completado");
  ocOdooId = (oc.resultado as any).odoo_id;
  ok("OC confirmada (genera la recepcion)", (await ad.confirmar({ odoo_id: ocOdooId })).estado === "completado");
  const [pv] = await sqlq(`select id from sgc.proveedores limit 1`);
  const ocId = crypto.randomUUID();
  await sqlq(`insert into sgc.ordenes_compra(id, numero, proveedor_id, estado, creado_por, odoo_instancia_id, odoo_compania_id, odoo_id, es_prueba, notas) values (${lit(ocId)}, ${lit(TAG)}, ${lit(pv.id)}, 'aprobada', ${lit(admin.id)}, ${lit(inst.id)}, 1, ${ocOdooId}, false, ${lit(TAG)});
    insert into sgc.orden_compra_items(orden_id, articulo_id, descripcion, cantidad, precio_unitario, total, odoo_product_id) values (${lit(ocId)}, ${lit(P2.id)}, ${lit(P2.nombre)}, 10, 1, 10, ${Number(P2.p)})`);
  const base = await saldo(WHL, Number(P2.p));
  const nuevaEntrada = async (cant: number, oc: string | null, ref: string) => {
    const id = await val(`select sgc.registrar_entrada_inventario(current_date, ${lit(WH.id)}::uuid, ${lit(pv.id)}::uuid, ${oc ? lit(oc) : "null"}::uuid, ${lit(ref)}, ${lit(TAG)}, ${lit(admin.id)}::uuid, ${lit(JSON.stringify([{ articulo_id: P2.id, cantidad: cant, precio_unit: 1 }]))}::jsonb, null::text, null::uuid)::text`);
    docs.entradas.push(id); return id as string;
  };
  const e1 = await nuevaEntrada(6, ocId, `${TAG}-1`);
  await drenar("entrada parcial");
  let ee = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er, odoo_picking_id p from sgc.entradas_inventario where id=${lit(e1)}`))[0];
  ok("2a entrada parcial (6 de 10): sincronizada, recibe en la recepcion de la OC, stock +6", ee.e === "sincronizado" && !!ee.p && (await saldo(WHL, Number(P2.p))) - base === 6, JSON.stringify({ e: ee.e, er: ee.er }));
  if (ee.p) pickingsOc.push(Number(ee.p));
  await sqlq(`select sgc.odoo_v1_encolar_documento('entrada_inventario', ${lit(e1)}, 'e2e_reintento')`);
  await drenar("reintento entrada");
  ok("2a reintento de la misma entrada NO suma de nuevo", (await saldo(WHL, Number(P2.p))) - base === 6);
  const e2 = await nuevaEntrada(4, ocId, `${TAG}-2`);
  await drenar("entrada completa");
  ee = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er, odoo_picking_id p from sgc.entradas_inventario where id=${lit(e2)}`))[0];
  ok("2b segunda entrada (4) cierra la OC sobre el backorder: stock +10", ee.e === "sincronizado" && (await saldo(WHL, Number(P2.p))) - base === 10, JSON.stringify({ e: ee.e, er: ee.er }));
  if (ee.p) pickingsOc.push(Number(ee.p));
  // entrada libre (sin OC)
  const e3 = await nuevaEntrada(3, null, `${TAG}-libre`);
  await drenar("entrada libre");
  ee = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er, odoo_picking_id p from sgc.entradas_inventario where id=${lit(e3)}`))[0];
  ok("2c entrada libre (sin OC): recepcion proveedor -> WH, stock +3", ee.e === "sincronizado" && (await saldo(WHL, Number(P2.p))) - base === 13, JSON.stringify({ e: ee.e, er: ee.er }));
  // entrada pendiente de confirmar: no toca Odoo
  const e4 = await nuevaEntrada(2, null, `${TAG}-pend`);
  await sqlq(`update sgc.entradas_inventario set pendiente_confirmacion=true where id=${lit(e4)}`);
  await sqlq(`select sgc.odoo_v1_encolar_documento('entrada_inventario', ${lit(e4)}, 'e2e_pendiente')`);
  await drenar("entrada pendiente");
  ok("2d entrada pendiente de confirmar: no mueve Odoo", (await saldo(WHL, Number(P2.p))) - base === 13);
}

/* ====================================================================== */
if (quiere("externos")) {
  console.log("\n[3] Conduce externo");
  const placa = `e2e/${run}/placa.jpg`;
  const sX = await nuevoConduce([[P1, 1]], "para-externo");
  const exId = await val(`select sgc.crear_conduce_externo(null, 'Transporte E2E', ${lit(placa)}, null, ${lit(TAG)}, null, 'Almacen', null, null, null, ${lit(WH.id)}, 'Torre Alpha', null, null, null, ${lit(TA.id)}, null, null, ${lit(sX)}, false)::text`);
  docs.externos.push(exId);
  await drenar("externo con salida");
  const x = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er from sgc.conduces_externos where id=${lit(exId)}`))[0];
  const stX = await syncSalida(sX);
  ok("3a conduce externo ligado a una salida: re-encola ESA salida (A en Odoo) y queda sincronizado", stX.e === "sincronizado" && !!stX.a && x.e !== "error", JSON.stringify({ ext: x, salida: stX.e }));
  const exL = await val(`select sgc.crear_conduce_externo(null, 'Transporte E2E', ${lit(placa + "2")}, null, ${lit(TAG + " logistico")}, null, 'Obra A', null, null, null, null, 'Obra B', null, null, null, null, null, null, null, false)::text`);
  docs.externos.push(exL);
  await drenar("externo logistico");
  const xl = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er, odoo_picking_id p from sgc.conduces_externos where id=${lit(exL)}`))[0];
  ok("3b conduce externo logistico (sin inventario): no crea nada en Odoo", !xl.p, JSON.stringify(xl));
}

/* ====================================================================== */
let cuarLoc = 0;
if (quiere("retiros")) {
  console.log("\n[4] Retiro de material danado -> cuarentena -> disposicion");
  // el material debe estar en la obra (TA) en Odoo: el conduce 1b dejo P1 ahi
  const baseTA = await saldo(TAL, Number(P1.p)); const baseCU = await saldo(CUAR, Number(P1.p));
  const rid = await val(`select sgc.crear_retiro_material(${lit(TA.proyecto_id)}, ${lit(TA.id)}, 'danado_obra', ${lit(TAG)}, ${lit(TAG)}, ${lit(JSON.stringify([{ articulo_id: P1.id, cantidad: 2, descripcion: P1.nombre }]))}::jsonb, ${lit(JSON.stringify([{ path: "e2e/foto.jpg", nombre: "foto" }]))}::jsonb, false, ${lit(crypto.randomUUID())}::uuid)::text`);
  docs.retiros.push(rid);
  await drenar("retiro solicitado", 3);
  ok("4a retiro solicitado/pendiente: no mueve Odoo", (await saldo(TAL, Number(P1.p))) === baseTA && (await saldo(CUAR, Number(P1.p))) === baseCU);
  await sqlA(`select sgc.retiro_aprobar(${lit(rid)}, ${lit(TA.id)})::text r`);
  await sqlA(`select sgc.retiro_recibir(${lit(rid)}, 'e2e/recepcion.jpg', 'e2e/firma.png', ${lit(TAG)})::text r`);
  await drenar("retiro recibido");
  let r = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er, estado from sgc.retiros_material where id=${lit(rid)}`))[0];
  ok("4b retiro recibido: obra -> CUARENTENA (TA -2, cuarentena +2), sincronizado", r.e === "sincronizado" && (await saldo(TAL, Number(P1.p))) - baseTA === -2 && (await saldo(CUAR, Number(P1.p))) - baseCU === 2, JSON.stringify({ r }));
  cuarLoc = CUAR;
  await sqlA(`select sgc.retiro_disponer(${lit(rid)}, 'descarte', ${lit(TAG)}, null)::text r`);
  await drenar("retiro descarte");
  r = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er from sgc.retiros_material where id=${lit(rid)}`))[0];
  ok("4c disposicion DESCARTE: cuarentena vuelve a su saldo inicial (scrap), sincronizado", r.e === "sincronizado" && (await saldo(CUAR, Number(P1.p))) === baseCU, JSON.stringify(r));
}

/* ====================================================================== */
if (quiere("conteos")) {
  console.log("\n[5] Conteo fisico aplicado / ajuste / deshacer");
  const antes = await saldo(TAL, Number(P3.p));
  const objetivo = antes + 7;
  const cid = await val(`select sgc.conteo_fisico_abrir(${lit(TA.id)}, false)::text`);
  docs.conteos.push(cid);
  const sigma = (await sqlq(`select (sgc.apertura_efectiva(${lit(P3.id)}, ${lit(TA.id)}) + sgc.stock_movimientos_sigma(${lit(P3.id)}, ${lit(TA.id)}))::float s`))[0].s;
  void sigma;
  await sqlA(`select sgc.conteo_fisico_guardar(${lit(cid)}, ${lit(JSON.stringify([{ articulo_id: P3.id, cantidad_contada: objetivo }]))}::jsonb)::text r`);
  await sqlA(`select sgc.conteo_fisico_cerrar(${lit(cid)})::text r`);
  await drenar("conteo borrador/contado", 3);
  ok("5a conteo borrador/contado: no toca Odoo", (await saldo(TAL, Number(P3.p))) === antes);
  await sqlA(`select sgc.conteo_fisico_aplicar(${lit(cid)}, ${lit(TAG)})::text r`);
  await drenar("conteo aplicado");
  let k = (await sqlq(`select odoo_sync_estado e, odoo_sync_error er, estado from sgc.conteos_inventario where id=${lit(cid)}`))[0];
  ok("5b conteo aplicado: Odoo queda en la cantidad objetivo (accion de negocio de inventario), sincronizado", k.e === "sincronizado" && (await saldo(TAL, Number(P3.p))) === objetivo, JSON.stringify({ k, objetivo, odoo: await saldo(TAL, Number(P3.p)) }));
  await sqlq(`select sgc.odoo_v1_encolar_documento('conteo_inventario', ${lit(cid)}, 'e2e_repeticion')`);
  await drenar("conteo repetido");
  ok("5c reprocesar el mismo conteo es un solo efecto", (await saldo(TAL, Number(P3.p))) === objetivo);
  await sqlA(`select sgc.conteo_fisico_deshacer(${lit(cid)})::text r`);
  await drenar("conteo deshecho");
  ok("5d deshacer el conteo: compensa el delta (Odoo vuelve al saldo previo)", (await saldo(TAL, Number(P3.p))) === antes, JSON.stringify({ antes, ahora: await saldo(TAL, Number(P3.p)) }));
}

/* ====================================================================== */
console.log("\n[6] Conciliador (edge odoo-conciliar, diaria + sondeo)");
const cd = await conciliar("diaria");
const abiertas = await sqlq(`select tipo, salida_id, count(*)::int n from sgc.odoo_discrepancias where resuelta_en is null and odoo_instancia_id=${lit(inst.id)} group by 1,2 order by 1`);
const mias = abiertas.filter((a: any) => docs.salidas.includes(a.salida_id));
ok("6a conciliador diario corre (HTTP 200)", cd.status === 200, JSON.stringify(cd.body).slice(0, 200));
ok("6a ninguna discrepancia abierta sobre MIS conduces", mias.length === 0, JSON.stringify(mias));
console.log("  discrepancias abiertas en toda la instancia (informativo):", JSON.stringify(abiertas));
const cs = await conciliar("sondeo");
ok("6b sondeo corre (HTTP 200)", cs.status === 200, JSON.stringify(cs.body).slice(0, 200));
const fuera = await sqlq(`select tipo, count(*)::int n from sgc.odoo_discrepancias where resuelta_en is null and tipo in ('fuera_de_canal','saldo_distinto') group by 1`);
console.log("  fuera_de_canal / saldo_distinto abiertas:", JSON.stringify(fuera));

} catch (e) { ok("excepcion no controlada durante la corrida (se limpia igual)", false, (e as Error).message.slice(0, 300)); }

/* ====================================================================== */
if (limpiar) {
  console.log("\n[7] Limpieza: compensacion por «pasar a prueba» (DS-19) y reversa manual de lo bloqueado");
  // orden inverso: conteos (REV), retiros, externos, entradas, salidas
  for (const id of docs.conteos) await flipPrueba("conteos_inventario", id);
  for (const id of docs.retiros) await flipPrueba("retiros_material", id);
  await drenar("limpieza conteos/retiros");
  for (const id of docs.externos) await flipPrueba("conduces_externos", id);
  for (const id of docs.entradas) await flipPrueba("entradas_inventario", id);
  await drenar("limpieza entradas");
  const bloqueadas = await sqlq(`select count(*)::int n from sgc.odoo_eventos where agregado_id = any(${lit(`{${docs.entradas.join(",")}}`)}::text[]) and not es_prueba and estado='error' and error like '%ya validó una orden de compra%'`);
  if (quiere("entradas")) ok("7 entradas con OC ya validada pasadas a prueba: BLOQUEADAS con motivo (las dos), la libre se compensa", bloqueadas[0].n === 2, `bloqueadas=${bloqueadas[0].n}`);
  for (const id of docs.salidas) {
    const s = await syncSalida(id);
    if (s.estado === "anulado") continue;
    await flipPrueba("salidas_inventario", id);
  }
  await drenar("limpieza salidas", 40);
  // reversa manual en Odoo de las recepciones de la OC (la integracion no las revierte sola: Compras lo hace)
  for (const [i, p] of pickingsOc.entries()) { try { await devolverTraslado(c, p, { salidaId: `${TAG}-REC`, paso: i === 0 ? "A" : "B", companyId: 1 }); } catch (e) { console.log("  (devolucion manual de recepcion fallo:", (e as Error).message.slice(0, 80), ")"); } }
  const s1 = await snapshot();
  const difs = Object.keys(s0).filter((k) => Math.abs(s1[k] - s0[k]) > 1e-9);
  // La baja por faltante APROBADO es una perdida real aceptada: pasar el conduce a prueba devuelve solo lo que sigue en transito, no la repone.
  const esperado = (quiere("conduces") && !argv.includes("--sin-faltantes")) ? { [`${P2.p}@WH`]: -2 } : {};
  const inesperadas = difs.filter((k) => Math.abs((s1[k] - s0[k]) - (esperado[k] ?? 0)) > 1e-9);
  ok("7 saldos finales en Odoo (WH/TA/transito/cuarentena) = iniciales, salvo la baja del faltante aprobado (-2 en WH)", inesperadas.length === 0, inesperadas.length ? JSON.stringify(inesperadas.map((k) => `${k}: ${s0[k]} -> ${s1[k]}`)) : "");
  // limpieza manual DECLARADA (script, no la integracion): devolver el saldo a lo inicial con la accion de negocio de inventario
  for (const k of difs) {
    const [prod, donde] = k.split("@"); const loc = { WH: WHL, TA: TAL, TR: TRANSITO, CU: CUAR }[donde]!;
    if (s0[k] < 0) continue;
    try { await ajustarArticulo(c, { nombre: `${TAG}-LIMPIEZA`, locationId: loc, productId: Number(prod), objetivo: s0[k] }); console.log(`  limpieza manual declarada: ${donde} producto ${prod}: ${s1[k]} -> ${s0[k]}`); } catch (e) { console.log("  limpieza manual fallo:", (e as Error).message.slice(0, 80)); }
  }
  const cf = await conciliar("diaria");
  const abiertas2 = await sqlq(`select tipo, salida_id from sgc.odoo_discrepancias where resuelta_en is null and odoo_instancia_id=${lit(inst.id)}`);
  const mias2 = abiertas2.filter((a: any) => docs.salidas.includes(a.salida_id));
  ok("7 conciliador tras la limpieza: sin deriva sobre mis conduces", cf.status === 200 && mias2.length === 0, JSON.stringify(mias2));
  // stock de SGC dev: devolverlo a lo que habia (los conduces/entradas de prueba lo movieron; pasar a prueba no revierte el stock de SGC)
  const sgc1 = await stockSgc();
  let restaurados = 0;
  for (const a of sgc0) { const n = sgc1.find((x: any) => x.articulo_id === a.articulo_id && x.cod === a.cod); if (n && n.c !== a.c) { await sqlq(`update sgc.stock_por_bodega set cantidad=${a.c} where articulo_id=${lit(a.articulo_id)} and bodega_id=(select id from sgc.bodegas where codigo_odoo=${lit(a.cod)})`); restaurados++; } }
  console.log(`  stock de SGC dev restaurado en ${restaurados} fila(s) de articulos piloto`);
}

console.log("\n=== RESUMEN ===");
const fallos = resultados.filter((r) => !r.ok);
console.log(`${resultados.length - fallos.length}/${resultados.length} comprobaciones OK`);
for (const f of fallos) console.log("  FALLA:", f.n, f.extra);
console.log(`Residuos declarados en staging: OC ${TAG} (confirmada, recibida y devuelta; no se puede cancelar desde SGC), ubicaciones de cuarentena (permanentes, se quieren), movimientos de inventario neto cero.`);
Deno.exit(fallos.length ? 1 : 0);
