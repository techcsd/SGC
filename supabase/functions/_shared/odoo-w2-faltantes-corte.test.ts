// W2 (DS-17/DS-28/DS-29): ejecucion del faltante en transito (devolver / baja), apertura por bodega y adjunto del PDF en la salida.
// Contrato real contra staging: scripts/odoo-contrato-w2-staging.ts
import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { type DatosAjusteFaltante, publicarAjusteFaltante, refFaltante } from "./odoo-faltantes.ts";
import { aplicarAperturaBodega, type DatosApertura, refApertura } from "./odoo-corte.ts";
import { type DatosSalida, publicarSalida } from "./odoo-salidas.ts";
import { odooFake } from "./odoo-fake-util.ts";
import { TrasladoError } from "./odoo-traslados.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const dato: DatosAjusteFaltante = {
  id: "abcdef12-0000-0000-0000-000000000000", salidaId: "s1", folio: "CND-S1", estado: "rechazada", accion: "devolver_transito", esPrueba: false, faltante: 4,
  articuloNombre: "Cemento", odooProductId: 7, origenLocationId: 8, origenWarehouseId: 1, companyId: 1,
};

/** Biblioteca en memoria: A done con 10 uds, B done con 6; lo que falta (4) esta en transito. */
function lib(extra: Any[] = []) {
  const pk: Any[] = [
    { id: 1, origin: "SGC-TRAS-s1-A", state: "done", items: [{ productId: 7, cantidad: 10 }] },
    { id: 2, origin: "SGC-TRAS-s1-B", state: "done", items: [{ productId: 7, cantidad: 6 }] }, ...extra,
  ];
  const log: string[] = [];
  const l = {
    buscar: (o: string) => { const p = pk.find((x) => x.origin === o); return Promise.resolve(p ? { id: p.id, state: p.state } : null); },
    crear: (e: Any) => { const id = pk.length + 1; pk.push({ id, origin: e.origin, state: "draft", items: e.items, de: e.origenLocationId, a: e.destinoLocationId }); log.push(`crear:${e.origin}`); return Promise.resolve({ pickingId: id }); },
    validar: (id: number) => { pk.find((x) => x.id === id).state = "done"; log.push(`validar:${id}`); return Promise.resolve({ estado: "done" }); },
    transitoLocationId: () => Promise.resolve(13), tipoInterno: () => Promise.resolve(5),
    publicado: (prefijo: string) => {
      const m = new Map<number, number>();
      for (const p of pk.filter((x) => x.origin.startsWith(prefijo) && x.state !== "cancel" && !/-D\d+$/.test(x.origin))) for (const i of p.items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.cantidad);
      return Promise.resolve(m);
    },
  };
  return { l, pk, log };
}
function run(k: Partial<DatosAjusteFaltante>, f = odooFake(), li = lib()) {
  let d = { ...dato, ...k }; const marcas: Any[] = [];
  const deps = { c: f.c, lib: li.l, cargar: () => Promise.resolve(d), marcar: (_i: string, m: Any) => { marcas.push(m); return Promise.resolve(); } };
  return { f, li, marcas, publicar: (e: Partial<DatosAjusteFaltante> = {}, intentos = 1) => { d = { ...d, ...e }; return publicarAjusteFaltante(deps, dato.id, intentos); } };
}

Deno.test("faltante: sin decision o de prueba NO toca Odoo", async () => {
  const r = run({ estado: "pendiente", accion: null });
  assertEquals((await r.publicar()).resultado?.omitido, "sin_decision");
  assertEquals((await r.publicar({ estado: "rechazada", accion: "devolver_transito", esPrueba: true })).resultado?.omitido, "es_prueba");
  assertEquals(r.li.log, []);
});

Deno.test("DS-17 rechazo: devuelve el faltante de transito al ORIGEN (picking propio, validado) y no se duplica al reintentar", async () => {
  const r = run({});
  const a = await r.publicar();
  assertEquals(a.estado, "completado");
  const origin = refFaltante("s1", dato.id);
  assertEquals(r.li.log, [`crear:${origin}`, "validar:3"]);
  const p = r.li.pk[2];
  assertEquals([p.de, p.a, p.items], [13, 8, [{ productId: 7, cantidad: 4, nombre: "Cemento" }]]);
  assertEquals(r.marcas.at(-1).estado, "sincronizado");
  assertEquals(r.marcas.at(-1).picking, 3);
  const b = await r.publicar({}, 2);
  assertEquals(b.estado, "completado");
  assertEquals(r.li.log.length, 2); // reintento: sin crear ni validar de nuevo
});

