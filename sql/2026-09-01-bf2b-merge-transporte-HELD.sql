-- ════════════════════════════════════════════════════════════════════════════
-- BF2 (parte B) — FUSIÓN de sgc.proveedores_transporte → sgc.proveedores.
--
-- ✅ APLICADA 01/09/2026 tras revisar el preview (proveedores_transporte estaba
--     VACÍA → 0 emparejamientos, 0 inserciones, 0 repunteos: no-op de datos, solo
--     agrega columnas/tabla puente + comentario de deprecación). El nombre "-HELD"
--     queda por historia; la unificación funcional la cierra bf2c.
--     (preview: node scripts/preview-merge-proveedores.mjs)
--
-- Es DESTRUCTIVA (repunta FKs de conduces_externos y viajes_transporte). Deja
-- proveedores_transporte VACÍA pero intacta como respaldo; una limpieza posterior
-- la puede dropear. Idempotente por el mapa old_id→new_id.
--
-- ESTRATEGIA:
--  1. Por cada transportista, EMPAREJAR con un proveedor existente (nombre/RNC) o
--     INSERTAR uno nuevo con tipos=['transportista']. Guardar el mapa en una tabla
--     puente `proveedor_transporte_map(old_id, new_id)`.
--  2. A los emparejados, agregar 'transportista' a tipos + copiar estado de
--     ratificación (nuevas columnas transportista_estado/ratificado_por/_en).
--  3. Repuntar las FKs: conduces_externos.transporta_proveedor_id y
--     viajes_transporte.proveedor_id → new_id.
--  4. Marcar proveedores_transporte como deprecada (comentario); NO dropear aún.
--
-- SEGUIMIENTO (post-merge, en su propio archivo): apuntar el SELECTOR del conduce
--  externo y las RPCs de Transporte v3 a `proveedores` where 'transportista' = any(tipos)
--  (hoy leen proveedores_transporte). Se hace CON este merge, tras el OK.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public, extensions;  -- unaccent puede vivir en extensions

-- Columnas de transportista en el maestro unificado (estado de ratificación BA4).
alter table sgc.proveedores add column if not exists transportista_estado text
  check (transportista_estado in ('sin_ratificar','ratificado'));
alter table sgc.proveedores add column if not exists ratificado_por uuid references sgc.usuarios(id);
alter table sgc.proveedores add column if not exists ratificado_en  timestamptz;

-- Mapa puente old→new (idempotencia + auditoría de la fusión).
create table if not exists sgc.proveedor_transporte_map (
  old_id uuid primary key references sgc.proveedores_transporte(id),
  new_id uuid not null references sgc.proveedores(id),
  creado_en timestamptz not null default now()
);

-- (1) Emparejar o insertar. norm = lower/sin acentos; rnc = solo dígitos.
with pending as (
  select t.* from sgc.proveedores_transporte t
  where not exists (select 1 from sgc.proveedor_transporte_map m where m.old_id = t.id)
),
matched as (
  select p.id as old_id, pr.id as new_id
  from pending p
  join lateral (
    select id from sgc.proveedores pr
    where lower(unaccent(pr.nombre)) = lower(unaccent(p.nombre))
       or (p.rnc is not null and regexp_replace(coalesce(pr.rnc,''),'\D','','g') = regexp_replace(p.rnc,'\D','','g') and p.rnc <> '')
    limit 1
  ) pr on true
),
inserted as (
  insert into sgc.proveedores (nombre, rnc, telefono, tipos, transportista_estado, ratificado_por, ratificado_en, activo, es_prueba)
  select p.nombre, p.rnc, p.telefono, array['transportista'], p.estado, p.ratificado_por, p.ratificado_en,
         coalesce(p.activo, true), coalesce(p.es_prueba, false)
  from pending p
  where not exists (select 1 from matched m where m.old_id = p.id)
  returning id as new_id, nombre
)
insert into sgc.proveedor_transporte_map (old_id, new_id)
  select old_id, new_id from matched
  union all
  select p.id, i.new_id
  from inserted i
  join sgc.proveedores_transporte p
    on lower(unaccent(p.nombre)) = lower(unaccent(i.nombre))
  where not exists (select 1 from sgc.proveedor_transporte_map m where m.old_id = p.id);

-- (2) A los emparejados: + tipo transportista + estado de ratificación.
update sgc.proveedores pr
   set tipos = (select array(select distinct e from unnest(pr.tipos || array['transportista']) e)),
       transportista_estado = coalesce(pr.transportista_estado, t.estado),
       ratificado_por = coalesce(pr.ratificado_por, t.ratificado_por),
       ratificado_en  = coalesce(pr.ratificado_en, t.ratificado_en)
  from sgc.proveedor_transporte_map m
  join sgc.proveedores_transporte t on t.id = m.old_id
 where pr.id = m.new_id
   and not ('transportista' = any(pr.tipos));

-- (3) Repuntar FKs.
update sgc.conduces_externos ce
   set transporta_proveedor_id = m.new_id
  from sgc.proveedor_transporte_map m
 where ce.transporta_proveedor_id = m.old_id;

update sgc.viajes_transporte v
   set proveedor_id = m.new_id
  from sgc.proveedor_transporte_map m
 where v.proveedor_id = m.old_id;

-- (4) Deprecar (no dropear).
comment on table sgc.proveedores_transporte is
  'DEPRECADA (BF2) — fusionada en sgc.proveedores (tipos ⊇ transportista). Conservada como respaldo; dropear en limpieza posterior.';

commit;
