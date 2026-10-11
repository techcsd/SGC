-- 2026-10-09-cm6-incentivo-topes.sql — CM6 (reglas 18/19) — tope de incentivos
--
-- Tope semanal (puntos) + tope por actividad (número de veces, por día y por semana).
-- Semántica confirmada por Xaviel/Misael:
--   · el tope cuenta NÚMERO de veces (no puntos);
--   · la AYUDA cuenta en el MISMO tope que lo propio (se suman, propio primero);
--   · el FACTOR de ayudante se aplica DESPUÉS del tope;
--   · además hay un tope TOTAL de puntos por semana (maximo_semanal).
-- Aditivo: la versión vigente queda SIN tope (null) → nada cambia hasta que guarden topes.
-- Las semanas ya generadas NO se recalculan. Regla 19: defs vivas en prod leídas y == dev.
--
--   node scripts/apply-migration.mjs sql/2026-10-09-cm6-incentivo-topes.sql --env dev

begin;

alter table sgc.incentivo_config
  add column if not exists maximo_semanal numeric,
  add column if not exists topes jsonb not null default '{}';   -- {renglon: {dia:int|null, semana:int|null}}

alter table sgc.incentivo_semana
  add column if not exists maximo numeric,
  add column if not exists topes jsonb,
  add column if not exists puntaje_bruto numeric;

-- ── set_config: ahora acepta maximo_semanal + topes ─────────────────────────────
drop function if exists sgc.incentivo_set_config(numeric, jsonb, numeric, text);
create or replace function sgc.incentivo_set_config(
  p_minimo numeric, p_pesos jsonb, p_ayudante_factor numeric, p_nota text default null,
  p_maximo numeric default null, p_topes jsonb default '{}')
 returns integer
 language plpgsql
 security definer
 set search_path to 'sgc', 'public'
as $function$
declare v_version int; v_penal jsonb;
begin
  if not sgc.puede_gestionar_incentivos() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_strip_nulls(jsonb_build_object(
           '_penal_gracia_dias', pesos->'_penal_gracia_dias',
           '_penal_pts_dia',     pesos->'_penal_pts_dia',
           '_penal_tope',        pesos->'_penal_tope'))
    into v_penal from sgc.incentivo_config where activo order by version desc limit 1;
  update sgc.incentivo_config set activo = false where activo;
  insert into sgc.incentivo_config (minimo_semanal, pesos, ayudante_factor, activo, nota, creado_por, maximo_semanal, topes)
  values (p_minimo, coalesce(v_penal,'{}'::jsonb) || coalesce(p_pesos,'{}'::jsonb), coalesce(p_ayudante_factor, 1),
          true, p_nota, auth.uid(), p_maximo, coalesce(p_topes,'{}'::jsonb))
  returning version into v_version;
  return v_version;
end;
$function$;
grant execute on function sgc.incentivo_set_config(numeric, jsonb, numeric, text, numeric, jsonb) to authenticated, service_role;

