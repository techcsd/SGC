-- BO10 (F8-resto) — Admin puede editar los catálogos de acero (diámetros kg/m + figuras).
-- Los catálogos ya tenían solo SELECT; se añaden INSERT/UPDATE gateados a is_admin().

begin;

grant insert, update on sgc.acero_diametros, sgc.cartilla_figuras to authenticated;

drop policy if exists cat_diam_ins on sgc.acero_diametros;
create policy cat_diam_ins on sgc.acero_diametros for insert to authenticated with check (sgc.is_admin());
drop policy if exists cat_diam_upd on sgc.acero_diametros;
create policy cat_diam_upd on sgc.acero_diametros for update to authenticated using (sgc.is_admin()) with check (sgc.is_admin());

drop policy if exists cat_fig_ins on sgc.cartilla_figuras;
create policy cat_fig_ins on sgc.cartilla_figuras for insert to authenticated with check (sgc.is_admin());
drop policy if exists cat_fig_upd on sgc.cartilla_figuras;
create policy cat_fig_upd on sgc.cartilla_figuras for update to authenticated using (sgc.is_admin()) with check (sgc.is_admin());

commit;
