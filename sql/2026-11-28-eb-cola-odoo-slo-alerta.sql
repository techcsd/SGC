-- 2026-11-28 -- PROMPT-158 F2 (EB-05/06): SLO honesto + alerta de cola atascada de Odoo.
-- Incidente 25-28-nov: ningun conduce llegaba a Odoo (campo de Odoo 17 en Odoo 19) y el panel decia "SLO 100 %"
-- porque solo contaba las salidas ya publicadas (1 muestra en 7 dias) e ignoraba la cola pendiente.
-- Aditiva: CREATE OR REPLACE (mismas claves de siempre + claves nuevas), parametros nuevos, funcion y cron nuevos. Sin DROP.
-- Reversa: sql/_reversa/2026-11-28-eb-cola-odoo-slo-alerta.reversa.sql
begin;
set local lock_timeout = '3s';

insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_alerta_cola_activa', 'true', 'EB-05: true = avisa a Tecnologia si el evento pendiente mas viejo de la cola de Odoo supera el umbral.'),
  ('odoo_alerta_cola_min', '15', 'EB-05: minutos que puede esperar el evento pendiente mas viejo antes de avisar.'),
  ('odoo_alerta_cola_horas', '3', 'EB-05: horas minimas entre avisos de cola atascada.'),
  ('odoo_slo_muestras_min', '10', 'EB-06: muestras minimas en 7 dias para que el SLO se considere medido (menos = sin datos suficientes, nunca 100 %).')
on conflict (clave) do nothing;

-- Cola viva: eventos de tipos con politica habilitada, no de prueba, aun sin completar (pendiente/reintento/procesando).
create or replace function sgc.odoo_cola_estado()
returns jsonb language sql stable security definer set search_path = sgc, pg_temp as $fn$
  select jsonb_build_object(
    'pendientes', count(*),
    'mas_vieja_min', coalesce(round(extract(epoch from (now() - min(e.creado_en))) / 60.0)::int, 0),
    'sin_intentos', count(*) filter (where e.intentos = 0))
  from sgc.odoo_eventos e
  join sgc.odoo_publicacion_politica pol on pol.agregado_tipo = e.agregado_tipo and pol.habilitada
  where e.es_prueba = false and e.estado in ('pendiente', 'reintento', 'procesando');
$fn$;
revoke all on function sgc.odoo_cola_estado() from public, anon, authenticated;
grant execute on function sgc.odoo_cola_estado() to service_role;

create or replace function sgc.odoo_canary_criterios()
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare
  v_p99 numeric; v_n integer; v_ok integer; v_fuera integer; v_inciertos integer; v_errores integer;
  v_cola jsonb; v_min integer; v_umbral integer; v_estado text; v_cumple boolean;
begin
  if not sgc.es_tecnologia() then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;

  select percentile_disc(0.99) within group (order by extract(epoch from (actualizado_en - creado_en))),
         count(*), count(*) filter (where actualizado_en - creado_en < interval '2 minutes')
    into v_p99, v_n, v_ok
    from sgc.odoo_eventos
   where agregado_tipo = 'salida_inventario' and estado = 'completado' and creado_en > now() - interval '7 days';

  select count(*) into v_fuera from sgc.odoo_discrepancias where tipo = 'fuera_de_canal' and resuelta_en is null;
  select count(*) into v_inciertos from sgc.salidas_inventario where odoo_sync_estado = 'incierto';
  select count(*) into v_errores from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and estado in ('error', 'bloqueado');

  v_cola := sgc.odoo_cola_estado();
  select coalesce(nullif(valor, '')::int, 10) into v_min from sgc.parametros where clave = 'odoo_slo_muestras_min';
  select coalesce(nullif(valor, '')::int, 15) into v_umbral from sgc.parametros where clave = 'odoo_alerta_cola_min';
  v_min := coalesce(v_min, 10); v_umbral := coalesce(v_umbral, 15);

  -- EB-06: el SLO mira tambien la cola. Con la cola atascada, o con pocas muestras, NO dice "cumple".
  v_estado := case
    when (v_cola ->> 'mas_vieja_min')::int > v_umbral then 'cola_atascada'
    when coalesce(v_n, 0) < v_min then 'pocas_muestras'
    when (100.0 * v_ok / v_n) >= 99 then 'cumple'
    else 'incumple' end;
  v_cumple := v_estado = 'cumple';

  return jsonb_build_object(
    'muestras', coalesce(v_n, 0),
    'p99_publicacion_s', round(coalesce(v_p99, 0)::numeric, 1),
    'pct_en_2min', case when coalesce(v_n, 0) = 0 then null else round(100.0 * v_ok / v_n, 1) end,
    'cumple_slo', v_cumple,
    'cumple_p99', v_cumple,
    'estado_slo', v_estado,
    'muestras_min', v_min,
    'cola_pendientes', (v_cola ->> 'pendientes')::int,
    'cola_mas_vieja_min', (v_cola ->> 'mas_vieja_min')::int,
    'cola_sin_intentos', (v_cola ->> 'sin_intentos')::int,
    'fuera_de_canal_abiertas', v_fuera,
    'cumple_fuera_de_canal', v_fuera = 0,
    'inciertos_abiertos', coalesce(v_inciertos, 0),
    'outbox_errores', coalesce(v_errores, 0),
    'ratificaciones', (select coalesce(jsonb_agg(adr order by adr), '[]'::jsonb) from sgc.odoo_ratificaciones)
  );
end $fn$;
revoke all on function sgc.odoo_canary_criterios() from public, anon;
grant execute on function sgc.odoo_canary_criterios() to authenticated;

create or replace function sgc.odoo_alertar_cola_atascada()
returns jsonb language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_activa boolean; v_umbral int; v_horas int; v_cola jsonb; v_avisos int := 0;
begin
  select coalesce(lower(valor) in ('true','t','1'), false) into v_activa from sgc.parametros where clave = 'odoo_alerta_cola_activa';
  if not coalesce(v_activa, false) then return jsonb_build_object('activa', false); end if;
  select coalesce(nullif(valor,'')::int, 15) into v_umbral from sgc.parametros where clave = 'odoo_alerta_cola_min';
  select coalesce(nullif(valor,'')::int, 3) into v_horas from sgc.parametros where clave = 'odoo_alerta_cola_horas';
  v_umbral := coalesce(v_umbral, 15); v_horas := coalesce(v_horas, 3);
  v_cola := sgc.odoo_cola_estado();
  if (v_cola ->> 'mas_vieja_min')::int > v_umbral
     and not exists (select 1 from sgc.notificaciones where tipo = 'alerta' and titulo = 'Cola de Odoo atascada'
                      and created_at > now() - make_interval(hours => v_horas)) then
    perform sgc.odoo_notificar_tecnologia('Cola de Odoo atascada',
      (v_cola ->> 'pendientes') || ' evento(s) esperan publicarse en Odoo; el mas viejo lleva ' || (v_cola ->> 'mas_vieja_min') ||
      ' min (' || (v_cola ->> 'sin_intentos') || ' sin ningun intento). Revisa Sincronizacion con Odoo.', '/tecnologia/odoo-sync');
    v_avisos := 1;
  end if;
  return jsonb_build_object('activa', true, 'avisos', v_avisos, 'cola', v_cola);
end $fn$;
revoke all on function sgc.odoo_alertar_cola_atascada() from public, anon, authenticated;
grant execute on function sgc.odoo_alertar_cola_atascada() to service_role;

select cron.schedule('sgc-odoo-alertar-cola-atascada', '*/10 * * * *', $cron$ select sgc.odoo_alertar_cola_atascada() $cron$);

commit;
