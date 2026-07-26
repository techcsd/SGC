-- Ronda 11 · Z2 — Ingenieros responsables vinculados al proyecto
-- Aditivo/retrocompatible. Idempotente.
--
-- Decisión de arquitectura: las FIRMAS de liberación referencian `usuarios` (auth),
-- por lo que los "responsables vinculados" deben ser usuarios (para preseleccionar
-- firmantes y dirigirles "solicitar firma"). `proyecto_empleados` liga `empleados`
-- (roster RRHH, incluye externos sin cuenta) → NO es equivalente para el flujo de
-- firma. Por eso se crea una relación dedicada proyecto↔usuario, que además
-- generaliza el `proyectos.responsable_id` de un solo responsable.

create table if not exists sgc.proyecto_responsables (
  id                  uuid primary key default gen_random_uuid(),
  proyecto_id         uuid not null references sgc.proyectos(id) on delete cascade,
  usuario_id          uuid not null references sgc.usuarios(id) on delete cascade,
  tipo_responsabilidad text not null default 'responsable'
                        check (tipo_responsabilidad in ('residente','responsable')),
  activo              boolean not null default true,
  desde               date,
  hasta               date,
  notas               text,
  creado_por          uuid references sgc.usuarios(id),
  created_at          timestamptz not null default now()
);

-- Un usuario no se repite como el mismo tipo en la misma obra (mientras esté activo)
create unique index if not exists uq_proyecto_resp_activo
  on sgc.proyecto_responsables (proyecto_id, usuario_id, tipo_responsabilidad)
  where activo;
create index if not exists ix_proyecto_resp_proyecto
  on sgc.proyecto_responsables (proyecto_id) where activo;
create index if not exists ix_proyecto_resp_usuario
  on sgc.proyecto_responsables (usuario_id) where activo;

alter table sgc.proyecto_responsables enable row level security;

drop policy if exists "proyecto_responsables: select" on sgc.proyecto_responsables;
create policy "proyecto_responsables: select" on sgc.proyecto_responsables
  for select using (
    sgc.is_admin() or sgc.tiene_modulo('proyectos')
    or sgc.tiene_modulo('bitacora') or usuario_id = auth.uid()
  );
drop policy if exists "proyecto_responsables: insert" on sgc.proyecto_responsables;
create policy "proyecto_responsables: insert" on sgc.proyecto_responsables
  for insert with check ( sgc.is_admin() or sgc.tiene_modulo('proyectos') );
drop policy if exists "proyecto_responsables: update" on sgc.proyecto_responsables;
create policy "proyecto_responsables: update" on sgc.proyecto_responsables
  for update using ( sgc.is_admin() or sgc.tiene_modulo('proyectos') );
drop policy if exists "proyecto_responsables: delete" on sgc.proyecto_responsables;
create policy "proyecto_responsables: delete" on sgc.proyecto_responsables
  for delete using ( sgc.is_admin() or sgc.tiene_modulo('proyectos') );

grant select, insert, update, delete on sgc.proyecto_responsables to authenticated;

-- Backfill: el responsable único legacy queda vinculado como 'responsable'
insert into sgc.proyecto_responsables (proyecto_id, usuario_id, tipo_responsabilidad)
select p.id, p.responsable_id, 'responsable'
from sgc.proyectos p
where p.responsable_id is not null
  and not exists (
    select 1 from sgc.proyecto_responsables r
    where r.proyecto_id = p.id and r.usuario_id = p.responsable_id
      and r.tipo_responsabilidad = 'responsable' and r.activo
  );

-- Backfill continuidad: miembros del Equipo de Obra que sean ingenieros con cuenta
insert into sgc.proyecto_responsables (proyecto_id, usuario_id, tipo_responsabilidad)
select pe.proyecto_id, e.usuario_id,
       case when pe.rol = 'ing_residente' then 'residente' else 'responsable' end
from sgc.proyecto_empleados pe
join sgc.empleados e on e.id = pe.empleado_id
where pe.rol in ('ing_residente','ing_responsable')
  and e.usuario_id is not null
  and coalesce(pe.activo, true)
  and not exists (
    select 1 from sgc.proyecto_responsables r
    where r.proyecto_id = pe.proyecto_id and r.usuario_id = e.usuario_id
      and r.tipo_responsabilidad = (case when pe.rol='ing_residente' then 'residente' else 'responsable' end)
      and r.activo
  );

-- Contrato para web + app (preselección de firmantes de liberación)
create or replace function sgc.responsables_de_proyecto(p_proyecto_id uuid)
returns table (
  id uuid, usuario_id uuid, nombre text, email text,
  tipo_responsabilidad text, activo boolean, desde date, hasta date, notas text
)
language sql
security definer
set search_path to 'sgc','pg_temp'
as $$
  select r.id, r.usuario_id, u.nombre::text, u.email::text,
         r.tipo_responsabilidad, r.activo, r.desde, r.hasta, r.notas
  from sgc.proyecto_responsables r
  join sgc.usuarios u on u.id = r.usuario_id
  where r.proyecto_id = p_proyecto_id and r.activo
    and auth.uid() is not null
  order by r.tipo_responsabilidad, u.nombre;
$$;

grant execute on function sgc.responsables_de_proyecto(uuid) to authenticated;
