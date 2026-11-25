-- Reversa de sql/2026-11-25-odoo-importar-catalogo-desde-odoo.sql.
-- No borra los artículos ya importados (origen = 'odoo'): para retirarlos, desactívalos a mano (activo = false).
begin;
drop function if exists sgc.odoo_articulos_importar(uuid, jsonb);

create or replace function sgc.tg_articulo_apertura_automatica()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_cant numeric := coalesce((select valor from sgc.parametros
                              where clave = 'apertura_nuevos_articulos')::numeric, 0);
  rec record;
begin
  if v_cant <= 0 then return new; end if;
  if coalesce(new.es_prueba, false) then return new; end if;

  for rec in
    select distinct ap.bodega_id
      from sgc.stock_apertura ap
      join sgc.bodegas b on b.id = ap.bodega_id
     where coalesce(b.activo, true)
       and not coalesce(b.es_prueba, false)
  loop
    perform sgc._aplicar_apertura(new.id, rec.bodega_id, v_cant, auth.uid());
  end loop;
  return new;
end;
$function$;
commit;
