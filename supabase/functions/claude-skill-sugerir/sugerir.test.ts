// DO-10(e) — tests del sugeridor de contenido de skill (proveedor mockeado:
// se prueba la lógica pura — construcción del prompt y parseo de la respuesta).
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { construirPromptSugerir, parsearSugerencia } from "./sugerir.ts";

Deno.test("construirPromptSugerir: incluye rol, qué hace, cuándo usarla y las skills visibles", () => {
  const p = construirPromptSugerir({
    queHace: "Resume un reporte de obra", cuandoUsarla: "Al cerrar el día",
    roles: ["ingeniero_campo"],
    skillsVisibles: [{ nombre: "Resumir documento", descripcion: "Resume un texto largo." }],
  });
  assertStringIncludes(p, "ingeniero_campo");
  assertStringIncludes(p, "Resume un reporte de obra");
  assertStringIncludes(p, "Al cerrar el día");
  assertStringIncludes(p, "Resumir documento");
});

// Riesgo DO-10.7: el prompt NUNCA debe incluir nombres de personas — solo
// nombre/descripción de skills (dato no personal) y códigos de rol.
Deno.test("construirPromptSugerir: no incluye nombres de personas, solo skills y roles", () => {
  const p = construirPromptSugerir({
    queHace: "x", cuandoUsarla: "y", roles: ["logistica"],
    skillsVisibles: [{ nombre: "Pedir bien a la IA", descripcion: "Guía de redacción." }],
  });
  // No hay ningún campo de "autor"/"nombre de usuario" en el shape de entrada —
  // verificamos que el prompt resultante no trae más que lo que le dimos.
  assertStringIncludes(p, "Pedir bien a la IA");
  assertEquals(p.includes("owner"), false);
  assertEquals(p.includes("autor"), false);
});

Deno.test("construirPromptSugerir: sin skills visibles, lo dice explícitamente", () => {
  const p = construirPromptSugerir({ queHace: "x", cuandoUsarla: "y", roles: [], skillsVisibles: [] });
  assertStringIncludes(p, "(ninguna todavía)");
  assertStringIncludes(p, "sin rol específico");
});

Deno.test("parsearSugerencia: respuesta válida con texto alrededor del JSON", () => {
  const r = parsearSugerencia(`Aquí tienes:\n{ "pasos": "1. Lee el texto.\\n2. Resume.", "ejemplo": "Usuario: resume esto..." }`);
  assertEquals(r?.pasos, "1. Lee el texto.\n2. Resume.");
  assertStringIncludes(r?.ejemplo ?? "", "resume esto");
});

Deno.test("parsearSugerencia: sin texto extraíble devuelve null", () => {
  assertEquals(parsearSugerencia("No se pudo generar nada útil."), null);
});

Deno.test("parsearSugerencia: JSON corrupto devuelve null", () => {
  assertEquals(parsearSugerencia(`{ "pasos": "incompleto`), null);
});
