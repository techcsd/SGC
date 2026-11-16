import { assertEquals } from "jsr:@std/assert@1";
import { conciliarSalidas, fueraDeCanal, type PickingOdoo, type SalidaConciliable } from "./odoo-conciliacion.ts";

const salida = (o: Partial<SalidaConciliable> = {}): SalidaConciliable => ({
  id: "s1", estado: "despachado", esPrueba: false, despachadaEn: "2026-11-10T00:00:00Z",
  lineas: [{ odooProductId: 7, cantidad: 10, cantidadRecibida: null }], ...o,
});
const pick = (origin: string, o: Partial<PickingOdoo> = {}): PickingOdoo => ({ id: Math.floor(Math.random() * 1e6), origin, state: "done", writeDate: "2026-11-10", writeUid: 1, moves: [{ productId: 7, cantidad: 10 }], ...o });
const tipos = (d: Array<{ tipo: string }>) => d.map((x) => x.tipo);
const ahora = new Date("2026-11-11T00:00:00Z");

Deno.test("salida despachada con A validado y cantidades iguales: sin discrepancias", () => {
  assertEquals(conciliarSalidas([salida()], [pick("SGC-TRAS-s1-A")], ahora), []);
});
Deno.test("sin A, A sin validar y cantidades distintas se reportan", () => {
  assertEquals(tipos(conciliarSalidas([salida()], [], ahora)), ["sin_picking_a"]);
  assertEquals(tipos(conciliarSalidas([salida()], [pick("SGC-TRAS-s1-A", { state: "assigned" })], ahora)), ["picking_a_no_validado"]);
  assertEquals(tipos(conciliarSalidas([salida()], [pick("SGC-TRAS-s1-A", { moves: [{ productId: 7, cantidad: 9 }] })], ahora)), ["cantidad_distinta"]);
});
Deno.test("entregada: exige B con lo recibido (NULL = enviado)", () => {
  const s = salida({ estado: "entregado" });
  assertEquals(tipos(conciliarSalidas([s], [pick("SGC-TRAS-s1-A")], ahora)), ["sin_picking_b"]);
  assertEquals(conciliarSalidas([s], [pick("SGC-TRAS-s1-A"), pick("SGC-TRAS-s1-B")], ahora), []);
  const inc = salida({ estado: "entregado_incompleto", lineas: [{ odooProductId: 7, cantidad: 10, cantidadRecibida: 6 }] });
  assertEquals(conciliarSalidas([inc], [pick("SGC-TRAS-s1-A"), pick("SGC-TRAS-s1-B", { moves: [{ productId: 7, cantidad: 6 }] })], ahora), []);
});
Deno.test("transito vencido a las 72 h; antes no", () => {
  const A = pick("SGC-TRAS-s1-A");
  assertEquals(tipos(conciliarSalidas([salida({ despachadaEn: "2026-11-07T00:00:00Z" })], [A], ahora)), ["transito_vencido"]);
  assertEquals(conciliarSalidas([salida({ despachadaEn: "2026-11-09T12:00:00Z" })], [A], ahora), []);
});
Deno.test("picking huerfano (sin salida) y devolucion -D1 de una salida conocida", () => {
  assertEquals(tipos(conciliarSalidas([], [pick("SGC-TRAS-x-A")], ahora)), ["picking_huerfano"]);
  assertEquals(conciliarSalidas([salida({ estado: "entregado" })], [pick("SGC-TRAS-s1-A"), pick("SGC-TRAS-s1-B"), pick("SGC-TRAS-s1-A-D1")], ahora), []);
});
Deno.test("anuladas y de prueba se ignoran", () => {
  assertEquals(conciliarSalidas([salida({ estado: "anulado" }), salida({ id: "s2", esPrueba: true })], [], ahora), []);
});
Deno.test("fuera de canal: picking SGC tocado por otro usuario y movimiento validado sin origen SGC", () => {
  const d = fueraDeCanal([pick("SGC-TRAS-s1-A", { writeUid: 99 }), pick("SGC-TRAS-s2-A", { writeUid: 1 }), pick("WH/INT/55")], 1);
  assertEquals(d.length, 2);
});
Deno.test("un picking cancelado sin salida no cuenta como huerfano", () => {
  assertEquals(conciliarSalidas([], [pick("SGC-TRAS-x-A", { state: "cancel" })], ahora), []);
});
