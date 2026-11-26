-- 2026-11-21 — Catálogo de productos, unidades y categorías directo de Odoo.
-- sgc.articulos queda como proyección (única por instancia + odoo_product_id).
-- El alta de un producto nuevo pasa por la bandeja «Productos por dar de alta»
-- con aprobación de Contabilidad y productos.crear (ADR 15 / #206).
-- Aditiva y retrocompatible: las firmas de crear_articulo_app y
-- crear_articulo_desde_libre se conservan, pero ya no crean artículos solo en SGC.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

-- ── 1) Proyección: snapshot y IDs de unidad/categoría de Odoo ──────────────
alter table sgc.articulos
  add column if not exists odoo_snapshot jsonb,
  add column if not exists odoo_snapshot_en timestamptz,
  add column if not exists odoo_uom_id bigint,
  add column if not exists odoo_categ_id bigint;

comment on column sgc.articulos.odoo_snapshot is 'Última lectura del producto en Odoo (nombre, código, unidad, categoría). SGC no es dueño de esos campos.';
comment on column sgc.articulos.odoo_snapshot_en is 'Cuándo se tomó odoo_snapshot. Si Odoo no responde, la UI muestra esta antigüedad.';

do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'articulos_odoo_uom_id_ck') then
    alter table sgc.articulos add constraint articulos_odoo_uom_id_ck check (odoo_uom_id is null or odoo_uom_id > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'articulos_odoo_categ_id_ck') then
    alter table sgc.articulos add constraint articulos_odoo_categ_id_ck check (odoo_categ_id is null or odoo_categ_id > 0) not valid;
  end if;
end
$ck$;

-- Categoría de respaldo para artículos proyectados cuyo categ de Odoo aún no tiene par en SGC.
insert into sgc.categorias_inventario (nombre, orden, destacada, activo)
select 'Odoo', 900, false, true
where not exists (select 1 from sgc.categorias_inventario where lower(btrim(nombre)) = 'odoo');

