// DS-34/#74 — token del QR del conduce: `<salidaId>.<expEpochSeg>.<firma>`.
// La firma es HMAC-SHA256(secret, "<salidaId>.<exp>") en base64url. El token NO da acceso a datos: solo
// identifica el conduce; quien lo escanea debe estar autenticado y la RLS / RPCs de recepción deciden lo demás.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secreto: string, mensaje: string): Promise<string> {
  const llave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(mensaje))));
}

/** Comparación en tiempo constante (longitudes iguales o falla). */
function igualesCT(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function firmarTokenConduce(secreto: string, salidaId: string, expEpochSeg: number): Promise<string> {
  if (!secreto) throw new Error("secreto vacío");
  if (!UUID_RE.test(salidaId)) throw new Error("id de conduce inválido");
  const cuerpo = `${salidaId}.${Math.floor(expEpochSeg)}`;
  return `${cuerpo}.${await hmac(secreto, cuerpo)}`;
}

export type ResultadoToken =
  | { ok: true; salidaId: string; exp: number }
  | { ok: false; motivo: "formato" | "firma" | "vencido" };

export async function verificarTokenConduce(secreto: string, token: string, ahoraEpochSeg: number): Promise<ResultadoToken> {
  const partes = String(token ?? "").split(".");
  if (partes.length !== 3) return { ok: false, motivo: "formato" };
  const [salidaId, expTxt, firma] = partes;
  const exp = Number(expTxt);
  if (!UUID_RE.test(salidaId) || !Number.isInteger(exp)) return { ok: false, motivo: "formato" };
  const esperada = await hmac(secreto, `${salidaId}.${exp}`);
  if (!igualesCT(esperada, firma)) return { ok: false, motivo: "firma" };
  if (exp < ahoraEpochSeg) return { ok: false, motivo: "vencido" };
  return { ok: true, salidaId, exp };
}
