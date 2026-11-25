-- Reversa de sql/2026-11-25-odoo-alinear-catalogo.sql.
-- No revierte los nombres ya alineados (los datos): para eso usa el respaldo que deja el data-fix
-- (scripts/data-fixes/2026-11-25-odoo-alinear-catalogo.mjs) o los apodos de articulo_alias.
begin;
drop function if exists sgc.odoo_catalogo_alinear(uuid, jsonb, boolean);

create or replace function sgc.tg_homologar_nombre()
returns trigger
language plpgsql
as $function$
begin
  new.nombre := sgc.homologar_texto(new.nombre);
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
commit;