Deno.test("DS-17: un faltante mayor que lo que quedo en transito se rechaza con mensaje claro", async () => {
  const r = run({ faltante: 5 }); // A=10, B=6 -> en transito 4
  const x = await r.publicar();
  assertEquals(x.estado, "error");
  assertStringIncludes(x.error ?? "", "mayor que lo que ese conduce dejó en tránsito");
  assertEquals(r.li.log, []);
});

Deno.test("DS-17: si el despacho A aun no esta validado en Odoo no hay nada que resolver (error visible, sin escribir)", async () => {
  const r = run({}, odooFake(), lib());
  r.li.pk[0].state = "draft";
  const x = await r.publicar();
  assertEquals(x.estado, "error"); assertStringIncludes(x.error ?? "", "aún no está validado");
  assertEquals(r.li.log, []);
});

Deno.test("DS-28 aprobacion: BAJA del faltante desde transito con la accion de negocio de inventario; reintento = un solo efecto", async () => {
  const f = odooFake(); f.quants.push({ id: 1, product_id: [7, "p"], location_id: [13, "t"], quantity: 10, inventory_quantity: 0 });
  const r = run({ estado: "aprobada", accion: "ajuste" }, f);
  const a = await r.publicar();
  assertEquals(a.estado, "completado");
  assertEquals(f.quants[0].quantity, 6);
  assertEquals(f.moves.at(-1).name, `${refFaltante("s1", dato.id)}-AJ`);
  assertEquals(f.llamadas.includes("stock.quant.action_apply_inventory"), true);
  const n = f.moves.length;
  const b = await r.publicar({}, 2);
  assertEquals(b.estado, "completado"); assertEquals(f.quants[0].quantity, 6); assertEquals(f.moves.length, n);
});

Deno.test("DS-28 aprobacion: sin material suficiente en transito = error sin_stock; articulo sin vincular = error de datos", async () => {
  const f = odooFake(); f.quants.push({ id: 1, product_id: [7, "p"], location_id: [13, "t"], quantity: 2, inventory_quantity: 0 });
  const r = run({ estado: "aprobada", accion: "ajuste" }, f);
  const a = await r.publicar();
  assertEquals(a.estado, "error"); assertStringIncludes(a.error ?? "", "No hay suficiente material en tránsito");
  assertEquals(f.quants[0].quantity, 2);
  const b = await r.publicar({ odooProductId: null });
  assertEquals(b.estado, "error"); assertStringIncludes(b.error ?? "", "no está vinculado con Odoo");
});

// ── DS-29 apertura ──────────────────────────────────────────────────────────────────────────────────────────────────────
const apertura: DatosApertura = { fase_corte: true, configurada: true, fecha_corte: "2026-11-01", apertura_hecha: false, hoy: "2026-11-16", location_id: 8, saldos: [{ odoo_product_id: 7, cantidad: 12 }] };
function conOdoo() {
  const f = odooFake();
  f.quants.push({ id: 1, product_id: [7, "p"], location_id: [8, "l"], quantity: 10, inventory_quantity: 0 }, { id: 2, product_id: [99, "q"], location_id: [8, "l"], quantity: 500, inventory_quantity: 0 });
  return f;
}

Deno.test("DS-29 plan: calcula el delta SOLO de articulos homologados, no escribe y cuenta los que solo existen en Odoo", async () => {
  const f = conOdoo();
  const r = await aplicarAperturaBodega(f.c, "b1", apertura, "plan");
  assertEquals(r.ajustes, [{ productId: 7, delta: 2 }]); assertEquals(r.solo_odoo, 1);
  assertEquals(f.llamadas.some((x) => x.endsWith("action_apply_inventory") || x.endsWith(".write")), false);
});

