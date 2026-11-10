import { assertEquals } from "jsr:@std/assert@1";
import {
  fechaRD, sumarDiasIso, horasDesde, nivelDeHoy, debeRecordarPorFechaLimite,
  evaluarHallazgo, filtrarParaRecordar, filtrarParaVencer, consolidarPorPersona,
  consolidarEscalacionNivel3, dentroDeVentanaWhatsapp, dedupeKey,
  construirCorreoRecordatorio, construirCorreoEscalacionNivel3,
} from "./wa-seguimiento.ts";

// ── fechaRD / sumarDiasIso ───────────────────────────────────────────────────
Deno.test("fechaRD — resta 4h fijas (RD no tiene horario de verano)", () => {
  // 2026-11-10 02:00 UTC → 2026-11-09 22:00 RD → fecha 2026-11-09
  assertEquals(fechaRD(new Date("2026-11-10T02:00:00Z")), "2026-11-09");
  // 2026-11-10 05:00 UTC → 2026-11-10 01:00 RD → fecha 2026-11-10
  assertEquals(fechaRD(new Date("2026-11-10T05:00:00Z")), "2026-11-10");
});

Deno.test("sumarDiasIso — suma y resta días sin importar el mes", () => {
  assertEquals(sumarDiasIso("2026-11-30", 1), "2026-12-01");
  assertEquals(sumarDiasIso("2026-11-10", -1), "2026-11-09");
});

// ── horasDesde ───────────────────────────────────────────────────────────────
Deno.test("horasDesde — calcula horas transcurridas, nunca negativo", () => {
  const ahora = Date.now();
  assertEquals(horasDesde(new Date(ahora - 48 * 3_600_000).toISOString(), ahora), 48);
  assertEquals(horasDesde(new Date(ahora + 3_600_000).toISOString(), ahora), 0); // futuro → 0
});

// ── nivelDeHoy (escalera DL-11) ──────────────────────────────────────────────
Deno.test("nivelDeHoy — día 1/2/3 → niveles 1/2/3", () => {
  assertEquals(nivelDeHoy(24).nivel, 1);
  assertEquals(nivelDeHoy(47).nivel, 1);
  assertEquals(nivelDeHoy(48).nivel, 2);
  assertEquals(nivelDeHoy(71).nivel, 2);
  assertEquals(nivelDeHoy(72).nivel, 3);
});

Deno.test("nivelDeHoy — entre umbrales (día 4-5) no recuerda otra vez", () => {
  assertEquals(nivelDeHoy(96).nivel, 0); // día 4
  assertEquals(nivelDeHoy(119).nivel, 0); // día 4 (hasta 119h = <5d)
});

Deno.test("nivelDeHoy — cada 3 días desde el día 3 hasta el 12 vuelve a nivel 3", () => {
  assertEquals(nivelDeHoy(72).nivel, 3); // día 3
  assertEquals(nivelDeHoy(72 + 3 * 24).nivel, 3); // día 6
  assertEquals(nivelDeHoy(72 + 6 * 24).nivel, 3); // día 9
  assertEquals(nivelDeHoy(72 + 9 * 24).nivel, 3); // día 12
});

Deno.test("nivelDeHoy — día 14+ vence y deja de recordar", () => {
  const r = nivelDeHoy(14 * 24);
  assertEquals(r.vencido, true);
  assertEquals(r.nivel, 0);
});

Deno.test("nivelDeHoy — menos de 24h no recuerda", () => {
  assertEquals(nivelDeHoy(0).nivel, 0);
  assertEquals(nivelDeHoy(23).nivel, 0);
});

// ── debeRecordarPorFechaLimite ───────────────────────────────────────────────
Deno.test("debeRecordarPorFechaLimite — hoy y la víspera sí, otro día no", () => {
  assertEquals(debeRecordarPorFechaLimite("2026-11-10", "2026-11-10"), true);
  assertEquals(debeRecordarPorFechaLimite("2026-11-11", "2026-11-10"), true);
  assertEquals(debeRecordarPorFechaLimite("2026-11-12", "2026-11-10"), false);
  assertEquals(debeRecordarPorFechaLimite(null, "2026-11-10"), false);
});

// ── evaluarHallazgo — fecha_mencionada fuerza nivel 1 aunque sea reciente ───
Deno.test("evaluarHallazgo — fecha_mencionada mañana fuerza recordatorio aunque tenga <24h", () => {
  const ahora = Date.now();
  const h = {
    id: "h1", responsable_id: "u1", grupo_jid: "g1", grupo_nombre: "Torre Alpha",
    resumen: "Entregar cotización", fecha_mencionada: sumarDiasIso(fechaRD(new Date(ahora)), 1),
    seguimiento_desde: new Date(ahora - 2 * 3_600_000).toISOString(), // 2h de antigüedad
  };
  const ev = evaluarHallazgo(h, fechaRD(new Date(ahora)), ahora);
  assertEquals(ev.porFechaLimite, true);
  assertEquals(ev.nivel, 1);
});

