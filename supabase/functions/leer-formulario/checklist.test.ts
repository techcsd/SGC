import { assertEquals } from "jsr:@std/assert";
import { validarRespuestasChecklist } from "./checklist.ts";

const ITEMS = [
  { id: "a1", etiqueta: "Frenos", es_critico: true },
  { id: "a2", etiqueta: "Luces delanteras", es_critico: false },
  { id: "a3", etiqueta: "Luces traseras", es_critico: false },
];

Deno.test("caso positivo: respuesta valida con comentario se conserva tal cual", () => {
  const out = validarRespuestasChecklist(
    [{ id: "a2", respuesta: "no", comentario: "El faro izquierdo no prende", confianza: 0.9 }],
    ITEMS,
  );
  assertEquals(out, [{ id: "a2", respuesta: "no", comentario: "El faro izquierdo no prende", confianza: 0.9 }]);
});

Deno.test("sin match (id inventado por el modelo) se descarta -- nunca inventa", () => {
  const out = validarRespuestasChecklist(
    [{ id: "no-existe-este-id", respuesta: "no", comentario: "algo", confianza: 0.8 }],
    ITEMS,
  );
  assertEquals(out, []);
});

Deno.test("respuesta ambigua (valor distinto de ok/no) se descarta", () => {
  const out = validarRespuestasChecklist(
    [{ id: "a2", respuesta: "tal_vez", comentario: null, confianza: 0.5 }],
    ITEMS,
  );
  assertEquals(out, []);
});

Deno.test("voz vacia -- arreglo vacio de respuestas crudas da arreglo vacio", () => {
  assertEquals(validarRespuestasChecklist([], ITEMS), []);
  assertEquals(validarRespuestasChecklist(undefined as unknown as unknown[], ITEMS), []);
});

Deno.test("item critico en NO sin comentario del modelo: nunca queda mudo", () => {
  const out = validarRespuestasChecklist(
    [{ id: "a1", respuesta: "no", comentario: null, confianza: 0.6 }],
    ITEMS,
  );
  assertEquals(out, [{ id: "a1", respuesta: "no", comentario: "Revisar — no se capturó el detalle.", confianza: 0.6 }]);
});

Deno.test("item NO critico en NO sin comentario: se deja null, no se inventa texto", () => {
  const out = validarRespuestasChecklist(
    [{ id: "a2", respuesta: "no", comentario: null, confianza: 0.6 }],
    ITEMS,
  );
  assertEquals(out, [{ id: "a2", respuesta: "no", comentario: null, confianza: 0.6 }]);
});

Deno.test("confianza no numerica cae a 0", () => {
  const out = validarRespuestasChecklist(
    [{ id: "a3", respuesta: "ok", comentario: null, confianza: "alta" }],
    ITEMS,
  );
  assertEquals(out[0].confianza, 0);
});
