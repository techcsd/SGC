-- SOLO PostgreSQL local desechable. No ejecutar en Supabase.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end; $$;
create schema sgc;
grant usage on schema sgc to anon, authenticated, service_role;
create table sgc.proveedores (id uuid primary key default gen_random_uuid(), nombre text default 'fixture', odoo_ref text);
create table sgc.articulos (id uuid primary key default gen_random_uuid(), nombre text default 'fixture', unidad text not null default 'u', odoo_ref text);
create table sgc.categorias_inventario (id integer primary key, nombre text default 'fixture');
create table sgc.unidades (id integer primary key, nombre text default 'fixture');
create table sgc.bodegas (id uuid primary key default gen_random_uuid(), nombre text default 'fixture');
create table sgc.ordenes_compra (id uuid primary key default gen_random_uuid(), nombre text default 'fixture');
create table sgc.orden_compra_items (id uuid primary key default gen_random_uuid(), nombre text default 'fixture', orden_id uuid references sgc.ordenes_compra(id) on delete cascade);
create table sgc.proyectos (id uuid primary key default gen_random_uuid(), nombre text default 'fixture');
create table sgc.activos_fijos (id uuid primary key default gen_random_uuid(), nombre text default 'fixture');
create table sgc.tec_equipos (id uuid primary key default gen_random_uuid(), nombre text default 'fixture');
create table sgc.vehiculos (id uuid primary key default gen_random_uuid(), nombre text default 'fixture', odoo_ref text);
create table sgc.entradas_inventario(id uuid primary key default gen_random_uuid(), orden_compra_id uuid references sgc.ordenes_compra(id), salida_id uuid, nombre text);
create table sgc.salidas_inventario(id uuid primary key default gen_random_uuid(), nombre text);
create table sgc.conduces_externos(id uuid primary key default gen_random_uuid(), nombre text);
create table sgc.conteos_inventario(id uuid primary key default gen_random_uuid(), nombre text);
create table sgc.retiros_material(id uuid primary key default gen_random_uuid(), nombre text);
create table sgc.detalle_entradas(id uuid primary key default gen_random_uuid(), entrada_id uuid references sgc.entradas_inventario(id) on delete cascade, articulo_id uuid references sgc.articulos(id));
create table sgc.detalle_salidas(id uuid primary key default gen_random_uuid(), salida_id uuid references sgc.salidas_inventario(id) on delete cascade, articulo_id uuid references sgc.articulos(id));
create table sgc.conteo_items(id uuid primary key default gen_random_uuid(), conteo_id uuid references sgc.conteos_inventario(id), articulo_id uuid references sgc.articulos(id));
create table sgc.retiro_material_items(id uuid primary key default gen_random_uuid(), retiro_id uuid references sgc.retiros_material(id), articulo_id uuid references sgc.articulos(id));
grant select, insert, update, delete on all tables in schema sgc to authenticated, service_role;
-- Simula defaults amplios de una instalación existente: la migración los cerrará SOLO en objetos nuevos.
alter default privileges in schema sgc grant all on tables to anon, authenticated, service_role;
alter default privileges in schema sgc grant execute on functions to anon, authenticated, service_role;
create table public.test_existing_columns as
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='sgc';
create table public.test_existing_grants as
select table_name,grantee,privilege_type
from information_schema.table_privileges where table_schema='sgc';
