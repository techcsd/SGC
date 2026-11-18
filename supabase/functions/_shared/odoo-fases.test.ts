import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { adjuntarPdfAPicking, nombreAdjuntoConduce } from "./odoo-adjuntos.ts";
import { planificarApertura, validarCorte } from "./odoo-corte.ts";

const falso = (previos: unknown[]) => {
  const llamadas: Array<[string, string, unknown[]]> = [];
  return { llamadas, call: (m: string, f: string, a: unknown[] = []) => { llamadas.push([m, f, a]); return Promise.resolve(f === "search_read" ? previos : [77]); } };
};

Deno.test("adjunto del conduce: crea una vez y no duplica", async () => {
  const a = falso([]);
  assertEquals(await adjuntarPdfAPicking(a, 5, { nombre: nombreAdjuntoConduce("CND-ABC12345", "B"), base64: "JVBERi0xLjQ=" }), { id: 77, creado: true });
  assertEquals(a.llamadas.map((l) => l[1]), ["search_read", "create"]);
  const b = falso([{ id: 9 }]);
  assertEquals(await adjuntarPdfAPicking(b, 5, { nombre: "CND-ABC12345-B.pdf", base64: "JVBERi0xLjQ=" }), { id: 9, creado: false });
  assertEquals(b.llamadas.length, 1);
});
Deno.test("adjunto: rechaza PDF vacio y nombres raros", async () => {
  await assertRejects(() => adjuntarPdfAPicking(falso([]), 5, { nombre: "x.pdf", base64: "" }));
  await assertRejects(() => adjuntarPdfAPicking(falso([]), 5, { nombre: "../x.exe", base64: "JVBERi0xLjQ=" }));
});
Deno.test("apertura: delta SGC - Odoo, incluye productos solo en un lado", () => {
  assertEquals(planificarApertura([{ productId: 1, cantidad: 10 }, { productId: 2, cantidad: 5 }], [{ productId: 1, cantidad: 10 }, { productId: 3, cantidad: 4 }]),
    [{ productId: 2, delta: 5 }, { productId: 3, delta: -4 }]);
  assertEquals(planificarApertura([{ productId: 1, cantidad: 10 }], [{ productId: 1, cantidad: 10 }]), []);
});
Deno.test("corte: fecha futura y apertura desproporcionada se rechazan", () => {
  const sgc = [{ productId: 1, cantidad: 100 }];
  assertEquals(validarCorte("2026-12-01", "2026-11-16", [], sgc), "La fecha de corte no puede ser futura.");
  assertEquals(validarCorte("2026-11-15", "2026-11-16", [{ productId: 1, delta: 80 }], sgc)?.startsWith("La apertura ajusta"), true);
  assertEquals(validarCorte("2026-11-15", "2026-11-16", [{ productId: 1, delta: 5 }], sgc), null);
});
