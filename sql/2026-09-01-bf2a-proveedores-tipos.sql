-- ════════════════════════════════════════════════════════════════════════════
-- BF2 (parte A, ADITIVA) — Un solo maestro de proveedores con TIPOS (decisión
--   Xaviel: "un maestro con tipos"). Añade `tipos text[]` a sgc.proveedores:
--   'ferreteria' · 'suministros' · 'transportista' · 'otro' (multiselección).
--   El legacy `is_hardware_store` queda SINCRONIZADO con el tipo 'ferreteria'
--   (los consumidores viejos —ferreterias_visibles— siguen funcionando).
--
--   La FUSIÓN de `proveedores_transporte` → `proveedores` (repunteo de FKs de
--   conduces_externos/viajes) va en la parte B (2026-09-01-bf2b), que es
--   DESTRUCTIVA y espera la revisión del backfill por Xaviel (criterio AM8):
--   ver scripts/preview-merge-proveedores.mjs.
-- Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- (1) Columna tipos (multiselección). Nace con default → sin riesgo de NOT NULL.
alter table sgc.proveedores
  add column if not exists tipos text[] not null default '{}'::text[];
comment on column sgc.proveedores.tipos is
  'BF2 — tipos del proveedor (multiselección): ferreteria|suministros|transportista|otro. is_hardware_store queda sincronizado con ''ferreteria''.';

-- (2) Backfill: las ferreterías existentes ⇒ tipo 'ferreteria'.
update sgc.proveedores
   set tipos = array['ferreteria']
 where is_hardware_store and not ('ferreteria' = any(tipos));

-- (3) Sincronización tipos ⇄ is_hardware_store, dentro del guard BF1 (mismo BEFORE
--     trigger). Reemplaza la función del guard extendiéndola (no se pierde el coalesce).
create or replace function sgc.trg_proveedores_null_guard()
returns trigger
language plpgsql
as $$
begin
  -- BF1 — nunca reventar por null explícito en columnas con default.
  new.is_hardware_store := coalesce(new.is_hardware_store, false);
  if new.activo is null then new.activo := true; end if;
  new.tipos := coalesce(new.tipos, '{}'::text[]);

  -- BF2 — sincroniza el tipo 'ferreteria' con el flag legacy (ambos sentidos).
  if 'ferreteria' = any(new.tipos) then
    new.is_hardware_store := true;
  elsif new.is_hardware_store then
    new.tipos := array_append(new.tipos, 'ferreteria');
  end if;

  return new;
end;
$$;
-- El trigger trg_proveedores_null_guard (BF1) ya existe y apunta a esta función.

commit;
