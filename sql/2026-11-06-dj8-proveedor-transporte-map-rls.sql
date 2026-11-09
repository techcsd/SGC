-- Issue #71 (sub-pieza acotada): sgc.proveedor_transporte_map nunca tuvo RLS
-- habilitado (BF2b, puente de la fusion old->new transportistas). Verificado
-- antes de escribir esto: anon/authenticated NO tienen ningun grant sobre esta
-- tabla (solo postgres/service_role) -- no es una fuga activa hoy, pero
-- sin RLS cualquier grant futuro a esos roles quedaria sin filtro. Se cierra
-- explicitamente, igual que sgc.odoo_instancias/odoo_companias (F5).
-- El resto de #71 (auth.uid() sin (select ...) en ~40 politicas, consolidar
-- politicas permisivas multiples) NO se toca aqui -- volumen grande, necesita
-- prueba de permisos negativos por tabla antes de aplicar, ver
-- docs/PLAN-ISSUES-ABIERTOS-2026-11.md.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

alter table sgc.proveedor_transporte_map enable row level security;
revoke all on table sgc.proveedor_transporte_map from public, anon, authenticated;

do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid = 'sgc.proveedor_transporte_map'::regclass and polname = 'proveedor_transporte_map_backend') then
    create policy proveedor_transporte_map_backend on sgc.proveedor_transporte_map
      for all to service_role using (true) with check (true);
  end if;
end; $pol$;

commit;
