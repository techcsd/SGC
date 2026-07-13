-- Captura de mantenimiento desde la CSD App (offline, idempotente por UUID cliente).
set search_path = sgc, public;

create or replace function sgc.crear_mantenimiento_app(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text,
  p_fecha date, p_km numeric, p_fotos jsonb, p_capturado_en timestamptz
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.mantenimientos where id = p_id) then
    return p_id;  -- idempotente
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  insert into sgc.mantenimientos (id, vehiculo_id, tipo, descripcion, fecha, kilometraje_al_mantenimiento, estado, fotos)
  values (
    p_id, p_vehiculo_id, coalesce(nullif(p_tipo,''),'correctivo'), p_descripcion,
    coalesce(p_fecha, current_date), p_km, 'pendiente',
    coalesce((select array_agg(f->>'storage_path') from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f
              where nullif(f->>'storage_path','') is not null), '{}')
  );
  return p_id;
end;
$$;
grant execute on function sgc.crear_mantenimiento_app(uuid, uuid, text, text, date, numeric, jsonb, timestamptz) to authenticated, service_role;
