-- ============================================================================
-- CC6 (PROMPT-74 F5) — Conciliación de combustible: nº de recibo, matcher por
-- niveles, "ya registrada", % honesto (1 factura = 1) y causas.
-- Nota #89: comparar por número de recibo; Raykler quiere subir el % de match y
-- más detalle.
-- ----------------------------------------------------------------------------
-- Realidad del esquema (el CONTEXTO nombra conciliacion_items/nro_factura; aquí
-- se mapea a las tablas reales): la echada es `registros_combustible`, el detalle
-- de conciliación es `conciliacion_combustible_detalle`, y la factura se enlaza
-- por `conciliaciones_combustible.factura_id` (→ combustible_facturas).
--
-- ADITIVO: numero_recibo en la echada; nivel_match/causa_sin_match en el detalle;
-- vista de "factura vigente" (última conciliación por factura); RPCs de causas y
-- de % por chofer/vehículo.
--
-- BU1 (regla 18): --env dev primero, probar, luego --env prod --yes.
-- ============================================================================

begin;

-- ── 1) Nº de recibo en la echada (para cruzar por recibo) ────────────────────
alter table sgc.registros_combustible
  add column if not exists numero_recibo text;
create index if not exists ix_rc_numero_recibo
  on sgc.registros_combustible (numero_recibo)
  where numero_recibo is not null;
comment on column sgc.registros_combustible.numero_recibo is
  'CC6 — número del RECIBO del ticket (para cruzar con el informe de la estación).';

-- ── 2) Nivel de match y causa en el detalle de conciliación ──────────────────
alter table sgc.conciliacion_combustible_detalle
  add column if not exists nivel_match     text,   -- recibo | placa_fecha | tarjeta_fecha
  add column if not exists causa_sin_match text;    -- chofer_no_registro | tarjeta_sin_vehiculo | galones | fecha | fuera_flota | anulacion
comment on column sgc.conciliacion_combustible_detalle.nivel_match is
  'CC6 — cómo cruzó la fila: recibo (exacto) | placa_fecha | tarjeta_fecha.';
comment on column sgc.conciliacion_combustible_detalle.causa_sin_match is
  'CC6 — por qué NO cruzó (solo_informe): chofer_no_registro | tarjeta_sin_vehiculo | galones | fecha | fuera_flota | anulacion.';

-- ── 3) Vista "factura vigente": la última conciliación por factura ───────────
-- Una re-subida de la misma factura NO debe contar dos veces (hundía el % e
-- inflaba las discrepancias). Las conciliaciones sin factura enlazada cuentan tal cual.
create or replace view sgc.v_conciliacion_factura_vigente as
  select c.*
  from sgc.conciliaciones_combustible c
  where c.factura_id is null
     or c.created_at = (
       select max(c2.created_at) from sgc.conciliaciones_combustible c2
       where c2.factura_id = c.factura_id
     );
comment on view sgc.v_conciliacion_factura_vigente is
  'CC6 — una fila por factura (la última conciliación) + las conciliaciones sin factura. '
  'El dashboard honesto (% match, discrepancias) se calcula sobre esta vista.';
grant select on sgc.v_conciliacion_factura_vigente to authenticated, service_role;

-- ── 4) Causas de las filas sin match de UNA conciliación ─────────────────────
create or replace function sgc.conciliacion_causas(p_conciliacion uuid)
returns table (causa text, filas integer, galones numeric, monto numeric)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    coalesce(d.causa_sin_match, 'sin_clasificar') as causa,
    count(*)::int as filas,
    coalesce(sum(d.galones_informe), 0) as galones,
    coalesce(sum(d.monto_informe), 0) as monto
  from sgc.conciliacion_combustible_detalle d
  where d.conciliacion_id = p_conciliacion
    and d.tipo = 'solo_informe'
    and (sgc.es_flota_elevado() or sgc.is_admin())
  group by coalesce(d.causa_sin_match, 'sin_clasificar')
  order by filas desc;
$$;
grant execute on function sgc.conciliacion_causas(uuid) to authenticated, service_role;

-- ── 5) % de match por chofer o por vehículo (en un rango, sobre vigentes) ─────
-- p_por = 'vehiculo' | 'chofer'. Cuenta, por entidad, filas del informe que
-- cruzaron (tipo='match') vs total (match + solo_informe). Para el vehículo usa
-- d.vehiculo_id; para el chofer, el conductor de la echada (match) o el conductor
-- más frecuente del vehículo en registros (solo_informe, best-effort).
create or replace function sgc.conciliacion_match_por(
  p_desde date, p_hasta date, p_por text default 'vehiculo'
)
returns table (entidad_id uuid, entidad text, total integer, matches integer, pct numeric)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with vig as (
    select id from sgc.v_conciliacion_factura_vigente
    where (p_desde is null or fecha_hasta >= p_desde)
      and (p_hasta is null or fecha_desde <= p_hasta)
  ),
  det as (
    select d.*,
      case
        when p_por = 'chofer' then coalesce(
          (select rc.conductor_id from sgc.registros_combustible rc where rc.id = d.registro_id),
          (select rc2.conductor_id from sgc.registros_combustible rc2
             where rc2.vehiculo_id = d.vehiculo_id and rc2.conductor_id is not null
             group by rc2.conductor_id order by count(*) desc limit 1)
        )
        else d.vehiculo_id
      end as ent_id
    from sgc.conciliacion_combustible_detalle d
    join vig on vig.id = d.conciliacion_id
    where d.tipo in ('match','solo_informe')
  )
  select
    det.ent_id as entidad_id,
    case when p_por = 'chofer'
      then coalesce((select co.nombre from sgc.conductores co where co.id = det.ent_id), 'Sin chofer')
      else coalesce((select trim(coalesce(v.alias,'') || ' ' || coalesce(v.placa,'')) from sgc.vehiculos v where v.id = det.ent_id), 'Sin vehículo')
    end as entidad,
    count(*)::int as total,
    count(*) filter (where det.tipo = 'match')::int as matches,
    round(100.0 * count(*) filter (where det.tipo = 'match') / nullif(count(*),0), 1) as pct
  from det
  where (sgc.es_flota_elevado() or sgc.is_admin())
  group by det.ent_id, p_por
  order by pct asc nulls last, total desc;
$$;
grant execute on function sgc.conciliacion_match_por(date, date, text) to authenticated, service_role;

commit;
