import { assertEquals } from "jsr:@std/assert@1";
import { clasificarParaRecap, loteMensajes, seccionesPdfGrupo, type HallazgoRecap } from "./wa-recap-contenido.ts";

function h(over: Partial<HallazgoRecap>): HallazgoRecap {
  return {
    id: "h1", tipo: "otro", resumen: "x", detalle: null, fecha_mencionada: null,
    monto: null, moneda: null, confianza: 0.9, estado: "nuevo", seguimiento: "sin",
    responsable_nombre: null, seguimiento_desde: null, recordatorios_enviados: 0,
    creado_en: "2026-11-10T12:00:00Z", ...over,
  };
}

const VENTANA = { desde: new Date("2026-11-09T22:00:00Z"), hasta: new Date("2026-11-10T22:00:00Z") };

Deno.test("clasificarParaRecap — decisiones/acuerdos/cambio_de_plan entran a 'decisiones'", () => {
  const ventana = [h({ tipo: "decision" }), h({ tipo: "acuerdo" }), h({ tipo: "cambio_de_plan" }), h({ tipo: "otro" })];
  const c = clasificarParaRecap(ventana, [], [], VENTANA, "dia");
  assertEquals(c.decisiones.length, 3);
});

Deno.test("clasificarParaRecap — montos e incidentes se separan por tipo", () => {
  const ventana = [h({ tipo: "monto", monto: 500 }), h({ tipo: "incidente" })];
  const c = clasificarParaRecap(ventana, [], [], VENTANA, "dia");
  assertEquals(c.montos.length, 1);
  assertEquals(c.incidentes.length, 1);
});

Deno.test("clasificarParaRecap — por confirmar: confianza<0.7 y estado nuevo", () => {
  const ventana = [h({ confianza: 0.5, estado: "nuevo" }), h({ confianza: 0.5, estado: "revisado" }), h({ confianza: 0.9, estado: "nuevo" })];
  const c = clasificarParaRecap(ventana, [], [], VENTANA, "dia");
  assertEquals(c.porConfirmar.length, 1);
});

Deno.test("clasificarParaRecap — pendientes = TODOS los abiertos actuales (no solo los de la ventana)", () => {
  const abiertos = [h({ id: "a" }), h({ id: "b" })];
  const c = clasificarParaRecap([], abiertos, [], VENTANA, "dia");
  assertEquals(c.pendientes.length, 2);
});

Deno.test("clasificarParaRecap — fechas próximas: dentro de los próximos 7 días desde 'hasta'", () => {
  const abiertos = [
    h({ id: "a", fecha_mencionada: "2026-11-12" }), // dentro de 7 días
    h({ id: "b", fecha_mencionada: "2026-12-01" }), // fuera
    h({ id: "c", fecha_mencionada: null }),
  ];
  const c = clasificarParaRecap([], abiertos, [], VENTANA, "dia");
  assertEquals(c.fechasProximas.map((x) => x.id), ["a"]);
});

Deno.test("clasificarParaRecap — semanal: pendientesDeAntes = abiertos con seguimiento_desde anterior a la ventana", () => {
  const abiertos = [
    h({ id: "viejo", seguimiento_desde: "2026-11-01T00:00:00Z" }),
    h({ id: "nuevo", seguimiento_desde: "2026-11-10T00:00:00Z" }),
  ];
  const c = clasificarParaRecap([], abiertos, [], VENTANA, "semana");
  assertEquals(c.pendientesDeAntes.map((x) => x.id), ["viejo"]);
});

Deno.test("clasificarParaRecap — diario NO calcula pendientesDeAntes (queda vacío)", () => {
  const abiertos = [h({ id: "viejo", seguimiento_desde: "2026-11-01T00:00:00Z" })];
  const c = clasificarParaRecap([], abiertos, [], VENTANA, "dia");
  assertEquals(c.pendientesDeAntes.length, 0);
});

Deno.test("clasificarParaRecap — resueltosEnVentana = tamaño de cerradosEnVentana", () => {
  const cerrados = [h({ id: "x" }), h({ id: "y" })];
  const c = clasificarParaRecap([], [], cerrados, VENTANA, "semana");
  assertEquals(c.resueltosEnVentana, 2);
});

// ── loteMensajes ─────────────────────────────────────────────────────────────
Deno.test("loteMensajes — divide en lotes del tamaño pedido, sin perder elementos", () => {
  const items = Array.from({ length: 325 }, (_, i) => i);
  const lotes = loteMensajes(items, 150);
  assertEquals(lotes.length, 3);
  assertEquals(lotes[0].length, 150);
  assertEquals(lotes[2].length, 25);
  assertEquals(lotes.flat(), items); // no perdió el inicio ni el final
});

Deno.test("loteMensajes — array vacío devuelve [] (sin lotes)", () => {
  assertEquals(loteMensajes([], 150), []);
});

// ── seccionesPdfGrupo ────────────────────────────────────────────────────────
Deno.test("seccionesPdfGrupo — sin resumen IA (presupuesto agotado) lo deja explícito", () => {
  const c = clasificarParaRecap([], [], [], VENTANA, "dia");
  const secs = seccionesPdfGrupo("Torre Alpha", null, c, "dia");
  assertEquals(secs[0].rows[0][0].includes("presupuesto diario agotado"), true);
});

Deno.test("seccionesPdfGrupo — semanal agrega la sección de cumplidos vs abiertos", () => {
  const c = clasificarParaRecap([], [], [], VENTANA, "semana");
  const secs = seccionesPdfGrupo("G", "resumen", c, "semana");
  assertEquals(secs.some((s) => s.titulo.includes("cumplidos vs")), true);
});

Deno.test("seccionesPdfGrupo — diario NO agrega la sección semanal", () => {
  const c = clasificarParaRecap([], [], [], VENTANA, "dia");
  const secs = seccionesPdfGrupo("G", "resumen", c, "dia");
  assertEquals(secs.some((s) => s.titulo.includes("cumplidos vs")), false);
});
