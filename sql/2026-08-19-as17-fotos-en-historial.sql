-- PROMPT-28 (AS17 cierre) — las 4 fotos del uso de vehículo se subían (set_uso_fotos)
-- pero NINGÚN historial las mostraba: `mis_usos_vehiculo` no devolvía los paths.
-- Fix ADITIVO: recrear la función agregando las 4 columnas foto_*_path al final
-- (retrocompatible: los consumidores leen por nombre). Sin cambios de datos.
set search_path = sgc, public;

drop function if exists sgc.mis_usos_vehiculo(date, date);
create function sgc.mis_usos_vehiculo(p_desde date default null, p_hasta date default null)
returns table(
  id uuid, vehiculo_id uuid, placa text, marca text, modelo text,
  inicio_at timestamptz, fin_at timestamptz, km_inicio numeric, km_fin numeric,
  nivel_inicio text, nivel_fin text, recibido_de uuid, activa boolean,
  foto_frente_path text, foto_lateral_izq_path text, foto_lateral_der_path text, foto_trasera_path text
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select vu.id, v.id, v.placa, v.marca, v.modelo, vu.inicio_at, vu.fin_at,
         vu.km_inicio, vu.km_fin, vu.nivel_combustible_inicio, vu.nivel_combustible_fin,
         vu.recibido_de, (vu.fin_at is null),
         vu.foto_frente_path, vu.foto_lateral_izq_path, vu.foto_lateral_der_path, vu.foto_trasera_path
  from sgc.vehiculo_usos vu join sgc.vehiculos v on v.id = vu.vehiculo_id
  where vu.usuario_id = auth.uid()
    and (p_desde is null or vu.inicio_at::date >= p_desde)
    and (p_hasta is null or vu.inicio_at::date <= p_hasta)
  order by vu.inicio_at desc
  limit 300;
$function$;

grant execute on function sgc.mis_usos_vehiculo(date, date) to authenticated;

-- Verificación: el return ahora incluye las 4 columnas de foto.
select pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='sgc' and p.proname='mis_usos_vehiculo';
