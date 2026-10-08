-- 2026-10-08-ck3b-log-foto-origen.sql
-- CK3 — el log de combustible (web Flota › Combustible) devuelve foto_origen para
-- pintar el chip "Foto de galería" (Raykler revisa las echadas con foto de galería).
-- Cambia el tipo de retorno → drop+create en la misma transacción, mismos grants.
--   node scripts/apply-migration.mjs sql/2026-10-08-ck3b-log-foto-origen.sql --env dev

begin;

drop function if exists sgc.log_combustible(date, date, uuid, uuid);

create function sgc.log_combustible(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_vehiculo_id uuid DEFAULT NULL::uuid, p_usuario_id uuid DEFAULT NULL::uuid)
 returns table(id uuid, fecha date, vehiculo_id uuid, placa text, kilometraje integer, km_anterior integer, km_recorridos integer, galones numeric, monto numeric, producto text, subtipo text, estado text, km_alerta boolean, sin_asignacion boolean, alerta_consumo boolean, revision text, registrado_por uuid, registrado_nombre text, conductor_nombre text, es_prueba boolean, foto_origen text, created_at timestamp with time zone)
 language sql stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select
    r.id, r.fecha, r.vehiculo_id, v.placa, r.kilometraje, r.km_anterior, r.km_recorridos,
    r.galones, r.monto, r.producto, r.subtipo, r.estado,
    coalesce(r.km_alerta, false), coalesce(r.sin_asignacion, false), coalesce(r.alerta_consumo, false),
    coalesce(r.revision, 'normal'),
    r.registrado_por, u.nombre, c.nombre, coalesce(r.es_prueba, false),
    coalesce(r.foto_origen, 'camara'), r.created_at
  from sgc.registros_combustible r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  left join sgc.usuarios u on u.id = r.registrado_por
  left join sgc.conductores c on c.id = r.conductor_id
  where (sgc.is_admin() or sgc.es_flota_elevado())
    and (p_desde is null or r.fecha >= p_desde)
    and (p_hasta is null or r.fecha <= p_hasta)
    and (p_vehiculo_id is null or r.vehiculo_id = p_vehiculo_id)
    and (p_usuario_id is null or r.registrado_por = p_usuario_id)
    and (not coalesce(r.es_prueba, false) or sgc.is_admin())
  order by r.fecha desc, r.created_at desc;
$function$;

grant execute on function sgc.log_combustible(date, date, uuid, uuid) to authenticated, service_role, postgres, public;

commit;
