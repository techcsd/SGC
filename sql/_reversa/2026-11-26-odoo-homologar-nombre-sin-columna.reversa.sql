-- Reversa de sql/2026-11-26-odoo-homologar-nombre-sin-columna.sql: vuelve a la versión original (siempre homologa).
-- OJO: con esta versión los artículos vinculados a Odoo pierden la regla «nombre exacto de Odoo».
begin;
create or replace function sgc.tg_homologar_nombre()
returns trigger
language plpgsql
as $function$
begin
  new.nombre := sgc.homologar_texto(new.nombre);
  return new;
end;
$function$;
commit;
