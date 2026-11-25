-- HOTFIX Odoo 19 (25-nov-2026), parte 2 -- «Odoo manda el catálogo, también los nombres».
--
-- Odoo es la fuente de verdad: un artículo vinculado a un producto de Odoo debe llamarse como en Odoo. Hoy SGC lo
-- reescribe (homologar_texto: «de/con» en minúscula) y por eso 104 de 600 artículos vinculados difieren de Odoo.
--
-- Cambios (reversible: sql/_reversa/2026-11-25-odoo-alinear-catalogo.reversa.sql):
--  (a) tg_homologar_nombre: si el artículo está vinculado a Odoo (odoo_product_id), solo se recortan/colapsan espacios;
--      el resto del nombre queda EXACTO como en Odoo. Los artículos solo-SGC siguen homologándose.
--  (b) odoo_articulos_importar: el nombre importado ya no se homologa (mismo criterio) y la búsqueda de un artículo sin
--      vínculo con el mismo nombre compara homologado contra homologado.
--  (c) odoo_catalogo_alinear(instancia, filas, aplicar): solo service_role. Con p_aplicar=false NO escribe (simulación).
--      Por cada producto de Odoo: renombra el artículo vinculado al nombre de Odoo (el nombre viejo queda como apodo en
--      articulo_alias si cambia de verdad), vincula artículos sin vínculo con el mismo nombre (ignorando mayúsculas,
--      acentos y espacios), mueve de «(Revisión)» a la categoría indicada y crea lo que no existe (fila con crear=true).
--      Nunca reclasifica un artículo que ya tiene categoría; nunca publica eventos hacia Odoo.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

create or replace function sgc.tg_homologar_nombre()
returns trigger
language plpgsql
as $function$
begin
  if new.odoo_product_id is not null then
    -- Odoo manda: nombre exacto de Odoo (solo espacios recortados/colapsados).
    new.nombre := nullif(btrim(regexp_replace(coalesce(new.nombre, ''), '\s+', ' ', 'g')), '');
  else
    new.nombre := sgc.homologar_texto(new.nombre);
  end if;
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
    v_nombre := left(nullif(btrim(regexp_replace(coalesce(f ->> 'nombre', ''), '\s+', ' ', 'g')), ''), 200);
    v_unidad := left(coalesce(nullif(trim(f ->> 'unidad'), ''), 'Unidad'), 30);
    if v_pid is null or v_pid <= 0 or v_tid is null or v_tid <= 0 or v_nombre is null then
      v_omitidos := v_omitidos + 1; continue;
    end if;

    if exists (select 1 from sgc.articulos where odoo_product_id = v_pid) then
      v_existentes := v_existentes + 1; continue;
    end if;

    select id into v_art from sgc.articulos
     where odoo_product_id is null and sgc.homologar_texto(nombre) = sgc.homologar_texto(v_nombre)
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

