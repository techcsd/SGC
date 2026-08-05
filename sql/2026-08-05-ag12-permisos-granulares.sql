-- ============================================================================
-- AG12 — Permisos granulares por submódulo. Aditivo sobre `roles.modulos`:
-- un rol puede otorgar un submódulo específico (p.ej. "compras.proveedores")
-- en nivel 'ver' u 'operar' SIN dar el módulo completo. Generaliza el caso
-- ad-hoc AF32 (jefe de flota → solo Proveedores).
--
-- Retrocompatibilidad ESTRICTA: quien tiene el módulo en `modulos[]` conserva
-- 'operar' sobre TODOS sus submódulos (regla de compat en el helper). El nuevo
-- `permisos` jsonb solo AÑADE accesos finos; nunca quita.
-- ============================================================================

set search_path = sgc, public;

-- ── Columna aditiva: permisos por submódulo ─────────────────────────────────
-- Formato: { "compras.proveedores": "ver", "compras.ordenes": "operar", ... }
alter table sgc.roles add column if not exists permisos jsonb not null default '{}'::jsonb;

-- ── Helper central: nivel efectivo de un submódulo para el usuario actual ────
-- Devuelve 'operar' | 'ver' | null. Fuente única para guards, menú y RLS.
create or replace function sgc.nivel_submodulo(p_key text)
returns text
language sql
stable
set search_path to 'sgc','pg_temp'
as $function$
  select case
    when sgc.is_admin() then 'operar'
    -- Compat: tener el módulo padre = 'operar' en todos sus submódulos.
    when sgc.tiene_modulo(split_part(p_key,'.',1)) then 'operar'
    when exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = auth.uid() and coalesce(r.permisos->>p_key,'') = 'operar'
    ) then 'operar'
    when exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = auth.uid() and coalesce(r.permisos->>p_key,'') in ('ver','operar')
    ) then 'ver'
    else null
  end;
$function$;
grant execute on function sgc.nivel_submodulo(text) to authenticated, service_role;

create or replace function sgc.puede_ver_submodulo(p_key text)
returns boolean language sql stable set search_path to 'sgc','pg_temp'
as $function$ select sgc.nivel_submodulo(p_key) in ('ver','operar'); $function$;
grant execute on function sgc.puede_ver_submodulo(text) to authenticated, service_role;

create or replace function sgc.puede_operar_submodulo(p_key text)
returns boolean language sql stable set search_path to 'sgc','pg_temp'
as $function$ select sgc.nivel_submodulo(p_key) = 'operar'; $function$;
grant execute on function sgc.puede_operar_submodulo(text) to authenticated, service_role;

-- ── Generalización AF32: RLS de proveedores lee el modelo granular ──────────
-- Se AÑADEN políticas permisivas (se combinan con OR) → solo amplían acceso a
-- quien tenga el submódulo; NO tocan las políticas existentes ni quitan acceso.
drop policy if exists proveedores_submodulo_sel on sgc.proveedores;
create policy proveedores_submodulo_sel on sgc.proveedores
  for select using (sgc.puede_ver_submodulo('compras.proveedores'));

drop policy if exists proveedores_submodulo_ins on sgc.proveedores;
create policy proveedores_submodulo_ins on sgc.proveedores
  for insert with check (sgc.puede_operar_submodulo('compras.proveedores'));

drop policy if exists proveedores_submodulo_upd on sgc.proveedores;
create policy proveedores_submodulo_upd on sgc.proveedores
  for update using (sgc.puede_operar_submodulo('compras.proveedores'))
  with check (sgc.puede_operar_submodulo('compras.proveedores'));

drop policy if exists proveedores_submodulo_del on sgc.proveedores;
create policy proveedores_submodulo_del on sgc.proveedores
  for delete using (sgc.puede_operar_submodulo('compras.proveedores'));
