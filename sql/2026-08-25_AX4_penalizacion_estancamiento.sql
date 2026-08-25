-- ============================================================================
-- AX4 - Penalizacion por ESTADO ESTANCADO (renglon negativo del motor AT1).
-- Direccion (decision de Xaviel): NO se premian los cambios de estado; se PENALIZA
-- al chofer que pasa dias laborables SIN ninguna senal (ni cambio de estado en
-- chofer_estado_historial, ni actividad registrada esa fecha). Configurable y
-- versionado en la config del incentivo (claves _penal_* dentro de pesos), con
-- periodo de gracia y tope semanal. DEFAULT APAGADO (_penal_pts_dia=0): mientras
-- valga 0, la funcion es no-op y el pago no cambia. Exenciones: domingo (no
-- laborable) y dias CON senal.
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

  with dias_lab as (
    select d::date as dia
      from generate_series(v_inicio, v_fin, interval '1 day') g(d)
     where extract(dow from d) <> 0
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

CREATE OR REPLACE FUNCTION sgc.incentivo_set_penalizacion(p_gracia_dias integer, p_pts_dia numeric, p_tope numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare v_version int;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.incentivo_config
     set pesos = pesos
                 || jsonb_build_object('_penal_gracia_dias', coalesce(p_gracia_dias, 2))
                 || jsonb_build_object('_penal_pts_dia', coalesce(p_pts_dia, 0))
                 || jsonb_build_object('_penal_tope', coalesce(p_tope, 4))
   where activo
  returning version into v_version;
  return v_version;
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.incentivo_set_config(p_minimo numeric, p_pesos jsonb, p_ayudante_factor numeric, p_nota text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare v_version int; v_penal jsonb;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select jsonb_strip_nulls(jsonb_build_object(
           '_penal_gracia_dias', pesos->'_penal_gracia_dias',
           '_penal_pts_dia',     pesos->'_penal_pts_dia',
           '_penal_tope',        pesos->'_penal_tope'))
    into v_penal
    from sgc.incentivo_config where activo order by version desc limit 1;
  update sgc.incentivo_config set activo = false where activo;
  insert into sgc.incentivo_config (minimo_semanal, pesos, ayudante_factor, activo, nota, creado_por)
  values (p_minimo, coalesce(v_penal,'{}'::jsonb) || coalesce(p_pesos,'{}'::jsonb), coalesce(p_ayudante_factor, 1), true, p_nota, auth.uid())
  returning version into v_version;
  return v_version;
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.incentivo_generar_semana(p_anio integer, p_semana integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare
  v_inicio date := sgc.incentivo_semana_inicio(p_anio, p_semana);
  v_fin    date := sgc.incentivo_semana_inicio(p_anio, p_semana) + 6;
  v_cfg    sgc.incentivo_config%rowtype;
  v_factor numeric;
  v_count  int := 0;
begin
  select * into v_cfg from sgc.incentivo_config where activo order by version desc limit 1;
  if not found then
    raise exception 'No hay configuraciÃ³n de incentivo activa' using errcode = 'AT404';
  end if;
  v_factor := coalesce(v_cfg.ayudante_factor, 1);

  with
  titulares as (
    select ck.creado_por as usuario_id, 'reporte_semanal'::text as renglon, ck.id as ref_id, ck.fecha as ref_fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia = 'semanal' and not ck.es_prueba and ck.creado_por is not null
       and ck.fecha between v_inicio and v_fin
    union all
    select ck.creado_por, 'inspeccion', ck.id, ck.fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia <> 'semanal' and not ck.es_prueba and ck.creado_por is not null
       and ck.fecha between v_inicio and v_fin
    union all
    -- Echada CON foto de tablero (AT1) y NO invalidada (AW3).
    select rc.registrado_por, 'echada', rc.id, rc.fecha
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null
       and not coalesce(rc.invalidada, false)
       and coalesce(nullif(trim(rc.foto_tablero_path), ''), null) is not null
       and rc.fecha between v_inicio and v_fin
    union all
    select coalesce(c.usuario_id, r.creado_por), 'ruta', r.id, r.fecha
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
     where r.estado = 'completada' and not r.es_prueba
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha)
             between v_inicio and v_fin
       and coalesce(c.usuario_id, r.creado_por) is not null
    union all
    select coalesce(c.usuario_id, s.entregado_por), 'conduce', s.id, s.fecha
      from sgc.salidas_inventario s
      left join sgc.conductores c on c.id = s.conductor_id
     where s.recibido_por is not null and not s.es_prueba
       and coalesce((s.recibido_en at time zone 'America/Santo_Domingo')::date,
                    (s.entregado_en at time zone 'America/Santo_Domingo')::date, s.fecha)
             between v_inicio and v_fin
       and coalesce(c.usuario_id, s.entregado_por) is not null
  ),
  ayudantes as (
    select ap.usuario_id, t.renglon, t.ref_id, t.ref_fecha
      from sgc.actividad_participantes ap
      join titulares t on t.renglon = ap.activity_type and t.ref_id = ap.activity_id
     where ap.rol = 'helper'
  ),
  eventos as (
    select usuario_id, renglon, ref_id, ref_fecha, false as es_ayudante from titulares
    union all
    select usuario_id, renglon, ref_id, ref_fecha, true  as es_ayudante from ayudantes
  ),
  por_renglon as (
    select e.usuario_id, e.renglon,
           count(*) filter (where not e.es_ayudante) as propio,
           count(*) filter (where e.es_ayudante)     as ayudante,
           (count(*) filter (where not e.es_ayudante)
            + count(*) filter (where e.es_ayudante) * v_factor)
             * coalesce((v_cfg.pesos->>e.renglon)::numeric, 0) as puntos,
           jsonb_agg(jsonb_build_object('id', e.ref_id, 'tipo', e.renglon,
                     'fecha', e.ref_fecha, 'ayudante', e.es_ayudante)
                     order by e.ref_fecha) as refs
      from eventos e
     group by e.usuario_id, e.renglon
  ),
  agg as (
    select usuario_id,
           jsonb_object_agg(renglon, jsonb_build_object(
             'propio', propio, 'ayudante', ayudante, 'puntos', puntos, 'refs', refs)) as conteos,
           sum(puntos) as puntaje
      from por_renglon group by usuario_id
  ),
  flags_ruta as (
    select coalesce(c.usuario_id, r.creado_por) as usuario_id,
           jsonb_build_object('tipo','ruta_sin_metrica','ref_id', r.id,
             'msg','Ruta completada con 0 km o 0 min â€” revisar') as flag
      from sgc.rutas r left join sgc.conductores c on c.id = r.conductor_id
     where r.estado='completada' and not r.es_prueba
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) between v_inicio and v_fin
       and (coalesce(r.km_real,0) = 0 or coalesce(r.tiempo_real_min,0) = 0)
       and coalesce(c.usuario_id, r.creado_por) is not null
  ),
  flags_echada as (
    select rc.registrado_por as usuario_id,
           jsonb_build_object('tipo','echada_duplicada','ref_id', rc.id,
             'msg','Echada registrada en el mismo minuto que otra â€” revisar') as flag
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null
       and not coalesce(rc.invalidada, false)
       and rc.fecha between v_inicio and v_fin
       and exists (
         select 1 from sgc.registros_combustible r2
          where r2.id <> rc.id and r2.registrado_por = rc.registrado_por
            and not coalesce(r2.invalidada, false)
            and date_trunc('minute', r2.created_at) = date_trunc('minute', rc.created_at))
  ),
  flags_all as (
    select usuario_id, jsonb_agg(flag) as flags
      from (select * from flags_ruta union all select * from flags_echada) f
     group by usuario_id
  )
  insert into sgc.incentivo_semana as ins
    (anio, semana, inicio, fin, usuario_id, conductor_id, config_version, pesos, minimo,
     conteos, puntaje, cumplio, flags, generado_at)
  select p_anio, p_semana, v_inicio, v_fin, a.usuario_id,
         (select id from sgc.conductores c where c.usuario_id = a.usuario_id limit 1),
         v_cfg.version, v_cfg.pesos, v_cfg.minimo_semanal,
         a.conteos, a.puntaje, (a.puntaje >= v_cfg.minimo_semanal),
         coalesce(fa.flags, '[]'::jsonb), now()
    from agg a
    left join flags_all fa on fa.usuario_id = a.usuario_id
   -- AX5 — solo CHOFERES reales (rol chofer_transportista). Excluye no-choferes
   -- (ingenieros/gerentes/jefe_flota con actividad o registro de conductor) que
   -- se colaban en la matriz por actividad. El incentivo es de choferes.
   where exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = a.usuario_id and r.codigo = 'chofer_transportista')
  on conflict (anio, semana, usuario_id) do update
    set conteos = excluded.conteos, puntaje = excluded.puntaje, cumplio = excluded.cumplio,
        flags = excluded.flags, pesos = excluded.pesos, minimo = excluded.minimo,
        config_version = excluded.config_version, conductor_id = excluded.conductor_id,
        generado_at = now();

  get diagnostics v_count = row_count;
  -- AX4 - aplica la penalizacion por estancamiento (renglon negativo). No-op si
  -- el peso esta en 0 (apagado por defecto). Idempotente (recalcula desde base).
  perform sgc._incentivo_penalizacion(p_anio, p_semana);
  return v_count;
end;
$function$;
