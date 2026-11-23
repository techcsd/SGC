-- DX4 (ronda 23-nov-2026) -- los fallos del correo de requisiciones ya no son mudos.
-- F0 (prod, solo lectura): de 16 requisiciones de los últimos 14 días, 5 NO tienen ninguna fila de correo en
-- notif_entregas (10-nov 17:51, 11-nov 19:56, 14-nov 13:20, 14-nov 15:58, 14-nov 22:27) y 11 sí (37 destinatarios
-- «enviada», Raykler incluido en todas). `functions.invoke` no rechaza, así que el .catch del front era código muerto.
-- Esta RPC deja la traza cuando el FRONT no logró que la edge corriera (o la edge devolvió error).
-- notif_entregas ya acepta estado='fallida' y usuario_id/destino nulos.
begin;

create or replace function sgc.registrar_correo_fallido(p_tipo text, p_solicitud_id text, p_evento text, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_tipo not in ('material', 'compra') then raise exception 'tipo inválido' using errcode = '22023'; end if;
  insert into sgc.notif_entregas (canal, usuario_id, tipo, titulo, destino, estado, motivo)
  values ('email', null, 'solicitud_' || p_tipo,
          left('Solicitud ' || coalesce(p_evento, '?') || ' · ' || coalesce(p_solicitud_id, '?'), 200),
          null, 'fallida', left(coalesce(p_motivo, 'desconocido'), 200));
end;
$$;

revoke all on function sgc.registrar_correo_fallido(text, text, text, text) from public, anon;
grant execute on function sgc.registrar_correo_fallido(text, text, text, text) to authenticated;
comment on function sgc.registrar_correo_fallido is 'DX4 — rastro de un correo de requisición/compra que no salió (visible en Pulso del sistema > Correos de requisiciones).';
commit;
