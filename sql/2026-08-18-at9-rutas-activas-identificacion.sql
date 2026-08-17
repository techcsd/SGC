-- AT9 — Identificación de vehículo (marca/modelo/color) en las rutas activas/hoy.
-- El mapa de Seguimiento y Rutas activas mostraban solo la placa; ahora también
-- devuelven marca/modelo/color para pintar "Marca Modelo · Color · Placa".
-- Requiere DROP+CREATE porque cambia las columnas OUT (aditivo en intención).

set search_path = sgc, public;

drop function if exists sgc.rutas_activas_y_hoy();

create function sgc.rutas_activas_y_hoy()
returns table(
  id uuid, seccion text, estado text, tipo text, origen text, destino text,
  placa text, marca text, modelo text, color text,
  conductor_nombre text, fecha date, iniciada_at timestamptz,
  paradas_total integer, paradas_entregadas integer
)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    r.id,
    case when r.estado = 'en_curso' then 'activa' else 'hoy' end as seccion,
    r.estado, r.tipo, r.origen, r.destino,
    v.placa, v.marca, v.modelo, v.color,
    c.nombre, r.fecha, r.iniciada_at,
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id),
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id and p.estado = 'entregada')
  from sgc.rutas r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  left join sgc.conductores c on c.id = r.conductor_id
  where (sgc.es_flota_elevado() or r.creado_por = auth.uid() or r.conductor_id in (select sgc.mis_conductor_ids()))
    and (r.estado = 'en_curso' or r.fecha = current_date)
  order by (case when r.estado = 'en_curso' then 0 else 1 end), r.iniciada_at desc nulls last, r.fecha desc;
$function$;

grant execute on function sgc.rutas_activas_y_hoy() to authenticated, service_role;