-- ── 2) Upsert de la proyección al elegir un producto de Odoo (primer pick) ─
create or replace function sgc.upsert_articulo_proyeccion_odoo(
  p_odoo_product_id bigint,
  p_nombre text,
  p_codigo text default null,
  p_unidad text default null,
  p_odoo_template_id bigint default null,
  p_odoo_uom_id bigint default null,
  p_odoo_categ_id bigint default null,
  p_categoria_nombre text default null,
  p_snapshot jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_instancia uuid;
  v_id uuid;
  v_creado boolean := false;
  v_codigo text;
  v_cat int;
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_snap jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_odoo_product_id is null or p_odoo_product_id <= 0 then
    raise exception 'odoo_product_id es obligatorio y debe ser mayor que cero';
  end if;
  if v_nombre is null then raise exception 'El nombre del producto es obligatorio'; end if;

  select count(*) into v_cat from sgc.odoo_instancias where habilitada;
  if v_cat <> 1 then
    raise exception 'No hay una instancia de Odoo habilitada (o hay más de una).';
  end if;
  select id into v_instancia from sgc.odoo_instancias where habilitada;

  v_codigo := nullif(btrim(coalesce(p_codigo, '')), '');
  if v_codigo is null then
    v_codigo := 'ODOO-' || p_odoo_product_id::text;
  end if;

  v_snap := coalesce(p_snapshot, jsonb_build_object(
    'id', p_odoo_product_id,
    'nombre', v_nombre,
    'codigo', v_codigo,
    'unidad', p_unidad,
    'unidad_id', p_odoo_uom_id,
    'categoria', p_categoria_nombre,
    'categoria_id', p_odoo_categ_id,
    'plantilla_id', p_odoo_template_id
  ));

  select id into v_id
    from sgc.articulos
   where odoo_instancia_id = v_instancia
     and odoo_product_id = p_odoo_product_id
   for update;

  if v_id is not null then
    update sgc.articulos
       set nombre = v_nombre,
           codigo = case
             when codigo like 'ODOO-%' or codigo = v_codigo then v_codigo
             else codigo
           end,
           unidad = coalesce(nullif(btrim(coalesce(p_unidad, '')), ''), unidad),
           odoo_template_id = coalesce(p_odoo_template_id, odoo_template_id),
           odoo_uom_id = coalesce(p_odoo_uom_id, odoo_uom_id),
           odoo_categ_id = coalesce(p_odoo_categ_id, odoo_categ_id),
           odoo_snapshot = v_snap,
           odoo_snapshot_en = now(),
           odoo_ultima_sync = now(),
           updated_at = now()
     where id = v_id;
    return jsonb_build_object('id', v_id, 'creado', false, 'codigo', (select codigo from sgc.articulos where id = v_id));
  end if;

  -- Categoría SGC: por nombre de Odoo, o la de respaldo «Odoo».
  select id into v_cat
    from sgc.categorias_inventario
   where lower(btrim(nombre)) = lower(btrim(coalesce(p_categoria_nombre, '')))
   order by id
   limit 1;
  if v_cat is null then
    select id into v_cat from sgc.categorias_inventario where lower(btrim(nombre)) = 'odoo' limit 1;
  end if;
  if v_cat is null then
    raise exception 'No hay una categoría en SGC para proyectar el producto.';
  end if;

  -- Evitar choque de código con un artículo local aún no vinculado.
  if exists (select 1 from sgc.articulos where codigo = v_codigo and (odoo_product_id is distinct from p_odoo_product_id)) then
    v_codigo := 'ODOO-' || p_odoo_product_id::text;
    if exists (select 1 from sgc.articulos where codigo = v_codigo and odoo_product_id is distinct from p_odoo_product_id) then
      v_codigo := 'ODOO-' || p_odoo_product_id::text || '-' || substr(gen_random_uuid()::text, 1, 8);
    end if;
  end if;

  begin
    insert into sgc.articulos (
      nombre, codigo, categoria_id, unidad, propiedad, activo,
      odoo_instancia_id, odoo_product_id, odoo_template_id, odoo_uom_id, odoo_categ_id,
      odoo_snapshot, odoo_snapshot_en, odoo_ultima_sync, origen
    ) values (
      v_nombre, v_codigo, v_cat, nullif(btrim(coalesce(p_unidad, '')), ''),
      'propio_csd', true,
      v_instancia, p_odoo_product_id, p_odoo_template_id, p_odoo_uom_id, p_odoo_categ_id,
      v_snap, now(), now(), 'odoo'
    )
    returning id into v_id;
  exception when unique_violation then
    select id into v_id
      from sgc.articulos
     where odoo_instancia_id = v_instancia and odoo_product_id = p_odoo_product_id;
  end;

  if v_id is null then
    raise exception 'No se pudo registrar la proyección del producto de Odoo.';
  end if;

  v_creado := true;
  return jsonb_build_object('id', v_id, 'creado', v_creado, 'codigo', v_codigo);
end;
$fn$;

comment on function sgc.upsert_articulo_proyeccion_odoo(bigint, text, text, text, bigint, bigint, bigint, text, jsonb) is
  'Proyección de un product.product de Odoo en sgc.articulos. Única por (instancia, odoo_product_id). No pisa extras de SGC (talla, alias, foto, min/max, etc.).';

revoke all on function sgc.upsert_articulo_proyeccion_odoo(bigint, text, text, text, bigint, bigint, bigint, text, jsonb) from public, anon;
grant execute on function sgc.upsert_articulo_proyeccion_odoo(bigint, text, text, text, bigint, bigint, bigint, text, jsonb) to authenticated, service_role;

-- ── 3) Bandeja de alta: aprobación de Contabilidad y datos para productos.crear
alter table sgc.odoo_producto_solicitudes
  add column if not exists origen_item_libre_id uuid,
  add column if not exists nombre_propuesto text,
  add column if not exists codigo_propuesto text,
  add column if not exists odoo_categ_id bigint,
  add column if not exists odoo_uom_id bigint,
  add column if not exists aprobado_por uuid,
  add column if not exists aprobado_en timestamptz;

do $est$
begin
  -- Ampliar el CHECK de estado con 'aprobado' (aditivo).
  if exists (select 1 from pg_constraint where conname = 'odoo_producto_solicitudes_estado_check') then
    alter table sgc.odoo_producto_solicitudes drop constraint odoo_producto_solicitudes_estado_check;
  end if;
  alter table sgc.odoo_producto_solicitudes
    add constraint odoo_producto_solicitudes_estado_check
    check (estado in ('pendiente', 'aprobado', 'creado', 'vinculado_existente', 'rechazado'));
end
$est$;

insert into sgc.roles (codigo, nombre, descripcion, modulos, es_operativo)
select 'contabilidad', 'Contabilidad',
       'Aprueba el alta de productos en Odoo y decisiones de catálogo (ADR 15).',
       array['compras']::text[], false
where not exists (select 1 from sgc.roles where codigo = 'contabilidad');

