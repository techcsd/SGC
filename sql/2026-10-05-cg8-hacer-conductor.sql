-- CG8 — Desde Administración › Usuarios, convertir a un usuario en "Conductor en la app"
-- SIN obligarlo a usar un vehículo. Crea/enlaza la ficha de `conductores` con los datos
-- del usuario y le asigna el rol de chofer elegido (transportista o privado).
-- Nota (literal): "in the users view, i must be able to select one and make them a
-- 'Conductor in the app' without need to obligate them to use a vehicle."
-- -------------------------------------------------------------------------------------
create or replace function sgc.hacer_conductor(p_usuario uuid, p_rol text default 'chofer_transportista')
returns jsonb
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_u record; v_cond_id uuid; v_rol_id int; v_creada boolean := false;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_rol not in ('chofer_transportista','chofer_privado') then
    raise exception 'Rol inválido: %', p_rol using errcode = '22023';
  end if;

  select id, nombre, cedula, telefono into v_u from sgc.usuarios where id = p_usuario;
  if v_u.id is null then raise exception 'Usuario no encontrado' using errcode = 'P0002'; end if;

  -- Ficha de conductor: si ya existe una enlazada a este usuario, la reusamos.
  select id into v_cond_id from sgc.conductores where usuario_id = p_usuario limit 1;
  if v_cond_id is null then
    insert into sgc.conductores (nombre, cedula, telefono, usuario_id, activo)
    values (coalesce(v_u.nombre,'Conductor'), nullif(regexp_replace(coalesce(v_u.cedula,''),'\D','','g'),''), v_u.telefono, p_usuario, true)
    returning id into v_cond_id;
    v_creada := true;
  end if;

  -- Rol de chofer (idempotente).
  select id into v_rol_id from sgc.roles where codigo = p_rol;
  if v_rol_id is null then raise exception 'No existe el rol %. Configúralo en Administración › Roles.', p_rol using errcode = '22023'; end if;
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
  values (p_usuario, v_rol_id, auth.uid())
  on conflict (usuario_id, rol_id) do nothing;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'usuario_hecho_conductor', p_usuario,
          jsonb_build_object('conductor_id', v_cond_id, 'rol', p_rol, 'ficha_creada', v_creada));

  return jsonb_build_object('conductor_id', v_cond_id, 'creada', v_creada, 'rol', p_rol);
end;
$function$;

grant execute on function sgc.hacer_conductor(uuid, text) to authenticated;
