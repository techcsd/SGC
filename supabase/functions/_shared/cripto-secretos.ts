// DA6 (ronda DA, 27-oct-2026) — primitivas de cifrado COMPARTIDAS, extraídas de
// `supabase/functions/boveda/cripto.ts` (CZ3/CZ9) para que una segunda edge
// (`equipos-clave`) pueda cifrar/descifrar con la MISMA llave maestra
// (`BOVEDA_MASTER_KEY`, una sola por entorno) sin depender del Vault ni de su
// tabla. AES-256-GCM (WebCrypto), IV de 96 bits, AAD = id de la fila (evita que
// un ciphertext se reasigne a otra fila sin que falle el tag de autenticación).
//
// `boveda/cripto.ts` NO se tocó (ya en producción pendiente de OK de Xaviel);
// queda documentado aquí como candidato a refactor futuro para que ambas edges
// importen de un solo lugar.

export async function importarLlaveMaestra(base64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function toHexBytea(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function fromHexBytea(hex: string): Uint8Array {
  const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export async function cifrarBytes(key: CryptoKey, bytes: Uint8Array, aad: string): Promise<{ cifrado: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aadBytes = new TextEncoder().encode(aad);
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadBytes }, key, bytes);
  return { cifrado: new Uint8Array(buf), iv };
}
export async function descifrarBytes(key: CryptoKey, cifrado: Uint8Array, iv: Uint8Array, aad: string): Promise<Uint8Array> {
  const aadBytes = new TextEncoder().encode(aad);
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aadBytes }, key, cifrado);
  return new Uint8Array(buf);
}
export async function cifrarTexto(key: CryptoKey, texto: string, aad: string) {
  return cifrarBytes(key, new TextEncoder().encode(texto), aad);
}
export async function descifrarTexto(key: CryptoKey, cifrado: Uint8Array, iv: Uint8Array, aad: string): Promise<string> {
  return new TextDecoder().decode(await descifrarBytes(key, cifrado, iv, aad));
}