Deno.test("evaluarHallazgo — sin fecha_mencionada y <24h no recuerda", () => {
  const ahora = Date.now();
  const h = {
    id: "h1", responsable_id: "u1", grupo_jid: "g1", grupo_nombre: "Torre Alpha",
    resumen: "x", fecha_mencionada: null,
    seguimiento_desde: new Date(ahora - 2 * 3_600_000).toISOString(),
  };
  assertEquals(evaluarHallazgo(h, fechaRD(new Date(ahora)), ahora).nivel, 0);
});

// ── filtrarParaRecordar / filtrarParaVencer ─────────────────────────────────
Deno.test("filtrarParaRecordar/filtrarParaVencer — separan correctamente", () => {
  const base = { id: "x", responsable_id: "u1", grupo_jid: "g1", grupo_nombre: "g", resumen: "r", fecha_mencionada: null, seguimiento_desde: "" };
  const items = [
    { ...base, id: "a", nivel: 1 as const, vencido: false, porFechaLimite: false },
    { ...base, id: "b", nivel: 0 as const, vencido: true, porFechaLimite: false },
    { ...base, id: "c", nivel: 0 as const, vencido: false, porFechaLimite: false },
  ];
  assertEquals(filtrarParaRecordar(items).map((h) => h.id), ["a"]);
  assertEquals(filtrarParaVencer(items).map((h) => h.id), ["b"]);
});

// ── consolidarPorPersona ─────────────────────────────────────────────────────
Deno.test("consolidarPorPersona — un solo recordatorio con el nivel más alto de la persona", () => {
  const base = { grupo_jid: "g1", grupo_nombre: "g", resumen: "r", fecha_mencionada: null, seguimiento_desde: "", vencido: false, porFechaLimite: false };
  const items = [
    { ...base, id: "a", responsable_id: "u1", nivel: 1 as const },
    { ...base, id: "b", responsable_id: "u1", nivel: 3 as const },
    { ...base, id: "c", responsable_id: "u2", nivel: 2 as const },
  ];
  const out = consolidarPorPersona(items);
  assertEquals(out.length, 2);
  const u1 = out.find((c) => c.usuarioId === "u1")!;
  assertEquals(u1.items.length, 2);
  assertEquals(u1.nivelMax, 3);
});

// ── consolidarEscalacionNivel3 ───────────────────────────────────────────────
Deno.test("consolidarEscalacionNivel3 — solo nivel 3, agrupado por grupo", () => {
  const base = { responsable_id: "u1", grupo_nombre: "g", resumen: "r", fecha_mencionada: null, seguimiento_desde: "", vencido: false, porFechaLimite: false };
  const items = [
    { ...base, id: "a", grupo_jid: "g1", nivel: 3 as const },
    { ...base, id: "b", grupo_jid: "g1", nivel: 1 as const },
    { ...base, id: "c", grupo_jid: "g2", nivel: 3 as const },
  ];
  const out = consolidarEscalacionNivel3(items);
  assertEquals(out.size, 2);
  assertEquals(out.get("g1")!.map((h) => h.id), ["a"]);
  assertEquals(out.get("g2")!.map((h) => h.id), ["c"]);
});

// ── dentroDeVentanaWhatsapp ──────────────────────────────────────────────────
Deno.test("dentroDeVentanaWhatsapp — 24h de Meta, sin plantilla", () => {
  const ahora = Date.now();
  assertEquals(dentroDeVentanaWhatsapp(new Date(ahora - 23 * 3_600_000).toISOString(), ahora), true);
  assertEquals(dentroDeVentanaWhatsapp(new Date(ahora - 25 * 3_600_000).toISOString(), ahora), false);
  assertEquals(dentroDeVentanaWhatsapp(null, ahora), false);
});

// ── dedupeKey ────────────────────────────────────────────────────────────────
Deno.test("dedupeKey — misma persona/fecha/canal da la misma clave (evita doble envío)", () => {
  assertEquals(dedupeKey("u1", "2026-11-10", "email"), dedupeKey("u1", "2026-11-10", "email"));
  assertEquals(dedupeKey("u1", "2026-11-10", "email") === dedupeKey("u1", "2026-11-10", "push"), false);
});

// ── Textos ───────────────────────────────────────────────────────────────────
Deno.test("construirCorreoRecordatorio — autocontenido, con aviso de IA", () => {
  const base = { id: "a", responsable_id: "u1", grupo_jid: "g1", grupo_nombre: "Torre Alpha", resumen: "Entregar listado", fecha_mencionada: null, seguimiento_desde: "", nivel: 1 as const, vencido: false, porFechaLimite: false };
  const { asunto, textoPlano } = construirCorreoRecordatorio([base]);
  assertEquals(asunto.includes("1 pendiente"), true);
  assertEquals(textoPlano.includes("Torre Alpha"), true);
  assertEquals(textoPlano.includes("Generado por IA"), true);
});

Deno.test("construirCorreoEscalacionNivel3 — menciona 72h y el grupo", () => {
  const base = { id: "a", responsable_id: "u1", grupo_jid: "g1", grupo_nombre: "Torre Alpha", resumen: "x", fecha_mencionada: null, seguimiento_desde: "", nivel: 3 as const, vencido: false, porFechaLimite: false };
  const { asunto } = construirCorreoEscalacionNivel3("Torre Alpha", [base]);
  assertEquals(asunto.includes("72h"), true);
  assertEquals(asunto.includes("Torre Alpha"), true);
});
