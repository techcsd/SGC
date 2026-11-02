-- sql/2026-11-02-df6b-pulso-obras-y-flujo.sql — Ronda DF, F6b (PROMPT 128, DF5-A/DF5-B)
-- Dos RPCs de solo lectura, aditivas, sin tablas nuevas:
--   1) sgc.pulso_obras_hoy() — envoltorio de sgc.bitacoras_cobertura_resumen() (BJ1b, ya
--      existente) que agrega `reporto_hoy` para pintar el anillo verde/naranja del pulso
--      de obras (DF5-B). No duplica el cálculo de cobertura, solo lo reinterpreta para hoy.
--   2) sgc.requisicion_flujo_tiempos(p_dias) — tiempo promedio real entre los timestamps
--      que YA se registran en solicitudes_material/salidas_inventario (los mismos que usa
--      sgc.tablero_vivo_resumen(), db14) para las 3 transiciones medibles con los datos que
--      existen hoy. No se mide "aprobada→despachada" porque no hay una FK limpia
--      solicitud→salida verificada en esta pasada — se documenta como limitación, no se
--      inventa un timestamp que no existe.
--   3) sgc.requisicion_flujo_detalle(p_etapa, p_dias) — la lista exacta detrás de cada
--      etapa (AT11: todo número visible se puede abrir).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-02-df6b-pulso-obras-y-flujo.sql --env dev

begin;
set local search_path = sgc, public;

-- ── 1) Pulso de obras (DF5-B) ──────────────────────────────────────────────────
create or replace function sgc.pulso_obras_hoy()
returns table (
  obra text,
  reporto_hoy boolean,
  dias_sin_reportar integer,
  estado text
)
language sql stable security definer
set search_path to 'sgc', 'public'
as $$
  select
    r.obra,
    (r.ultima = current_date) as reporto_hoy,
    r.dias_sin_reportar,
    r.estado
  from sgc.bitacoras_cobertura_resumen() r;
$$;
grant execute on function sgc.pulso_obras_hoy() to authenticated;
revoke execute on function sgc.pulso_obras_hoy() from public;

-- ── 2) Flujo requisición → recepción, tiempos promedio (DF5-A) ─────────────────
create or replace function sgc.requisicion_flujo_tiempos(p_dias integer default 30)
returns table (
  etapa text,
  cantidad bigint,
  promedio_horas numeric,
  es_cuello_botella boolean
)
language plpgsql stable security definer
set search_path to 'sgc', 'public'
as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(p_dias, 1));
  v_max numeric;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()
          or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras') or sgc.tiene_modulo('proyectos')) then
    raise exception 'No autorizado para el flujo de requisiciones.' using errcode = '42501';
  end if;

  create temporary table tmp_flujo_etapas (
    etapa text, cantidad bigint, promedio_horas numeric
  ) on commit drop;

  insert into tmp_flujo_etapas
  select 'solicitud_a_aprobacion', count(*),
         round(avg(extract(epoch from (s.atendido_en - s.created_at)) / 3600.0)::numeric, 1)
  from sgc.solicitudes_material s
  where s.atendido_en is not null and s.created_at >= v_desde
    and (sgc.is_admin() or not exists (
      select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba, false)));

  insert into tmp_flujo_etapas
  select 'despacho_a_transito', count(*),
         round(avg(extract(epoch from (sa.transito_at - sa.created_at)) / 3600.0)::numeric, 1)
  from sgc.salidas_inventario sa
  where sa.transito_at is not null and sa.estado <> 'anulado' and sa.created_at >= v_desde
    and (sgc.is_admin() or not coalesce(sa.es_prueba, false));

  insert into tmp_flujo_etapas
  select 'transito_a_entrega', count(*),
         round(avg(extract(epoch from (sa.entregado_en - sa.transito_at)) / 3600.0)::numeric, 1)
  from sgc.salidas_inventario sa
  where sa.entregado_en is not null and sa.transito_at is not null and sa.created_at >= v_desde
    and (sgc.is_admin() or not coalesce(sa.es_prueba, false));

  select max(t.promedio_horas) into v_max from tmp_flujo_etapas t where t.cantidad > 0;

  return query
  select t.etapa, t.cantidad, t.promedio_horas,
         (t.cantidad > 0 and v_max is not null and t.promedio_horas = v_max) as es_cuello_botella
  from tmp_flujo_etapas t;
end;
$$;
grant execute on function sgc.requisicion_flujo_tiempos(integer) to authenticated;
revoke execute on function sgc.requisicion_flujo_tiempos(integer) from public;

-- ── 3) Detalle de una etapa (AT11 — todo número visible se puede abrir) ────────
create or replace function sgc.requisicion_flujo_detalle(p_etapa text, p_dias integer default 30)
returns table (
  referencia text,
  obra text,
  horas numeric,
  en_fecha timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'public'
as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(p_dias, 1));
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()
          or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras') or sgc.tiene_modulo('proyectos')) then
    raise exception 'No autorizado para el flujo de requisiciones.' using errcode = '42501';
  end if;

  if p_etapa = 'solicitud_a_aprobacion' then
    return query
    select 'Solicitud ' || coalesce(s.folio::text, s.id::text),
           coalesce(p.nombre, ''),
           round(extract(epoch from (s.atendido_en - s.created_at)) / 3600.0, 1),
           s.atendido_en
    from sgc.solicitudes_material s
    left join sgc.proyectos p on p.id = s.proyecto_id
    where s.atendido_en is not null and s.created_at >= v_desde
      and (sgc.is_admin() or not coalesce(p.es_prueba, false))
    order by s.atendido_en desc limit 100;
  elsif p_etapa = 'despacho_a_transito' then
    return query
    select 'CND-' || upper(left(sa.id::text, 8)),
           coalesce(p.nombre, ''),
           round(extract(epoch from (sa.transito_at - sa.created_at)) / 3600.0, 1),
           sa.transito_at
    from sgc.salidas_inventario sa
    left join sgc.proyectos p on p.id = sa.proyecto_id
    where sa.transito_at is not null and sa.estado <> 'anulado' and sa.created_at >= v_desde
      and (sgc.is_admin() or not coalesce(sa.es_prueba, false))
    order by sa.transito_at desc limit 100;
  elsif p_etapa = 'transito_a_entrega' then
    return query
    select 'CND-' || upper(left(sa.id::text, 8)),
           coalesce(p.nombre, ''),
           round(extract(epoch from (sa.entregado_en - sa.transito_at)) / 3600.0, 1),
           sa.entregado_en
    from sgc.salidas_inventario sa
    left join sgc.proyectos p on p.id = sa.proyecto_id
    where sa.entregado_en is not null and sa.transito_at is not null and sa.created_at >= v_desde
      and (sgc.is_admin() or not coalesce(sa.es_prueba, false))
    order by sa.entregado_en desc limit 100;
  else
    raise exception 'Etapa desconocida: %', p_etapa using errcode = '22023';
  end if;
end;
$$;
grant execute on function sgc.requisicion_flujo_detalle(text, integer) to authenticated;
revoke execute on function sgc.requisicion_flujo_detalle(text, integer) from public;

commit;
