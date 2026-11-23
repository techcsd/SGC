import { SupabaseClient } from '@supabase/supabase-js';

type Tipo = 'material' | 'compra';
type Evento = 'creada' | 'aprobada' | 'rechazada';

/** Espera entre el intento y su único reintento (permite que un worker frío arranque). */
export const ESPERA_REINTENTO_CORREO_MS = 1500;

/**
 * DX4 — resultado de UNA invocación a `notificar-solicitud`.
 * OJO: `functions.invoke` NO rechaza la promesa cuando la edge falla; devuelve `{ error }`.
 * El `.catch(console.error)` anterior era código muerto y todos los fallos eran mudos
 * (la requisición se guardaba, el correo no salía y nadie lo sabía).
 */
async function intentar(
  client: SupabaseClient<any, any, any>,
  tipo: Tipo,
  solicitudId: string,
  evento: Evento,
): Promise<{ ok: boolean; skipped?: boolean; motivo: string }> {
  try {
    const { data, error } = await client.functions.invoke('notificar-solicitud', { body: { tipo, solicitudId, evento } });
    if (error) {
      let motivo = (error as { message?: string }).message ?? 'error';
      try {
        const ctx = (error as { context?: Response }).context;
        const body = ctx && (await ctx.clone().json());
        if (body?.error_code) motivo = String(body.error_code);
      } catch { /* sin cuerpo legible: nos quedamos con el mensaje */ }
      return { ok: false, motivo: `edge:${motivo}`.slice(0, 200) };
    }
    const d = (data ?? {}) as { error?: string; error_code?: string; skipped?: boolean; reason?: string };
    if (d.error) return { ok: false, motivo: `edge:${d.error_code ?? d.error}`.slice(0, 200) };
    // `skipped` es legítimo (p. ej. «Sin destinatarios»): la edge ya lo trazó; no se reintenta.
    if (d.skipped) return { ok: true, skipped: true, motivo: d.error_code ?? d.reason ?? 'skipped' };
    return { ok: true, motivo: 'enviada' };
  } catch (e) {
    return { ok: false, motivo: `red:${e instanceof Error ? e.message : 'desconocido'}`.slice(0, 200) };
  }
}

/**
 * Notificación por correo vía la edge `notificar-solicitud`. Nunca lanza ni bloquea el
 * flujo de la solicitud, pero YA NO es muda: lee `{data, error}`; si hay fallo real
 * reintenta UNA vez y, si persiste, deja el rastro en `notif_entregas` (estado
 * `fallida`, visible para Tecnología en Pulso del sistema) vía `registrar_correo_fallido`.
 */
export function notificarSolicitud(
  client: SupabaseClient<any, any, any>,
  tipo: Tipo,
  solicitudId: string,
  evento: Evento,
): void {
  void notificarSolicitudAsync(client, tipo, solicitudId, evento);
}

/** Variante con promesa (tests y llamadores que quieran esperar el resultado). */
export async function notificarSolicitudAsync(
  client: SupabaseClient<any, any, any>,
  tipo: Tipo,
  solicitudId: string,
  evento: Evento,
  espera = ESPERA_REINTENTO_CORREO_MS,
): Promise<{ ok: boolean; intentos: number; motivo: string }> {
  let r = await intentar(client, tipo, solicitudId, evento);
  let intentos = 1;
  if (!r.ok) {
    console.error('notificar-solicitud falló, reintentando', r.motivo);
    if (espera > 0) await new Promise((res) => setTimeout(res, espera));
    r = await intentar(client, tipo, solicitudId, evento);
    intentos = 2;
  }
  if (!r.ok) {
    console.error('notificar-solicitud falló definitivamente', r.motivo);
    try {
      await client.rpc('registrar_correo_fallido', { p_tipo: tipo, p_solicitud_id: solicitudId, p_evento: evento, p_motivo: r.motivo });
    } catch { /* el rastro nunca rompe el flujo */ }
  }
  return { ok: r.ok, intentos, motivo: r.motivo };
}
