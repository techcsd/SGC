-- ============================================================================
-- PROMPT-48 (BP) FASE 1 — BP1 (1.5): normalizar `conductores.cedula` a DÍGITOS.
-- Ronda 14/09/2026.  Aditivo, idempotente, colisión-seguro.
--
-- PORQUÉ.  El login de campo (BL1) y `usuarios.cedula` (BI6) ya trabajan en dígitos;
--   `conductores.cedula` quedó con formatos mixtos (con y sin guiones) → esa
--   discrepancia es la raíz de BP1.  Guardamos dígitos y mostramos con máscara en la UI.
--
-- ⚠️ ORDEN.  Aplicar DESPUÉS de `2026-09-14-bp1-conductores-fantasma-fusion.sql`:
--   antes de borrar el fantasma, normalizar la ficha real de Felix ('223-0162962-3')
--   colisionaría con el fantasma ('22301629623').  El backfill de todos modos SALTA
--   cualquier fila cuya forma normalizada ya exista en otra fila (defensa doble).
--
-- REGLA de normalización.  Solo se tocan cédulas compuestas SOLO por dígitos y guiones
--   (`^[0-9-]+$`): así se preservan los placeholders 'SIN-CED-…' y 'TEST-…' (que llevan
--   letras y NO deben perder su prefijo).  '828-00000000' → '82800000000' (correcto).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp1-cedula-normalizar.sql
-- ============================================================================
begin;

-- Backfill colisión-seguro: normaliza las cédulas con guiones que NO chocan con otra fila.
update sgc.conductores c
   set cedula = regexp_replace(c.cedula, '\D', '', 'g'),
       updated_at = now()
 where c.cedula ~ '^[0-9-]+$'
   and c.cedula ~ '-'
   and not exists (
     select 1 from sgc.conductores o
      where o.id <> c.id
        and o.cedula = regexp_replace(c.cedula, '\D', '', 'g'));

-- Reporta las que se SALTARON por colisión (si las hay) — requieren fusión manual.
do $$
declare v_n bigint;
begin
  select count(*) into v_n from sgc.conductores c
   where c.cedula ~ '^[0-9-]+$' and c.cedula ~ '-';
  if v_n > 0 then
    raise notice 'BP1: % cédula(s) con guiones NO normalizadas por colisión — revisar fusión.', v_n;
  end if;
end $$;

-- Trigger de escritura: toda cédula nueva/editada nace en dígitos (excepto placeholders).
create or replace function sgc.tg_conductores_normaliza_cedula()
 returns trigger
 language plpgsql
as $function$
begin
  if new.cedula is not null and new.cedula ~ '^[0-9-]+$' then
    new.cedula := regexp_replace(new.cedula, '\D', '', 'g');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_conductores_normaliza_cedula on sgc.conductores;
create trigger trg_conductores_normaliza_cedula
  before insert or update of cedula on sgc.conductores
  for each row execute function sgc.tg_conductores_normaliza_cedula();

commit;
