import { assertEquals } from "jsr:@std/assert@1";
import { OdooError } from "./odoo-client.ts";
import { TrasladoError } from "./odoo-traslados.ts";
import { type Biblioteca, type DatosSalida, type DepsSalida, publicarSalida } from "./odoo-salidas.ts";

const salidaBase: DatosSalida = {
  id: "s1", folio: "CND-1", estado: "despachado", esPrueba: false, paradaEntregada: false, companyId: 1,
  origenLocationId: 8, origenWarehouseId: 1, destinoLocationId: 102,
  lineas: [{ nombre: "Cemento", cantidad: 10, cantidadRecibida: null, odooProductId: 7 }, { nombre: "Varilla", cantidad: 4, cantidadRecibida: null, odooProductId: 9 }],
};

function armar(s: Partial<DatosSalida> | null, previos: Record<string, { id: number; state: string }> = {}, falla?: () => Error) {
  const log: string[] = []; const marcas: Array<Record<string, unknown>> = []; let nextId = 100;
  const lib: Biblioteca = {
    // deno-lint-ignore require-await
    async buscar(o) { return previos[o] ?? null; },
    // deno-lint-ignore require-await
    async crear(e) { if (falla) throw falla(); log.push(`crear ${e.paso} ${e.origenLocationId}->${e.destinoLocationId} ${JSON.stringify(e.items.map((i) => i.cantidad))}`); return { pickingId: nextId++ }; },
    // deno-lint-ignore require-await
    async validar(id) { log.push(`validar ${id}`); return { estado: "done" }; },
    // deno-lint-ignore require-await
    async cancelar(id) { log.push(`cancelar ${id}`); return {}; },
    // deno-lint-ignore require-await
    async devolver(id, p) { log.push(`devolver ${p} ${id}`); return {}; },
    // deno-lint-ignore require-await
    async transitoLocationId() { return 13; },
    // deno-lint-ignore require-await
    async tipoInterno() { return 5; },
  };
  const deps: DepsSalida = {
    lib,
    // deno-lint-ignore require-await
    async cargar() { return s === null ? null : { ...salidaBase, ...s }; },
    // deno-lint-ignore require-await
    async marcar(_id, m) { marcas.push(m); },
  };
  return { deps, log, marcas };
}

Deno.test("despachado: solo paso A (origen->transito) con las cantidades enviadas", async () => {
  const { deps, log, marcas } = armar({});
  const r = await publicarSalida(deps, "s1", 1);
  assertEquals(r.estado, "completado");
  assertEquals(log, ["crear A 8->13 [10,4]", "validar 100"]);
  assertEquals([marcas[0].estado, marcas[0].a, marcas[0].b], ["sincronizado", 100, undefined]);
});

Deno.test("despachado con parada entregada: A y B (B desde transito al destino)", async () => {
  const { deps, log } = armar({ paradaEntregada: true });
  await publicarSalida(deps, "s1", 1);
  assertEquals(log, ["crear A 8->13 [10,4]", "validar 100", "crear B 13->102 [10,4]", "validar 101"]);
});

Deno.test("entregado_incompleto: B con lo RECIBIDO y el faltante se reporta en transito", async () => {
  const { deps, log, marcas } = armar({ estado: "entregado_incompleto", lineas: salidaBase.lineas.map((l, i) => ({ ...l, cantidadRecibida: i === 0 ? 7 : null })) });
  const r = await publicarSalida(deps, "s1", 1);
  assertEquals(log[2], "crear B 13->102 [7,4]");
  assertEquals([r.resultado?.faltante_en_transito, String(marcas[0].error).includes("Faltante")], [true, true]);
});

Deno.test("recibida NULL = lo enviado (ADR 14): sin faltante", async () => {
  const { deps } = armar({ estado: "entregado" });
  const r = await publicarSalida(deps, "s1", 1);
  assertEquals(r.resultado?.faltante_en_transito, false);
});

