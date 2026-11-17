import { assertEquals } from "jsr:@std/assert@1";
import { autorizadoWorker } from "./odoo-sync-auth.ts";

const base = { syncSecret: "s1", infraSecret: "i1", serviceKey: "sk" };
Deno.test("worker: sin credenciales falla cerrado", () => {
  assertEquals(autorizadoWorker({ secretHeader: null, authHeader: null, ...base }), false);
  assertEquals(autorizadoWorker({ secretHeader: null, authHeader: null }), false);
});
Deno.test("worker: secreto propio o de infra (cron) entran; uno ajeno no", () => {
  assertEquals(autorizadoWorker({ secretHeader: "s1", authHeader: null, ...base }), true);
  assertEquals(autorizadoWorker({ secretHeader: "i1", authHeader: null, ...base }), true);
  assertEquals(autorizadoWorker({ secretHeader: "x", authHeader: null, ...base }), false);
});
Deno.test("worker: secreto no configurado nunca coincide con una cabecera vacia", () => {
  assertEquals(autorizadoWorker({ secretHeader: "", authHeader: null, syncSecret: "", infraSecret: "" }), false);
  assertEquals(autorizadoWorker({ secretHeader: "undefined", authHeader: null, syncSecret: undefined, infraSecret: null }), false);
});
Deno.test("worker: solo el bearer de service_role entra (no el JWT de un usuario)", () => {
  assertEquals(autorizadoWorker({ secretHeader: null, authHeader: "Bearer sk", ...base }), true);
  assertEquals(autorizadoWorker({ secretHeader: null, authHeader: "Bearer jwt-de-usuario", ...base }), false);
  assertEquals(autorizadoWorker({ secretHeader: null, authHeader: "Bearer sk", syncSecret: "s1" }), false);
});
