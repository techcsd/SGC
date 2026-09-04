-- =============================================================================
-- PROMPT-32+ (BJ1b) — Resumen de cobertura de bitácoras para Compa (WhatsApp).
-- Variante ligera de bitacoras_cobertura SIN la matriz por_fecha (que Compa no
-- necesita para responder en texto): una fila por obra con total, última fecha,
-- días sin reportar y un estado legible (al día / atrasada / sin bitácoras).
-- Ronda 04/09/2026. Aditivo, idempotente.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-04-bj1b-cobertura-resumen-compa.sql
-- =============================================================================
begin;
set local search_path = sgc, public;

create or replace function sgc.bitacoras_cobertura_resumen(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  obra text,
  total bigint,
  dias_con_bitacora bigint,
  ultima date,
  dias_sin_reportar integer,
  estado text
)
language plpgsql stable security definer
set search_path to 'sgc', 'public'
as $$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()
          or sgc.tiene_modulo('bitacora') or sgc.tiene_modulo('direccion') or sgc.tiene_modulo('proyectos')) then
    raise exception 'No autorizado para el reporte de bitácoras.' using errcode = '42501';
  end if;
  return query
  with b as (
    select bi.proyecto_id, bi.fecha
    from sgc.bitacoras bi
    where coalesce(bi.es_prueba,false) = false
      and (p_desde is null or bi.fecha >= p_desde)
      and (p_hasta is null or bi.fecha <= p_hasta)
  )
  select
    p.nombre,
    count(b.fecha),
    count(distinct b.fecha),
    max(b.fecha),
    case when max(b.fecha) is null then null else (current_date - max(b.fecha))::int end,
    case
      when count(b.fecha) = 0 then 'sin bitácoras'
      when (current_date - max(b.fecha)) >= 3 then 'atrasada'
      else 'al día'
    end
  from sgc.proyectos p
  left join b on b.proyecto_id = p.id
  where coalesce(p.activo, true) = true and coalesce(p.es_prueba,false) = false
  group by p.id, p.nombre
  order by max(b.fecha) desc nulls last, p.nombre;
end;
$$;
grant execute on function sgc.bitacoras_cobertura_resumen(date, date) to authenticated, service_role;
revoke execute on function sgc.bitacoras_cobertura_resumen(date, date) from public;

commit;
