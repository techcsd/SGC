import { describe, it, expect, vi } from 'vitest';
import { notificarSolicitudAsync } from './notificar-solicitud.util';

const cliente = (respuestas: Array<{ data?: unknown; error?: unknown }>) => {
  const invoke = vi.fn();
  respuestas.forEach((r) => invoke.mockResolvedValueOnce({ data: r.data ?? null, error: r.error ?? null }));
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { client: { functions: { invoke }, rpc } as never, invoke, rpc };
};

describe('notificarSolicitudAsync (DX4)', () => {
  it('éxito: un solo intento, sin rastro de fallo', async () => {
    const { client, invoke, rpc } = cliente([{ data: { sent: true } }]);
    const r = await notificarSolicitudAsync(client, 'material', 's1', 'creada', 0);
    expect(r).toMatchObject({ ok: true, intentos: 1 });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('{ error } de invoke (que NO rechaza) → reintenta una vez', async () => {
    const { client, invoke } = cliente([{ error: new Error('boom') }, { data: { sent: true } }]);
    const r = await notificarSolicitudAsync(client, 'material', 's1', 'creada', 0);
    expect(r).toMatchObject({ ok: true, intentos: 2 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('data.error persistente → registra el fallo en notif_entregas vía RPC', async () => {
    const { client, rpc } = cliente([{ data: { error: 'Resend error', error_code: 'resend_error' } }, { data: { error: 'Resend error', error_code: 'resend_error' } }]);
    const r = await notificarSolicitudAsync(client, 'compra', 's2', 'aprobada', 0);
    expect(r.ok).toBe(false);
    expect(rpc).toHaveBeenCalledWith('registrar_correo_fallido', expect.objectContaining({ p_tipo: 'compra', p_solicitud_id: 's2', p_evento: 'aprobada' }));
  });

  it('skipped legítimo (sin destinatarios) NO se reintenta ni se marca como fallo', async () => {
    const { client, invoke, rpc } = cliente([{ data: { skipped: true, reason: 'Sin destinatarios.' } }]);
    const r = await notificarSolicitudAsync(client, 'material', 's3', 'creada', 0);
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });
});
