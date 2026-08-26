-- ============================================================================
-- AY4c — el Ingeniero de Oficina NO gestiona proyectos (solo VE todas + costos).
--
-- El rol ingeniero_oficina (AY4b) lleva el módulo `proyectos` para VER todas las obras
-- y sus costos/presupuesto (cubicaciones). Pero eso también le daba, vía las RLS de
-- escritura (que gatean por tiene_modulo('proyectos')), poder CREAR/EDITAR/BORRAR
-- proyectos. Decisión Xaviel: acotar la gestión de proyectos → oficina es solo-lectura
-- sobre la ficha del proyecto.
--
-- Helper `puede_gestionar_proyectos()` = admin, o tener el módulo `proyectos` por un rol
-- que NO sea ingeniero_oficina (así un usuario que sea oficina + gerente_proyectos SÍ
-- gestiona; y quien sea SOLO oficina, no). Se usa en las 3 RLS de escritura. Los que
-- gestionan hoy (admin/gerencia/gerente_proyectos/gerente_produccion/direccion) no
-- cambian. Aditivo/retrocompatible; enforcement real en BD (app + web).
-- ============================================================================

begin;
set local search_path = sgc, public;

create or replace function sgc.puede_gestionar_proyectos()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin() or exists (
    select 1
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo <> 'ingeniero_oficina'
      and 'proyectos' = any(r.modulos)
  );
$$;
grant execute on function sgc.puede_gestionar_proyectos() to authenticated, service_role;

-- ── RLS de escritura de proyectos: gestión (no solo tener el módulo) ────────
drop policy if exists "proyectos: insert" on sgc.proyectos;
create policy "proyectos: insert" on sgc.proyectos
  for insert with check (sgc.puede_gestionar_proyectos());

drop policy if exists "proyectos: update" on sgc.proyectos;
create policy "proyectos: update" on sgc.proyectos
  for update using (sgc.puede_gestionar_proyectos())
  with check (sgc.puede_gestionar_proyectos());

drop policy if exists "proyectos: delete" on sgc.proyectos;
create policy "proyectos: delete" on sgc.proyectos
  for delete using (sgc.puede_gestionar_proyectos());

commit;

-- Verificación: gestión por rol (espejo del helper, sin auth.uid()).
select r.codigo,
       ('proyectos' = any(r.modulos)) as tiene_modulo_proyectos,
       (r.codigo <> 'ingeniero_oficina' and 'proyectos' = any(r.modulos)) as gestiona
from sgc.roles r
where 'proyectos' = any(r.modulos) or r.codigo in ('admin','ingeniero_oficina')
order by r.codigo;
