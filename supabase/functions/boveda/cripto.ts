// CZ3/CZ9 — primitivas de cifrado del Vault, aisladas de index.ts para poder
// probarlas sin red (deno test). AES-256-GCM (WebCrypto), IV de 96 bits, AAD =
// id de la entrada (evita que un ciphertext se reasigne a otra fila sin que
// falle el tag de autenticación). TOTP: RFC 6238 (HMAC-SHA1, 30s, 6 dígitos).

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

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

export async function totpCodigo(seedBase32: string, instanteMs = Date.now(), paso = 30, digitos = 6): Promise<{ codigo: string; segundosRestantes: number }> {
  const seedBytes = base32Decode(seedBase32);
  const key = await crypto.subtle.importKey("raw", seedBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const ahora = Math.floor(instanteMs / 1000);
  const contador = Math.floor(ahora / paso);
  const contadorBytes = new Uint8Array(8);
  let c = BigInt(contador);
  for (let i = 7; i >= 0; i--) { contadorBytes[i] = Number(c & 0xffn); c >>= 8n; }
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, contadorBytes));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const codigo = (binCode % 10 ** digitos).toString().padStart(digitos, "0");
  return { codigo, segundosRestantes: paso - (ahora % paso) };
}