create or replace function sgc.es_contabilidad()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
  select sgc.is_admin() or exists (
    select 1
      from sgc.usuarios_roles ur
      join sgc.roles r on r.id = ur.rol_id
     where ur.usuario_id = auth.uid()
       and r.codigo in ('contabilidad', 'direccion', 'gerencia')
  );
$fn$;

comment on function sgc.es_contabilidad() is
  'True si el usuario puede aprobar altas de producto en Odoo (rol contabilidad, dirección, gerencia o admin). No existe un módulo «contabilidad».';

revoke all on function sgc.es_contabilidad() from public, anon;
grant execute on function sgc.es_contabilidad() to authenticated, service_role;

create or replace function sgc.aprobar_solicitud_producto_odoo(
  p_solicitud_id uuid,
  p_nombre text default null,
  p_codigo text default null,
  p_odoo_categ_id bigint default null,
  p_odoo_uom_id bigint default null
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_s sgc.odoo_producto_solicitudes;
  v_nombre text;
begin
  if not sgc.es_contabilidad() then
    raise exception 'Solo Contabilidad (o Dirección / Gerencia / admin) puede aprobar el alta de un producto.' using errcode = '42501';
  end if;

  select * into v_s from sgc.odoo_producto_solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_s.estado not in ('pendiente', 'aprobado') then
    return jsonb_build_object('ok', false, 'motivo', format('la solicitud ya estaba %s', v_s.estado));
  end if;
  if v_s.solicitado_por = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes aprobar tu propia solicitud' using errcode = '42501';
  end if;

  v_nombre := nullif(btrim(coalesce(p_nombre, v_s.nombre_propuesto, v_s.descripcion_libre)), '');
  if v_nombre is null then
    raise exception 'El nombre del producto es obligatorio para aprobar el alta.';
  end if;

  update sgc.odoo_producto_solicitudes
     set estado = 'aprobado',
         nombre_propuesto = v_nombre,
         codigo_propuesto = coalesce(nullif(btrim(coalesce(p_codigo, '')), ''), codigo_propuesto),
         odoo_categ_id = coalesce(p_odoo_categ_id, odoo_categ_id),
         odoo_uom_id = coalesce(p_odoo_uom_id, odoo_uom_id),
         aprobado_por = auth.uid(),
         aprobado_en = now()
   where id = p_solicitud_id;

  return jsonb_build_object('ok', true, 'estado', 'aprobado', 'solicitud_id', p_solicitud_id);
end;
$fn$;

comment on function sgc.aprobar_solicitud_producto_odoo(uuid, text, text, bigint, bigint) is
  'ADR 15 — Contabilidad aprueba el alta. El gateway productos.crear solo escribe en Odoo si la solicitud está aprobada.';

revoke all on function sgc.aprobar_solicitud_producto_odoo(uuid, text, text, bigint, bigint) from public, anon;
grant execute on function sgc.aprobar_solicitud_producto_odoo(uuid, text, text, bigint, bigint) to authenticated, service_role;

-- El edge (service_role) relee la solicitud, crea el producto en Odoo y cierra el alta.
create or replace function sgc.solicitud_producto_para_crear(p_solicitud_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_s sgc.odoo_producto_solicitudes;
  v_inst uuid;
begin
  select * into v_s from sgc.odoo_producto_solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_s.estado <> 'aprobado' then
    raise exception 'La solicitud debe estar aprobada por Contabilidad antes de crearla en Odoo.';
  end if;
  select id into v_inst from sgc.odoo_instancias where habilitada;
  if v_inst is null then raise exception 'No hay una instancia de Odoo habilitada.'; end if;
  return jsonb_build_object(
    'solicitud_id', v_s.id,
    'odoo_instancia_id', v_inst,
    'nombre', coalesce(v_s.nombre_propuesto, v_s.descripcion_libre),
    'codigo', v_s.codigo_propuesto,
    'odoo_categ_id', v_s.odoo_categ_id,
    'odoo_uom_id', v_s.odoo_uom_id,
    'descripcion', v_s.descripcion_libre,
    'origen_item_libre_id', v_s.origen_item_libre_id,
    'orden_id', v_s.orden_id,
    'orden_item_id', v_s.orden_item_id
  );
end;
$fn$;

create or replace function sgc.solicitud_producto_marcar_creado(
  p_solicitud_id uuid,
  p_articulo_id uuid,
  p_odoo_product_id bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_s sgc.odoo_producto_solicitudes;
begin
  select * into v_s from sgc.odoo_producto_solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_s.estado = 'creado' and v_s.articulo_resultante_id is not null then
    return jsonb_build_object('ok', true, 'repetido', true, 'articulo_id', v_s.articulo_resultante_id);
  end if;
  if v_s.estado <> 'aprobado' then
    raise exception 'La solicitud debe estar aprobada para marcarla como creada.';
  end if;

  update sgc.odoo_producto_solicitudes
     set estado = 'creado',
         articulo_resultante_id = p_articulo_id,
         resuelto_por = coalesce(resuelto_por, auth.uid()),
         resuelto_en = coalesce(resuelto_en, now())
   where id = p_solicitud_id;

  if v_s.orden_item_id is not null then
    update sgc.orden_compra_items
       set articulo_id = p_articulo_id,
           odoo_product_id = coalesce(odoo_product_id, p_odoo_product_id)
     where id = v_s.orden_item_id;
  end if;

  if v_s.origen_item_libre_id is not null then
    begin
      perform sgc.vincular_item_libre_articulo(v_s.origen_item_libre_id, p_articulo_id, false);
    exception when others then
      -- El vínculo es best-effort: el artículo ya existe en Odoo y en la proyección.
      null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'repetido', false, 'articulo_id', p_articulo_id);
end;
$fn$;

revoke all on function sgc.solicitud_producto_para_crear(uuid), sgc.solicitud_producto_marcar_creado(uuid, uuid, bigint) from public, anon;
grant execute on function sgc.solicitud_producto_para_crear(uuid), sgc.solicitud_producto_marcar_creado(uuid, uuid, bigint) to service_role;

-- Badge: pendientes + aprobados (esperando creación en Odoo).
create or replace function sgc.productos_por_dar_de_alta_count()
returns integer
language sql
security invoker
stable
set search_path to 'sgc', 'pg_temp'
as $fn$
  select count(*)::integer
    from sgc.odoo_producto_solicitudes
   where estado in ('pendiente', 'aprobado');
$fn$;

-- ── 4) crear_articulo_app / desde_libre: abren una solicitud de alta, no un artículo solo en SGC
create or replace function sgc.crear_articulo_app(
  p_nombre text, p_categoria_id int, p_unidad text default null,
  p_propiedad text default 'propio_csd', p_nota text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_busqueda text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.puede_gestionar_articulos() then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_nombre is null then raise exception 'Nombre requerido'; end if;
  v_busqueda := v_nombre;

  insert into sgc.odoo_producto_solicitudes (descripcion_libre, busqueda_previa, nombre_propuesto, solicitado_por)
    values (v_nombre, v_busqueda, v_nombre, v_uid)
    returning id into v_id;

  return jsonb_build_object(
    'solicitud_id', v_id,
    'pendiente', true,
    'mensaje', 'El artículo se pedirá de alta en Odoo. Contabilidad debe aprobarlo antes de usarlo en un movimiento.'
  );
end;
$fn$;

comment on function sgc.crear_articulo_app(text, int, text, text, text) is
  'Ya no crea un artículo solo en SGC: abre una solicitud en Productos por dar de alta (catálogo = Odoo).';

create or replace function sgc.crear_articulo_desde_libre(
  p_item_libre_id     uuid,
  p_nombre            text,
  p_categoria_id      int,
  p_unidad            text default null,
  p_generar_movimiento boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_il sgc.salida_items_libres%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if v_nombre is null then raise exception 'Nombre requerido'; end if;

  select * into v_il from sgc.salida_items_libres where id = p_item_libre_id;
  if not found then raise exception 'Item libre no encontrado.'; end if;
  if v_il.articulo_vinculado_id is not null then
    raise exception 'Este material ya fue vinculado.';
  end if;

  insert into sgc.odoo_producto_solicitudes (
    descripcion_libre, busqueda_previa, nombre_propuesto, solicitado_por, origen_item_libre_id
  ) values (v_nombre, v_nombre, v_nombre, v_uid, p_item_libre_id)
    returning id into v_id;

  return jsonb_build_object(
    'solicitud_id', v_id,
    'pendiente', true,
    'generar_movimiento_omitido', coalesce(p_generar_movimiento, false),
    'mensaje', 'Se abrió una solicitud de alta en Odoo. Cuando Contabilidad la apruebe y se cree el producto, se podrá vincular este material.'
  );
end;
$fn$;

comment on function sgc.crear_articulo_desde_libre(uuid, text, int, text, boolean) is
  'Ya no crea un artículo solo en SGC: abre una solicitud de alta en Odoo y deja el material no catalogado pendiente de vínculo.';

-- ── 5) Movimientos nuevos exigen odoo_product_id (salvo datos de prueba)
create or replace function sgc.exigir_articulo_en_odoo(p_articulo_id uuid)
returns void
language plpgsql
stable
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_nombre text;
  v_pid bigint;
begin
  select nombre, odoo_product_id into v_nombre, v_pid from sgc.articulos where id = p_articulo_id;
  if not found then
    raise exception 'Artículo no encontrado.';
  end if;
  if v_pid is null then
    raise exception '«%» no está en el catálogo de Odoo. Pide el alta en Productos por dar de alta antes de usarlo en un movimiento.', coalesce(v_nombre, 'Este artículo');
  end if;
end;
$fn$;

comment on function sgc.exigir_articulo_en_odoo(uuid) is
  'Los movimientos nuevos (salidas, entradas, ajustes, conteos) exigen que el artículo tenga odoo_product_id.';

revoke all on function sgc.exigir_articulo_en_odoo(uuid) from public, anon;
grant execute on function sgc.exigir_articulo_en_odoo(uuid) to authenticated, service_role;

create or replace function sgc.trg_detalle_exige_odoo()
returns trigger
language plpgsql
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_prueba boolean := false;
begin
  if tg_table_name = 'detalle_salidas' then
    select coalesce(es_prueba, false) into v_prueba from sgc.salidas_inventario where id = new.salida_id;
  elsif tg_table_name = 'detalle_entradas' then
    begin
      select coalesce(es_prueba, false) into v_prueba from sgc.entradas_inventario where id = new.entrada_id;
    exception when undefined_table or undefined_column then
      v_prueba := false;
    end;
  end if;
  if not coalesce(v_prueba, false) then
    perform sgc.exigir_articulo_en_odoo(new.articulo_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_detalle_salidas_exige_odoo on sgc.detalle_salidas;
create trigger trg_detalle_salidas_exige_odoo
  before insert on sgc.detalle_salidas
  for each row execute function sgc.trg_detalle_exige_odoo();

do $ent$
begin
  if to_regclass('sgc.detalle_entradas') is not null then
    execute 'drop trigger if exists trg_detalle_entradas_exige_odoo on sgc.detalle_entradas';
    execute 'create trigger trg_detalle_entradas_exige_odoo before insert on sgc.detalle_entradas for each row execute function sgc.trg_detalle_exige_odoo()';
  end if;
end
$ent$;

-- ── 6) Reposición: no pisar reglas editadas a mano en Odoo
alter table sgc.odoo_reabastecimiento_reglas
  add column if not exists protegida boolean not null default false;

comment on column sgc.odoo_reabastecimiento_reglas.protegida is
  'True si la regla se editó en Odoo después de la última escritura de SGC: la sincronización no la sobrescribe.';

create or replace function sgc.odoo_reabastecimiento_cargar(p_instancia uuid)
returns jsonb language sql stable security definer set search_path = sgc, pg_temp as $fn$
  select jsonb_build_object(
    'articulos', coalesce((select jsonb_agg(jsonb_build_object('articulo_id', a.id, 'odoo_product_id', a.odoo_product_id,
        'minimo', a.stock_minimo, 'maximo', coalesce(a.stock_maximo, a.stock_minimo)))
      from sgc.articulos a where a.odoo_product_id is not null and coalesce(a.stock_minimo, 0) > 0 and coalesce(a.activo, true)), '[]'::jsonb),
    'reglas', coalesce((select jsonb_agg(jsonb_build_object('articulo_id', r.articulo_id, 'orderpoint_id', r.odoo_orderpoint_id,
        'minimo', r.minimo, 'maximo', r.maximo, 'activa', r.activa, 'odoo_product_id', a.odoo_product_id,
        'protegida', coalesce(r.protegida, false)))
      from sgc.odoo_reabastecimiento_reglas r join sgc.articulos a on a.id = r.articulo_id where r.odoo_instancia_id = p_instancia), '[]'::jsonb));
$fn$;

create or replace function sgc.odoo_reabastecimiento_marcar_protegida(p_articulo uuid, p_protegida boolean)
returns void language sql security definer set search_path = sgc, pg_temp as $fn$
  update sgc.odoo_reabastecimiento_reglas set protegida = p_protegida where articulo_id = p_articulo;
$fn$;

revoke all on function sgc.odoo_reabastecimiento_marcar_protegida(uuid, boolean) from public, anon;
grant execute on function sgc.odoo_reabastecimiento_marcar_protegida(uuid, boolean) to service_role;

grant execute on function sgc.odoo_reabastecimiento_cargar(uuid) to service_role;

commit;
