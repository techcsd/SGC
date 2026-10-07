-- 2026-10-07-ci11b-es-prueba-escape-testuser.sql
-- CI11b — Coherencia es_prueba: un usuario de PRUEBA ve datos de PRUEBA.
-- Hoy ~29 tablas tienen la política restrictiva "oculta" = ((NOT es_prueba) OR is_admin()),
-- que SOLO deja ver datos de prueba a los admin. `proyectos` ya incluía el escape
-- `usuario_actual_es_prueba()`. Unificamos: añadimos ese escape a todas, para que el
-- revisor de tiendas (es_prueba=true) vea la OBRA DEMO en flota/inventario/compras.
-- SEGURO: solo AÑADE un OR; los usuarios reales (usuario_actual_es_prueba=false) no cambian.
--   node scripts/apply-migration.mjs sql/2026-10-07-ci11b-es-prueba-escape-testuser.sql --env dev

do $$
declare r record;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, pol.polname as pol
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'sgc'
      and pol.polcmd in ('r', '*')                 -- SELECT o ALL
      and not pol.polpermissive                    -- restrictiva
      and pg_get_expr(pol.polqual, pol.polrelid) = '((NOT es_prueba) OR sgc.is_admin())'
  loop
    execute format(
      'alter policy %I on sgc.%I using ((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba())',
      r.pol, r.tbl
    );
    raise notice 'escape añadido: %.%', r.tbl, r.pol;
  end loop;
end $$;
