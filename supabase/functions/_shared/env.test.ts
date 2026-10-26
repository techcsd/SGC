import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { envRequerido } from "./env.ts";

Deno.test("devuelve el valor si existe", () => {
  Deno.env.set("CY21_SMOKE_VAR", "valor");
  assertEquals(envRequerido("CY21_SMOKE_VAR"), "valor");
  Deno.env.delete("CY21_SMOKE_VAR");
});

Deno.test("lanza con mensaje claro si falta", () => {
  Deno.env.delete("CY21_SMOKE_VAR_FALTANTE");
  assertThrows(() => envRequerido("CY21_SMOKE_VAR_FALTANTE"), Error, "CY21_SMOKE_VAR_FALTANTE");
});

Deno.test("lanza si está vacía", () => {
  Deno.env.set("CY21_SMOKE_VAR_VACIA", "");
  assertThrows(() => envRequerido("CY21_SMOKE_VAR_VACIA"), Error);
  Deno.env.delete("CY21_SMOKE_VAR_VACIA");
});
