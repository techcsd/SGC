-- CW4 — Reporte de rendimiento por vehículo (Eduardo). Usa las mismas echadas de
-- combustible que ya existen; no inventa datos nuevos. Método (D4, CONTEXTO-56 §4):
-- por vehículo y período, rendimiento = Σ km (u horas) ÷ Σ galones, SIN CONTAR la
-- primera echada del período (esa echada llenó el tanque para el tramo anterior al
-- período, no hay con qué atribuirle un consumo dentro de la ventana). Se excluyen
-- echadas duplicadas (mismo vehículo+galones+monto en <5min, igual que el blindaje
-- de registrar_combustible_app) y datos de prueba. Nunca se captura "tanque lleno",
-- así que el número es una aproximación — se acompaña de un nivel de confianza.
--
--   node scripts/apply-migration.mjs sql/2026-10-23-cw4-reporte-rendimiento.sql --env dev
-- -------------------------------------------------------------------------------------
begin;
set local search_path = sgc, public;

create or replace function sgc.reporte_rendimiento_vehiculos(
  p_desde date, p_hasta date, p_vehiculo_id uuid default null)
returns table (
  vehiculo_id uuid, placa text, alias text, medida_uso text,
  echadas_total int, echadas_usadas int, echadas_excluidas_dup int,
  total_km numeric, total_galones numeric, rendimiento numeric,
  unidad text, confianza text, baseline numeric, estado_actual text
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  -- auth.uid() is null = llamada server-to-server (edge del correo semanal vía
  -- service role) — igual que el resto de los RPC que alimentan correos automáticos.
  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or auth.uid() is null) then
    raise exception 'No tienes acceso a Combustible.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Elige un período válido (desde ≤ hasta).' using errcode = '22023';
  end if;

  -- Nota: las CTEs usan "veh_id" (no "vehiculo_id") porque "vehiculo_id" es el
  -- nombre de una columna OUT de esta función — un `vehiculo_id` sin calificar
  -- en el SQL sería ambiguo con la variable plpgsql del mismo nombre.
  return query
  with crudo as (
    select rc.id, rc.vehiculo_id as veh_id, rc.galones, rc.km_recorridos, rc.monto, rc.fecha, rc.created_at
    from sgc.registros_combustible rc
    where coalesce(rc.es_prueba, false) = false
      and rc.vehiculo_id is not null
      and rc.fecha between p_desde and p_hasta
      and (p_vehiculo_id is null or rc.vehiculo_id = p_vehiculo_id)
  ),
  -- Duplicados: mismo vehículo + galones + monto a menos de 5 minutos de distancia
  -- (misma regla que el anti-dup de registrar_combustible_app) — se queda la más vieja.
  marcado as (
    select c.*,
      exists (
        select 1 from crudo c2
        where c2.veh_id = c.veh_id and c2.id <> c.id
          and c2.galones = c.galones and coalesce(c2.monto,0) = coalesce(c.monto,0)
          and c2.created_at < c.created_at
          and c.created_at - c2.created_at < interval '5 minutes'
      ) as es_duplicado
    from crudo c
  ),
  sin_dup as (
    select * from marcado where not es_duplicado
  ),
  -- Descarta la primera echada cronológica de CADA vehículo dentro del período.
  numerado as (
    select *, row_number() over (partition by veh_id order by fecha, created_at) as rn
    from sin_dup
  ),
  usable as (
    select * from numerado where rn > 1
  ),
  agregado as (
    select
      v.id as veh_id, v.placa, v.alias, v.medida_uso,
      (select count(*) from crudo c where c.veh_id = v.id)::int as echadas_total,
      count(u.id)::int as echadas_usadas,
      (select count(*) from marcado m where m.veh_id = v.id and m.es_duplicado)::int as echadas_excluidas_dup,
      coalesce(sum(u.km_recorridos), 0)::numeric as total_km,
      coalesce(sum(u.galones), 0)::numeric as total_galones,
      v.rendimiento_esperado_km_gal as baseline
    from sgc.vehiculos v
    left join usable u on u.veh_id = v.id
    where (p_vehiculo_id is null or v.id = p_vehiculo_id)
      and exists (select 1 from crudo c where c.veh_id = v.id)
    group by v.id, v.placa, v.alias, v.medida_uso, v.rendimiento_esperado_km_gal
  )
  select
    a.veh_id, a.placa, a.alias, a.medida_uso,
    a.echadas_total, a.echadas_usadas, a.echadas_excluidas_dup,
    a.total_km, a.total_galones,
    case when a.total_galones > 0 then round(a.total_km / a.total_galones, 2) else null end as rendimiento,
    case when a.medida_uso = 'horas' then 'gal/hora' else 'km/gal' end as unidad,
    -- Confianza — heurística simple y explicable: más echadas y más distancia = más confianza.
    case
      when a.echadas_usadas = 0 or a.total_galones <= 0 then 'sin_datos'
      when a.echadas_usadas >= 4 and a.total_km >= 200 then 'alta'
      when a.echadas_usadas >= 2 and a.total_km >= 50 then 'media'
      else 'baja'
    end as confianza,
    a.baseline,
    (select rc2.estado from sgc.registros_combustible rc2
      where rc2.vehiculo_id = a.veh_id and coalesce(rc2.es_prueba,false) = false
      order by rc2.fecha desc, rc2.created_at desc limit 1) as estado_actual
  from agregado a
  order by a.placa nulls last, a.alias nulls last;
end;
$function$;
grant execute on function sgc.reporte_rendimiento_vehiculos(date, date, uuid) to authenticated;
comment on function sgc.reporte_rendimiento_vehiculos(date, date, uuid) is 'CW4 — rendimiento por vehículo en un período: Σkm÷Σgal sin la primera echada del período, duplicados excluidos, con nivel de confianza. Gate: admin o módulo flota.';

commit;
