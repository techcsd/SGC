import { assertEquals } from "jsr:@std/assert@1";
import {
  transcripcionAtascada,
  envioAtascado,
  errorEsRepetido,
  obraSinBitacoraHoy,
  reporteSinResponder,
  agenteBajoTope,
} from "./agentes-reglas.ts";

const AHORA = "2026-11-01T12:00:00.000Z";

Deno.test("transcripcionAtascada: procesando hace 31 min → atascada", () => {
  assertEquals(transcripcionAtascada("procesando", "2026-11-01T11:29:00.000Z", AHORA), true);
});
Deno.test("transcripcionAtascada: procesando hace 5 min → no atascada", () => {
  assertEquals(transcripcionAtascada("procesando", "2026-11-01T11:55:00.000Z", AHORA), false);
});
Deno.test("transcripcionAtascada: completada no cuenta aunque sea vieja", () => {
  assertEquals(transcripcionAtascada("completada", "2026-11-01T09:00:00.000Z", AHORA), false);
});

Deno.test("envioAtascado: sistema sin resolver hace 3h → atascado", () => {
  assertEquals(envioAtascado(false, "sistema", "2026-11-01T09:00:00.000Z", AHORA), true);
});
Deno.test("envioAtascado: ya resuelto no cuenta aunque sea viejo", () => {
  assertEquals(envioAtascado(true, "sistema", "2026-11-01T09:00:00.000Z", AHORA), false);
});
Deno.test("envioAtascado: categoria dato (culpa del usuario) no cuenta", () => {
  assertEquals(envioAtascado(false, "dato", "2026-11-01T09:00:00.000Z", AHORA), false);
});

Deno.test("errorEsRepetido: 5 ocurrencias → repetido", () => {
  assertEquals(errorEsRepetido(5), true);
});
Deno.test("errorEsRepetido: 4 ocurrencias → no repetido", () => {
  assertEquals(errorEsRepetido(4), false);
});

Deno.test("obraSinBitacoraHoy: proyecto no está en el set → sin bitácora", () => {
  assertEquals(obraSinBitacoraHoy("p1", new Set(["p2"])), true);
});
Deno.test("obraSinBitacoraHoy: proyecto está en el set → tiene bitácora", () => {
  assertEquals(obraSinBitacoraHoy("p1", new Set(["p1", "p2"])), false);
});

Deno.test("reporteSinResponder: abierto hace 50h sin respuesta → sin responder", () => {
  assertEquals(reporteSinResponder("abierto", null, "2026-10-30T10:00:00.000Z", AHORA), true);
});
Deno.test("reporteSinResponder: tiene respuesta_admin → no cuenta aunque sea viejo", () => {
  assertEquals(reporteSinResponder("abierto", "ya lo vimos", "2026-10-30T10:00:00.000Z", AHORA), false);
});
Deno.test("reporteSinResponder: resuelto no cuenta", () => {
  assertEquals(reporteSinResponder("resuelto", null, "2026-10-30T10:00:00.000Z", AHORA), false);
});

Deno.test("agenteBajoTope: costo bajo el tope → puede usar IA", () => {
  assertEquals(agenteBajoTope(2.5, 5), true);
});
Deno.test("agenteBajoTope: costo igual o sobre el tope → corta a solo determinista", () => {
  assertEquals(agenteBajoTope(5, 5), false);
  assertEquals(agenteBajoTope(7, 5), false);
});
