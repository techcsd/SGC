-- ============================================================================
-- AX5 — Población de la matriz de incentivos = SOLO choferes.
-- El motor derivaba la población por ACTIVIDAD (creado_por/registrado_por/
-- entregado_por), así que cualquier no-chofer con actividad de transporte
-- (ingenieros, gerentes, jefe de flota, incluso admin) entraba en la matriz y en
-- el correo. Fix (aditivo): gate por rol `chofer_transportista` en la generación
-- y en el read path; el correo real además excluye choferes de prueba.
-- No borra filas existentes (varias ya tienen decisión) — quedan ocultas por el
-- gate; reportar las erróneas a Xaviel por si revierte pagos.
-- ============================================================================

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
  return v_count;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- AX5 — read path del módulo Desempeño de choferes (lo usan la pantalla Y el
-- correo). Dos cambios:
--   1) gate por rol chofer_transportista (misma regla que la generación) →
--      no-choferes nunca aparecen en la matriz (bug de población AV1/AV2/AX5).
--   2) p_incluir_prueba (default true = pantalla, para QA): el correo real llama
--      con false para excluir choferes de prueba (conductores.es_prueba).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sgc.incentivo_listado(p_anio integer, p_semana integer, p_incluir_prueba boolean DEFAULT true)
 RETURNS TABLE(informe_id uuid, usuario_id uuid, nombre text, conductor_id uuid, puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb, flags jsonb, decision text, motivo text, decidido_por uuid, decidido_por_nombre text, decidido_en timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
  select s.id, s.usuario_id, u.nombre, s.conductor_id,
         s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags,
         v.decision, v.motivo, v.decidido_por, du.nombre, v.decidido_en
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
    left join sgc.usuarios du on du.id = v.decidido_por
   where s.anio = p_anio and s.semana = p_semana
     and sgc.puede_gestionar_incentivos()
     and exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = s.usuario_id and r.codigo = 'chofer_transportista')
     and (p_incluir_prueba
          or not exists (select 1 from sgc.conductores c
                         where c.usuario_id = s.usuario_id and coalesce(c.es_prueba, false)))
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$function$;
