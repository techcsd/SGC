-- ════════════════════════════════════════════════════════════════════════════
-- BH3 (parte incentivo) — incentivo_generar_semana excluye las rutas DERIVADAS
-- de un conduce del renglón `ruta` (y de sus incidencias 0km/0min). Decisión de
-- Xaviel: la ruta derivada NO puntúa; el conduce ya paga ese viaje. Copia fiel de
-- la función vigente + 2 líneas `and not coalesce(r.derivada_de_conduce,false)`.
-- Depende de 2026-09-02-bh3-conduce-asegura-ruta.sql (crea la columna).
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local search_path = sgc, public;

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
    raise exception 'No hay configuración de incentivo activa' using errcode = 'AT404';
  end if;
  v_factor := coalesce(v_cfg.ayudante_factor, 1);

  with
  -- Rutas con incidencia (0 km o 0 min) de la semana.
  ruta_flag as (
    select r.id,
           coalesce(c.usuario_id, r.creado_por) as usuario_id,
           coalesce(d.decision, 'cuarentena') as decision
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
      left join sgc.incentivo_incidencia_decision d
             on d.anio = p_anio and d.semana = p_semana and d.ref_tipo = 'ruta' and d.ref_id = r.id
     where r.estado = 'completada' and not r.es_prueba
       and not coalesce(r.derivada_de_conduce, false)  -- BH3: la ruta derivada de un conduce NO puntúa (el conduce ya paga)
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) between v_inicio and v_fin
       and (coalesce(r.km_real, 0) = 0 or coalesce(r.tiempo_real_min, 0) = 0)
       and coalesce(c.usuario_id, r.creado_por) is not null
  ),
  -- Echadas registradas en el mismo minuto que otra (posible duplicado).
  echada_flag as (
    select rc.id, rc.registrado_por as usuario_id,
           coalesce(d.decision, 'cuarentena') as decision
      from sgc.registros_combustible rc
      left join sgc.incentivo_incidencia_decision d
             on d.anio = p_anio and d.semana = p_semana and d.ref_tipo = 'echada' and d.ref_id = rc.id
     where not rc.es_prueba and rc.registrado_por is not null
       and not coalesce(rc.invalidada, false)
       and rc.fecha between v_inicio and v_fin
       and exists (
         select 1 from sgc.registros_combustible r2
          where r2.id <> rc.id and r2.registrado_por = rc.registrado_por
            and not coalesce(r2.invalidada, false)
            and date_trunc('minute', r2.created_at) = date_trunc('minute', rc.created_at))
  ),
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
    -- Echada CON foto de tablero (AT1) y NO invalidada (AW3). BB8b: si está en
    -- cuarentena/excluida por incidencia, NO cuenta.
    select rc.registrado_por, 'echada', rc.id, rc.fecha
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null
       and not coalesce(rc.invalidada, false)
       and coalesce(nullif(trim(rc.foto_tablero_path), ''), null) is not null
       and rc.fecha between v_inicio and v_fin
       and not exists (select 1 from echada_flag ef where ef.id = rc.id and ef.decision <> 'aceptada')
    union all
    -- Ruta completada. BB8b: si tiene incidencia y no fue aceptada, NO cuenta.
    select coalesce(c.usuario_id, r.creado_por), 'ruta', r.id, r.fecha
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
     where r.estado = 'completada' and not r.es_prueba
       and not coalesce(r.derivada_de_conduce, false)  -- BH3: la ruta derivada de un conduce NO puntúa (el conduce ya paga)
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha)
             between v_inicio and v_fin
       and coalesce(c.usuario_id, r.creado_por) is not null
       and not exists (select 1 from ruta_flag rf where rf.id = r.id and rf.decision <> 'aceptada')
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
  -- Flags para la salida (con ref_tipo, fecha y estado de decisión) — la UI las
  -- agrupa y ofrece aceptar/excluir (BB8a).
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
      from (select * from flags_ruta union all select * from flags_echada) f
     group by usuario_id
  ),
  -- Población: choferes con puntos O con incidencias (para que un chofer cuyas
  -- rutas quedaron todas en cuarentena siga apareciendo, en 0, con sus flags).
  poblacion as (
    select usuario_id from agg
    union
    select usuario_id from flags_all
  )
  insert into sgc.incentivo_semana as ins
    (anio, semana, inicio, fin, usuario_id, conductor_id, config_version, pesos, minimo,
     conteos, puntaje, cumplio, flags, generado_at)
  select p_anio, p_semana, v_inicio, v_fin, p.usuario_id,
         (select id from sgc.conductores c where c.usuario_id = p.usuario_id limit 1),
         v_cfg.version, v_cfg.pesos, v_cfg.minimo_semanal,
         coalesce(a.conteos, '{}'::jsonb), coalesce(a.puntaje, 0),
         (coalesce(a.puntaje, 0) >= v_cfg.minimo_semanal),
         coalesce(fa.flags, '[]'::jsonb), now()
    from poblacion p
    left join agg a on a.usuario_id = p.usuario_id
    left join flags_all fa on fa.usuario_id = p.usuario_id
   where exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = p.usuario_id and r.codigo = 'chofer_transportista')
  on conflict (anio, semana, usuario_id) do update
    set conteos = excluded.conteos, puntaje = excluded.puntaje, cumplio = excluded.cumplio,
        flags = excluded.flags, pesos = excluded.pesos, minimo = excluded.minimo,
        config_version = excluded.config_version, conductor_id = excluded.conductor_id,
        generado_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

commit;
