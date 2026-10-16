-- SGC / Odoo: fundación aditiva v1. PostgreSQL 16+ (destino Supabase PG17).
-- Solo prepara esquema. NO crea conexiones, cron, webhooks, HTTP ni eventos de negocio.
-- Aplicación con scripts/apply-migration.mjs <este archivo> --env dev.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $preflight$
declare r record; actual regtype;
begin
  if to_regnamespace('sgc') is null then raise exception 'Falta el esquema sgc'; end if;
  if not exists(select 1 from pg_roles where rolname='service_role')
     or not exists(select 1 from pg_roles where rolname='authenticated')
     or not exists(select 1 from pg_roles where rolname='anon') then
    raise exception 'Faltan roles Supabase; no ejecutar fuera de la base SGC correcta';
  end if;
  for r in select * from (values
    ('proveedores','uuid'),
    ('articulos','uuid'),
    ('categorias_inventario','integer'),
    ('unidades','integer'),
    ('bodegas','uuid'),
    ('ordenes_compra','uuid'),
    ('orden_compra_items','uuid'),
    ('proyectos','uuid'),
    ('activos_fijos','uuid'),
    ('tec_equipos','uuid'),
    ('vehiculos','uuid'),
    ('entradas_inventario','uuid'),
    ('salidas_inventario','uuid'),
    ('conduces_externos','uuid'),
    ('conteos_inventario','uuid'),
    ('retiros_material','uuid'),
    ('detalle_entradas','uuid'),
    ('detalle_salidas','uuid'),
    ('conteo_items','uuid'),
    ('retiro_material_items','uuid')
  ) x(tabla,tipo) loop
    select a.atttypid::regtype into actual from pg_attribute a
    where a.attrelid=to_regclass('sgc.'||r.tabla) and a.attname='id' and not a.attisdropped;
    if actual is distinct from to_regtype(r.tipo) then
      raise exception 'Preflight: sgc.%.id requiere %, encontrado %',r.tabla,r.tipo,actual;
    end if;
  end loop;
  for r in select * from (values
    ('odoo_instancias'),('odoo_companias'),('odoo_documentos'),('odoo_lineas'),
    ('odoo_recepcion_asignaciones'),('odoo_eventos'),('odoo_intentos'),
    ('odoo_cursores'),('odoo_politicas'),('odoo_conciliaciones'),('odoo_desfases')
  ) x(tabla) loop
    if to_regclass('sgc.'||r.tabla) is not null
       and obj_description(to_regclass('sgc.'||r.tabla),'pg_class') is distinct from 'SGC Odoo foundation v1' then
      raise exception 'Objeto preexistente ajeno al paquete: sgc.%',r.tabla;
    end if;
  end loop;
end;
$preflight$;

do $function_collisions$
begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='sgc' and p.proname in ('odoo_v1_proteger_campos','odoo_v1_validar_documento',
      'odoo_v1_validar_linea','odoo_v1_validar_asignacion','odoo_v1_reclamar_eventos',
      'odoo_v1_finalizar_evento','odoo_v1_proteger_instancia')
    and obj_description(p.oid,'pg_proc') is distinct from 'SGC Odoo foundation v1') then
    raise exception 'Hay una función preexistente ajena al paquete con el mismo nombre';
  end if;
end;
$function_collisions$;

create table if not exists sgc.odoo_instancias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check(length(btrim(nombre)) between 1 and 120),
  base_url text not null check(base_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'),
  base_datos text not null check(length(btrim(base_datos)) between 1 and 128),
  entorno text not null check(entorno in ('dev','prod')),
  habilitada boolean not null default false,
  permitir_salida boolean not null default false,
  permitir_entrada boolean not null default false,
  creado_en timestamptz not null default now(),
  unique(base_url,base_datos,entorno)
);
create table if not exists sgc.odoo_companias (
  instancia_id uuid not null references sgc.odoo_instancias(id),
  odoo_id bigint not null check(odoo_id > 0),
  nombre text not null check(length(btrim(nombre)) > 0),
  activa boolean not null default true,
  primary key(instancia_id,odoo_id)
);

create or replace function sgc.odoo_v1_proteger_instancia()
returns trigger language plpgsql security invoker set search_path=pg_catalog,sgc as $fn$
begin
  if (new.base_url,new.base_datos,new.entorno) is distinct from (old.base_url,old.base_datos,old.entorno) then
    raise exception 'Identidad de instancia inmutable; registrar otra instancia' using errcode='23514';
  end if;
  return new;
end;
$fn$;
do $trg$ begin
  if not exists(select 1 from pg_trigger where tgrelid='sgc.odoo_instancias'::regclass and tgname='odoo_v1_proteger_instancia') then
    create trigger odoo_v1_proteger_instancia before update on sgc.odoo_instancias for each row execute function sgc.odoo_v1_proteger_instancia();
  end if;
end; $trg$;

