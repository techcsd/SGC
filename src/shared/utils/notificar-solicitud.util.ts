import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fire-and-forget email notification via the notificar-solicitud Edge
 * Function. Never throws — a notification failure (or RESEND_API_KEY not
 * being configured yet) must never block the real solicitud workflow.
 */
export function notificarSolicitud(
  client: SupabaseClient<any, any, any>,
  tipo: 'material' | 'compra',
  solicitudId: string,
  evento: 'creada' | 'aprobada' | 'rechazada',
): void {
  client.functions.invoke('notificar-solicitud', { body: { tipo, solicitudId, evento } }).catch((e) => {
    console.error('notificar-solicitud failed', e);
  });
}
