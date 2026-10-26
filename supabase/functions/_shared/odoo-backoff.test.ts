import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { conReintentoLectura } from "./odoo-backoff.ts";
import { OdooError } from "./odoo-client.ts";

const sinEspera = async (_ms: number) => {}; // test determinístico, sin tiempo real
const azarFijo = () => 0;

Deno.test("éxito al primer intento: no reintenta", async () => {
  let llamadas = 0;
  const r = await conReintentoLectura(async () => { llamadas++; return "ok"; }, { dormir: sinEspera, azar: azarFijo });
  assertEquals(r, "ok");
  assertEquals(llamadas, 1);
});

Deno.test("odoo_timeout se reintenta y puede recuperarse", async () => {
  let llamadas = 0;
  const r = await conReintentoLectura(async () => {
    llamadas++;
    if (llamadas < 3) throw new OdooError("odoo_timeout", "no respondió");
    return "ok";
  }, { intentos: 3, dormir: sinEspera, azar: azarFijo });
  assertEquals(r, "ok");
  assertEquals(llamadas, 3);
});

Deno.test("agota los intentos y propaga el último error", async () => {
  let llamadas = 0;
  await assertRejects(
    () => conReintentoLectura(async () => { llamadas++; throw new OdooError("odoo_no_disponible", "caído"); }, { intentos: 3, dormir: sinEspera, azar: azarFijo }),
    OdooError,
  );
  assertEquals(llamadas, 3);
});

Deno.test("errores NO reintentables (auth/config/negocio) fallan en el primer intento", async () => {
  let llamadas = 0;
  await assertRejects(
    () => conReintentoLectura(async () => { llamadas++; throw new OdooError("odoo_auth", "credenciales"); }, { intentos: 3, dormir: sinEspera, azar: azarFijo }),
    OdooError,
  );
  assertEquals(llamadas, 1);
});

Deno.test("errores que no son OdooError tampoco se reintentan", async () => {
  let llamadas = 0;
  await assertRejects(
    () => conReintentoLectura(async () => { llamadas++; throw new Error("boom"); }, { intentos: 3, dormir: sinEspera, azar: azarFijo }),
    Error,
    "boom",
  );
  assertEquals(llamadas, 1);
});

Deno.test("el tiempo de espera crece exponencialmente (con jitter)", async () => {
  const esperas: number[] = [];
  let llamadas = 0;
  await assertRejects(() =>
    conReintentoLectura(async () => { llamadas++; throw new OdooError("odoo_timeout", "x"); }, {
      intentos: 4, baseMs: 100, azar: () => 0, dormir: async (ms) => { esperas.push(ms); },
    })
  );
  assertEquals(esperas, [100, 200, 400]); // 2^0, 2^1, 2^2 * baseMs, sin jitter (azar=0)
});
