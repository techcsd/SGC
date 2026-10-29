// DB6 — tests del resumidor (proveedor mockeado).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { construirPromptUsuario, parsearResumen } from "./resumidor.ts";

const CTX = {
  asunto: "ERROR AL REGISTRAR UNA HECHADA ANTERIOR",
  descripcion: "NECESITO QUE ME AYUDES CON EL PERMISO DE REGISTRAR UNA HECHADA ANTERIOR",
  tipo: "bug", estado: "en_progreso", creado: "2026-10-26",
  autor: { nombre: "Raykler Peña", roles: ["jefe_flota", "logistica"], modulos: ["flota", "inventario"] },
  fotos: 1,
  parecidos: [{ asunto: "Echada rechazada", respuesta_admin: "Corregido en v1.202.1", estado: "resuelto" }],
};

Deno.test("el prompt incluye autor, roles y los resueltos parecidos con su respuesta", () => {
  const p = construirPromptUsuario(CTX);
  assert(p.includes("Raykler Peña"));
  assert(p.includes("jefe_flota"));
  assert(p.includes("Corregido en v1.202.1"));
});

Deno.test("parsea un hotfix completo", () => {
  const r = parsearResumen(`{
    "resumen_ronda": "Flota › Combustible: Raykler (jefe de flota) no puede registrar una echada con fecha anterior.",
    "es_hotfix": true, "motivo": "Bloquea el registro diario de combustible.",
    "prompt_hotfix": "Repo SGC... rama feature/hotfix desde origin/dev..."
  }`)!;
  assertEquals(r.es_hotfix, true);
  assert(r.prompt_hotfix.includes("feature/"));
});

Deno.test("no-hotfix: prompt_hotfix queda null aunque el modelo mande texto", () => {
  const r = parsearResumen(`{"resumen_ronda":"Comentario de mejora.","es_hotfix":false,"motivo":"Es una sugerencia.","prompt_hotfix":"no debería venir"}`)!;
  assertEquals(r.es_hotfix, false);
  assertEquals(r.prompt_hotfix, null);
});

Deno.test("sin resumen_ronda → null (no se guarda basura)", () => {
  assertEquals(parsearResumen(`{"es_hotfix":true}`), null);
  assertEquals(parsearResumen("texto sin json"), null);
});
