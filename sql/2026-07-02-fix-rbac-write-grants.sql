-- Fixes a real, pre-existing bug uncovered while building admin user/role
-- management: `authenticated` only ever had SELECT granted on
-- sgc.usuarios and sgc.usuarios_roles. sgc.assign_roles() (SECURITY
-- INVOKER, used by the existing "assign roles" UI) does DELETE+INSERT on
-- usuarios_roles, and the "editar usuario" drawer does a direct client
-- UPDATE on usuarios — both would fail with a permission-denied error for
-- any real authenticated admin session. This was invisible until now
-- because prior testing this session used elevated DB access, not a real
-- logged-in session.
--
-- Rather than granting broad INSERT/UPDATE/DELETE on these sensitive RBAC
-- tables to the entire `authenticated` role (a wide blast radius: any bug
-- in RLS coverage on these two tables would become directly exploitable),
-- these operations move to SECURITY DEFINER functions that each
-- independently re-check sgc.is_admin() before doing anything — the same
-- narrow, self-contained pattern already used by sgc.is_admin() and
-- sgc.get_resend_api_key() in this schema. No new table grants needed.

create or replace function sgc.assign_roles(p_usuario_id uuid, p_rol_ids integer[], p_asignado_por uuid)
returns void
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_keeps_admin boolean;
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado para asignar roles.';
  end if;

  if p_usuario_id = auth.uid() then
    select exists (
      select 1 from sgc.roles where id = any(p_rol_ids) and codigo = 'admin'
    ) into v_keeps_admin;

    if not v_keeps_admin then
      raise exception 'No puedes quitarte el rol de administrador a ti mismo.';
    end if;
  end if;

  delete from sgc.usuarios_roles where usuario_id = p_usuario_id;

  if p_rol_ids is not null and array_length(p_rol_ids, 1) > 0 then
    insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
    select p_usuario_id, rid, p_asignado_por
    from unnest(p_rol_ids) as rid;
  end if;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (p_asignado_por, 'roles_actualizados', p_usuario_id, jsonb_build_object('rol_ids', p_rol_ids));
end;
$$;

create or replace function sgc.eliminar_rol(p_rol_id integer)
returns void
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_rol sgc.roles%rowtype;
  v_en_uso integer;
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado para eliminar roles.';
  end if;

  select * into v_rol from sgc.roles where id = p_rol_id;
  if not found then
    raise exception 'Rol no encontrado.';
  end if;

  if v_rol.codigo = 'admin' then
    raise exception 'El rol "admin" no puede eliminarse.';
  end if;

  select count(*) into v_en_uso from sgc.usuarios_roles where rol_id = p_rol_id;
  if v_en_uso > 0 then
    raise exception 'Este rol está asignado a % usuario(s). Reasígnalos antes de eliminarlo.', v_en_uso;
  end if;

  delete from sgc.roles where id = p_rol_id;

  insert into sgc.audit_log (actor_id, action, metadata)
  values (auth.uid(), 'rol_eliminado', jsonb_build_object('rol_id', p_rol_id, 'codigo', v_rol.codigo, 'nombre', v_rol.nombre));
end;
$$;

-- Replaces the direct client-side `usuarios` table UPDATE in
-- admin.service.ts's updateUsuario() — same reasoning as above, no
-- broad UPDATE grant needed on a table that includes every user's
-- account status.
create or replace function sgc.actualizar_usuario(p_id uuid, p_nombre text)
returns void
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado.';
  end if;

  update sgc.usuarios set nombre = p_nombre, updated_at = now() where id = p_id;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'usuario_actualizado', p_id, jsonb_build_object('nombre', p_nombre));
end;
$$;

grant execute on function sgc.assign_roles(uuid, integer[], uuid) to authenticated;
grant execute on function sgc.eliminar_rol(integer) to authenticated;
grant execute on function sgc.actualizar_usuario(uuid, text) to authenticated;
