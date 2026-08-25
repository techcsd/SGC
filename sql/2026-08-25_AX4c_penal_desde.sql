-- ============================================================================
-- AX4c - Fecha de inicio de la penalizacion. La penalizacion por estancamiento
-- solo cuenta a partir de la semana cuyo lunes es _penal_desde; las semanas
-- anteriores quedan exentas ('esta semana no cuenta, a partir de esta si').
-- ============================================================================

CREATE OR REPLACE FUNCTION sgc._incentivo_penalizacion(p_anio integer, p_semana integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_cfg sgc.incentivo_config%rowtype;
  v_inicio date; v_fin date;
  v_gracia int; v_pts numeric; v_tope numeric;
begin
  select * into v_cfg from sgc.incentivo_config where activo order by version desc limit 1;
  if not found then return; end if;
  v_pts := coalesce((v_cfg.pesos->>'_penal_pts_dia')::numeric, 0);
  if v_pts <= 0 then return; end if;
  v_gracia := coalesce((v_cfg.pesos->>'_penal_gracia_dias')::int, 2);
  v_tope   := coalesce((v_cfg.pesos->>'_penal_tope')::numeric, 4);
  v_inicio := sgc.incentivo_semana_inicio(p_anio, p_semana);
  v_fin    := v_inicio + 6;
  -- AX4c - la penalizacion solo cuenta desde la fecha configurada (_penal_desde);
  -- las semanas anteriores quedan exentas ('a partir de esta semana cuenta').
  if (v_cfg.pesos ? '_penal_desde') and v_inicio < (v_cfg.pesos->>'_penal_desde')::date then
    return;
  end if;

  with dias_lab as (
    -- AX4b - los choferes trabajan la semana completa (incl. domingos): sin exencion.
    select d::date as dia
      from generate_series(v_inicio, v_fin, interval '1 day') g(d)
  ),
  base as (
    select s.id, s.usuario_id, s.conteos, s.minimo
      from sgc.incentivo_semana s
     where s.anio = p_anio and s.semana = p_semana
  ),
  pbase as (
    select b.id,
           coalesce(sum((e.value->>'puntos')::numeric) filter (where e.key <> 'estancamiento'), 0) as pos
      from base b, lateral jsonb_each(b.conteos) e
     group by b.id
  ),
  senal as (
    select h.usuario_id, (h.created_at at time zone 'America/Santo_Domingo')::date as dia
      from sgc.chofer_estado_historial h
     where (h.created_at at time zone 'America/Santo_Domingo')::date between v_inicio and v_fin
    union
    select b.usuario_id, (r.value->>'fecha')::date
      from base b,
           lateral jsonb_each(b.conteos) c,
           lateral jsonb_array_elements(coalesce(c.value->'refs', '[]'::jsonb)) r
     where c.key <> 'estancamiento' and (r.value->>'fecha') is not null
  ),
  estancados as (
    select b.id, b.usuario_id, b.minimo,
           count(*) filter (where s.usuario_id is null) as n_sin,
           array_agg(dl.dia order by dl.dia) filter (where s.usuario_id is null) as dias
      from base b
      cross join dias_lab dl
      left join senal s on s.usuario_id = b.usuario_id and s.dia = dl.dia
     group by b.id, b.usuario_id, b.minimo
  ),
  calc as (
    select e.id, e.minimo, e.dias, pb.pos,
           least(greatest(e.n_sin - v_gracia, 0) * v_pts, v_tope) as pts
      from estancados e join pbase pb on pb.id = e.id
  )
  update sgc.incentivo_semana s
     set conteos = (s.conteos - 'estancamiento') || jsonb_build_object('estancamiento', jsonb_build_object(
                     'propio', 0, 'ayudante', 0, 'puntos', -c.pts,
                     'refs', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', d::text, 'tipo', 'estancamiento', 'fecha', d, 'ayudante', false)), '[]'::jsonb)
                              from unnest(c.dias) d))),
         puntaje = c.pos - c.pts,
         cumplio = (c.pos - c.pts) >= s.minimo
    from calc c
   where s.id = c.id and c.pts > 0;
end;
$function$;
