-- DS-06 (ronda DS, 16-nov-2026): cuentas analiticas de Odoo por proyecto (#51). ADITIVA.
-- 1) Una cuenta analitica de una instancia no puede estar en dos proyectos.
-- 2) Tabla hija: un proyecto puede tener >1 cuenta (rol principal/adicional), con evidencia y confirmacion.
-- 3) proyectos.odoo_analytic_confirmado: en prod compras.crear solo imputa cuentas confirmadas.
-- Nada se empareja por nombre: el enlace lo escribe el integrador (data-fix) o un admin (RPC con auditoria).
create unique index if not exists odoo_v1_proyectos_analytic_uq
  on sgc.proyectos(odoo_instancia_id, odoo_analytic_id) where odoo_analytic_id is not null;

alter table sgc.proyectos add column if not exists odoo_analytic_confirmado boolean;
comment on column sgc.proyectos.odoo_analytic_confirmado is 'DS-06 cuenta analitica principal confirmada por un admin o pre-confirmada con evidencia';

create table if not exists sgc.proyecto_odoo_analiticas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  odoo_analytic_id bigint not null check (odoo_analytic_id > 0),
  rol text not null default 'adicional' check (rol in ('principal','adicional')),
  confirmado boolean not null default false,
  confirmado_por uuid references sgc.usuarios(id),
  confirmado_en timestamptz,
  evidencia jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  unique (odoo_instancia_id, odoo_analytic_id),
  unique (proyecto_id, odoo_instancia_id, odoo_analytic_id)
);
create unique index if not exists proyecto_odoo_analiticas_principal_uq
  on sgc.proyecto_odoo_analiticas(proyecto_id, odoo_instancia_id) where rol = 'principal';
comment on table sgc.proyecto_odoo_analiticas is 'DS-06 cuentas analiticas de Odoo por proyecto (>1 posible). Escritura: integrador o RPC admin.';

alter table sgc.proyecto_odoo_analiticas enable row level security;
drop policy if exists proyecto_odoo_analiticas_leer on sgc.proyecto_odoo_analiticas;
create policy proyecto_odoo_analiticas_leer on sgc.proyecto_odoo_analiticas
  for select to authenticated using (sgc.is_admin());
grant select on sgc.proyecto_odoo_analiticas to authenticated;
grant all on sgc.proyecto_odoo_analiticas to service_role;

-- Admin confirma/rechaza (auditable: quien y cuando).
create or replace function sgc.odoo_analitica_confirmar(p_id uuid, p_confirmar boolean)
returns jsonb language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v sgc.proyecto_odoo_analiticas; begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo un administrador puede confirmar cuentas analiticas' using errcode = '42501';
  end if;
  update sgc.proyecto_odoo_analiticas
     set confirmado = p_confirmar,
         confirmado_por = case when p_confirmar then auth.uid() else null end,
         confirmado_en = case when p_confirmar then now() else null end
   where id = p_id returning * into v;
  if not found then raise exception 'Cuenta analitica no encontrada' using errcode = 'P0002'; end if;
  if v.rol = 'principal' then
    -- el flag es del integrador: lo escribe el trigger con permiso de definer (postgres)
    update sgc.proyectos set odoo_analytic_confirmado = p_confirmar where id = v.proyecto_id;
  end if;
  return to_jsonb(v);
end $fn$;
revoke all on function sgc.odoo_analitica_confirmar(uuid, boolean) from public;
grant execute on function sgc.odoo_analitica_confirmar(uuid, boolean) to authenticated, service_role;

drop trigger if exists odoo_v1_proteger_campos on sgc.proyectos;
create trigger odoo_v1_proteger_campos before insert or update on sgc.proyectos
  for each row execute function sgc.odoo_v1_proteger_campos(
    'odoo_instancia_id','odoo_compania_id','odoo_id','odoo_analytic_id','odoo_ultima_sync','odoo_version',
    'odoo_analytic_confirmado');
