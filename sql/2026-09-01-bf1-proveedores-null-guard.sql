-- ============================================================================
-- BF1 — 🔴 Crear proveedor reventaba: "null value in column is_hardware_store
--        of relation proveedores violates not-null constraint".
--
-- CAUSA REAL (confirmada): la columna SÍ tiene default —
--   `is_hardware_store boolean not null default false` (AF32,
--   2026-08-04-af32-proveedores-ferreterias.sql:14). El problema NO era la DDL.
--   En Postgres un `null` EXPLÍCITO en el INSERT ANULA el DEFAULT (el default solo
--   aplica cuando la columna se OMITE). El formulario web hacía
--   `form.reset({parcial})`, que pone a null los controles no listados, y enviaba
--   `is_hardware_store: null` → viola el NOT NULL.
--
-- FIX de cliente (ya aplicado en esta ronda): openCreate() siembra todos los
--   defaults + el service quita null/undefined antes de insertar (stripNullish).
--
-- FIX de BD (este archivo) = red de seguridad a nivel de motor, para que NINGÚN
--   cliente (web, app csd-app, imports, tools de Compa) pueda volver a reventar
--   por un null explícito en una columna con default. Trigger idempotente que
--   coalescea los booleanos NOT NULL-con-default a su default.
--
-- REGLA QUE QUEDA (checklist de migraciones, junto al de RLS de BC7):
--   toda columna NOT NULL nueva NACE con DEFAULT o con backfill en la MISMA
--   migración. Ver docs/CHECKLIST-MIGRACIONES.md.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- Coalesce defensivo de los booleanos NOT NULL-con-default de proveedores.
-- Si algún cliente manda null explícito, la BD lo sanea al default en vez de
-- reventar. Aditivo y retrocompatible: un insert correcto no cambia.
create or replace function sgc.trg_proveedores_null_guard()
returns trigger
language plpgsql
as $$
begin
  new.is_hardware_store := coalesce(new.is_hardware_store, false);
  if new.activo is null then new.activo := true; end if;
  return new;
end;
$$;

drop trigger if exists trg_proveedores_null_guard on sgc.proveedores;
create trigger trg_proveedores_null_guard
  before insert or update on sgc.proveedores
  for each row execute function sgc.trg_proveedores_null_guard();

commit;
