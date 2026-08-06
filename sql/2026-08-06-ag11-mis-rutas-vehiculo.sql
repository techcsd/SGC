-- AG11 — Tracking: mis_rutas_hoy expone vehiculo_id/placa y siempre incluye las
-- rutas 'en_curso' (para que la app pueda (a) reanudar el tracking al reabrir con
-- una ruta activa y (b) etiquetar la posición con el vehículo real en vez de null).
-- Aditivo: solo agrega campos y afloja el filtro de fecha para rutas activas.

set search_path = sgc, public;

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
    'tiempo_estimado_min', r.tiempo_estimado_min,
    -- AG11 — vehículo de la ruta (para tag de posición + resume de tracking).
    'vehiculo_id', r.vehiculo_id,
    'placa', v.placa
  ) order by r.fecha desc), '[]'::jsonb)
  from sgc.rutas r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  where (r.fecha = current_date or r.estado = 'en_curso')
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$function$;

grant execute on function sgc.mis_rutas_hoy() to authenticated, service_role;
