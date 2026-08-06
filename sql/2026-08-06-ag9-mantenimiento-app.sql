-- AG9 — Mantenimiento operable desde la app móvil.
--
-- La app ya CREA mantenimientos (crear_mantenimiento_app). Faltaba (a) LISTAR los
-- de un vehículo y (b) CERRAR con evidencia/costo desde el chofer. Además el chofer
-- lleva el vehículo a "otros servicios" (ej. tintado) que no cabían en los 6 tipos.
--
-- Todo aditivo y retrocompatible: crear_mantenimiento_app y completar_mantenimiento
-- se mantienen (≥2 versiones); se agregan funciones nuevas *_app y un tipo 'otros'.

set search_path = sgc, public;

-- 1) Tipo 'otros' (tintado / servicios varios). No resetea el ciclo de km
--    (solo preventivo/incluye_preventivo lo hace, vía trg_mant_km_ultimo).
alter table sgc.mantenimientos drop constraint if exists mantenimientos_tipo_chk;
alter table sgc.mantenimientos add constraint mantenimientos_tipo_chk
  check (tipo = any (array['preventivo','falla','accidente_dano','cambio_pieza','engrase','hidraulico','otros']));

-- 2) crear_mantenimiento_app: aceptar 'otros' en el whitelist (idéntico resto).
create or replace function sgc.crear_mantenimiento_app(p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text, p_fecha date, p_km numeric, p_fotos jsonb, p_capturado_en timestamp with time zone, p_incluye_preventivo boolean DEFAULT false, p_accidente_id uuid DEFAULT NULL::uuid)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
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
  if v_tipo not in ('preventivo','falla','accidente_dano','cambio_pieza','engrase','hidraulico','otros') then
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

-- 3) Listar mantenimientos de un vehículo (para el historial en la app).
--    Gate: flota/admin o cualquier conductor (mismo criterio que crear_*_app).
create or replace function sgc.mantenimientos_por_vehiculo(p_vehiculo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'No autorizado';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'tipo', m.tipo, 'descripcion', m.descripcion, 'fecha', m.fecha,
      'estado', m.estado, 'costo', m.costo, 'proveedor', m.proveedor,
      'kilometraje', m.kilometraje_al_mantenimiento, 'notas', m.notas,
      'fotos', coalesce(m.fotos, '{}'), 'incluye_preventivo', m.incluye_preventivo,
      'created_at', m.created_at
    ) order by m.fecha desc, m.created_at desc)
    from sgc.mantenimientos m
    where m.vehiculo_id = p_vehiculo_id
  ), '[]'::jsonb);
end;
$function$;

-- 4) Cerrar mantenimiento desde la app: costo + proveedor + notas + evidencia.
--    Gate: flota/admin, el creador del registro, o el responsable del vehículo
--    (el chofer que lo llevó). Idempotente. Reusa avanzar_odometro + el trigger
--    trg_mant_km_ultimo (ciclo de km + auto-resolver avisos) igual que la web.
create or replace function sgc.completar_mantenimiento_app(
  p_id uuid,
  p_km integer default null,
  p_costo numeric default null,
  p_proveedor text default null,
  p_notas text default null,
  p_fotos jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_veh uuid; v_estado text; v_km int; v_creado uuid; v_resp uuid; v_nuevas text[];
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select m.vehiculo_id, m.estado, coalesce(p_km, m.kilometraje_al_mantenimiento),
         m.creado_por, v.responsable_id
    into v_veh, v_estado, v_km, v_creado, v_resp
  from sgc.mantenimientos m
  join sgc.vehiculos v on v.id = m.vehiculo_id
  where m.id = p_id;
  if v_veh is null then raise exception 'Mantenimiento no encontrado'; end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or v_creado = v_uid or v_resp = v_uid) then
    raise exception 'No autorizado para cerrar este mantenimiento';
  end if;

  if v_estado = 'completado' then return; end if;  -- idempotente

  select array_agg(f->>'storage_path') into v_nuevas
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
  where nullif(f->>'storage_path','') is not null;

  if v_km is not null then perform sgc.avanzar_odometro(v_veh, v_km); end if;

  update sgc.mantenimientos
     set estado = 'completado',
         kilometraje_al_mantenimiento = coalesce(p_km, kilometraje_al_mantenimiento),
         costo = coalesce(p_costo, costo),
         proveedor = coalesce(nullif(p_proveedor, ''), proveedor),
         notas = coalesce(nullif(p_notas, ''), notas),
         fotos = case when v_nuevas is not null then coalesce(fotos, '{}') || v_nuevas else fotos end
   where id = p_id;
end;
$function$;

grant execute on function sgc.mantenimientos_por_vehiculo(uuid) to authenticated, service_role;
grant execute on function sgc.completar_mantenimiento_app(uuid, integer, numeric, text, text, jsonb) to authenticated, service_role;
