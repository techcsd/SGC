-- BV7 — Asignar chofer (+ vehículo) a un conduce desde la bandeja de despacho.
-- Setear conductor_id + vehiculo_id dispara el trigger tg_conduce_autoruta, que crea la
-- ruta del chofer automáticamente. Gate: logística / flota-elevado / admin. Valida que el
-- chofer siga activo (dato a corregir = 22023 humano, no FK cruda; regla 16).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv7-asignar-chofer-conduce.sql --env dev  →  --env prod
begin;

create or replace function sgc.asignar_chofer_conduce(p_salida_id uuid, p_conductor_id uuid, p_vehiculo_id uuid default null)
 returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_s sgc.salidas_inventario%rowtype;
begin
  if not (sgc.is_admin() or sgc.es_logistica() or sgc.es_flota_elevado()) then
    raise exception 'Tu rol no puede asignar chofer a un conduce.' using errcode = '42501';
  end if;
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.' using errcode = '22023'; end if;
  if v_s.anulado_por is not null then
    raise exception 'No se puede asignar chofer a un conduce anulado.' using errcode = '22023';
  end if;
  if p_conductor_id is null then
    raise exception 'Indica el chofer.' using errcode = '22023';
  end if;
  if not exists (select 1 from sgc.conductores c where c.id = p_conductor_id and coalesce(c.activo, true)) then
    perform sgc.error_campo('conductor_id', 'no_existe', 'Ese chofer ya no está disponible. Elige otro.');
  end if;
  if p_vehiculo_id is not null and not exists (select 1 from sgc.vehiculos v where v.id = p_vehiculo_id) then
    perform sgc.error_campo('vehiculo_id', 'no_existe', 'Ese vehículo no existe. Elige otro.');
  end if;

  update sgc.salidas_inventario
     set conductor_id = p_conductor_id, vehiculo_id = p_vehiculo_id
   where id = p_salida_id;
end $function$;

grant execute on function sgc.asignar_chofer_conduce(uuid, uuid, uuid) to authenticated, service_role;

commit;
