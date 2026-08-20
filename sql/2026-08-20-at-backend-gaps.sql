-- PROMPT-4 (ronda AT) — huecos de backend que desbloquean la app.
-- Todo ADITIVO y retrocompatible. Se aplica sobre el proyecto Supabase compartido
-- con SGC (web padre). Espejar en SGC/sql tras aplicar.
--
--   1) AT24 — desempate en mis_rutas_hoy: rutas del MISMO día salían en orden
--      indefinido (solo `fecha desc`), lo que se veía como "la nueva abajo".
--   2) AT3  — incentivo_mi_rendimiento ahora devuelve el `motivo` de la decisión
--      (la vista v_incentivo_decision_vigente ya lo tiene) para que el chofer vea
--      por qué le declinaron/aprobaron la semana.
--   3) AT4  — helper echada_id(client_uuid): registrar_combustible_app NO devuelve
--      el row id, así que el ayudante en una echada no se podía marcar. Con este
--      helper la app resuelve el id (por client_uuid, ya indexado) tras crear la
--      echada y llama marcar_ayudante('echada', id, usuario).

-- 1) AT24 — desempate por hora de inicio / creación (igual criterio que rutas_historial)
create or replace function sgc.mis_rutas_hoy()
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'origen', r.origen, 'destino', r.destino,
    'estado', r.estado, 'fecha', r.fecha, 'notas', r.notas,
    'iniciada_at', r.iniciada_at,
    'finalizada_at', r.finalizada_at,
    'modificada_at', r.modificada_at,      -- AV13b
    'tiempo_estimado_min', r.tiempo_estimado_min,
    'vehiculo_id', r.vehiculo_id,
    'placa', v.placa,
    'creado_en', r.created_at              -- AK22
  ) order by r.fecha desc, r.iniciada_at desc nulls last, r.created_at desc), '[]'::jsonb)
  from sgc.rutas r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  where (r.fecha = current_date or r.estado = 'en_curso')
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$function$;

-- 2) AT3 — añadir `motivo` a la salida. Cambiar el RETURNS TABLE obliga a DROP+CREATE.
drop function if exists sgc.incentivo_mi_rendimiento();
create function sgc.incentivo_mi_rendimiento()
returns table(
  informe_id uuid, anio integer, semana integer, inicio date, fin date,
  puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb,
  decision text, motivo text, decidido_en timestamptz
)
language sql
stable security definer
set search_path to 'sgc', 'public'
as $function$
  select s.id, s.anio, s.semana, s.inicio, s.fin,
         s.puntaje, s.minimo, s.cumplio, s.conteos,
         v.decision, v.motivo, v.decidido_en
    from sgc.incentivo_semana s
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
   where s.usuario_id = auth.uid()
   order by s.anio desc, s.semana desc;
$function$;
grant execute on function sgc.incentivo_mi_rendimiento() to authenticated;

-- 3) AT4 — resolver el id de una echada por su client_uuid (para marcar ayudante)
create or replace function sgc.echada_id(p_client_uuid uuid)
returns uuid
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select id from sgc.registros_combustible where client_uuid = p_client_uuid;
$function$;
grant execute on function sgc.echada_id(uuid) to authenticated;
