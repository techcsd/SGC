import { assertEquals } from "jsr:@std/assert@1";
import { enlacePropuestaParte, filtrarToolsParteVoz, parteVozActivo, TOOL_PARTE_VOZ, validarArgsParte } from "./parte-voz.ts";

Deno.test("interruptor: apagado salvo 'true' explícito", () => {
  assertEquals(parteVozActivo(undefined), false);
  assertEquals(parteVozActivo(null), false);
  assertEquals(parteVozActivo(""), false);
  assertEquals(parteVozActivo("false"), false);
  assertEquals(parteVozActivo("1"), false);
  assertEquals(parteVozActivo(" TRUE "), true);
});

Deno.test("la herramienta se quita con el interruptor apagado y no toca las demás", () => {
  const tools = [{ name: "mis_tareas" }, { name: TOOL_PARTE_VOZ }, { name: "proponer_bitacora" }];
  assertEquals(filtrarToolsParteVoz(tools, false).map((t) => t.name), ["mis_tareas", "proponer_bitacora"]);
  assertEquals(filtrarToolsParteVoz(tools, true).length, 3);
});

Deno.test("enlace: solo con uuid válido y sin doble barra", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  assertEquals(enlacePropuestaParte("https://x.test/", id), `https://x.test/bitacora/nueva?propuesta=${id}`);
  assertEquals(enlacePropuestaParte("https://x.test", "no-es-uuid"), null);
  assertEquals(enlacePropuestaParte("https://x.test", id + "&x=1"), null);
});

Deno.test("argumentos: exige obra y transcripción, fecha por defecto hoy", () => {
  assertEquals(validarArgsParte({ proyecto_id: "p", transcripcion: "hoy vaciamos la losa del segundo nivel" }, "2026-11-16"),
    { ok: true, proyecto_id: "p", fecha: "2026-11-16", transcripcion: "hoy vaciamos la losa del segundo nivel" });
  assertEquals(validarArgsParte({ transcripcion: "hoy vaciamos la losa" }, "2026-11-16").ok, false);
  assertEquals(validarArgsParte({ proyecto_id: "p", transcripcion: "corto" }, "2026-11-16").ok, false);
  assertEquals(validarArgsParte({ proyecto_id: "p", transcripcion: "hoy vaciamos la losa", fecha: "ayer" }, "2026-11-16").ok, false);
});
