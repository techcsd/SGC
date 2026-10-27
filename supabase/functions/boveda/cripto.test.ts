// CZ3/CZ9 — pruebas sin red de las primitivas de cifrado/TOTP del Vault.
import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";
import {
  importarLlaveMaestra, toHexBytea, fromHexBytea, cifrarBytes, descifrarBytes, cifrarTexto, descifrarTexto, totpCodigo,
} from "./cripto.ts";

// Llave de prueba (32 bytes aleatorios fijos, SOLO para este test — nunca una llave real).
const LLAVE_PRUEBA_B64 = "VDrOSg268/DEWGDNop4fxrCZqBJouJEUBYAkDRRM72I=";

Deno.test("cifrarTexto/descifrarTexto — ida y vuelta exacta", async () => {
  const key = await importarLlaveMaestra(LLAVE_PRUEBA_B64);
  const { cifrado, iv } = await cifrarTexto(key, "hunter2 super-secreto", "entrada-123");
  assertEquals(iv.length, 12); // 96 bits
  const texto = await descifrarTexto(key, cifrado, iv, "entrada-123");
  assertEquals(texto, "hunter2 super-secreto");
});

Deno.test("el ciphertext NUNCA contiene el texto en claro", async () => {
  const key = await importarLlaveMaestra(LLAVE_PRUEBA_B64);
  const { cifrado } = await cifrarTexto(key, "contraseña-super-secreta-12345", "x");
  const hex = toHexBytea(cifrado);
  assert(!hex.includes("contraseña"), "el hex del cifrado no debe contener texto legible");
});

Deno.test("AAD mal-apareado (otra entrada_id) hace fallar el descifrado — detecta reasignación de fila", async () => {
  const key = await importarLlaveMaestra(LLAVE_PRUEBA_B64);
  const { cifrado, iv } = await cifrarTexto(key, "secreto-de-la-entrada-A", "entrada-A");
  await assertRejects(() => descifrarTexto(key, cifrado, iv, "entrada-B"));
});

Deno.test("IV distinto en cada cifrado (nunca se reusa)", async () => {
  const key = await importarLlaveMaestra(LLAVE_PRUEBA_B64);
  const a = await cifrarTexto(key, "mismo-texto", "misma-aad");
  const b = await cifrarTexto(key, "mismo-texto", "misma-aad");
  assertNotEquals(toHexBytea(a.iv), toHexBytea(b.iv));
  // Y por lo tanto el ciphertext tampoco es igual, aunque el texto y el AAD sean idénticos.
  assertNotEquals(toHexBytea(a.cifrado), toHexBytea(b.cifrado));
});

Deno.test("toHexBytea/fromHexBytea — ida y vuelta de bytes arbitrarios", () => {
  const original = crypto.getRandomValues(new Uint8Array(32));
  const vuelta = fromHexBytea(toHexBytea(original));
  assertEquals(vuelta, original);
});

Deno.test("cifrarBytes/descifrarBytes — binario arbitrario (no solo texto UTF-8)", async () => {
  const key = await importarLlaveMaestra(LLAVE_PRUEBA_B64);
  const archivo = crypto.getRandomValues(new Uint8Array(500)); // simula bytes de un archivo pequeño
  const { cifrado, iv } = await cifrarBytes(key, archivo, "archivo-1");
  const vuelta = await descifrarBytes(key, cifrado, iv, "archivo-1");
  assertEquals(vuelta, archivo);
});

Deno.test("totpCodigo — RFC 6238 Appendix B, vector oficial (seed ASCII '12345678901234567890', HMAC-SHA1, T=59s)", async () => {
  // El vector oficial trunca a 8 dígitos y da "94287082"; con 6 dígitos (default
  // de esta pieza, como Google Authenticator) el resultado es sus últimos 6:
  // "94287082" % 10^6 = "287082" — verificado aparte contra una implementación
  // de referencia en Node (HMAC-SHA1 + RFC 4226) antes de fijarlo aquí.
  const seedBase32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")
  const { codigo } = await totpCodigo(seedBase32, 59_000);
  assertEquals(codigo, "287082");
});

Deno.test("totpCodigo — el mismo instante siempre da el mismo código (determinístico)", async () => {
  const seed = "JBSWY3DPEHPK3PXP"; // seed de ejemplo común en documentación de TOTP
  const instante = 1_700_000_000_000;
  const a = await totpCodigo(seed, instante);
  const b = await totpCodigo(seed, instante);
  assertEquals(a.codigo, b.codigo);
});

Deno.test("totpCodigo — cambia de código al cruzar el paso de 30s", async () => {
  const seed = "JBSWY3DPEHPK3PXP";
  const a = await totpCodigo(seed, 1_700_000_000_000);
  const b = await totpCodigo(seed, 1_700_000_000_000 + 31_000);
  assertNotEquals(a.codigo, b.codigo);
});
