-- 2026-11-17 -- DS-30 (parte B, #117): retira SOLO las tablas sin uso del esquema transitorio de vinculos de stock
-- (odoo_vinculos_stock_lineas, odoo_vinculos_stock). `odoo_comandos_oc` SE CONSERVA: es la tabla de idempotencia de las OC reales (odoo-api).
-- Aborta (sin cambiar nada) salvo que: tablas vacias, sin FK externas y ninguna funcion las referencie
-- (en prod ademas se aplica con las 16 bodegas ya en fuente Odoo, 17-nov). Reversa: recrear las tablas desde sql/2026-10-26-cy4-vinculos-stock-odoo.sql (estaban vacias).
do $$
declare v_n bigint := 0; v_x bigint; v_dep integer; v_fn integer; t text;
begin
  foreach t in array array['odoo_vinculos_stock', 'odoo_vinculos_stock_lineas'] loop
    if to_regclass('sgc.' || t) is not null then execute format('select count(*) from sgc.%I', t) into v_x; v_n := v_n + v_x; end if;
  end loop;
  if v_n > 0 then raise exception 'DS-30b abortada: las tablas tienen % fila(s).', v_n using errcode = '55000'; end if;
  select count(*) into v_dep from pg_constraint c
   where c.contype = 'f' and c.confrelid in (select to_regclass('sgc.' || x) from unnest(array['odoo_vinculos_stock','odoo_vinculos_stock_lineas']) x where to_regclass('sgc.' || x) is not null)
     and c.conrelid not in (select to_regclass('sgc.' || x) from unnest(array['odoo_vinculos_stock','odoo_vinculos_stock_lineas']) x where to_regclass('sgc.' || x) is not null);
  if v_dep > 0 then raise exception 'DS-30b abortada: % FK externa(s).', v_dep using errcode = '55000'; end if;
  select count(*) into v_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'sgc' and pg_get_functiondef(p.oid) ~ 'odoo_vinculos_stock';
  if v_fn > 0 then raise exception 'DS-30b abortada: % funcion(es) referencian las tablas.', v_fn using errcode = '55000'; end if;
  drop table if exists sgc.odoo_vinculos_stock_lineas;
  drop table if exists sgc.odoo_vinculos_stock;
  raise notice 'DS-30b aplicada.';
end $$;
