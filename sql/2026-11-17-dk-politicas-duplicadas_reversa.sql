-- Reversa de 2026-11-17-dk-politicas-duplicadas.sql: recrea las politicas SELECT quitadas (mismos roles y expresion).
begin;
drop policy if exists "articulos: read" on sgc.articulos;
create policy "articulos: read" on sgc.articulos for select to authenticated using (true);
drop policy if exists "articulos: select" on sgc.articulos;
create policy "articulos: select" on sgc.articulos for select to authenticated using (true);
drop policy if exists "categorias_inventario: read" on sgc.categorias_inventario;
create policy "categorias_inventario: read" on sgc.categorias_inventario for select to authenticated using (true);
drop policy if exists "roles: read all" on sgc.roles;
create policy "roles: read all" on sgc.roles for select to authenticated using (true);
drop policy if exists "usuarios: read own" on sgc.usuarios;
create policy "usuarios: read own" on sgc.usuarios for select to authenticated using (id = (select auth.uid()));
drop policy if exists "stock_select" on sgc.stock_por_bodega;
create policy "stock_select" on sgc.stock_por_bodega for select to authenticated using (
  'admin'::text = any ((select sgc.get_user_roles())::text[]) or 'logistica'::text = any ((select sgc.get_user_roles())::text[]) or 'gerencia'::text = any ((select sgc.get_user_roles())::text[]));
drop policy if exists "stock_por_bodega: select" on sgc.stock_por_bodega;
create policy "stock_por_bodega: select" on sgc.stock_por_bodega for select to authenticated using (
  (select sgc.is_admin()) or (select sgc.tiene_modulo('inventario')) or (select sgc.tiene_modulo('compras')));
commit;
