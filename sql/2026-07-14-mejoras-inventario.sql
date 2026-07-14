-- ============================================================================
-- Mejoras 14/07/2026 — Inventario (R16 categorías destacadas, R18 homologación)
-- ----------------------------------------------------------------------------
-- Aditivo. Usa la tabla EXISTENTE sgc.categorias_inventario (NO se crea
-- articulo_categorias; articulos.categoria_id ya existe y es NOT NULL).
--   R16  columnas orden + destacada; Clavos/Madera/Acero destacadas primero
--   R18  sgc.homologar_texto() + triggers BEFORE INSERT/UPDATE en nombres
-- ============================================================================

set search_path = sgc, public;

-- ── R18) Homologación de texto en servidor ─────────────────────────────────
-- Trim + colapsa espacios + primera letra de cada palabra en mayúscula,
-- CONSERVANDO el resto tal cual (preserva acrónimos/medidas: STARLINK, BTU, 1/4)
-- y dejando en minúscula los conectores españoles (y, de, la, ...), salvo la
-- primera palabra. No destructiva sobre nombres ya bien escritos.
create or replace function sgc.homologar_texto(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
  w text;
  parts text[];
  out  text[] := '{}';
  i int := 0;
  connectors constant text[] := array['y','e','o','u','de','del','la','las','el','los','un','una','en','con','a','al','para','por'];
begin
  v := trim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
  if v = '' then return null; end if;
  parts := regexp_split_to_array(v, ' ');
  foreach w in array parts loop
    i := i + 1;
    if i > 1 and lower(w) = any(connectors) then
      out := out || lower(w);
    else
      out := out || (upper(left(w, 1)) || substr(w, 2));
    end if;
  end loop;
  return array_to_string(out, ' ');
end;
$$;
grant execute on function sgc.homologar_texto(text) to authenticated, service_role;

-- Trigger genérico: homologa la columna NEW.nombre.
create or replace function sgc.tg_homologar_nombre()
returns trigger
language plpgsql
as $$
begin
  new.nombre := sgc.homologar_texto(new.nombre);
  return new;
end;
$$;

-- Almacenes (bodegas)
drop trigger if exists trg_homologar_bodega_ins on sgc.bodegas;
drop trigger if exists trg_homologar_bodega_upd on sgc.bodegas;
create trigger trg_homologar_bodega_ins before insert on sgc.bodegas
  for each row execute function sgc.tg_homologar_nombre();
create trigger trg_homologar_bodega_upd before update on sgc.bodegas
  for each row when (new.nombre is distinct from old.nombre)
  execute function sgc.tg_homologar_nombre();

-- Categorías de inventario
drop trigger if exists trg_homologar_categoria_ins on sgc.categorias_inventario;
drop trigger if exists trg_homologar_categoria_upd on sgc.categorias_inventario;
create trigger trg_homologar_categoria_ins before insert on sgc.categorias_inventario
  for each row execute function sgc.tg_homologar_nombre();
create trigger trg_homologar_categoria_upd before update on sgc.categorias_inventario
  for each row when (new.nombre is distinct from old.nombre)
  execute function sgc.tg_homologar_nombre();

-- Artículos: sólo re-homologa cuando el nombre cambia (no al mover de categoría).
-- No se normaliza el catálogo histórico (ALL-CAPS del kit); aplica a inserciones/ediciones.
drop trigger if exists trg_homologar_articulo_ins on sgc.articulos;
drop trigger if exists trg_homologar_articulo_upd on sgc.articulos;
create trigger trg_homologar_articulo_ins before insert on sgc.articulos
  for each row execute function sgc.tg_homologar_nombre();
create trigger trg_homologar_articulo_upd before update on sgc.articulos
  for each row when (new.nombre is distinct from old.nombre)
  execute function sgc.tg_homologar_nombre();

-- Normalización one-shot sólo en tablas pequeñas y seguras.
update sgc.bodegas               set nombre = sgc.homologar_texto(nombre)
 where nombre is not null and nombre is distinct from sgc.homologar_texto(nombre);
update sgc.categorias_inventario set nombre = sgc.homologar_texto(nombre)
 where nombre is not null and nombre is distinct from sgc.homologar_texto(nombre);

-- ── R16) Categorías: orden + destacada ──────────────────────────────────────
alter table sgc.categorias_inventario
  add column if not exists orden     int     not null default 100,
  add column if not exists destacada boolean not null default false;

-- Por defecto, todas ordenadas después de las destacadas.
update sgc.categorias_inventario set orden = 100 + id, destacada = false;

-- Categorías de uso diario (primeras para el usuario): Clavos, Madera, Metales.
-- Reutilizo "Acero y Hierro" (vacía) renombrándola a "Acero y Metales".
update sgc.categorias_inventario
   set nombre = 'Acero y Metales', destacada = true, orden = 3
 where lower(nombre) in ('acero y hierro', 'acero');

insert into sgc.categorias_inventario (nombre, descripcion, activo, orden, destacada)
select 'Clavos', 'Clavos y elementos de fijación de uso diario.', true, 1, true
 where not exists (select 1 from sgc.categorias_inventario where lower(nombre) = 'clavos');
insert into sgc.categorias_inventario (nombre, descripcion, activo, orden, destacada)
select 'Madera', 'Madera, tablas y encofrado de uso diario.', true, 2, true
 where not exists (select 1 from sgc.categorias_inventario where lower(nombre) = 'madera');

-- Mover artículos existentes a las categorías destacadas.
update sgc.articulos
   set categoria_id = (select id from sgc.categorias_inventario where lower(nombre) = 'clavos' limit 1)
 where upper(nombre) like 'CLAVO%';
update sgc.articulos
   set categoria_id = (select id from sgc.categorias_inventario where lower(nombre) = 'acero y metales' limit 1)
 where upper(nombre) like 'VARILL%';
