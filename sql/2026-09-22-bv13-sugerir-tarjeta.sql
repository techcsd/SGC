-- BV13 — auto-vincular el vehículo de cada tarjeta del PDF; el select queda de
-- respaldo. RPC que resuelve el vehículo probable de una tarjeta por su titular:
-- (1) mapa guardado → (2) titular ≈ vehículo (trigram ≥0.55 y ÚNICO) → (3) persona
-- ≈ usuario (≥0.7) → vehículo asignado en la fecha. Sin candidato → vacío (el
-- cliente deja el select vacío). Ambigüedad (2 candidatos ≥0.55) → no adivina.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv13-sugerir-tarjeta.sql --env dev  →  --env prod
-- Rollback: drop function sgc.sugerir_vehiculo_tarjeta(text, date);
begin;

create or replace function sgc.sugerir_vehiculo_tarjeta(p_titular text, p_fecha date default null)
returns table(vehiculo_id uuid, score numeric, via text)
language plpgsql stable security definer set search_path to 'sgc', 'extensions', 'public' as $fn$
declare
  v_norm  text := upper(unaccent(coalesce(p_titular, '')));
  v_clean text := btrim(regexp_replace(
    regexp_replace(upper(unaccent(coalesce(p_titular, ''))),
      '(ING\.?|CAMION|DOBLE CABINA|1 CABINA|2DO|1RA|2DA)', ' ', 'g'),
    '\s+', ' ', 'g'));
begin
  -- (1) mapa guardado (titular ya aprendido) → certeza
  return query
    select m.vehiculo_id, 1.0::numeric, 'mapa'::text
    from sgc.combustible_tarjeta_map m
    where m.vehiculo_id is not null
      and upper(unaccent(coalesce(m.titular_nombre, ''))) = v_norm
    limit 1;
  if found then return; end if;

  -- (2) titular ≈ vehículo (alias o marca+modelo+año), trigram ≥ 0.55 y ÚNICO ganador
  return query
    with cand as (
      select v.id, greatest(
        similarity(v_clean, upper(unaccent(coalesce(v.alias, '')))),
        similarity(v_clean, upper(unaccent(concat_ws(' ', v.marca, v.modelo, nullif(v.anio, 0)::text))))
      ) as s
      from sgc.vehiculos v
      where coalesce(v.activo, true) and not coalesce(v.es_prueba, false)
    ), ge as (select id, s from cand where s >= 0.55)
    select g.id, round(g.s::numeric, 2), 'titular'::text
    from ge g
    where (select count(*) from ge) = 1
    order by g.s desc
    limit 1;
  if found then return; end if;

  -- (3) persona ≈ usuario (≥0.7) → vehículo asignado que cubre la fecha (o activo)
  return query
    with u as (
      select id, similarity(v_clean, upper(unaccent(coalesce(nombre, '')))) as s
      from sgc.usuarios where coalesce(activo, true)
    ), best as (select id, s from u where s >= 0.7 order by s desc limit 1)
    select va.vehiculo_id, round((select s from best)::numeric, 2), 'persona'::text
    from sgc.vehiculo_asignaciones va
    where va.usuario_id = (select id from best)
      and (
        (p_fecha is not null and va.desde::date <= p_fecha and (va.hasta is null or va.hasta::date >= p_fecha))
        or coalesce(va.activa, false)
      )
    order by coalesce(va.activa, false) desc, va.desde desc
    limit 1;
end $fn$;

grant execute on function sgc.sugerir_vehiculo_tarjeta(text, date) to authenticated, service_role;

commit;
