import { assertEquals } from "jsr:@std/assert@1";
import { CircuitoOdoo } from "./odoo-circuito.ts";

Deno.test("cerrado: deja pasar y permanece cerrado con éxitos", () => {
  const c = new CircuitoOdoo(3, 1000);
  for (let i = 0; i < 10; i++) {
    assertEquals(c.puedeIntentar(), true);
    c.registrarExito();
  }
  assertEquals(c.estadoActual, "cerrado");
});

Deno.test("abre tras el umbral de fallos consecutivos", () => {
  const c = new CircuitoOdoo(3, 1000);
  c.registrarFallo();
  c.registrarFallo();
  assertEquals(c.estadoActual, "cerrado"); // aún no llega al umbral
  c.registrarFallo();
  assertEquals(c.estadoActual, "abierto");
  assertEquals(c.puedeIntentar(), false); // mientras está abierto, falla rápido
});

Deno.test("medio-abierto tras el enfriamiento, una sola prueba a la vez", () => {
  let t = 0;
  const c = new CircuitoOdoo(1, 1000, () => t);
  c.registrarFallo(); // abre (umbral=1)
  assertEquals(c.estadoActual, "abierto");
  assertEquals(c.puedeIntentar(), false); // aún dentro del enfriamiento

  t = 1000; // pasó el enfriamiento
  assertEquals(c.puedeIntentar(), true); // primera prueba: pasa a medio-abierto
  assertEquals(c.estadoActual, "medio_abierto");
  assertEquals(c.puedeIntentar(), false); // una segunda prueba concurrente NO pasa
});

Deno.test("medio-abierto + éxito -> cierra", () => {
  let t = 0;
  const c = new CircuitoOdoo(1, 1000, () => t);
  c.registrarFallo();
  t = 1000;
  assertEquals(c.puedeIntentar(), true);
  c.registrarExito();
  assertEquals(c.estadoActual, "cerrado");
  assertEquals(c.puedeIntentar(), true);
});

Deno.test("medio-abierto + fallo -> vuelve a abrir con nuevo enfriamiento", () => {
  let t = 0;
  const c = new CircuitoOdoo(1, 1000, () => t);
  c.registrarFallo();
  t = 1000;
  assertEquals(c.puedeIntentar(), true); // medio-abierto
  c.registrarFallo();
  assertEquals(c.estadoActual, "abierto");
  assertEquals(c.puedeIntentar(), false); // dentro del nuevo enfriamiento
  t = 1999;
  assertEquals(c.puedeIntentar(), false);
  t = 2000;
  assertEquals(c.puedeIntentar(), true);
});