create or replace function sgc.odoo_catalogo_alinear(p_instancia uuid, p_filas jsonb, p_aplicar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  f jsonb;
  a record;
  v_pid bigint;
  v_tid bigint;
  v_nombre text;
  v_destino text;
  v_codigo text;
  v_unidad text;
  v_cat integer;
  v_crear boolean;
  v_art uuid;
  v_revision integer;
  v_renombrados integer := 0;
  v_alias integer := 0;
  v_vinculados integer := 0;
  v_reclasificados integer := 0;
  v_creados integer := 0;
  v_sin_cambio integer := 0;
  v_omitidos integer := 0;
  v_colisiones jsonb := '[]'::jsonb;
  v_ejemplos jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  if not exists (select 1 from sgc.odoo_instancias where id = p_instancia and habilitada) then
    raise exception 'Instancia Odoo no existe o no está habilitada' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'p_filas debe ser un arreglo' using errcode = '22023'; end if;
  select id into v_revision from sgc.categorias_inventario where nombre = '(Revisión) Artículos Sin Catálogo Oficial';
  if v_revision is null then raise exception 'Falta la categoría de revisión' using errcode = '22023'; end if;

  perform set_config('sgc.odoo_importando', 'true', true);

  for f in select * from jsonb_array_elements(p_filas) loop
    v_pid := nullif(f ->> 'product_id', '')::bigint;
    v_tid := nullif(f ->> 'template_id', '')::bigint;
    v_nombre := left(nullif(btrim(regexp_replace(coalesce(f ->> 'nombre', ''), '\s+', ' ', 'g')), ''), 200);
    v_unidad := left(coalesce(nullif(trim(f ->> 'unidad'), ''), 'Unidad'), 30);
    v_cat := coalesce(nullif(f ->> 'categoria_id', '')::integer, v_revision);
    v_crear := coalesce((f ->> 'crear')::boolean, false);
    if v_pid is null or v_pid <= 0 or v_tid is null or v_tid <= 0 or v_nombre is null
       or not exists (select 1 from sgc.categorias_inventario where id = v_cat) then
      v_omitidos := v_omitidos + 1; continue;
    end if;

    select * into a from sgc.articulos where odoo_instancia_id = p_instancia and odoo_product_id = v_pid;
    v_art := a.id;

    if v_art is null then
      -- Sin vínculo: ¿hay un artículo SGC sin vínculo con el mismo nombre (sin mayúsculas/acentos/espacios)?
      select * into a from sgc.articulos
       where odoo_product_id is null
         and regexp_replace(lower(sgc.f_unaccent(nombre)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(sgc.f_unaccent(v_nombre)), '[^a-z0-9]', '', 'g')
       order by activo desc, created_at limit 1;
      v_art := a.id;
      if v_art is not null then
        v_vinculados := v_vinculados + 1;
        if p_aplicar then
          update sgc.articulos
             set odoo_product_id = v_pid, odoo_template_id = v_tid, odoo_instancia_id = p_instancia, odoo_ultima_sync = now()
           where id = v_art;
        end if;
      end if;
    end if;

    if v_art is null then
      if not v_crear then v_omitidos := v_omitidos + 1; continue; end if;
      v_codigo := nullif(trim(f ->> 'codigo'), '');
      if v_codigo is null or length(v_codigo) > 50 or exists (select 1 from sgc.articulos where codigo = v_codigo) then
        v_codigo := 'ODOO-' || v_pid;
      end if;
      v_destino := v_nombre;
      if exists (select 1 from sgc.articulos where nombre = v_destino) then
        v_destino := left(v_nombre, 185) || ' (Odoo ' || v_pid || ')';
        v_colisiones := v_colisiones || jsonb_build_object('product_id', v_pid, 'odoo', v_nombre, 'sgc_queda_como', v_destino);
      end if;
      v_creados := v_creados + 1;
      if p_aplicar then
        insert into sgc.articulos (codigo, nombre, categoria_id, unidad, origen, es_prueba, activo,
                                   odoo_instancia_id, odoo_product_id, odoo_template_id, odoo_ultima_sync)
        values (v_codigo, v_destino, v_cat, v_unidad, 'odoo', false, true, p_instancia, v_pid, v_tid, now());
      end if;
      continue;
    end if;

    -- Artículo existente (vinculado o recién vinculado): nombre = Odoo.
    v_destino := v_nombre;
    if exists (select 1 from sgc.articulos where nombre = v_destino and id <> v_art) then
      v_destino := left(v_nombre, 185) || ' (Odoo ' || v_pid || ')';
      v_colisiones := v_colisiones || jsonb_build_object('product_id', v_pid, 'odoo', v_nombre, 'sgc_queda_como', v_destino);
    end if;

    if a.nombre is distinct from v_destino then
      v_renombrados := v_renombrados + 1;
      if jsonb_array_length(v_ejemplos) < 12 then
        v_ejemplos := v_ejemplos || jsonb_build_object('antes', a.nombre, 'despues', v_destino);
      end if;
      if sgc.normalizar_alias(a.nombre) is distinct from sgc.normalizar_alias(v_destino)
         and coalesce(sgc.normalizar_alias(a.nombre), '') <> '' then
        v_alias := v_alias + 1;
        if p_aplicar then
          insert into sgc.articulo_alias (articulo_id, alias, alias_norm)
          values (v_art, btrim(a.nombre), sgc.normalizar_alias(a.nombre))
          on conflict (articulo_id, alias_norm) do nothing;
        end if;
      end if;
      if p_aplicar then
        update sgc.articulos set nombre = v_destino, odoo_ultima_sync = now() where id = v_art;
      end if;
    else
      v_sin_cambio := v_sin_cambio + 1;
    end if;

    if a.categoria_id = v_revision and v_cat <> v_revision then
      v_reclasificados := v_reclasificados + 1;
      if p_aplicar then update sgc.articulos set categoria_id = v_cat where id = v_art; end if;
    end if;
  end loop;

  return jsonb_build_object('aplicado', p_aplicar, 'renombrados', v_renombrados, 'apodos_nuevos', v_alias,
    'vinculados', v_vinculados, 'reclasificados', v_reclasificados, 'creados', v_creados,
    'sin_cambio_de_nombre', v_sin_cambio, 'omitidos', v_omitidos, 'colisiones', v_colisiones, 'ejemplos', v_ejemplos);
end;
$fn$;
comment on function sgc.odoo_catalogo_alinear(uuid, jsonb, boolean) is 'Hotfix Odoo 19 -- alinea el catálogo de SGC con Odoo (nombres, categoría, altas). p_aplicar=false simula. Solo service_role.';
revoke all on function sgc.odoo_catalogo_alinear(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function sgc.odoo_catalogo_alinear(uuid, jsonb, boolean) to service_role;

commit;
