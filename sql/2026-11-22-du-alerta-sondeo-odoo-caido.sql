-- 2026-11-22 -- PROMPT-151 DU5: aviso a Tecnologia cuando el sondeo de Odoo falla varias veces seguidas.
-- Incidente 21-22-nov: Odoo renombro su base de datos y 36 sondeos fallaron en silencio durante ~3.5 h
-- (solo quedaba el error en odoo_conciliacion_corridas). Ahora, si los ultimos N sondeos de una instancia
-- HABILITADA fallaron todos, se avisa a Tecnologia (max 1 aviso cada 6 h). Apagar: odoo_alerta_sondeo_activa='false'.
-- Nota: odoo_instancias.base_datos es INMUTABLE (trigger odoo_v1_proteger_instancia: la identidad de la instancia no se edita).
-- Su valor en prod queda con el nombre historico; la edge usa el secret ODOO_DB (ya corregido).
begin;
set local lock_timeout = '3s';

insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_alerta_sondeo_activa', 'true', 'DU5: true = avisa a Tecnologia si los ultimos N sondeos de Odoo fallaron todos.'),
  ('odoo_alerta_sondeo_fallos', '6', 'DU5: sondeos consecutivos fallidos (cada 5 min) antes de avisar (6 = 30 min).'),
  ('odoo_alerta_sondeo_horas', '6', 'DU5: horas minimas entre avisos de sondeo caido.')
on conflict (clave) do nothing;

create or replace function sgc.odoo_alertar_sondeo_caido()
returns jsonb
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare
  v_activa boolean; v_n int; v_horas int; v_inst record; v_fallidos int; v_total int; v_err text; v_avisadas int := 0;
begin
  select coalesce(lower(valor) in ('true','t','1'), false) into v_activa from sgc.parametros where clave = 'odoo_alerta_sondeo_activa';
  if not coalesce(v_activa, false) then return jsonb_build_object('activa', false); end if;
  select coalesce(nullif(valor,'')::int, 6) into v_n from sgc.parametros where clave = 'odoo_alerta_sondeo_fallos';
  select coalesce(nullif(valor,'')::int, 6) into v_horas from sgc.parametros where clave = 'odoo_alerta_sondeo_horas';
  v_n := greatest(coalesce(v_n, 6), 2); v_horas := coalesce(v_horas, 6);

  for v_inst in select id, nombre from sgc.odoo_instancias where habilitada loop
    select count(*) filter (where error is not null), count(*), max(error) filter (where error is not null)
      into v_fallidos, v_total, v_err
      from (select error from sgc.odoo_conciliacion_corridas
             where odoo_instancia_id = v_inst.id and tipo = 'sondeo'
             order by iniciada_en desc limit v_n) u;
    if v_total >= v_n and v_fallidos = v_total
       and not exists (select 1 from sgc.notificaciones where tipo = 'alerta' and titulo = 'Odoo no responde'
                        and created_at > now() - make_interval(hours => v_horas)) then
      perform sgc.odoo_notificar_tecnologia('Odoo no responde',
        v_inst.nombre || ': los últimos ' || v_n || ' sondeos fallaron (' || left(coalesce(v_err, 'sin detalle'), 140) ||
        '). Revisa que el nombre de la base (secret ODOO_DB) y el servidor de Odoo sigan vigentes.', '/tecnologia/odoo-conciliacion');
      v_avisadas := v_avisadas + 1;
    end if;
  end loop;
  return jsonb_build_object('activa', true, 'avisos', v_avisadas);
end $fn$;
revoke all on function sgc.odoo_alertar_sondeo_caido() from public, anon, authenticated;
grant execute on function sgc.odoo_alertar_sondeo_caido() to service_role;

select cron.schedule('sgc-odoo-alertar-sondeo-caido', '*/10 * * * *', $cron$ select sgc.odoo_alertar_sondeo_caido() $cron$);

commit;
