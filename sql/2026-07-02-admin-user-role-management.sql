-- ═══════════════════════════════════════════════════════════
-- Admin-managed user & role management — DB side.
--
-- Context: creating a real Supabase Auth user requires the Admin API
-- (service_role only, never exposed to the frontend), so that part is
-- handled by new Edge Functions (admin-create-user, admin-deactivate-user,
-- admin-reset-user-password). Everything here is what those functions +
-- the existing Angular admin pages need on the DB side.
-- ═══════════════════════════════════════════════════════════

-- ── Audit log ────────────────────────────────────────────────
-- Records admin actions (user created, deactivated, role changed) with
-- enough context to answer "who did what, to whom, when." Immutable by
-- design — no update/delete policy.
create table sgc.audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references sgc.usuarios(id),
  action         text not null,
  target_user_id uuid references sgc.usuarios(id),
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index idx_audit_log_target on sgc.audit_log(target_user_id);
create index idx_audit_log_created on sgc.audit_log(created_at desc);

alter table sgc.audit_log enable row level security;

create policy "audit_log: admin select" on sgc.audit_log for select to authenticated
  using (sgc.is_admin());
-- Inserts come from sgc.assign_roles (SECURITY INVOKER, run by an admin —
-- covered by this same check) and from the Edge Functions (service_role,
-- which bypasses RLS entirely regardless of this policy).
create policy "audit_log: admin insert" on sgc.audit_log for insert to authenticated
  with check (sgc.is_admin());

grant select, insert on sgc.audit_log to authenticated;

-- ── Role CRUD via plain RLS-protected table ops ────────────────
-- sgc.roles previously had SELECT policies only — no admin could
-- actually create/edit/delete a role from the client, which is exactly
-- why the old "Roles" screen said it wasn't possible. Roles never touch
-- auth.users, so this doesn't need an Edge Function — just real policies.
create policy "roles: admin insert" on sgc.roles for insert to authenticated
  with check (sgc.is_admin());
create policy "roles: admin update" on sgc.roles for update to authenticated
  using (sgc.is_admin())
  with check (sgc.is_admin());
-- No blanket DELETE policy: sgc.usuarios_roles.rol_id is ON DELETE CASCADE,
-- so a raw delete would silently strip that role from every user who had
-- it with zero warning. Deletion goes through sgc.eliminar_rol() below,
-- which checks first and gives a real error instead.
grant insert, update on sgc.roles to authenticated;

create or replace function sgc.eliminar_rol(p_rol_id integer)
returns void
language plpgsql
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

grant execute on function sgc.eliminar_rol(integer) to authenticated;

-- ── Self-lockout protection on role assignment ─────────────────
-- The Angular UI already blocked an admin from removing their own admin
-- role, but only client-side — a raw RPC call could bypass it. Enforce
-- it here too, and log every role change.
create or replace function sgc.assign_roles(p_usuario_id uuid, p_rol_ids integer[], p_asignado_por uuid)
returns void
language plpgsql
as $$
declare
  v_keeps_admin boolean;
begin
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
