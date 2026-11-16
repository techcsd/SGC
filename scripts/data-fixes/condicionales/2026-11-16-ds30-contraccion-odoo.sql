-- DS-30 (ronda DS, 16-nov-2026; issue #117): MIGRACION DE CONTRACCION (condicional). NO SE PROMUEVE A PROD EN ESTA RONDA.
--
-- Retira las tablas del esquema transitorio de vinculos de stock/OC (`odoo_vinculos_stock`, `odoo_vinculos_stock_lineas`,
-- `odoo_comandos_oc`) cuando Odoo ya es la fuente del stock. ABORTA con aviso (excepcion, no cambia nada) salvo que se cumpla TODO:
--   1. la fase `corte` esta encendida (sgc.odoo_fases);
--   2. TODA bodega homologada con Odoo (odoo_location_id no nulo, activa) tiene `fuente_odoo = true` en sgc.odoo_corte_bodega;
--   3. las tres tablas estan vacias (sin filas ni uso: ninguna otra tabla/funcion las referencia).
-- Vive FUERA de sql/ a proposito: no es una migracion normal (no debe contar como pendiente en el ledger de release-check);
-- cuando se cumplan las condiciones y Xaviel lo autorice, se copia a sql/ con fecha del dia, se aplica a dev (ledger) y despues a prod.
-- Es atomica: el DO valida y recien despues hace los DROP; si algo falla no queda nada a medias.

do $$
declare
  v_corte boolean; v_sin_fuente integer; v_filas bigint := 0; v_t text; v_n bigint; v_dep integer;
begin
  select coalesce(habilitada, false) into v_corte from sgc.odoo_fases where clave = 'corte';
  if not coalesce(v_corte, false) then
    raise exception 'DS-30 abortada: la fase de corte (odoo_fuente_stock) no está encendida.' using errcode = '55000';
  end if;

  select count(*) into v_sin_fuente
    from sgc.bodegas b left join sgc.odoo_corte_bodega c on c.bodega_id = b.id
   where b.activo and b.odoo_location_id is not null and coalesce(c.fuente_odoo, false) = false;
  if v_sin_fuente > 0 then
    raise exception 'DS-30 abortada: % bodega(s) homologada(s) todavía no usan Odoo como fuente del stock.', v_sin_fuente using errcode = '55000';
  end if;

  foreach v_t in array array['odoo_vinculos_stock', 'odoo_vinculos_stock_lineas', 'odoo_comandos_oc'] loop
    if to_regclass('sgc.' || v_t) is not null then
      execute format('select count(*) from sgc.%I', v_t) into v_n;
      v_filas := v_filas + v_n;
    end if;
  end loop;
  if v_filas > 0 then
    raise exception 'DS-30 abortada: las tablas a retirar todavía tienen % fila(s) (hay uso).', v_filas using errcode = '55000';
  end if;

  -- Ninguna otra tabla puede depender (FK) de ellas, salvo entre ellas mismas.
  select count(*) into v_dep from pg_constraint c
   where c.contype = 'f'
     and c.confrelid in (select to_regclass('sgc.' || t) from unnest(array['odoo_vinculos_stock', 'odoo_vinculos_stock_lineas', 'odoo_comandos_oc']) t where to_regclass('sgc.' || t) is not null)
     and c.conrelid not in (select to_regclass('sgc.' || t) from unnest(array['odoo_vinculos_stock', 'odoo_vinculos_stock_lineas', 'odoo_comandos_oc']) t where to_regclass('sgc.' || t) is not null);
  if v_dep > 0 then
    raise exception 'DS-30 abortada: % tabla(s) externas dependen de las que se retirarían.', v_dep using errcode = '55000';
  end if;

  drop table if exists sgc.odoo_vinculos_stock_lineas;
  drop table if exists sgc.odoo_vinculos_stock;
  drop table if exists sgc.odoo_comandos_oc;
  raise notice 'DS-30 aplicada: tablas de vínculos de stock/OC retiradas.';
end $$;
