-- HOTFIX Odoo 19 (25-nov-2026) -- «Odoo manda el catálogo»: los productos con stock en una bodega proyectada que SGC
-- aún no conoce se importan como artículos (origen 'odoo').
--
-- Diagnóstico (prod, solo lectura; Odoo 19.0+e): el stock de SGC es fiel a Odoo, pero Odoo tiene 417 productos con
-- stock real y solo 47 están vinculados a artículos de SGC. Los otros 179 artículos vinculados apuntan a productos
-- que SGC creó vacíos el 17-nov; el «stock» viejo de SGC era una apertura sintética (parametro
-- apertura_nuevos_articulos = 1000 por bodega), no stock real, y NO se restaura.
--
-- Cambios (aditivo y reversible, sql/_reversa/2026-11-25-odoo-importar-catalogo-desde-odoo.reversa.sql):
--  (a) tg_articulo_apertura_automatica: un artículo de origen 'odoo' nunca recibe apertura de SGC (Odoo manda el stock).
--  (b) sgc.odoo_articulos_importar(instancia, filas): solo service_role. Idempotente por odoo_product_id. Si ya existe un
--      artículo sin vínculo con el mismo nombre homologado, lo VINCULA en vez de duplicarlo; si no, lo crea en la
--      categoría «(Revisión) Artículos Sin Catálogo Oficial» para que el almacén los clasifique. No publica eventos a Odoo.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

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
  -- Odoo manda: un artículo importado desde Odoo no recibe apertura sintética de SGC.
  if new.origen = 'odoo' then return new; end if;

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

create or replace function sgc.odoo_articulos_importar(p_instancia uuid, p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  f jsonb;
  v_pid bigint;
  v_tid bigint;
  v_nombre text;
  v_codigo text;
  v_unidad text;
  v_art uuid;
  v_creados integer := 0;
  v_vinculados integer := 0;
  v_existentes integer := 0;
  v_omitidos integer := 0;
  v_cat integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  if not exists (select 1 from sgc.odoo_instancias where id = p_instancia and habilitada) then
    raise exception 'Instancia Odoo no existe o no está habilitada' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'p_filas debe ser un arreglo' using errcode = '22023'; end if;

  select id into v_cat from sgc.categorias_inventario where nombre = '(Revisión) Artículos Sin Catálogo Oficial';
  if v_cat is null then raise exception 'Falta la categoría de revisión' using errcode = '22023'; end if;

  -- No publicar al outbox hacia Odoo lo que viene de Odoo.
  perform set_config('sgc.odoo_importando', 'true', true);

  for f in select * from jsonb_array_elements(p_filas) loop
    v_pid := nullif(f ->> 'product_id', '')::bigint;
    v_tid := nullif(f ->> 'template_id', '')::bigint;
    v_nombre := left(sgc.homologar_texto(f ->> 'nombre'), 200);
    v_unidad := left(coalesce(nullif(trim(f ->> 'unidad'), ''), 'Unidad'), 30);
    if v_pid is null or v_pid <= 0 or v_tid is null or v_tid <= 0 or v_nombre is null then
      v_omitidos := v_omitidos + 1; continue;
    end if;

    if exists (select 1 from sgc.articulos where odoo_product_id = v_pid) then
      v_existentes := v_existentes + 1; continue;
    end if;

    -- ¿Hay un artículo SGC sin vínculo con el mismo nombre? Se vincula (no se duplica).
    select id into v_art from sgc.articulos
     where odoo_product_id is null and nombre = v_nombre
     order by created_at limit 1;
    if v_art is not null then
      update sgc.articulos
         set odoo_product_id = v_pid, odoo_template_id = v_tid, odoo_instancia_id = p_instancia, odoo_ultima_sync = now()
       where id = v_art;
      v_vinculados := v_vinculados + 1; continue;
    end if;

    v_codigo := nullif(trim(f ->> 'codigo'), '');
    if v_codigo is null or length(v_codigo) > 50 or exists (select 1 from sgc.articulos where codigo = v_codigo) then
      v_codigo := 'ODOO-' || v_pid;
    end if;
    if exists (select 1 from sgc.articulos where nombre = v_nombre) then
      v_nombre := left(v_nombre, 185) || ' (Odoo ' || v_pid || ')';
    end if;

    insert into sgc.articulos (codigo, nombre, categoria_id, unidad, origen, es_prueba, activo,
                               odoo_instancia_id, odoo_product_id, odoo_template_id, odoo_ultima_sync)
    values (v_codigo, v_nombre, v_cat, v_unidad, 'odoo', false, true, p_instancia, v_pid, v_tid, now());
    v_creados := v_creados + 1;
  end loop;

  return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'existentes', v_existentes, 'omitidos', v_omitidos);
end;
$fn$;
comment on function sgc.odoo_articulos_importar(uuid, jsonb) is 'Hotfix Odoo 19 -- importa/vincula artículos desde productos de Odoo con stock. Solo service_role.';
revoke all on function sgc.odoo_articulos_importar(uuid, jsonb) from public, anon, authenticated;
grant execute on function sgc.odoo_articulos_importar(uuid, jsonb) to service_role;

commit;
