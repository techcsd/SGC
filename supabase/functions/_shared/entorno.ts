// _shared/entorno.ts — BU1 F2.3 — utilidades de entorno para las edge functions.
// En dev (ENTORNO=dev) el correo se REDIRIGE a NOTIF_REDIRECT_TO con prefijo
// `[DEV → destinatarios reales]` y el push queda apagado salvo tokens en
// PUSH_ALLOWLIST. En prod (ENTORNO ausente o 'prod') todo se comporta normal.
export const ENTORNO = Deno.env.get('ENTORNO') ?? 'prod';
export const esDev = (): boolean => ENTORNO !== 'prod';

/**
 * Ajusta destinatarios + asunto de un correo según el entorno.
 * En dev: manda SOLO a NOTIF_REDIRECT_TO y antepone `[DEV → a,b]` al asunto para
 * no perder a quién habría llegado. En prod: devuelve `to`/`subject` intactos.
 */
export function redirigirCorreo(to: string[] | string, subject: string): { to: string[]; subject: string } {
  const lista = Array.isArray(to) ? to : [to];
  if (!esDev()) return { to: lista, subject };
  const destino = Deno.env.get('NOTIF_REDIRECT_TO') ?? 'Tecnologia@constructorasd.com';
  const reales = lista.join(', ') || '(sin destinatarios)';
  return { to: [destino], subject: `[DEV → ${reales}] ${subject}` };
}

/**
 * Ajusta el CUERPO de un correo a Resend según el entorno. En dev: redirige a
 * NOTIF_REDIRECT_TO, borra `bcc`, y antepone `[DEV → destinatarios reales]` al
 * asunto (junta `to` + `bcc` para no perder a quién iba). En prod: pass-through.
 * Uso:  body: JSON.stringify(ajustarCorreoResend({ from, to, subject, html }))
 */
export function ajustarCorreoResend<T extends { to?: string | string[]; bcc?: string | string[]; subject: string }>(body: T): T {
  if (!esDev()) return body;
  const destino = Deno.env.get('NOTIF_REDIRECT_TO') ?? 'Tecnologia@constructorasd.com';
  const reales = [body.to, body.bcc].flat().filter(Boolean).join(', ') || '(sin destinatarios)';
  return { ...body, to: [destino], bcc: undefined, subject: `[DEV → ${reales}] ${body.subject}` };
}

/** ¿Se puede mandar push a este token? En dev solo si está en PUSH_ALLOWLIST. */
export function puedeEnviarPush(token: string): boolean {
  if (!esDev()) return true;
  const allow = (Deno.env.get('PUSH_ALLOWLIST') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allow.includes(token);
}

/** Para edges que NO deben tocar servicios externos en dev (check-domains, etc.). */
export function bloquearExternoEnDev(nombre: string): boolean {
  if (esDev()) { console.log(`[DEV] ${nombre}: omitido (sin llamadas externas en dev)`); return true; }
  return false;
}
