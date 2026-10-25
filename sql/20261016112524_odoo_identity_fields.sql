-- SGC / Odoo: fase 1, campos de identidad aditivos v1. PostgreSQL 16+ (destino Supabase PG17).
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
    ('vehiculos','uuid')
  ) x(tabla,tipo) loop
    select a.atttypid::regtype into actual from pg_attribute a
    where a.attrelid=to_regclass('sgc.'||r.tabla) and a.attname='id' and not a.attisdropped;
    if actual is distinct from to_regtype(r.tipo) then
      raise exception 'Preflight: sgc.%.id requiere %, encontrado %',r.tabla,r.tipo,actual;
    end if;
  end loop;
  for r in select * from (values
    ('odoo_instancias'),('odoo_companias')
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
    where n.nspname='sgc' and p.proname in ('odoo_v1_proteger_campos','odoo_v1_proteger_instancia')
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

-- Cubrir las FKs nuevas: evita escaneos completos al actualizar/borrar orígenes.
do $fk_indexes$
declare r record; columnas text; nombre text;
begin
  for r in select c.conrelid,c.conkey,n.nspname,t.relname
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname='sgc'
      and (c.conname like 'odoo_v1_%' or t.relname=any(array['odoo_instancias','odoo_companias']))
  loop
    select string_agg(format('%I',a.attname),',' order by k.ord) into columnas
      from unnest(r.conkey) with ordinality k(num,ord)
      join pg_attribute a on a.attrelid=r.conrelid and a.attnum=k.num;
    nombre:='odoo_v1_fk_'||left(r.relname,30)||'_'||left(md5(columnas),8);
    execute format('create index if not exists %I on %I.%I (%s)',nombre,r.nspname,r.relname,columnas);
  end loop;
end;
$fk_indexes$;

-- Cerrar SOLO tablas y funciones nuevas; no modificar defaults/RLS/grants existentes.
do $security$
declare nombre text; firma regprocedure;
begin
  foreach nombre in array array['odoo_instancias','odoo_companias'] loop
    execute format('comment on table sgc.%I is %L',nombre,'SGC Odoo foundation v1');
    execute format('alter table sgc.%I enable row level security',nombre);
    execute format('revoke all on table sgc.%I from public,anon,authenticated,service_role',nombre);
    execute format('grant select,insert,update,delete on table sgc.%I to service_role',nombre);
    if not exists(select 1 from pg_policy where polrelid=to_regclass('sgc.'||nombre) and polname='odoo_v1_backend') then
      execute format('create policy odoo_v1_backend on sgc.%I for all to service_role using (true) with check (true)',nombre);
    end if;
  end loop;
  for firma in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='sgc' and p.proname in ('odoo_v1_proteger_campos','odoo_v1_proteger_instancia')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',firma);
    execute format('grant execute on function %s to service_role',firma);
    execute format('comment on function %s is %L',firma,'SGC Odoo foundation v1');
  end loop;
end;
$security$;
commit;
