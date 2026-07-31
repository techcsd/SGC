-- ============================================================================
-- AC14.3 — Tipos de visita de taller para equipos (engrase / hidráulico) (30/07)
-- ----------------------------------------------------------------------------
-- El catálogo X6 tenía 4 tipos (preventivo/falla/accidente_dano/cambio_pieza).
-- Los equipos por horas (telehandler) suman visitas propias: `engrase` y
-- `hidraulico`. Aditivo: se amplía el check y el whitelist del RPC de la app.
-- Estos tipos NO reinician el ciclo de mantenimiento (solo `preventivo` o
-- `incluye_preventivo=true` lo hacen — se mantiene el trigger tg_mant_km_ultimo).
-- ============================================================================

set search_path = sgc, public;

alter table sgc.mantenimientos drop constraint if exists mantenimientos_tipo_chk;
alter table sgc.mantenimientos add  constraint mantenimientos_tipo_chk
  check (tipo = any (array['preventivo','falla','accidente_dano','cambio_pieza','engrase','hidraulico']));

-- Ampliar el whitelist del RPC de la app (si no, coacciona a 'preventivo').
create or replace function sgc.crear_mantenimiento_app(p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text, p_fecha date, p_km numeric, p_fotos jsonb, p_capturado_en timestamp with time zone, p_incluye_preventivo boolean DEFAULT false, p_accidente_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_tipo text;
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

  v_tipo := lower(coalesce(nullif(p_tipo,''),'preventivo'));
  if v_tipo not in ('preventivo','falla','accidente_dano','cambio_pieza','engrase','hidraulico') then
    v_tipo := 'preventivo';
  end if;

  insert into sgc.mantenimientos (id, vehiculo_id, tipo, descripcion, fecha,
    kilometraje_al_mantenimiento, estado, fotos, incluye_preventivo, accidente_id)
  values (
    p_id, p_vehiculo_id, v_tipo, p_descripcion,
    coalesce(p_fecha, current_date), p_km, 'pendiente',
    coalesce((select array_agg(f->>'storage_path') from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f
              where nullif(f->>'storage_path','') is not null), '{}'),
    coalesce(p_incluye_preventivo, false), p_accidente_id
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);
  return p_id;
end;
$function$;
