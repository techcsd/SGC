-- =============================================================================
-- PROMPT-7 FASE 4 (AN4) — Ronda 11/08/2026 tarde. SGC padre.
-- Herramientas de auditoría de roles para la homologación "un usuario = un rol".
--   1) accesos_efectivos_de_roles(int[]) — suma real de accesos (módulos +
--      submódulos con nivel) de un CONJUNTO de roles. Núcleo reutilizable.
--   2) accesos_efectivos_usuario(uuid) — accesos efectivos de un usuario (sus
--      roles actuales).
--   3) accesos_efectivos_rol(int) — accesos de UN rol.
--   4) usuarios_multi_rol() — usuarios con 2+ roles (candidatos de limpieza) con
--      sus roles y accesos combinados.
-- Todo admin-only (revela superficie de acceso). SECURITY DEFINER.
-- El "diff al quitar roles" se calcula en el cliente comparando
--   accesos_efectivos_de_roles(actuales) vs accesos_efectivos_de_roles(propuestos).
-- =============================================================================

begin;

-- Núcleo: accesos efectivos de un conjunto de roles.
-- Devuelve { modulos: text[], submodulos: { "mod.sub": "ver"|"operar" } }.
-- `submodulos` incluye SOLO los grants granulares EXPLÍCITOS del/los rol(es)
-- (los módulos completos ya implican 'operar' en todo su árbol; se listan aparte).
create or replace function sgc.accesos_efectivos_de_roles(p_rol_ids int[])
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_modulos text[];
  v_subs jsonb := '{}'::jsonb;
  r record;
  k text; v text; cur text;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede consultar accesos efectivos.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct m), array[]::text[])
    into v_modulos
  from sgc.roles rr, unnest(rr.modulos) m
  where rr.id = any(p_rol_ids);

  -- Mejor nivel (operar > ver) por submódulo entre todos los roles del conjunto.
  for r in
    select rr.permisos from sgc.roles rr
    where rr.id = any(p_rol_ids) and rr.permisos is not null
  loop
    for k, v in select * from jsonb_each_text(r.permisos) loop
      cur := v_subs->>k;
      if v = 'operar' or (v = 'ver' and coalesce(cur,'') <> 'operar') then
        v_subs := jsonb_set(v_subs, array[k], to_jsonb(v));
      end if;
    end loop;
  end loop;

  return jsonb_build_object('modulos', to_jsonb(coalesce(v_modulos, array[]::text[])), 'submodulos', v_subs);
end;
$$;
grant execute on function sgc.accesos_efectivos_de_roles(int[]) to authenticated;
comment on function sgc.accesos_efectivos_de_roles(int[]) is
  'AN4 — suma de accesos (modulos + submodulos explicitos con nivel) de un conjunto de roles. Admin-only. Base del diff al quitar roles.';

-- Accesos efectivos de un usuario (sus roles actuales).
create or replace function sgc.accesos_efectivos_usuario(p_usuario_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.accesos_efectivos_de_roles(
    coalesce((select array_agg(ur.rol_id) from sgc.usuarios_roles ur where ur.usuario_id = p_usuario_id),
             array[]::int[]));
$$;
grant execute on function sgc.accesos_efectivos_usuario(uuid) to authenticated;

-- Accesos efectivos de un rol.
create or replace function sgc.accesos_efectivos_rol(p_rol_id int)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.accesos_efectivos_de_roles(array[p_rol_id]);
$$;
grant execute on function sgc.accesos_efectivos_rol(int) to authenticated;

-- Reporte de usuarios con 2+ roles (candidatos a homologar a un rol único).
create or replace function sgc.usuarios_multi_rol()
returns table (
  usuario_id uuid, nombre text, email text, n_roles int,
  roles jsonb, modulos text[]
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede ver el reporte de multi-rol.' using errcode = 'P0001';
  end if;
  return query
  select u.id, u.nombre::text, u.email::text, count(ur.rol_id)::int,
    jsonb_agg(jsonb_build_object('id', r.id, 'codigo', r.codigo, 'nombre', r.nombre) order by r.nombre),
    (select coalesce(array_agg(distinct m), array[]::text[])
       from sgc.usuarios_roles ur2 join sgc.roles r2 on r2.id = ur2.rol_id, unnest(r2.modulos) m
      where ur2.usuario_id = u.id)
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  group by u.id, u.nombre, u.email
  having count(ur.rol_id) >= 2
  order by count(ur.rol_id) desc, u.nombre;
end;
$$;
grant execute on function sgc.usuarios_multi_rol() to authenticated;
comment on function sgc.usuarios_multi_rol() is
  'AN4 — usuarios con 2+ roles (candidatos de la homologacion un-usuario-un-rol) con roles y modulos combinados. Admin-only.';

commit;