-- Solo protege campos NUEVOS; odoo_ref queda fuera para no romper importadores.
create or replace function sgc.odoo_v1_proteger_campos()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,sgc as $fn$
declare nuevo jsonb; previo jsonb;
begin
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into nuevo
    from jsonb_each(to_jsonb(new)) where key=any(tg_argv) and value <> 'null'::jsonb;
  if tg_op='INSERT' then previo:='{}'::jsonb;
  else
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into previo
      from jsonb_each(to_jsonb(old)) where key=any(tg_argv) and value <> 'null'::jsonb;
  end if;
  if nuevo is distinct from previo and current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'Identidades Odoo: escritura reservada al integrador' using errcode='42501';
  end if;
  return new;
end;
$fn$;

-- Extensión opcional de sgc.proveedores; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.proveedores'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.proveedores.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.proveedores
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.proveedores.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.proveedores.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.proveedores.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.proveedores.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.proveedores.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.proveedores'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.proveedores add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.proveedores add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.proveedores add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.proveedores add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.proveedores'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.proveedores
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create unique index if not exists odoo_v1_proveedores_odoo_id_uq on sgc.proveedores(odoo_instancia_id,odoo_id) where odoo_id is not null;
create index if not exists odoo_v1_proveedores_instancia_ix on sgc.proveedores(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.articulos; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_product_id','bigint'),('odoo_template_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.articulos'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.articulos.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.articulos
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_product_id bigint,
  add column if not exists odoo_template_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.articulos.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.articulos.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.articulos.odoo_product_id is 'SGC Odoo foundation v1';
comment on column sgc.articulos.odoo_template_id is 'SGC Odoo foundation v1';
comment on column sgc.articulos.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.articulos.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.articulos'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.articulos add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_product_id is null and odoo_template_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.articulos add constraint odoo_v1_ids_ck check ((odoo_product_id is null or odoo_product_id > 0) and (odoo_template_id is null or odoo_template_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.articulos add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.articulos add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.articulos'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.articulos
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_product_id','odoo_template_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create unique index if not exists odoo_v1_articulos_odoo_product_id_uq on sgc.articulos(odoo_instancia_id,odoo_product_id) where odoo_product_id is not null;
create index if not exists odoo_v1_articulos_instancia_ix on sgc.articulos(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.categorias_inventario; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.categorias_inventario'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.categorias_inventario.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.categorias_inventario
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.categorias_inventario.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.categorias_inventario.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.categorias_inventario.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.categorias_inventario.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.categorias_inventario.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.categorias_inventario'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.categorias_inventario add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.categorias_inventario add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.categorias_inventario add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.categorias_inventario add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.categorias_inventario'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.categorias_inventario
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create index if not exists odoo_v1_categorias_inventario_instancia_ix on sgc.categorias_inventario(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.unidades; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_factor','numeric(24,12)'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.unidades'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.unidades.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.unidades
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_factor numeric(24,12),
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.unidades.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.unidades.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.unidades.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.unidades.odoo_factor is 'SGC Odoo foundation v1';
comment on column sgc.unidades.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.unidades.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.unidades'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.unidades add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_factor is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.unidades add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_factor is null or (odoo_factor > 0 and odoo_factor<>'NaN'::numeric)) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.unidades add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.unidades add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.unidades'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.unidades
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_factor','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create index if not exists odoo_v1_unidades_instancia_ix on sgc.unidades(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.bodegas; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_location_id','bigint'),('odoo_warehouse_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.bodegas'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.bodegas.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.bodegas
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_location_id bigint,
  add column if not exists odoo_warehouse_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.bodegas.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.bodegas.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.bodegas.odoo_location_id is 'SGC Odoo foundation v1';
comment on column sgc.bodegas.odoo_warehouse_id is 'SGC Odoo foundation v1';
comment on column sgc.bodegas.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.bodegas.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.bodegas'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.bodegas add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_location_id is null and odoo_warehouse_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.bodegas add constraint odoo_v1_ids_ck check ((odoo_location_id is null or odoo_location_id > 0) and (odoo_warehouse_id is null or odoo_warehouse_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.bodegas add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.bodegas add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.bodegas'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.bodegas
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_location_id','odoo_warehouse_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create unique index if not exists odoo_v1_bodegas_odoo_location_id_uq on sgc.bodegas(odoo_instancia_id,odoo_location_id) where odoo_location_id is not null;
create index if not exists odoo_v1_bodegas_instancia_ix on sgc.bodegas(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.ordenes_compra; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.ordenes_compra'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.ordenes_compra.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.ordenes_compra
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.ordenes_compra.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.ordenes_compra.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.ordenes_compra.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.ordenes_compra.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.ordenes_compra.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.ordenes_compra'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.ordenes_compra add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.ordenes_compra add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.ordenes_compra add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.ordenes_compra add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.ordenes_compra'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.ordenes_compra
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create unique index if not exists odoo_v1_ordenes_compra_odoo_id_uq on sgc.ordenes_compra(odoo_instancia_id,odoo_id) where odoo_id is not null;
create index if not exists odoo_v1_ordenes_compra_instancia_ix on sgc.ordenes_compra(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.orden_compra_items; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.orden_compra_items'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.orden_compra_items.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.orden_compra_items
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.orden_compra_items.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.orden_compra_items.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.orden_compra_items.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.orden_compra_items.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.orden_compra_items.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.orden_compra_items'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.orden_compra_items add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.orden_compra_items add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.orden_compra_items add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.orden_compra_items add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.orden_compra_items'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.orden_compra_items
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create unique index if not exists odoo_v1_orden_compra_items_odoo_id_uq on sgc.orden_compra_items(odoo_instancia_id,odoo_id) where odoo_id is not null;
create index if not exists odoo_v1_orden_compra_items_instancia_ix on sgc.orden_compra_items(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.proyectos; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_analytic_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.proyectos'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.proyectos.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.proyectos
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_analytic_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.proyectos.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.proyectos.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.proyectos.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.proyectos.odoo_analytic_id is 'SGC Odoo foundation v1';
comment on column sgc.proyectos.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.proyectos.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.proyectos'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.proyectos add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_analytic_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.proyectos add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_analytic_id is null or odoo_analytic_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.proyectos add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.proyectos add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.proyectos'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.proyectos
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_analytic_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create unique index if not exists odoo_v1_proyectos_odoo_id_uq on sgc.proyectos(odoo_instancia_id,odoo_id) where odoo_id is not null;
create index if not exists odoo_v1_proyectos_instancia_ix on sgc.proyectos(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.activos_fijos; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_modelo','text'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.activos_fijos'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.activos_fijos.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.activos_fijos
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_modelo text,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.activos_fijos.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.activos_fijos.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.activos_fijos.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.activos_fijos.odoo_modelo is 'SGC Odoo foundation v1';
comment on column sgc.activos_fijos.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.activos_fijos.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.activos_fijos'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.activos_fijos add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_modelo is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.activos_fijos add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_id is null or odoo_modelo is not null) and (odoo_modelo is null or odoo_modelo ~ '^[a-z][a-z0-9_.]+$') and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.activos_fijos add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.activos_fijos add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.activos_fijos'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.activos_fijos
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_modelo','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create index if not exists odoo_v1_activos_fijos_instancia_ix on sgc.activos_fijos(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.tec_equipos; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_modelo','text'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.tec_equipos'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.tec_equipos.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.tec_equipos
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_modelo text,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.tec_equipos.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.tec_equipos.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.tec_equipos.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.tec_equipos.odoo_modelo is 'SGC Odoo foundation v1';
comment on column sgc.tec_equipos.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.tec_equipos.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.tec_equipos'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.tec_equipos add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_modelo is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.tec_equipos add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_id is null or odoo_modelo is not null) and (odoo_modelo is null or odoo_modelo ~ '^[a-z][a-z0-9_.]+$') and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.tec_equipos add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.tec_equipos add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.tec_equipos'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.tec_equipos
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_modelo','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create index if not exists odoo_v1_tec_equipos_instancia_ix on sgc.tec_equipos(odoo_instancia_id) where odoo_instancia_id is not null;

-- Extensión opcional de sgc.vehiculos; sin defaults ni backfill.
do $columns$
declare r record; actual regtype; comentario text;
begin
  for r in select * from (values ('odoo_instancia_id','uuid'),('odoo_compania_id','bigint'),('odoo_id','bigint'),('odoo_ultima_sync','timestamptz'),('odoo_version','text')) x(nombre,tipo) loop
    select a.atttypid::regtype,col_description(a.attrelid,a.attnum) into actual,comentario
      from pg_attribute a where a.attrelid='sgc.vehiculos'::regclass and a.attname=r.nombre and not a.attisdropped;
    if found and (actual is distinct from to_regtype(r.tipo) or comentario is distinct from 'SGC Odoo foundation v1') then
      raise exception 'Colisión o tipo inesperado: sgc.vehiculos.%',r.nombre;
    end if;
  end loop;
end;
$columns$;
alter table sgc.vehiculos
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_compania_id bigint,
  add column if not exists odoo_id bigint,
  add column if not exists odoo_ultima_sync timestamptz,
  add column if not exists odoo_version text;
comment on column sgc.vehiculos.odoo_instancia_id is 'SGC Odoo foundation v1';
comment on column sgc.vehiculos.odoo_compania_id is 'SGC Odoo foundation v1';
comment on column sgc.vehiculos.odoo_id is 'SGC Odoo foundation v1';
comment on column sgc.vehiculos.odoo_ultima_sync is 'SGC Odoo foundation v1';
comment on column sgc.vehiculos.odoo_version is 'SGC Odoo foundation v1';
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='sgc.vehiculos'::regclass and conname='odoo_v1_contexto_ck') then
    alter table sgc.vehiculos add constraint odoo_v1_contexto_ck
      check (odoo_instancia_id is not null or (odoo_compania_id is null and odoo_id is null and odoo_ultima_sync is null and odoo_version is null)) not valid;
    alter table sgc.vehiculos add constraint odoo_v1_ids_ck check ((odoo_id is null or odoo_id > 0) and (odoo_compania_id is null or odoo_compania_id > 0)) not valid;
    alter table sgc.vehiculos add constraint odoo_v1_instancia_fk foreign key(odoo_instancia_id) references sgc.odoo_instancias(id) not valid;
    alter table sgc.vehiculos add constraint odoo_v1_compania_fk foreign key(odoo_instancia_id,odoo_compania_id) references sgc.odoo_companias(instancia_id,odoo_id) not valid;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='sgc.vehiculos'::regclass and tgname='odoo_v1_proteger_campos') then
    create trigger odoo_v1_proteger_campos before insert or update on sgc.vehiculos
      for each row execute function sgc.odoo_v1_proteger_campos('odoo_instancia_id','odoo_compania_id','odoo_id','odoo_ultima_sync','odoo_version');
  end if;
end;
$constraints$;
create unique index if not exists odoo_v1_vehiculos_odoo_id_uq on sgc.vehiculos(odoo_instancia_id,odoo_id) where odoo_id is not null;
create index if not exists odoo_v1_vehiculos_instancia_ix on sgc.vehiculos(odoo_instancia_id) where odoo_instancia_id is not null;

-- Los vínculos múltiples no fuerzan a representar un traslado como dos compras.
create table if not exists sgc.odoo_documentos (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references sgc.odoo_instancias(id),
  compania_id bigint,
  modelo text not null check(modelo in ('stock.picking','stock.move','stock.scrap')),
  odoo_id bigint not null check(odoo_id > 0),
  etapa text not null check(length(btrim(etapa)) between 1 and 80),
  tipo_sgc text not null,
  sgc_id uuid not null,
  orden_compra_id uuid references sgc.ordenes_compra(id) on delete set null on update set null,
  entrada_id uuid references sgc.entradas_inventario(id) on delete set null on update set null,
  salida_id uuid references sgc.salidas_inventario(id) on delete set null on update set null,
  conduce_externo_id uuid references sgc.conduces_externos(id) on delete set null on update set null,
  conteo_id uuid references sgc.conteos_inventario(id) on delete set null on update set null,
  retiro_id uuid references sgc.retiros_material(id) on delete set null on update set null,
  origen_borrado_en timestamptz,
  creado_en timestamptz not null default now(),
  foreign key(instancia_id,compania_id) references sgc.odoo_companias(instancia_id,odoo_id),
  check(num_nonnulls(orden_compra_id,entrada_id,salida_id,conduce_externo_id,conteo_id,retiro_id)<=1),
  unique(instancia_id,modelo,odoo_id,tipo_sgc,sgc_id,etapa),
  unique(id,instancia_id)
);
create or replace function sgc.odoo_v1_validar_documento()
returns trigger language plpgsql security invoker set search_path=pg_catalog,sgc as $fn$
declare tipo text; clave uuid;
begin
  if num_nonnulls(new.orden_compra_id,new.entrada_id,new.salida_id,new.conduce_externo_id,new.conteo_id,new.retiro_id)=1 then
    tipo:=case when new.orden_compra_id is not null then 'ordenes_compra'
      when new.entrada_id is not null then 'entradas_inventario'
      when new.salida_id is not null then 'salidas_inventario'
      when new.conduce_externo_id is not null then 'conduces_externos'
      when new.conteo_id is not null then 'conteos_inventario' else 'retiros_material' end;
    clave:=coalesce(new.orden_compra_id,new.entrada_id,new.salida_id,new.conduce_externo_id,new.conteo_id,new.retiro_id);
    if (new.tipo_sgc is not null and new.tipo_sgc<>tipo) or (new.sgc_id is not null and new.sgc_id<>clave) then
      raise exception 'El vínculo no coincide con la FK de origen' using errcode='23514';
    end if;
    new.tipo_sgc:=tipo; new.sgc_id:=clave; new.origen_borrado_en:=null;
  elsif tg_op='UPDATE' and new.tipo_sgc=old.tipo_sgc and new.sgc_id=old.sgc_id then
    new.origen_borrado_en:=coalesce(old.origen_borrado_en,clock_timestamp());
  else raise exception 'El documento necesita exactamente una FK de origen' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (new.tipo_sgc,new.sgc_id,new.instancia_id,new.modelo,new.odoo_id,new.etapa)
    is distinct from (old.tipo_sgc,old.sgc_id,old.instancia_id,old.modelo,old.odoo_id,old.etapa) then
    raise exception 'El vínculo documental es inmutable; registrar una nueva relación' using errcode='23514';
  end if;
  return new;
end;
$fn$;
do $trg$ begin
  if not exists(select 1 from pg_trigger where tgrelid='sgc.odoo_documentos'::regclass and tgname='odoo_v1_validar_documento') then
    create trigger odoo_v1_validar_documento before insert or update on sgc.odoo_documentos for each row execute function sgc.odoo_v1_validar_documento();
  end if;
end; $trg$;

create table if not exists sgc.odoo_lineas (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null,
  instancia_id uuid not null,
  modelo text not null check(modelo in ('stock.move','stock.move.line')),
  odoo_id bigint not null check(odoo_id>0),
  tipo_sgc text not null,
  sgc_id uuid not null,
  orden_compra_item_id uuid references sgc.orden_compra_items(id) on delete set null on update set null,
  detalle_entrada_id uuid references sgc.detalle_entradas(id) on delete set null on update set null,
  detalle_salida_id uuid references sgc.detalle_salidas(id) on delete set null on update set null,
  conteo_item_id uuid references sgc.conteo_items(id) on delete set null on update set null,
  retiro_item_id uuid references sgc.retiro_material_items(id) on delete set null on update set null,
  cantidad_sgc numeric(24,8) check(cantidad_sgc>=0 and cantidad_sgc<>'NaN'::numeric),
  cantidad_odoo numeric(24,8) check(cantidad_odoo>=0 and cantidad_odoo<>'NaN'::numeric),
  origen_borrado_en timestamptz,
  creado_en timestamptz not null default now(),
  foreign key(documento_id,instancia_id) references sgc.odoo_documentos(id,instancia_id),
  check(num_nonnulls(orden_compra_item_id,detalle_entrada_id,detalle_salida_id,conteo_item_id,retiro_item_id)<=1),
  unique(documento_id,modelo,odoo_id,tipo_sgc,sgc_id)
);
create or replace function sgc.odoo_v1_validar_linea()
returns trigger language plpgsql security invoker set search_path=pg_catalog,sgc as $fn$
declare d sgc.odoo_documentos%rowtype; tipo text; clave uuid; padre uuid; esperado uuid;
begin
  if num_nonnulls(new.orden_compra_item_id,new.detalle_entrada_id,new.detalle_salida_id,new.conteo_item_id,new.retiro_item_id)=0 then
    if tg_op='UPDATE' and (new.tipo_sgc,new.sgc_id,new.documento_id,new.instancia_id,new.modelo,new.odoo_id)
      is not distinct from (old.tipo_sgc,old.sgc_id,old.documento_id,old.instancia_id,old.modelo,old.odoo_id) then
      new.origen_borrado_en:=coalesce(old.origen_borrado_en,clock_timestamp()); return new;
    end if;
    raise exception 'La línea necesita exactamente una FK de origen' using errcode='23514';
  end if;
  if num_nonnulls(new.orden_compra_item_id,new.detalle_entrada_id,new.detalle_salida_id,new.conteo_item_id,new.retiro_item_id)<>1 then
    raise exception 'Línea con múltiples orígenes' using errcode='23514';
  end if;
  select * into d from sgc.odoo_documentos where id=new.documento_id and instancia_id=new.instancia_id;
  if not found or d.origen_borrado_en is not null then raise exception 'Documento inexistente, distinto entorno o sin origen activo' using errcode='23514'; end if;
  if new.orden_compra_item_id is not null then
    tipo:='orden_compra_items'; clave:=new.orden_compra_item_id; esperado:=d.orden_compra_id;
    select orden_id into padre from sgc.orden_compra_items where id=clave;
  elsif new.detalle_entrada_id is not null then
    tipo:='detalle_entradas'; clave:=new.detalle_entrada_id; esperado:=d.entrada_id;
    select entrada_id into padre from sgc.detalle_entradas where id=clave;
  elsif new.detalle_salida_id is not null then
    tipo:='detalle_salidas'; clave:=new.detalle_salida_id; esperado:=d.salida_id;
    select salida_id into padre from sgc.detalle_salidas where id=clave;
  elsif new.conteo_item_id is not null then
    tipo:='conteo_items'; clave:=new.conteo_item_id; esperado:=d.conteo_id;
    select conteo_id into padre from sgc.conteo_items where id=clave;
  else
    tipo:='retiro_material_items'; clave:=new.retiro_item_id; esperado:=d.retiro_id;
    select retiro_id into padre from sgc.retiro_material_items where id=clave;
  end if;
  if esperado is null or padre is distinct from esperado then raise exception 'La línea no pertenece al documento SGC' using errcode='23514'; end if;
  if (new.tipo_sgc is not null and new.tipo_sgc<>tipo) or (new.sgc_id is not null and new.sgc_id<>clave) then
    raise exception 'Identidad de línea incompatible' using errcode='23514';
  end if;
  new.tipo_sgc:=tipo; new.sgc_id:=clave; new.origen_borrado_en:=null;
  if tg_op='UPDATE' and (new.tipo_sgc,new.sgc_id,new.documento_id,new.instancia_id,new.modelo,new.odoo_id)
    is distinct from (old.tipo_sgc,old.sgc_id,old.documento_id,old.instancia_id,old.modelo,old.odoo_id) then
    raise exception 'El vínculo de línea es inmutable' using errcode='23514';
  end if;
  return new;
end;
$fn$;
do $trg$ begin
  if not exists(select 1 from pg_trigger where tgrelid='sgc.odoo_lineas'::regclass and tgname='odoo_v1_validar_linea') then
    create trigger odoo_v1_validar_linea before insert or update on sgc.odoo_lineas for each row execute function sgc.odoo_v1_validar_linea();
  end if;
end; $trg$;

-- Relación faltante: asignar una recepción a una o varias líneas OC, sin cambiar detalle_entradas.
create table if not exists sgc.odoo_recepcion_asignaciones (
  id uuid primary key default gen_random_uuid(),
  detalle_entrada_id uuid references sgc.detalle_entradas(id) on delete set null on update set null,
  orden_compra_item_id uuid references sgc.orden_compra_items(id) on delete set null on update set null,
  detalle_entrada_origen_id uuid not null,
  orden_compra_item_origen_id uuid not null,
  cantidad numeric(24,8) not null check(cantidad>0 and cantidad<>'NaN'::numeric),
  unidad_id integer references sgc.unidades(id) on delete set null on update set null,
  unidad_origen_id integer,
  factor numeric(24,12) not null default 1 check(factor>0 and factor<>'NaN'::numeric),
  creado_en timestamptz not null default now(),
  unique(detalle_entrada_origen_id,orden_compra_item_origen_id)
);
create or replace function sgc.odoo_v1_validar_asignacion()
returns trigger language plpgsql security invoker set search_path=pg_catalog,sgc as $fn$
declare orden_recepcion uuid; orden_item uuid;
begin
  if new.unidad_id is not null then new.unidad_origen_id:=new.unidad_id;
  elsif tg_op='UPDATE' then new.unidad_origen_id:=old.unidad_origen_id;
  end if;
  if tg_op='INSERT' then
    if new.detalle_entrada_id is null or new.orden_compra_item_id is null then raise exception 'Asignación sin líneas activas' using errcode='23514'; end if;
    new.detalle_entrada_origen_id:=new.detalle_entrada_id;
    new.orden_compra_item_origen_id:=new.orden_compra_item_id;
  else
    if (new.detalle_entrada_origen_id,new.orden_compra_item_origen_id) is distinct from (old.detalle_entrada_origen_id,old.orden_compra_item_origen_id)
      or (new.detalle_entrada_id is not null and new.detalle_entrada_id<>old.detalle_entrada_origen_id)
      or (new.orden_compra_item_id is not null and new.orden_compra_item_id<>old.orden_compra_item_origen_id) then
      raise exception 'Identidad de asignación inmutable' using errcode='23514';
    end if;
  end if;
  -- Una nulificación referencial no debe bloquear un DELETE legacy por desfase histórico.
  if tg_op='UPDATE' and old.unidad_id is not null and new.unidad_id is null
    and (new.detalle_entrada_id,new.orden_compra_item_id,new.cantidad,new.factor)
      is not distinct from (old.detalle_entrada_id,old.orden_compra_item_id,old.cantidad,old.factor) then
    return new;
  end if;
  if new.detalle_entrada_id is not null and new.orden_compra_item_id is not null then
    select e.orden_compra_id into orden_recepcion from sgc.detalle_entradas d join sgc.entradas_inventario e on e.id=d.entrada_id where d.id=new.detalle_entrada_id;
    select orden_id into orden_item from sgc.orden_compra_items where id=new.orden_compra_item_id;
    if orden_recepcion is not null and orden_recepcion is distinct from orden_item then
      raise exception 'La línea OC pertenece a otra orden' using errcode='23514';
    end if;
  end if;
  return new;
end;
$fn$;
do $trg$ begin
  if not exists(select 1 from pg_trigger where tgrelid='sgc.odoo_recepcion_asignaciones'::regclass and tgname='odoo_v1_validar_asignacion') then
    create trigger odoo_v1_validar_asignacion before insert or update on sgc.odoo_recepcion_asignaciones for each row execute function sgc.odoo_v1_validar_asignacion();
  end if;
end; $trg$;

create table if not exists sgc.odoo_eventos (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references sgc.odoo_instancias(id),
  compania_id bigint,
  direccion text not null check(direccion in ('sgc_a_odoo','odoo_a_sgc')),
  clave_idempotencia text not null check(length(btrim(clave_idempotencia)) between 1 and 250),
  agregado text not null check(length(btrim(agregado)) between 1 and 200),
  revision bigint not null check(revision>0),
  accion text not null check(length(btrim(accion)) between 1 and 100),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
  estado text not null default 'pendiente' check(estado in ('pendiente','procesando','completado','reintento','error','incierto','bloqueado','cancelado')),
  depende_de uuid,
  causa_evento_id uuid,
  disponible_en timestamptz not null default now(),
  intentos integer not null default 0 check(intentos>=0),
  lease_token uuid,
  lease_hasta timestamptz,
  procesador text,
  ultimo_error text,
  resultado jsonb,
  creado_en timestamptz not null default now(),
  finalizado_en timestamptz,
  unique(instancia_id,direccion,clave_idempotencia),
  unique(instancia_id,direccion,agregado,revision),
  unique(id,instancia_id),
  foreign key(instancia_id,compania_id) references sgc.odoo_companias(instancia_id,odoo_id),
  foreign key(depende_de,instancia_id) references sgc.odoo_eventos(id,instancia_id),
  foreign key(causa_evento_id,instancia_id) references sgc.odoo_eventos(id,instancia_id),
  check(depende_de is null or depende_de<>id),
  check(causa_evento_id is null or causa_evento_id<>id),
  check((estado='procesando' and lease_token is not null and lease_hasta is not null and procesador is not null)
     or (estado<>'procesando' and lease_token is null and lease_hasta is null))
);
create table if not exists sgc.odoo_intentos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references sgc.odoo_eventos(id),
  numero integer not null check(numero>0),
  lease_token uuid not null unique,
  procesador text not null,
  iniciado_en timestamptz not null default now(),
  terminado_en timestamptz,
  estado text not null default 'procesando',
  error_resumen text,
  unique(evento_id,numero)
);
create table if not exists sgc.odoo_cursores (
  instancia_id uuid not null references sgc.odoo_instancias(id),
  modelo text not null check(modelo ~ '^[a-z][a-z0-9_.]+$'),
  consumidor text not null check(length(btrim(consumidor)) between 1 and 100),
  cursor jsonb not null default '{}'::jsonb check(jsonb_typeof(cursor)='object'),
  actualizado_en timestamptz not null default now(),
  primary key(instancia_id,modelo,consumidor)
);
create table if not exists sgc.odoo_politicas (
  instancia_id uuid not null references sgc.odoo_instancias(id),
  modelo text not null,
  campo text not null,
  autoridad text not null check(autoridad in ('sgc','odoo','solo_lectura')),
  conflicto text not null default 'revision_manual' check(conflicto in ('revision_manual','rechazar')),
  habilitada boolean not null default false,
  primary key(instancia_id,modelo,campo)
);
create table if not exists sgc.odoo_conciliaciones (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references sgc.odoo_instancias(id),
  compania_id bigint,
  alcance text not null,
  fecha_sgc timestamptz not null,
  fecha_odoo timestamptz not null,
  filtros jsonb not null default '{}'::jsonb,
  resumen jsonb not null default '{}'::jsonb,
  estado text not null default 'borrador' check(estado in ('borrador','revisada','aceptada','descartada')),
  creado_en timestamptz not null default now(),
  foreign key(instancia_id,compania_id) references sgc.odoo_companias(instancia_id,odoo_id)
);
create table if not exists sgc.odoo_desfases (
  id uuid primary key default gen_random_uuid(),
  conciliacion_id uuid not null references sgc.odoo_conciliaciones(id),
  entidad_sgc text,
  clave_sgc text,
  modelo_odoo text,
  odoo_id bigint check(odoo_id>0),
  clasificacion text not null check(clasificacion in ('equivalente','solo_sgc','solo_odoo','diferente','ambiguo','no_aplica')),
  accion text not null default 'revisar' check(accion in ('vincular','crear_sgc','crear_odoo','corregir_sgc','corregir_odoo','revisar','ninguna')),
  decision text not null default 'pendiente' check(decision in ('pendiente','aceptada','rechazada','aplicada')),
  evidencia jsonb not null default '{}'::jsonb,
  resultado jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists odoo_v1_eventos_pendientes_ix on sgc.odoo_eventos(instancia_id,disponible_en,creado_en) where estado in ('pendiente','reintento');
create index if not exists odoo_v1_eventos_agregado_ix on sgc.odoo_eventos(instancia_id,direccion,agregado,revision);
create index if not exists odoo_v1_eventos_lease_ix on sgc.odoo_eventos(instancia_id,lease_hasta) where estado='procesando';
create index if not exists odoo_v1_documentos_origen_ix on sgc.odoo_documentos(tipo_sgc,sgc_id,instancia_id);
create index if not exists odoo_v1_lineas_origen_ix on sgc.odoo_lineas(tipo_sgc,sgc_id);
create index if not exists odoo_v1_desfases_run_ix on sgc.odoo_desfases(conciliacion_id,decision,clasificacion);

-- Cubrir las FKs nuevas: evita escaneos completos al actualizar/borrar orígenes.
do $fk_indexes$
declare r record; columnas text; nombre text;
begin
  for r in select c.conrelid,c.conkey,n.nspname,t.relname
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname='sgc'
      and (c.conname like 'odoo_v1_%' or t.relname=any(array[
        'odoo_instancias','odoo_companias','odoo_documentos','odoo_lineas',
        'odoo_recepcion_asignaciones','odoo_eventos','odoo_intentos','odoo_cursores',
        'odoo_politicas','odoo_conciliaciones','odoo_desfases']))
  loop
    select string_agg(format('%I',a.attname),',' order by k.ord) into columnas
      from unnest(r.conkey) with ordinality k(num,ord)
      join pg_attribute a on a.attrelid=r.conrelid and a.attnum=k.num;
    nombre:='odoo_v1_fk_'||left(r.relname,30)||'_'||left(md5(columnas),8);
    execute format('create index if not exists %I on %I.%I (%s)',nombre,r.nspname,r.relname,columnas);
  end loop;
end;
$fk_indexes$;

-- Reclamación atómica. Un lease vencido se vuelve INCIERTO, nunca se reenvía ciegamente.
create or replace function sgc.odoo_v1_reclamar_eventos(
  p_instancia uuid,p_procesador text,p_limite integer default 20,p_lease_segundos integer default 120)
returns setof sgc.odoo_eventos language plpgsql security invoker
set search_path=pg_catalog,sgc as $fn$
declare r sgc.odoo_eventos%rowtype;
begin
  if p_limite is null or p_limite<1 or p_limite>100 or p_lease_segundos is null or p_lease_segundos<30 or p_lease_segundos>900
     or p_procesador is null or length(btrim(p_procesador)) not between 1 and 100 then
    raise exception 'Parámetros de reclamación inválidos' using errcode='22023';
  end if;
  with vencidos as (
    select id from sgc.odoo_eventos where instancia_id=p_instancia and estado='procesando'
      and lease_hasta<=clock_timestamp() for update skip locked
  ), cambios as (
    update sgc.odoo_eventos e set estado='incierto',lease_token=null,lease_hasta=null,
      ultimo_error='Lease vencido; reconciliar resultado ERP antes de reintentar'
    from vencidos v where e.id=v.id returning e.id
  )
  update sgc.odoo_intentos t set estado='incierto',terminado_en=clock_timestamp(),
    error_resumen='Lease vencido'
  where t.evento_id in(select id from cambios) and t.terminado_en is null;

  for r in
    select e.* from sgc.odoo_eventos e join sgc.odoo_instancias i on i.id=e.instancia_id
    where e.instancia_id=p_instancia and i.habilitada
      and ((e.direccion='sgc_a_odoo' and i.permitir_salida) or (e.direccion='odoo_a_sgc' and i.permitir_entrada))
      and e.estado in ('pendiente','reintento') and e.disponible_en<=clock_timestamp()
      and (e.depende_de is null or exists(select 1 from sgc.odoo_eventos p where p.id=e.depende_de and p.estado='completado'))
      and not exists(select 1 from sgc.odoo_eventos prev where prev.instancia_id=e.instancia_id
        and prev.direccion=e.direccion and prev.agregado=e.agregado
        and (prev.revision,prev.creado_en,prev.id)<(e.revision,e.creado_en,e.id)
        and prev.estado not in ('completado','cancelado'))
    order by e.creado_en,e.id limit p_limite for update of e skip locked
  loop
    update sgc.odoo_eventos set estado='procesando',intentos=intentos+1,lease_token=gen_random_uuid(),
      lease_hasta=clock_timestamp()+make_interval(secs=>p_lease_segundos),procesador=p_procesador,
      finalizado_en=null where id=r.id returning * into r;
    insert into sgc.odoo_intentos(evento_id,numero,lease_token,procesador)
      values(r.id,r.intentos,r.lease_token,p_procesador);
    return next r;
  end loop;
end;
$fn$;

create or replace function sgc.odoo_v1_finalizar_evento(
  p_evento uuid,p_lease uuid,p_estado text,p_resultado jsonb default null,
  p_error text default null,p_reintentar_en timestamptz default null)
returns void language plpgsql security invoker set search_path=pg_catalog,sgc as $fn$
begin
  if p_estado is null or p_estado not in ('completado','reintento','error','incierto','bloqueado','cancelado') then
    raise exception 'Estado final inválido' using errcode='22023';
  end if;
  if p_estado='reintento' and (p_reintentar_en is null or p_reintentar_en<=clock_timestamp()) then
    raise exception 'Reintento requiere una fecha futura' using errcode='22023';
  end if;
  update sgc.odoo_eventos set estado=p_estado,resultado=p_resultado,ultimo_error=p_error,
    lease_token=null,lease_hasta=null,disponible_en=coalesce(p_reintentar_en,disponible_en),
    finalizado_en=case when p_estado in ('completado','cancelado') then clock_timestamp() else null end
  where id=p_evento and estado='procesando' and lease_token=p_lease and lease_hasta>clock_timestamp();
  if not found then raise exception 'Lease inexistente, vencido o reemplazado' using errcode='55000'; end if;
  update sgc.odoo_intentos set estado=p_estado,terminado_en=clock_timestamp(),error_resumen=p_error
    where evento_id=p_evento and lease_token=p_lease and terminado_en is null;
end;
$fn$;

-- Cerrar SOLO tablas y funciones nuevas; no modificar defaults/RLS/grants existentes.
do $security$
declare nombre text; firma regprocedure;
begin
  foreach nombre in array array[
    'odoo_instancias','odoo_companias','odoo_documentos','odoo_lineas','odoo_recepcion_asignaciones',
    'odoo_eventos','odoo_intentos','odoo_cursores','odoo_politicas','odoo_conciliaciones','odoo_desfases'
  ] loop
    execute format('comment on table sgc.%I is %L',nombre,'SGC Odoo foundation v1');
    execute format('alter table sgc.%I enable row level security',nombre);
    execute format('revoke all on table sgc.%I from public,anon,authenticated,service_role',nombre);
    execute format('grant select,insert,update,delete on table sgc.%I to service_role',nombre);
    if not exists(select 1 from pg_policy where polrelid=to_regclass('sgc.'||nombre) and polname='odoo_v1_backend') then
      execute format('create policy odoo_v1_backend on sgc.%I for all to service_role using (true) with check (true)',nombre);
    end if;
  end loop;
  for firma in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='sgc' and p.proname in ('odoo_v1_proteger_campos','odoo_v1_validar_documento',
      'odoo_v1_validar_linea','odoo_v1_validar_asignacion','odoo_v1_reclamar_eventos','odoo_v1_finalizar_evento',
      'odoo_v1_proteger_instancia')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',firma);
    execute format('grant execute on function %s to service_role',firma);
    execute format('comment on function %s is %L',firma,'SGC Odoo foundation v1');
  end loop;
end;
$security$;
commit;
