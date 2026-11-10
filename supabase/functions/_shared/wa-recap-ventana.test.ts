import { assertEquals } from "jsr:@std/assert@1";
import { calcularVentana } from "./wa-recap-ventana.ts";

Deno.test("calcularVentana — primera corrida diario: 24h atrás", () => {
  const ahora = new Date("2026-11-10T22:00:00Z");
  const v = calcularVentana(null, ahora, "dia");
  assertEquals(v.desde.toISOString(), "2026-11-09T22:00:00.000Z");
  assertEquals(v.hasta.toISOString(), ahora.toISOString());
});

Deno.test("calcularVentana — primera corrida semanal: 7 días atrás", () => {
  const ahora = new Date("2026-11-10T22:30:00Z");
  const v = calcularVentana(null, ahora, "semana");
  assertEquals(v.desde.toISOString(), "2026-11-03T22:30:00.000Z");
});

Deno.test("calcularVentana — con cursor previo, la ventana empieza donde quedó el cursor (rodante)", () => {
  const ahora = new Date("2026-11-10T22:00:00Z");
  const v = calcularVentana("2026-11-09T18:30:00.000Z", ahora, "dia");
  assertEquals(v.desde.toISOString(), "2026-11-09T18:30:00.000Z");
});

Deno.test("calcularVentana — cambio de día (sábado cubre diario + semanal el mismo corrido)", () => {
  // Sábado 6:00pm RD = 22:00 UTC (diario) y 6:30pm RD = 22:30 UTC (semanal) — ambas ventanas son independientes.
  const sabadoDiario = new Date("2026-11-14T22:00:00Z");
  const sabadoSemanal = new Date("2026-11-14T22:30:00Z");
  const vDia = calcularVentana("2026-11-13T22:00:00.000Z", sabadoDiario, "dia");
  const vSemana = calcularVentana(null, sabadoSemanal, "semana");
  assertEquals(vDia.hasta.toISOString(), "2026-11-14T22:00:00.000Z");
  assertEquals(vSemana.desde.toISOString(), "2026-11-07T22:30:00.000Z");
});
