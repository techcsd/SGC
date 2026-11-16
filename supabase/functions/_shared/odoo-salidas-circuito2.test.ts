// DS-17 / DS-19 / DS-20 sobre el publicador de salidas: entrada ligada completa B, real->prueba compensa, lineas anadidas publican complemento.
import { assertEquals } from "jsr:@std/assert@1";
import { type Biblioteca, calcularComplemento, type DatosSalida, huellaComplemento, publicarSalida } from "./odoo-salidas.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const base: DatosSalida = {
  id: "s1", folio: "CND-1", estado: "despachado", esPrueba: false, paradaEntregada: false, companyId: 1,
  origenLocationId: 8, origenWarehouseId: 1, destinoLocationId: 20,
  lineas: [{ nombre: "Cemento", cantidad: 5, cantidadRecibida: null, odooProductId: 7 }],
};
function lib() {
  const pk: Any[] = []; const log: string[] = [];
  const l: Biblioteca = {
    buscar: (o) => Promise.resolve(pk.find((p) => p.origin === o) ? { id: pk.find((p) => p.origin === o).id, state: pk.find((p) => p.origin === o).state } : null),
    crear: (e) => { const id = pk.length + 1; pk.push({ id, origin: e.origin ?? `SGC-TRAS-${e.salidaId}-${e.paso}`, state: "draft", items: e.items }); log.push("crear:" + pk[id - 1].origin); return Promise.resolve({ pickingId: id }); },
    validar: (id) => { pk[id - 1].state = "done"; return Promise.resolve({ estado: "done" }); },
    cancelar: (id) => { pk[id - 1].state = "cancel"; return Promise.resolve({}); },
    devolver: (id) => { pk[id - 1].state = "devuelto"; log.push("devolver:" + id); return Promise.resolve({}); },
    transitoLocationId: () => Promise.resolve(13), tipoInterno: () => Promise.resolve(5),
    complementos: (prefijo) => Promise.resolve(pk.filter((x) => x.origin.startsWith(prefijo)).map((x) => ({ id: x.id, state: x.state }))),
    publicado: (prefijo) => {
      const m = new Map<number, number>();
      for (const p of pk.filter((x) => x.origin.startsWith(prefijo) && x.state !== "cancel" && !/-D\d+$/.test(x.origin))) for (const i of p.items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.cantidad);
      return Promise.resolve(m);
    },
  };
  return { l, pk, log };
}
function run(estado: Partial<DatosSalida>, f = lib()) {
  let s = { ...base, ...estado };
  const marcas: Any[] = [];
  const deps = { lib: f.l, cargar: () => Promise.resolve(s), marcar: (_i: string, m: Any) => { marcas.push(m); return Promise.resolve(); } };
  return { f, marcas, publicar: (e: Partial<DatosSalida> = {}) => { s = { ...s, ...e }; return publicarSalida(deps, "s1", 1); } };
}

Deno.test("calcularComplemento: solo lo que SGC tiene de mas; sin extras = vacio; suma duplicados", () => {
  assertEquals(calcularComplemento([{ productId: 7, cantidad: 5 }], new Map([[7, 5]])), []);
  assertEquals(calcularComplemento([{ productId: 7, cantidad: 5 }, { productId: 8, cantidad: 2 }], new Map([[7, 5]])), [{ productId: 8, cantidad: 2 }]);
  assertEquals(calcularComplemento([{ productId: 7, cantidad: 3 }, { productId: 7, cantidad: 4 }], new Map([[7, 5]])), [{ productId: 7, cantidad: 2 }]);
  assertEquals(huellaComplemento([{ productId: 8, cantidad: 2 }]), huellaComplemento([{ productId: 8, cantidad: 2 }]));
});

Deno.test("DS-20: material libre regularizado DESPUES de publicar -> complemento idempotente (no recrea A, no duplica)", async () => {
  const r = run({});
  await r.publicar(); assertEquals(r.f.pk.length, 1);
  const lineas = [...base.lineas, { nombre: "Libre vinculado", cantidad: 2, cantidadRecibida: null, odooProductId: 9 }];
  const res = await r.publicar({ lineas });
  assertEquals(res.estado, "completado"); assertEquals(r.f.pk.length, 2); assertEquals(r.f.pk[1].items, [{ productId: 9, cantidad: 2, uomId: undefined, nombre: "Libre vinculado" }]);
  assertEquals(r.f.pk[1].origin.startsWith("SGC-TRAS-s1-A-C"), true);
  await r.publicar({ lineas }); assertEquals(r.f.pk.length, 2); // reintento: nada nuevo
});

Deno.test("DS-20: B complementario cuando la salida ya esta entregada y llega una linea nueva", async () => {
  const r = run({ estado: "entregado" });
  await r.publicar(); assertEquals(r.f.pk.length, 2); // A y B
  const lineas = [...base.lineas, { nombre: "Libre", cantidad: 1, cantidadRecibida: null, odooProductId: 9 }];
  await r.publicar({ lineas });
  assertEquals(r.f.pk.map((p) => p.origin).filter((o) => o.includes("-C")).length, 2); // A-C y B-C
  await r.publicar({ lineas }); assertEquals(r.f.pk.length, 4);
});

Deno.test("DS-17/DS-19: una entrada confirmada ligada a la salida completa B con lo recibido (no una recepcion de proveedor)", async () => {
  const r = run({});
  await r.publicar(); assertEquals(r.f.pk.length, 1); // solo A
  const res = await r.publicar({ entradaConfirmada: true });
  assertEquals(res.estado, "completado"); assertEquals(r.f.pk.map((p) => p.origin), ["SGC-TRAS-s1-A", "SGC-TRAS-s1-B"]);
  assertEquals(r.marcas.at(-1).estado, "sincronizado");
});

Deno.test("DS-19: real -> prueba despues de publicar COMPENSA A y B; prueba que nunca se publico no hace nada", async () => {
  const r = run({ estado: "entregado" });
  await r.publicar();
  await r.publicar({ lineas: [...base.lineas, { nombre: "Libre", cantidad: 1, cantidadRecibida: null, odooProductId: 9 }] }); // + complementos A-C y B-C
  const res = await r.publicar({ esPrueba: true });
  assertEquals(res.estado, "completado"); assertEquals(res.resultado?.por, "es_prueba"); assertEquals(r.f.log.filter((x) => x.startsWith("devolver")).length, 4); // A, B y sus complementos
  const limpio = run({ esPrueba: true });
  assertEquals((await limpio.publicar()).resultado?.omitido, "es_prueba"); assertEquals(limpio.f.pk.length, 0);
});

Deno.test("DS-19: anulacion antes de validar cancela; despues de validar devuelve; reproceso no duplica", async () => {
  const r = run({});
  await r.publicar();
  r.f.pk[0].state = "draft"; // aun no validado en Odoo
  await r.publicar({ estado: "anulado" }); assertEquals(r.f.pk[0].state, "cancel");
  const q = run({});
  await q.publicar(); await q.publicar({ estado: "anulado" }); assertEquals(q.f.pk[0].state, "devuelto");
  const antes = q.f.log.length; await q.publicar({ estado: "anulado" }); assertEquals(q.f.log.length, antes);
});
