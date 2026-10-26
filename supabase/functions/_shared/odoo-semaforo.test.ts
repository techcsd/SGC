import { assertEquals } from "jsr:@std/assert@1";
import { SemaforoOdoo } from "./odoo-semaforo.ts";

Deno.test("deja pasar hasta el máximo y rechaza después", () => {
  const s = new SemaforoOdoo(2);
  assertEquals(s.intentar(), true);
  assertEquals(s.intentar(), true);
  assertEquals(s.intentar(), false); // ya hay 2 en curso
  assertEquals(s.ocupados, 2);
});

Deno.test("liberar abre cupo de nuevo", () => {
  const s = new SemaforoOdoo(1);
  assertEquals(s.intentar(), true);
  assertEquals(s.intentar(), false);
  s.liberar();
  assertEquals(s.ocupados, 0);
  assertEquals(s.intentar(), true);
});

Deno.test("liberar de más no baja de 0", () => {
  const s = new SemaforoOdoo(1);
  s.liberar();
  s.liberar();
  assertEquals(s.ocupados, 0);
});
