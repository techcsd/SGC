-- ════════════════════════════════════════════════════════════════════════════
-- AV13b — mis_rutas_hoy expone modificada_at (chip "(modificada)" en la lista)
-- ════════════════════════════════════════════════════════════════════════════
-- AV13 (PROMPT-23) agregó rutas.modificada_at y lo expuso en rutas_activas_y_hoy
-- y ruta_detalle_transporte, pero NO en mis_rutas_hoy (la lista del chofer en la
-- app). Se agrega el campo de forma aditiva para pintar "(modificada) · hora" en
-- la lista "Mis rutas" además del detalle. Retrocompatible (solo suma una clave).
-- ════════════════════════════════════════════════════════════════════════════

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
    -- AG11 — vehículo de la ruta (para tag de posición + resume de tracking).
    'vehiculo_id', r.vehiculo_id,
    'placa', v.placa,
    -- AK22 — fecha y hora de planificación/creación de la ruta.
    'creado_en', r.created_at
  ) order by r.fecha desc), '[]'::jsonb)
  from sgc.rutas r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  where (r.fecha = current_date or r.estado = 'en_curso')
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$function$;
grant execute on function sgc.mis_rutas_hoy() to authenticated, service_role;
