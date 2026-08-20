-- =============================================================================
-- AS4 — Rediseño del editor de permisos (UX) + AUDITORÍA de cambios de permiso.
-- El backend de permisos ya funciona (sgc.roles.permisos jsonb + accesos_efectivos_*).
-- Esto SOLO agrega la bitácora de "quién cambió los permisos de un rol, qué y cuándo".
--
--   1) Tabla sgc.roles_permisos_auditoria — un registro por guardado de rol, con el
--      diff (gana/pierde/cambia) que la web calculó, más el snapshot antes/después.
--   2) RPC registrar_cambio_permisos(p_rol_id int, p_cambio jsonb) — SECURITY DEFINER,
--      admin-only; la web la llama tras guardar el rol. Devuelve el id insertado.
--   3) RPC historial_cambios_permisos(p_limit int) — SECURITY DEFINER, admin-only;
--      últimas N entradas enriquecidas con nombre del rol y del actor.
--
-- RLS: admin-only SELECT. El INSERT va SIEMPRE por la RPC (SECURITY DEFINER), así que
-- no se otorga insert directo a la tabla (defensa en profundidad).
-- =============================================================================

begin;

-- 1) Tabla de auditoría ------------------------------------------------------
create table if not exists sgc.roles_permisos_auditoria (
  id        bigint generated always as identity primary key,
  rol_id    int not null references sgc.roles(id) on delete cascade,
  actor_id  uuid not null default auth.uid(),
  cambio    jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);

create index if not exists roles_permisos_auditoria_rol_idx
  on sgc.roles_permisos_auditoria (rol_id, at desc);
create index if not exists roles_permisos_auditoria_at_idx
  on sgc.roles_permisos_auditoria (at desc);

comment on table sgc.roles_permisos_auditoria is
  'AS4 — bitacora de cambios de permisos de un rol: quien (actor_id), que (cambio jsonb: gana/pierde/cambia + antes/despues) y cuando (at). Insert solo via RPC registrar_cambio_permisos.';

-- Grants de esquema/tabla (patrón del proyecto: schema usage + select scoped por RLS).
grant usage on schema sgc to authenticated;
grant select on sgc.roles_permisos_auditoria to authenticated;

-- 2) RLS: solo admin puede leer; nadie inserta/actualiza/borra directo -------
alter table sgc.roles_permisos_auditoria enable row level security;

drop policy if exists roles_permisos_auditoria_sel_admin on sgc.roles_permisos_auditoria;
create policy roles_permisos_auditoria_sel_admin
  on sgc.roles_permisos_auditoria
  for select
  to authenticated
  using (sgc.is_admin());

-- (Sin policies de insert/update/delete: la tabla es de solo-lectura para clientes;
--  el registro entra por la RPC SECURITY DEFINER de abajo.)

-- 3) RPC de registro ---------------------------------------------------------
create or replace function sgc.registrar_cambio_permisos(p_rol_id int, p_cambio jsonb)
returns bigint
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id bigint;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede registrar cambios de permisos.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sgc.roles where id = p_rol_id) then
    raise exception 'El rol % no existe.', p_rol_id using errcode = 'P0001';
  end if;

  insert into sgc.roles_permisos_auditoria (rol_id, actor_id, cambio)
  values (p_rol_id, auth.uid(), coalesce(p_cambio, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function sgc.registrar_cambio_permisos(int, jsonb) to authenticated;
comment on function sgc.registrar_cambio_permisos(int, jsonb) is
  'AS4 — registra un cambio de permisos de un rol (admin-only). p_cambio: { modulosGana, modulosPierde, subsGana, subsPierde, subsCambia, antes, despues }.';

-- 4) RPC de historial (últimas N, enriquecidas) ------------------------------
create or replace function sgc.historial_cambios_permisos(p_limit int default 20)
returns table (
  id bigint,
  rol_id int,
  rol_nombre text,
  actor_id uuid,
  actor_nombre text,
  cambio jsonb,
  at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede ver el historial de cambios de permisos.' using errcode = 'P0001';
  end if;
  return query
  select a.id,
         a.rol_id,
         r.nombre::text,
         a.actor_id,
         coalesce(u.nombre, u.email, 'Sistema')::text,
         a.cambio,
         a.at
  from sgc.roles_permisos_auditoria a
  left join sgc.roles r on r.id = a.rol_id
  left join sgc.usuarios u on u.id = a.actor_id
  order by a.at desc
  limit greatest(1, least(coalesce(p_limit, 20), 200));
end;
$$;
grant execute on function sgc.historial_cambios_permisos(int) to authenticated;
comment on function sgc.historial_cambios_permisos(int) is
  'AS4 — ultimas N entradas de la bitacora de cambios de permisos, con nombre de rol y actor. Admin-only.';

commit;