Deno.test("idempotente: A y B ya validados en Odoo no se crean ni validan de nuevo", async () => {
  const { deps, log } = armar({ estado: "entregado" }, { "SGC-TRAS-s1-A": { id: 5, state: "done" }, "SGC-TRAS-s1-B": { id: 6, state: "done" } });
  const r = await publicarSalida(deps, "s1", 1);
  assertEquals([log, r.estado, r.resultado?.picking_b], [[], "completado", 6]);
});

Deno.test("A creado pero sin validar (corte previo): se reutiliza y solo se valida", async () => {
  const { deps, log } = armar({}, { "SGC-TRAS-s1-A": { id: 5, state: "assigned" } });
  await publicarSalida(deps, "s1", 1);
  assertEquals(log, ["validar 5"]);
});

Deno.test("anulado: B validado se devuelve antes que A; un A en borrador se cancela", async () => {
  const dev = armar({ estado: "anulado" }, { "SGC-TRAS-s1-A": { id: 5, state: "done" }, "SGC-TRAS-s1-B": { id: 6, state: "done" } });
  await publicarSalida(dev.deps, "s1", 1);
  assertEquals(dev.log, ["devolver B 6", "devolver A 5"]);
  const can = armar({ estado: "rechazada" }, { "SGC-TRAS-s1-A": { id: 5, state: "draft" } });
  await publicarSalida(can.deps, "s1", 1);
  assertEquals(can.log, ["cancelar 5"]);
});

Deno.test("articulo sin homologar: error de datos con mensaje claro, sin llamar a Odoo", async () => {
  const { deps, log, marcas } = armar({ lineas: [{ nombre: "Pintura", cantidad: 1, cantidadRecibida: null, odooProductId: null }] });
  const r = await publicarSalida(deps, "s1", 1);
  assertEquals([r.estado, log, marcas[0].estado, String(marcas[0].error).includes("Pintura")], ["error", [], "error", true]);
});

Deno.test("origen/destino sin vincular: error; B sin destino vinculado deja el material en transito", async () => {
  const a = await publicarSalida(armar({ origenLocationId: null }).deps, "s1", 1);
  assertEquals(a.estado, "error");
  const b = armar({ estado: "entregado", destinoLocationId: null });
  const r = await publicarSalida(b.deps, "s1", 1);
  assertEquals([r.estado, b.log.length, String(b.marcas[0].error).includes("tránsito")], ["error", 2, true]); // A si se hizo
});

Deno.test("sin stock -> error visible (sin traza); no se reintenta solo", async () => {
  const { deps, marcas } = armar({}, {}, () => new TrasladoError("sin_stock", "No hay existencias suficientes en el almacén de origen para este despacho.", "{...}"));
  const r = await publicarSalida(deps, "s1", 1);
  assertEquals([r.estado, marcas[0].estado, String(marcas[0].error).includes("existencias")], ["error", "error", true]);
});

Deno.test("timeout/caida: reintento con espera creciente; tras MAX_INTENTOS queda incierto", async () => {
  const t = armar({}, {}, () => new OdooError("odoo_timeout", "Odoo no respondió a tiempo."));
  const r1 = await publicarSalida(t.deps, "s1", 1);
  const r3 = await publicarSalida(t.deps, "s1", 3);
  assertEquals([r1.estado, r1.reintentarEnMs, r3.reintentarEnMs], ["reintento", 30_000, 120_000]);
  const fin = await publicarSalida(t.deps, "s1", 8);
  assertEquals([fin.estado, t.marcas.at(-1)?.estado], ["incierto", "incierto"]);
});

Deno.test("salida de prueba no publica; salida inexistente es error", async () => {
  assertEquals((await publicarSalida(armar({ esPrueba: true }).deps, "s1", 1)).resultado, { omitido: "es_prueba" });
  assertEquals((await publicarSalida(armar(null).deps, "s1", 1)).estado, "error");
});

Deno.test("sin stock al validar A recien creado: se cancela el borrador huerfano (hallazgo del soak)", async () => {
  const { deps, log } = armar({});
  deps.lib.validar = () => Promise.reject(new TrasladoError("sin_stock", "No hay existencias suficientes en el almacén de origen para este despacho.", "{}"));
  const r = await publicarSalida(deps, "s1", 1);
  assertEquals([r.estado, log.includes("cancelar 100")], ["error", true]);
});