-- ── generar_semana: aplica topes por día → semana (propio primero), factor después,
--    y corte total en maximo_semanal. conteos gana contados/excedente; +puntaje_bruto. ──
create or replace function sgc.incentivo_generar_semana(p_anio integer, p_semana integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'sgc', 'public'
as $function$
declare
  v_inicio date := sgc.incentivo_semana_inicio(p_anio, p_semana);
  v_fin    date := sgc.incentivo_semana_inicio(p_anio, p_semana) + 6;
  v_cfg    sgc.incentivo_config%rowtype;
  v_factor numeric;
  v_count  int := 0;
  v_inf    int := 2147483647;
begin
  select * into v_cfg from sgc.incentivo_config where activo order by version desc limit 1;
  if not found then raise exception 'No hay configuración de incentivo activa' using errcode = 'AT404'; end if;
  v_factor := coalesce(v_cfg.ayudante_factor, 1);

  with
  ruta_flag as (
    select r.id, coalesce(c.usuario_id, r.creado_por) as usuario_id,
           coalesce(d.decision, 'cuarentena') as decision
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
      left join sgc.incentivo_incidencia_decision d
             on d.anio = p_anio and d.semana = p_semana and d.ref_tipo = 'ruta' and d.ref_id = r.id
     where r.estado = 'completada' and not r.es_prueba
       and not coalesce(r.derivada_de_conduce, false)
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) between v_inicio and v_fin
       and (coalesce(r.km_real, 0) = 0 or coalesce(r.tiempo_real_min, 0) = 0)
       and coalesce(c.usuario_id, r.creado_por) is not null
  ),
  echada_flag as (
    select rc.id, rc.registrado_por as usuario_id, coalesce(d.decision, 'cuarentena') as decision
      from sgc.registros_combustible rc
      left join sgc.incentivo_incidencia_decision d
             on d.anio = p_anio and d.semana = p_semana and d.ref_tipo = 'echada' and d.ref_id = rc.id
     where not rc.es_prueba and rc.registrado_por is not null and not coalesce(rc.invalidada, false)
       and rc.fecha between v_inicio and v_fin
       and exists (select 1 from sgc.registros_combustible r2
          where r2.id <> rc.id and r2.registrado_por = rc.registrado_por
            and not coalesce(r2.invalidada, false)
            and date_trunc('minute', r2.created_at) = date_trunc('minute', rc.created_at))
  ),
  titulares as (
    select ck.creado_por as usuario_id, 'reporte_semanal'::text as renglon, ck.id as ref_id, ck.fecha as ref_fecha
      from sgc.checklists_vehiculo ck join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia = 'semanal' and not ck.es_prueba and ck.creado_por is not null and ck.fecha between v_inicio and v_fin
    union all
    select ck.creado_por, 'inspeccion', ck.id, ck.fecha
      from sgc.checklists_vehiculo ck join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia <> 'semanal' and not ck.es_prueba and ck.creado_por is not null and ck.fecha between v_inicio and v_fin
    union all
    select rc.registrado_por, 'echada', rc.id, rc.fecha
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null and not coalesce(rc.invalidada, false)
       and coalesce(nullif(trim(rc.foto_tablero_path), ''), null) is not null and rc.fecha between v_inicio and v_fin
       and not exists (select 1 from echada_flag ef where ef.id = rc.id and ef.decision <> 'aceptada')
    union all
    select coalesce(c.usuario_id, r.creado_por), 'ruta', r.id, r.fecha
      from sgc.rutas r left join sgc.conductores c on c.id = r.conductor_id
     where r.estado = 'completada' and not r.es_prueba and not coalesce(r.derivada_de_conduce, false)
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) between v_inicio and v_fin
       and coalesce(c.usuario_id, r.creado_por) is not null
       and not exists (select 1 from ruta_flag rf where rf.id = r.id and rf.decision <> 'aceptada')
    union all
    select coalesce(c.usuario_id, s.entregado_por), 'conduce', s.id, s.fecha
      from sgc.salidas_inventario s left join sgc.conductores c on c.id = s.conductor_id
     where s.recibido_por is not null and not s.es_prueba
       and coalesce((s.recibido_en at time zone 'America/Santo_Domingo')::date,
                    (s.entregado_en at time zone 'America/Santo_Domingo')::date, s.fecha) between v_inicio and v_fin
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
  -- Totales SIN tope (para puntaje_bruto y excedente).
  tot as (
    select usuario_id, renglon,
           count(*) filter (where not es_ayudante) propio_t,
           count(*) filter (where es_ayudante)     ayud_t
      from eventos group by usuario_id, renglon
  ),
  -- Tope por DÍA (propio primero). rn<=tope.dia cuenta.
  ev_dia as (
    select e.*, row_number() over (partition by e.usuario_id, e.renglon, e.ref_fecha
                                   order by e.es_ayudante, e.ref_fecha, e.ref_id) rn_dia
      from eventos e
  ),
  ev_dia_ok as (
    select * from ev_dia e
     where e.rn_dia <= coalesce((v_cfg.topes->e.renglon->>'dia')::int, v_inf)
  ),
  -- Tope por SEMANA (propio primero) sobre lo que pasó el tope diario.
  ev_sem as (
    select e.*, row_number() over (partition by e.usuario_id, e.renglon
                                   order by e.es_ayudante, e.ref_fecha, e.ref_id) rn_sem
      from ev_dia_ok e
  ),
  ev_ok as (
    select * from ev_sem e
     where e.rn_sem <= coalesce((v_cfg.topes->e.renglon->>'semana')::int, v_inf)
  ),
  por_renglon as (
    select ok.usuario_id, ok.renglon,
           count(*) filter (where not ok.es_ayudante) propio,
           count(*) filter (where ok.es_ayudante)     ayudante,
           (count(*) filter (where not ok.es_ayudante)
            + count(*) filter (where ok.es_ayudante) * v_factor)
             * coalesce((v_cfg.pesos->>ok.renglon)::numeric, 0) as puntos,
           jsonb_agg(jsonb_build_object('id', ok.ref_id, 'tipo', ok.renglon,
                     'fecha', ok.ref_fecha, 'ayudante', ok.es_ayudante) order by ok.ref_fecha) as refs
      from ev_ok ok group by ok.usuario_id, ok.renglon
  ),
  agg as (
    select pr.usuario_id,
           jsonb_object_agg(pr.renglon, jsonb_build_object(
             'propio', pr.propio, 'ayudante', pr.ayudante, 'puntos', pr.puntos,
             'contados', pr.propio + pr.ayudante,
             'excedente', greatest(0, coalesce(t.propio_t + t.ayud_t, 0) - (pr.propio + pr.ayudante)),
             'refs', pr.refs)) as conteos,
           sum(pr.puntos) as puntaje
      from por_renglon pr
      left join tot t on t.usuario_id = pr.usuario_id and t.renglon = pr.renglon
     group by pr.usuario_id
  ),
  agg_bruto as (
    select usuario_id,
           sum((propio_t + ayud_t * v_factor) * coalesce((v_cfg.pesos->>renglon)::numeric, 0)) as puntaje_bruto
      from tot group by usuario_id
  ),
  flags_ruta as (
    select rf.usuario_id,
           jsonb_build_object('tipo','ruta_sin_metrica','ref_tipo','ruta','ref_id', rf.id,
             'fecha', r.fecha, 'decision', rf.decision,
             'msg','Ruta completada con 0 km o 0 min — revisar') as flag
      from ruta_flag rf join sgc.rutas r on r.id = rf.id
  ),
  flags_echada as (
    select ef.usuario_id,
           jsonb_build_object('tipo','echada_duplicada','ref_tipo','echada','ref_id', ef.id,
             'fecha', rc.fecha, 'decision', ef.decision,
             'msg','Echada registrada en el mismo minuto que otra — revisar') as flag
      from echada_flag ef join sgc.registros_combustible rc on rc.id = ef.id
  ),
  flags_all as (
    select usuario_id, jsonb_agg(flag) as flags
      from (select * from flags_ruta union all select * from flags_echada) f group by usuario_id
  ),
  poblacion as (
    select usuario_id from agg union select usuario_id from flags_all
  )
  insert into sgc.incentivo_semana as ins
    (anio, semana, inicio, fin, usuario_id, conductor_id, config_version, pesos, minimo,
     conteos, puntaje, cumplio, flags, generado_at, maximo, topes, puntaje_bruto)
  select p_anio, p_semana, v_inicio, v_fin, p.usuario_id,
         (select id from sgc.conductores c where c.usuario_id = p.usuario_id limit 1),
         v_cfg.version, v_cfg.pesos, v_cfg.minimo_semanal,
         coalesce(a.conteos, '{}'::jsonb),
         least(coalesce(a.puntaje, 0), coalesce(v_cfg.maximo_semanal, 'infinity'::numeric)),
         (least(coalesce(a.puntaje, 0), coalesce(v_cfg.maximo_semanal, 'infinity'::numeric)) >= v_cfg.minimo_semanal),
         coalesce(fa.flags, '[]'::jsonb), now(),
         v_cfg.maximo_semanal, v_cfg.topes, coalesce(ab.puntaje_bruto, 0)
    from poblacion p
    left join agg a on a.usuario_id = p.usuario_id
    left join agg_bruto ab on ab.usuario_id = p.usuario_id
    left join flags_all fa on fa.usuario_id = p.usuario_id
   where exists (select 1 from sgc.incentivo_participante ip where ip.usuario_id = p.usuario_id and ip.es_chofer)
  on conflict (anio, semana, usuario_id) do update
    set conteos = excluded.conteos, puntaje = excluded.puntaje, cumplio = excluded.cumplio,
        flags = excluded.flags, pesos = excluded.pesos, minimo = excluded.minimo,
        config_version = excluded.config_version, conductor_id = excluded.conductor_id,
        maximo = excluded.maximo, topes = excluded.topes, puntaje_bruto = excluded.puntaje_bruto,
        generado_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ── Sugerencia de topes: p90 (aprox) de las últimas 8 semanas por renglón ────────
create or replace function sgc.incentivo_sugerir_topes()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'sgc', 'public'
as $function$
  with ult as (
    select * from sgc.incentivo_semana
     order by anio desc, semana desc limit (8 * 50)  -- ~8 semanas × choferes
  ),
  porr as (
    select key as renglon, (value->>'contados')::numeric as contados
      from ult, jsonb_each(coalesce(conteos,'{}'::jsonb))
     where (value->>'contados') is not null
  )
  select coalesce(jsonb_object_agg(renglon, jsonb_build_object(
           'semana', ceil(p90), 'dia', greatest(1, ceil(p90 / 6.0)))), '{}'::jsonb)
    from (
      select renglon, percentile_cont(0.9) within group (order by contados) as p90
        from porr group by renglon
    ) s;
$function$;
grant execute on function sgc.incentivo_sugerir_topes() to authenticated, service_role;

commit;