Deno.test("DS-29 aplicar: lleva el saldo al de SGC con la accion de negocio, NO toca lo que solo esta en Odoo y repetir no suma", async () => {
  const f = conOdoo();
  const r = await aplicarAperturaBodega(f.c, "b1", apertura, "aplicar");
  assertEquals(r.aplicadas, 1); assertEquals(f.quants[0].quantity, 12); assertEquals(f.quants[1].quantity, 500);
  assertEquals(f.moves.at(-1).name, refApertura("b1"));
  const r2 = await aplicarAperturaBodega(f.c, "b1", apertura, "aplicar");
  assertEquals(r2.ajustes, []); assertEquals(r2.aplicadas, 0); assertEquals(f.quants[0].quantity, 12);
});

Deno.test("DS-29: fase apagada, sin fecha, fecha futura o apertura desproporcionada se rechazan sin escribir", async () => {
  const f = conOdoo();
  await assertRejects(() => aplicarAperturaBodega(f.c, "b1", { ...apertura, fase_corte: false }, "aplicar"), TrasladoError, "apagada");
  await assertRejects(() => aplicarAperturaBodega(f.c, "b1", { ...apertura, configurada: false, fecha_corte: null }, "aplicar"), TrasladoError, "fecha de corte");
  await assertRejects(() => aplicarAperturaBodega(f.c, "b1", { ...apertura, fecha_corte: "2026-12-01" }, "aplicar"), TrasladoError, "futura");
  await assertRejects(() => aplicarAperturaBodega(f.c, "b1", { ...apertura, saldos: [{ odoo_product_id: 7, cantidad: 100 }] }, "aplicar"), TrasladoError, "demasiado stock");
  assertEquals(f.quants[0].quantity, 10);
  const ok = await aplicarAperturaBodega(f.c, "b1", { ...apertura, saldos: [{ odoo_product_id: 7, cantidad: 100 }] }, "aplicar", 100); // el tope se sube a conciencia
  assertEquals(ok.aplicadas, 1);
});

// ── DS-28 adjunto del PDF en la salida ─────────────────────────────────────────────────────────────────────────────────────
Deno.test("DS-28: la salida adjunta el PDF a A y B (no falla si el adjunto falla: queda en el aviso)", async () => {
  const pk: Any[] = [];
  const base: DatosSalida = { id: "s1", folio: "CND-1", estado: "entregado", esPrueba: false, paradaEntregada: true, companyId: 1, origenLocationId: 8, origenWarehouseId: 1, destinoLocationId: 20,
    lineas: [{ nombre: "Cemento", cantidad: 5, cantidadRecibida: 5, odooProductId: 7 }] };
  const l = {
    buscar: (o: string) => Promise.resolve(pk.find((p) => p.origin === o) ? { id: pk.find((p) => p.origin === o).id, state: pk.find((p) => p.origin === o).state } : null),
    crear: (e: Any) => { const id = pk.length + 1; pk.push({ id, origin: e.origin ?? `SGC-TRAS-${e.salidaId}-${e.paso}`, state: "draft", items: e.items }); return Promise.resolve({ pickingId: id }); },
    validar: (id: number) => { pk[id - 1].state = "done"; return Promise.resolve({ estado: "done" }); },
    cancelar: () => Promise.resolve({}), devolver: () => Promise.resolve({}),
    transitoLocationId: () => Promise.resolve(13), tipoInterno: () => Promise.resolve(5),
  };
  const llamadas: string[] = []; const marcas: Any[] = [];
  const mk = (falla: boolean) => ({
    lib: l, cargar: () => Promise.resolve(base), marcar: (_i: string, m: Any) => { marcas.push(m); return Promise.resolve(); },
    adjuntarPdf: (pid: number, paso: string) => { llamadas.push(`${paso}:${pid}`); if (falla) throw new Error("sin permiso"); return Promise.resolve({ id: 70 + pid, creado: true }); },
  });
  const r = await publicarSalida(mk(false), "s1", 1);
  assertEquals(llamadas, ["A:1", "B:2"]); assertEquals(r.resultado?.adjunto_a, 71); assertEquals(r.resultado?.adjunto_b, 72);
  assertEquals(marcas.at(-1).error, undefined);
  const r2 = await publicarSalida(mk(true), "s1", 2);
  assertEquals(r2.estado, "completado");
  assertStringIncludes(marcas.at(-1).error, "No se pudo adjuntar el PDF firmado");
});
