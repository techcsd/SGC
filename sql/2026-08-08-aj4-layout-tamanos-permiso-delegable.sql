-- =============================================================================
-- PROMPT-13 FASE 6 (AJ4) — Layout del launcher de la app: TAMAÑO de tile por
-- módulo/submódulo + permiso DELEGABLE "personalizar layout de la app".
-- Ronda 08/08/2026 (IDs AJ). SGC padre. Aditivo, idempotente, retrocompatible.
--
-- Modelo AF38/AI16 = sgc.app_module_order (clave, parent, orden). Se le añade
-- `size` (1x1 | 2x1 | 2x2, confirmado por Xaviel). set_module_order deja de ser
-- solo-admin: ahora también quien tenga el permiso AG12 'plataforma.layout_app'.
--
-- AJ1 (changelog estructurado) NO requiere DDL: app_versiones.cambios ya es jsonb
-- (array de {t,d}); la convención se amplía a {t,d,m} (m = módulo) para agrupar
-- por módulo. Lo consume/edita la UI web de registrar versión; versiones viejas
-- quedan como texto (fallback en la app).
-- =============================================================================

begin;

-- ── 1) Tamaño de tile por módulo/submódulo ───────────────────────────────────
alter table sgc.app_module_order add column if not exists size text not null default '1x1';
do $$ begin
  alter table sgc.app_module_order
    add constraint app_module_order_size_chk check (size in ('1x1','2x1','2x2'));
exception when duplicate_object then null; end $$;
comment on column sgc.app_module_order.size is 'AJ4 — tamaño del tile en el launcher: 1x1 (chico) | 2x1 (ancho) | 2x2 (grande).';

-- get_module_order usa select * → ya incluye la nueva columna. Se re-declara por
-- claridad y para fijar el orden estable.
create or replace function sgc.get_module_order()
returns setof sgc.app_module_order
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$ select * from sgc.app_module_order order by parent nulls first, orden; $$;
grant execute on function sgc.get_module_order() to authenticated, service_role;

-- ── 2) set_module_order: acepta `size` + permiso delegable (no solo admin) ───
create or replace function sgc.set_module_order(p_items jsonb)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid(); it jsonb; v_size text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.puede_operar_submodulo('plataforma.layout_app')) then
    raise exception 'No tienes permiso para personalizar el layout de la app.';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_size := lower(coalesce(nullif(it->>'size',''), '1x1'));
    if v_size not in ('1x1','2x1','2x2') then v_size := '1x1'; end if;
    insert into sgc.app_module_order (clave, parent, orden, size, updated_at, updated_by)
    values (it->>'clave', nullif(it->>'parent',''), coalesce((it->>'orden')::int, 0), v_size, now(), v_uid)
    on conflict (clave) do update
      set parent = excluded.parent, orden = excluded.orden, size = excluded.size,
          updated_at = now(), updated_by = v_uid;
  end loop;
end;
$$;
grant execute on function sgc.set_module_order(jsonb) to authenticated, service_role;

-- ── 3) Módulo nuevo 'plataforma' en el rol admin (gotcha CLAUDE.md) ──────────
-- is_admin() ya concede todo, pero mantenemos coherencia con MODULOS_DISPONIBLES.
update sgc.roles
   set modulos = array_append(modulos, 'plataforma')
 where codigo = 'admin' and not ('plataforma' = any(modulos));

commit;
