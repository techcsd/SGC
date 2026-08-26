-- AZ9 — El equipo de obra deja de ser texto libre: identidad real (usuarios / personal de obra).
-- Aditivo: se conservan las columnas de texto (ingeniero_obra, maestro_encargado) como legado /
-- display hasta que se normalicen; se agregan los vínculos reales por id.
--  - ingeniero_obra_id → usuarios (rol Ingenieros). Además, al guardarse, la app lo suma a
--    proyecto_responsables para que alimente la visibilidad de AY4 (obras del ingeniero).
--  - maestro: puede venir de usuarios O de personal de obra (ficha sin login) — ambas fuentes.

alter table sgc.proyectos add column if not exists ingeniero_obra_id  uuid references sgc.usuarios(id);
alter table sgc.proyectos add column if not exists maestro_usuario_id  uuid references sgc.usuarios(id);
alter table sgc.proyectos add column if not exists maestro_personal_id uuid references sgc.personal_obra(id);

comment on column sgc.proyectos.ingeniero_obra_id  is 'AZ9 — ingeniero de obra (usuario del sistema, rol Ingenieros).';
comment on column sgc.proyectos.maestro_usuario_id is 'AZ9 — maestro encargado cuando es un usuario del sistema.';
comment on column sgc.proyectos.maestro_personal_id is 'AZ9 — maestro encargado cuando es una ficha de personal de obra (sin login).';

-- Usuarios elegibles como ingenieros (para los selectores del equipo de obra).
-- SECURITY DEFINER: cualquier autenticado puede listar el catálogo de ingenieros para elegir.
create or replace function sgc.ingenieros_disponibles()
returns table(id uuid, nombre text, roles text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select u.id,
         u.nombre,
         string_agg(distinct r.nombre, ', ' order by r.nombre) as roles
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
   where coalesce(u.activo, true)
     and coalesce(u.es_prueba, false) = false  -- AZ7 — el picker real de obra no ofrece usuarios de prueba
     and r.codigo in ('ingeniero_campo', 'ingeniero_oficina', 'jefe_ingenieros')
   group by u.id, u.nombre
   order by u.nombre;
$$;

grant execute on function sgc.ingenieros_disponibles() to authenticated;
