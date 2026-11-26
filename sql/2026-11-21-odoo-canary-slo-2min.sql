-- #204: odoo_canary_criterios() deja de medir p99 < 5 s (irreal con outbox asincrono)
-- y adopta el SLO vigente: 99 % de las publicaciones de salida en menos de 2 min
-- (misma regla y ventana de 7 dias que odoo_slo_publicacion / odoo_slo_evaluar).
-- Tambien expone inciertos y errores del outbox para la revision semanal en Conciliacion.
-- Idempotente (CREATE OR REPLACE). No cambia odoo_slo_publicacion ni odoo_slo_evaluar.
create or replace function sgc.odoo_canary_criterios()
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare
  v_p99 numeric;
  v_n integer;
  v_ok integer;
  v_fuera integer;
  v_inciertos integer;
  v_errores integer;
begin
  if not sgc.es_tecnologia() then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;

  select
    percentile_disc(0.99) within group (order by extract(epoch from (actualizado_en - creado_en))),
    count(*),
    count(*) filter (where actualizado_en - creado_en < interval '2 minutes')
    into v_p99, v_n, v_ok
    from sgc.odoo_eventos
   where agregado_tipo = 'salida_inventario'
     and estado = 'completado'
     and creado_en > now() - interval '7 days';

  select count(*) into v_fuera
    from sgc.odoo_discrepancias
   where tipo = 'fuera_de_canal' and resuelta_en is null;

  select count(*) into v_inciertos
    from sgc.salidas_inventario
   where odoo_sync_estado = 'incierto';

  select count(*) into v_errores
    from sgc.odoo_eventos
   where agregado_tipo = 'salida_inventario'
     and estado in ('error', 'bloqueado');

  return jsonb_build_object(
    'muestras', coalesce(v_n, 0),
    'p99_publicacion_s', round(coalesce(v_p99, 0)::numeric, 1),
    'pct_en_2min', case when coalesce(v_n, 0) = 0 then null else round(100.0 * v_ok / v_n, 1) end,
    'cumple_slo', coalesce(v_n, 0) = 0 or (100.0 * v_ok / v_n) >= 99,
    -- Alias del SLO (ya no es p99 < 5 s) por si un cliente viejo todavia lee cumple_p99.
    'cumple_p99', coalesce(v_n, 0) = 0 or (100.0 * v_ok / v_n) >= 99,
    'fuera_de_canal_abiertas', v_fuera,
    'cumple_fuera_de_canal', v_fuera = 0,
    'inciertos_abiertos', coalesce(v_inciertos, 0),
    'outbox_errores', coalesce(v_errores, 0),
    'ratificaciones', (select coalesce(jsonb_agg(adr order by adr), '[]'::jsonb) from sgc.odoo_ratificaciones)
  );
end $fn$;

comment on function sgc.odoo_canary_criterios() is
  '#204: criterios de observacion del canary; el SLO vigente es 99 % de salidas publicadas en menos de 2 min (no p99 < 5 s).';

revoke all on function sgc.odoo_canary_criterios() from public, anon;
grant execute on function sgc.odoo_canary_criterios() to authenticated;
