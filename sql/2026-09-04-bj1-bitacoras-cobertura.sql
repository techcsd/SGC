-- =============================================================================
-- PROMPT-32+ (BJ1) — Reporte de cobertura de bitácoras por obra y fecha.
-- Pedido de Eduardo NG (03-09): "cantidad de bitácoras por obra y por fecha para
-- pasar a los ingenieros para que la hagan". El valor real es ver qué obras están
-- AL DÍA y cuáles ATRASADAS o en CERO — para que el ingeniero sepa qué le falta.
-- Ronda 04/09/2026. Aditivo, idempotente.
--
-- Devuelve UNA fila por obra ACTIVA real (incluidas las de 0 bitácoras, que son
-- justo las que hay que atender): totales, última fecha, días sin reportar, y un
-- desglose por fecha (jsonb {fecha: n}) para pintar la matriz obra × fecha.
--
-- Gate: quien ve bitácoras de gestión (bitácora / dirección / proyectos) o Tec/admin.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-04-bj1-bitacoras-cobertura.sql
-- =============================================================================
begin;
set local search_path = sgc, public;

create or replace function sgc.bitacoras_cobertura(
  p_desde date default null,
  p_hasta date default null,
  p_incluir_prueba boolean default false
)
returns table (
  obra_id uuid,
  obra text,
  activa boolean,
  total bigint,
  dias_con_bitacora bigint,
  primera date,
  ultima date,
  dias_sin_reportar integer,
  por_fecha jsonb
)
language plpgsql stable security definer
set search_path to 'sgc', 'public'
as $$
begin
  -- Gate: quien gestiona/ve bitácoras de obra (o Tecnología/admin). Respeta roles.
  if not (sgc.is_admin() or sgc.es_tecnologia()
          or sgc.tiene_modulo('bitacora') or sgc.tiene_modulo('direccion') or sgc.tiene_modulo('proyectos')) then
    raise exception 'No autorizado para el reporte de bitácoras.' using errcode = '42501';
  end if;
  return query
  with b as (
    select bi.proyecto_id, bi.fecha
    from sgc.bitacoras bi
    where (p_incluir_prueba or coalesce(bi.es_prueba,false) = false)
      and (p_desde is null or bi.fecha >= p_desde)
      and (p_hasta is null or bi.fecha <= p_hasta)
  )
  select
    p.id as obra_id,
    p.nombre as obra,
    coalesce(p.activo, true) as activa,
    count(b.fecha) as total,
    count(distinct b.fecha) as dias_con_bitacora,
    min(b.fecha) as primera,
    max(b.fecha) as ultima,
    case when max(b.fecha) is null then null else (current_date - max(b.fecha))::int end as dias_sin_reportar,
    coalesce(
      (select jsonb_object_agg(x.fecha::text, x.n)
         from (select b2.fecha, count(*) as n from b b2 where b2.proyecto_id = p.id group by b2.fecha) x),
      '{}'::jsonb
    ) as por_fecha
  from sgc.proyectos p
  left join b on b.proyecto_id = p.id
  where coalesce(p.activo, true) = true
    and (p_incluir_prueba or coalesce(p.es_prueba,false) = false)
  group by p.id, p.nombre, p.activo
  order by max(b.fecha) desc nulls last, p.nombre;
end;
$$;

grant execute on function sgc.bitacoras_cobertura(date, date, boolean) to authenticated, service_role;

revoke execute on function sgc.bitacoras_cobertura(date, date, boolean) from public;

commit;
