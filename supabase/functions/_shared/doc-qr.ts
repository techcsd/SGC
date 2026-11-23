// DX7 — QR genérico por tipo de documento. Token: `<tipo>.<id>.<expEpochSeg>.<firma>` con
// firma = HMAC-SHA256(secret, "<tipo>.<id>.<exp>") en base64url. El token NO otorga permisos ni lleva datos
// personales: solo identifica {tipo,id}; quien lo escanea debe estar autenticado y la RLS/RPCs deciden.
// Compatibilidad: el token LEGADO del conduce (`<uuid>.<exp>.<firma>`, 3 partes) se sigue aceptando
// (QR ya impresos/enviados) y se trata como tipo `conduce`.
import { firmarTokenConduce, verificarTokenConduce } from "./conduce-qr.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TipoDocQr = "conduce" | "requisicion" | "solicitud_compra" | "conduce_externo";

export interface ConfigTipoDocQr {
  /** tabla (schema sgc) donde debe existir el documento y desde la que se valida la visibilidad al emitir. */
  tabla: string;
  /** ruta de la app a la que lleva el QR (sin origen). */
  ruta: (id: string) => string;
  /** clave en sgc.parametros del interruptor del tipo. */
  claveActivo: string;
  /** vigencia por defecto en días (el parámetro `doc_qr_vigencia_dias` puede acortarla/alargarla). */
  vigenciaDias: number;
}

export const TIPOS_DOC_QR: Record<TipoDocQr, ConfigTipoDocQr> = {
  conduce: { tabla: "salidas_inventario", ruta: (id) => `/conduce-recibir/${id}`, claveActivo: "conduce_qr_activo", vigenciaDias: 30 },
  // Requisición → su detalle (deep-link `?req=` que ya abre el drawer); ahí ven/aprueban según su rol.
  requisicion: { tabla: "solicitudes_material", ruta: (id) => `/inventario/requisiciones?req=${id}`, claveActivo: "doc_qr_requisicion_activo", vigenciaDias: 7 },
  // Solicitud de compra → su atención en Compras › Órdenes (deep-link `?solicitud=`); el guard del submódulo decide el acceso.
  solicitud_compra: { tabla: "solicitudes_compra", ruta: (id) => `/compras/ordenes?solicitud=${id}`, claveActivo: "doc_qr_solicitud_compra_activo", vigenciaDias: 7 },
  // Conduce externo → su ficha (Inventario › Conduces externos); el guard del submódulo inventario.salidas decide el acceso.
  conduce_externo: { tabla: "conduces_externos", ruta: (id) => `/inventario/conduces-externos/${id}`, claveActivo: "doc_qr_conduce_externo_activo", vigenciaDias: 30 },
};

export const esTipoDocQr = (t: unknown): t is TipoDocQr => typeof t === "string" && Object.hasOwn(TIPOS_DOC_QR, t);

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secreto: string, mensaje: string): Promise<string> {
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(mensaje))));
}

function igualesCT(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function firmarTokenDoc(secreto: string, tipo: TipoDocQr, id: string, expEpochSeg: number): Promise<string> {
  if (!secreto) throw new Error("secreto vacío");
  if (!esTipoDocQr(tipo)) throw new Error("tipo de documento inválido");
  if (!UUID_RE.test(id)) throw new Error("id inválido");
  // El conduce mantiene su formato original para no invalidar nada.
  if (tipo === "conduce") return firmarTokenConduce(secreto, id, expEpochSeg);
  const cuerpo = `${tipo}.${id}.${Math.floor(expEpochSeg)}`;
  return `${cuerpo}.${await hmac(secreto, cuerpo)}`;
}

export type ResultadoTokenDoc =
  | { ok: true; tipo: TipoDocQr; id: string; exp: number }
  | { ok: false; motivo: "formato" | "firma" | "vencido" };

export async function verificarTokenDoc(secreto: string, token: string, ahoraEpochSeg: number): Promise<ResultadoTokenDoc> {
  const partes = String(token ?? "").split(".");
  if (partes.length === 3) {
    const r = await verificarTokenConduce(secreto, token, ahoraEpochSeg);
    return r.ok ? { ok: true, tipo: "conduce", id: r.salidaId, exp: r.exp } : r;
  }
  if (partes.length !== 4) return { ok: false, motivo: "formato" };
  const [tipo, id, expTxt, firma] = partes;
  const exp = Number(expTxt);
  if (!esTipoDocQr(tipo) || tipo === "conduce" || !UUID_RE.test(id) || !Number.isInteger(exp)) return { ok: false, motivo: "formato" };
  if (!igualesCT(await hmac(secreto, `${tipo}.${id}.${exp}`), firma)) return { ok: false, motivo: "firma" };
  if (exp < ahoraEpochSeg) return { ok: false, motivo: "vencido" };
  return { ok: true, tipo, id, exp };
}
