// DS-34: token HMAC del QR del conduce. UUID ficticio, secreto ficticio.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { firmarTokenConduce, verificarTokenConduce } from "./conduce-qr.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const SEC = "secreto-de-prueba";

Deno.test("token válido verifica y devuelve el id", async () => {
  const t = await firmarTokenConduce(SEC, ID, 2000);
  assertEquals(await verificarTokenConduce(SEC, t, 1000), { ok: true, salidaId: ID, exp: 2000 });
});

Deno.test("token vencido se rechaza", async () => {
  const t = await firmarTokenConduce(SEC, ID, 1000);
  assertEquals(await verificarTokenConduce(SEC, t, 1001), { ok: false, motivo: "vencido" });
});

Deno.test("firma manipulada o secreto distinto se rechaza", async () => {
  const t = await firmarTokenConduce(SEC, ID, 2000);
  assertEquals(await verificarTokenConduce("otro", t, 1000), { ok: false, motivo: "firma" });
  const [a, , c] = t.split(".");
  assertEquals(await verificarTokenConduce(SEC, `${a}.9999999999.${c}`, 1000), { ok: false, motivo: "firma" });
});

Deno.test("cambiar el id del conduce invalida la firma", async () => {
  const t = await firmarTokenConduce(SEC, ID, 2000);
  const otro = t.replace(ID, "11111111-2222-3333-4444-555555555556");
  assertEquals(await verificarTokenConduce(SEC, otro, 1000), { ok: false, motivo: "firma" });
});

Deno.test("formato inválido", async () => {
  assertEquals(await verificarTokenConduce(SEC, "basura", 1), { ok: false, motivo: "formato" });
  assertEquals(await verificarTokenConduce(SEC, "x.y.z", 1), { ok: false, motivo: "formato" });
  await assertRejects(() => firmarTokenConduce("", ID, 1));
  await assertRejects(() => firmarTokenConduce(SEC, "no-uuid", 1));
});
