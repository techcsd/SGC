-- 2026-11-18 -- Alertas de publicacion a Odoo (plan ADR 17 / SLO: «incierto» < 1 h) + conduce_estado_sync lee la columna real.
-- 1) conduce_estado_sync (dt): usa salidas_inventario.odoo_sync_estado (fuente real: sincronizado|pendiente|incierto|error); si es null cae a los eventos.
-- 2) odoo_alertar_publicacion(): avisa a Tecnologia (a) conduces en estado 'incierto' hace mas de 1 h y (b) conduces en 'error'. Maximo un aviso por tipo cada
--    N horas (parametros). Corre cada 15 min por pg_cron. Apagar: odoo_alerta_publicacion_activa = 'false'.
insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_alerta_publicacion_activa', 'true', 'DW: true = avisa a Tecnologia de conduces inciertos (> 1 h) o con error de publicacion en Odoo.'),
  ('odoo_alerta_error_horas', '6', 'DW: horas minimas entre avisos de conduces con error de publicacion.')
on conflict (clave) do nothing;

create or replace function sgc.conduce_estado_sync(p_salida_id uuid)
returns text
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_col text; v_n int; v_err int; v_inc int; v_pen int;
begin
  if not (sgc.es_flota_elevado() or sgc.es_tecnologia()) then return null; end if;
  select odoo_sync_estado into v_col from sgc.salidas_inventario where id = p_salida_id;
  if v_col is not null then return v_col; end if;
  select count(*), count(*) filter (where estado in ('error','bloqueado')), count(*) filter (where estado = 'incierto'),
         count(*) filter (where estado in ('pendiente','procesando','reintento'))
    into v_n, v_err, v_inc, v_pen
    from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and agregado_id = p_salida_id::text;
  if v_n = 0 then return null; end if;
  if v_err > 0 then return 'error'; end if;
  if v_inc > 0 then return 'incierto'; end if;
  if v_pen > 0 then return 'pendiente'; end if;
  return 'sincronizado';
end $$;

create or replace function sgc.odoo_alertar_publicacion()
returns jsonb
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_activa boolean; v_inc int; v_err int; v_horas int;
begin
  select coalesce(lower(valor) in ('true','t','1'), false) into v_activa from sgc.parametros where clave = 'odoo_alerta_publicacion_activa';
  if not coalesce(v_activa, false) then return jsonb_build_object('activa', false); end if;
  select coalesce(nullif(valor,'')::int, 6) into v_horas from sgc.parametros where clave = 'odoo_alerta_error_horas';
  v_horas := coalesce(v_horas, 6);

  select count(*) into v_inc from sgc.salidas_inventario
   where odoo_sync_estado = 'incierto' and coalesce(odoo_sync_en, created_at) < now() - interval '1 hour';
  if v_inc > 0 and not exists (select 1 from sgc.notificaciones where tipo = 'alerta' and titulo = 'Conduces inciertos en Odoo' and created_at > now() - interval '1 hour') then
    perform sgc.odoo_notificar_tecnologia('Conduces inciertos en Odoo',
      v_inc || ' conduce(s) llevan más de 1 h sin saber si Odoo los registró. Revisa Conciliación antes de reintentar.', '/tecnologia/odoo-conciliacion');
  end if;

  select count(*) into v_err from sgc.salidas_inventario where odoo_sync_estado = 'error';
  if v_err > 0 and not exists (select 1 from sgc.notificaciones where tipo = 'alerta' and titulo = 'Conduces con error en Odoo' and created_at > now() - make_interval(hours => v_horas)) then
    perform sgc.odoo_notificar_tecnologia('Conduces con error en Odoo',
      v_err || ' conduce(s) no se pudieron publicar en Odoo (p. ej. falta de existencias). Revisa Conciliación.', '/tecnologia/odoo-conciliacion');
  end if;
  return jsonb_build_object('activa', true, 'inciertos_mas_1h', v_inc, 'con_error', v_err);
end $fn$;
revoke all on function sgc.odoo_alertar_publicacion() from public, anon, authenticated;

select cron.schedule('sgc-odoo-alertar-publicacion', '*/15 * * * *', $cron$ select sgc.odoo_alertar_publicacion() $cron$);
