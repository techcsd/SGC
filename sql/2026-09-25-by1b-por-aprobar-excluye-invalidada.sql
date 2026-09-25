-- BY1b — Endurecimiento: la lista "Por aprobar" (y el recordatorio) NO debe mostrar
-- echadas ya invalidadas. Caso: un elevado usa el viejo Revisar → sanear → invalidar
-- sobre una echada en_espera → queda invalidada=true pero revision='en_espera' y seguía
-- apareciendo en la cola. Se excluye `invalidada`.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-25-by1b-por-aprobar-excluye-invalidada.sql --env dev  →  --env prod
-- Rollback: quitar el `and not coalesce(...invalidada,false)` de ambas funciones.
begin;

create or replace function sgc.echadas_por_aprobar(p_vehiculo_id uuid default null, p_usuario_id uuid default null)
returns table(
  id uuid, fecha date, created_at timestamptz, vehiculo_id uuid, placa text, vehiculo_label text,
  km_anterior integer, kilometraje integer, km_recorridos integer, galones numeric, monto numeric,
  producto text, estacion text, registrado_por uuid, registrado_nombre text, conductor_nombre text,
  km_alerta boolean, alerta_consumo boolean, sin_asignacion boolean, retroactiva boolean,
  motivo text, foto_recibo_path text, foto_tablero_path text, foto_bomba_path text, reenvio_de uuid
) language sql stable security definer set search_path to 'sgc','pg_temp' as $fn$
  select r.id, r.fecha, r.created_at, r.vehiculo_id, v.placa,
         nullif(btrim(concat_ws(' · ', nullif(v.alias,''), v.placa)),'') as vehiculo_label,
         r.km_anterior, r.kilometraje, r.km_recorridos, r.galones, r.monto,
         r.producto, r.estacion, r.registrado_por, u.nombre, c.nombre,
         coalesce(r.km_alerta,false), coalesce(r.alerta_consumo,false),
         coalesce(r.sin_asignacion,false), coalesce(r.retroactiva,false),
         sgc.echada_motivo_revision(r.*), r.foto_recibo_path, r.foto_tablero_path, r.foto_bomba_path, r.reenvio_de
  from sgc.registros_combustible r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  left join sgc.usuarios u on u.id = r.registrado_por
  left join sgc.conductores c on c.id = r.conductor_id
  where (sgc.is_admin() or sgc.es_flota_elevado())
    and r.revision = 'en_espera' and not coalesce(r.es_prueba,false)
    and not coalesce(r.invalidada,false)                       -- BY1b
    and (p_vehiculo_id is null or r.vehiculo_id = p_vehiculo_id)
    and (p_usuario_id is null or r.registrado_por = p_usuario_id)
  order by r.created_at asc;
$fn$;
grant execute on function sgc.echadas_por_aprobar(uuid, uuid) to authenticated, service_role;

create or replace function sgc.recordar_echadas_por_aprobar()
returns integer language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_n int;
begin
  select count(*) into v_n from sgc.registros_combustible
   where revision = 'en_espera' and not coalesce(es_prueba,false)
     and not coalesce(invalidada,false)                        -- BY1b
     and created_at < now() - interval '48 hours';
  if v_n > 0 then
    perform sgc.notificar_modulo('flota', 'combustible_por_aprobar_recordatorio',
      'Echadas por aprobar',
      format('Hay %s echada(s) en espera de aprobación desde hace más de 48 h.', v_n),
      '/flota/combustible-log?revision=en_espera', null, null);
  end if;
  return v_n;
end $fn$;

commit;
