-- AT14 — exponer `es_prueba` en `vehiculos_en_uso` para que el toggle admin
-- "Mostrar datos de prueba" pueda ocultar/mostrar las sesiones de prueba en el
-- panel "Vehículos en uso" de la app. Aditivo: los no-admin YA no ven pruebas
-- (el WHERE lo gatea); esto solo suma la columna para el control del admin.
-- Cambiar el RETURNS TABLE obliga a DROP+CREATE.
drop function if exists sgc.vehiculos_en_uso();
create function sgc.vehiculos_en_uso()
returns table(
  vehiculo_id uuid, placa text, marca text, modelo text, color text,
  usuario_id uuid, usuario_nombre text, desde timestamptz,
  km_inicio numeric, nivel_inicio text, es_prueba boolean
)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select v.id, v.placa, v.marca, v.modelo, v.color, vu.usuario_id, u.nombre,
         vu.inicio_at, vu.km_inicio, vu.nivel_combustible_inicio,
         coalesce(v.es_prueba, false)
  from sgc.vehiculo_usos vu
  join sgc.vehiculos v on v.id = vu.vehiculo_id
  join sgc.usuarios u on u.id = vu.usuario_id
  where vu.fin_at is null
    and (sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_tecnologia())
    and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
  order by vu.inicio_at desc;
$function$;
grant execute on function sgc.vehiculos_en_uso() to authenticated;
