-- 2026-10-20-cu3-envio-automatico-probar.sql — CU3 (fila 269, segunda parte)
-- CT10 dejó la tabla/panel de "Envíos automáticos" pero NO implementó "Enviar
-- prueba ahora (solo a mí)" (anotado explícitamente en su HANDOFF: "requiere que
-- cada edge soporte un override de destinatarios"). Esta migración cierra eso
-- para las DOS familias que son correos a una lista (resumen_operaciones,
-- incentivo_semanal) — las otras dos (avisos_reporte_semanal, cronograma) son
-- avisos in-app/webhook sin un destinatario personal análogo, así que no
-- aplican a "enviar prueba ahora" (ver docs/SEGURIDAD.md… digo, la UI del panel
-- deshabilita el botón para esas dos con una nota, no se simula).
--
-- Por diseño (CU3 default, CONTEXTO-54 §6): "la llamada manual (botón) ignora
-- el interruptor y manda SOLO a quien la pidió" — por eso esta función no
-- consulta sgc.envio_automatico_activo(). Usa la semana ACTUAL (no la anterior
-- como el cron real) porque es una vista previa, no el informe oficial de la
-- semana cerrada.
begin;

create or replace function sgc.envio_automatico_probar(p_familia text) returns text
language plpgsql security definer
set search_path to 'sgc', 'public'
as $$
declare
  v_email  text;
  v_secret text;
  v_url    text;
  v_anio   int := extract(isoyear from current_date)::int;
  v_sem    int := extract(week from current_date)::int;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede probar un envío automático.' using errcode = '42501';
  end if;

  select email into v_email from sgc.usuarios where id = auth.uid();
  if nullif(trim(coalesce(v_email, '')), '') is null then
    raise exception 'Tu usuario no tiene un correo configurado — no se puede mandar la prueba.' using errcode = '22023';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  if v_secret is null then
    raise exception 'Falta el secreto infra_sync_secret en este entorno — no se puede llamar a la edge.' using errcode = '22023';
  end if;

  if p_familia = 'resumen_operaciones' then
    v_url := sgc.edge_url('resumen-semanal-operaciones');
  elsif p_familia = 'incentivo_semanal' then
    v_url := sgc.edge_url('incentivo-semanal');
  else
    raise exception 'Esta familia no tiene "enviar prueba ahora" — es un aviso interno, no un correo a una lista fija.' using errcode = '22023';
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('anio', v_anio, 'semana', v_sem, 'destinatario_prueba', v_email)
  );

  return v_email;
end;
$$;
grant execute on function sgc.envio_automatico_probar(text) to authenticated;

commit;
