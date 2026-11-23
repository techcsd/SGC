// DX7: token genérico por tipo. UUID ficticio, secreto ficticio.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { firmarTokenDoc, TIPOS_DOC_QR, verificarTokenDoc } from "./doc-qr.ts";
import { firmarTokenConduce } from "./conduce-qr.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const SEC = "secreto-de-prueba";

Deno.test("requisición: emitir → verificar devuelve {tipo,id}", async () => {
  const t = await firmarTokenDoc(SEC, "requisicion", ID, 2000);
  assertEquals(t.split(".").length, 4);
  assertEquals(await verificarTokenDoc(SEC, t, 1000), { ok: true, tipo: "requisicion", id: ID, exp: 2000 });
});

Deno.test("token LEGADO de conduce (3 partes) sigue funcionando como tipo conduce", async () => {
  const legado = await firmarTokenConduce(SEC, ID, 2000);
  assertEquals(await verificarTokenDoc(SEC, legado, 1000), { ok: true, tipo: "conduce", id: ID, exp: 2000 });
  assertEquals(await firmarTokenDoc(SEC, "conduce", ID, 2000), legado);
});

Deno.test("vencido, secreto distinto y token alterado se rechazan", async () => {
  const t = await firmarTokenDoc(SEC, "requisicion", ID, 1000);
  assertEquals(await verificarTokenDoc(SEC, t, 1001), { ok: false, motivo: "vencido" });
  assertEquals(await verificarTokenDoc("otro", t, 500), { ok: false, motivo: "firma" });
  const otroId = t.replace(ID, "11111111-2222-3333-4444-555555555556");
  assertEquals(await verificarTokenDoc(SEC, otroId, 500), { ok: false, motivo: "firma" });
  const [, i, e, f] = t.split(".");
  // cambiar el TIPO invalida la firma (un token de requisición no sirve como conduce, ni viceversa)
  assertEquals(await verificarTokenDoc(SEC, `conduce.${i}.${e}.${f}`, 500), { ok: false, motivo: "formato" });
  assertEquals(await verificarTokenDoc(SEC, `foo.${i}.${e}.${f}`, 500), { ok: false, motivo: "formato" });
});

Deno.test("basura y partes de más → formato", async () => {
  for (const x of ["", "a.b", "a.b.c.d.e", "requisicion.no-uuid.1.x"]) {
    assertEquals((await verificarTokenDoc(SEC, x, 1)).ok, false);
  }
  await assertRejects(() => firmarTokenDoc("", "requisicion", ID, 1));
  await assertRejects(() => firmarTokenDoc(SEC, "requisicion", "no-uuid", 1));
});

Deno.test("cada tipo tiene tabla, ruta e interruptor propios", () => {
  assertEquals(TIPOS_DOC_QR.requisicion.ruta(ID), `/inventario/requisiciones?req=${ID}`);
  assertEquals(TIPOS_DOC_QR.requisicion.claveActivo, "doc_qr_requisicion_activo");
  assertEquals(TIPOS_DOC_QR.conduce.ruta(ID), `/conduce-recibir/${ID}`);
});
