-- =============================================================================
-- PROMPT-32 (BI2/BI7) — bitacoras.bloque_entrepiso: varchar(100) → varchar(200).
-- Ronda 03/09/2026. Aditivo (amplía, no restringe), idempotente.
--
-- El cliente limita a 200 POR ACTIVIDAD (parte.ts:77) y la cabecera guarda el JOIN
-- de todos los bloques distintos (bitacora.service.ts:206-211) → un parte con varios
-- bloques revienta con 22001 "value too long for type character varying(100)".
-- bg-varchar-bitacora-libre.sql amplió estructura/actividad/tipo_restriccion pero
-- NO este. tipo_mime (varchar(100)) se deja: 'image/jpeg'/'audio/webm' caben de sobra.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-03-bi2-bloque-entrepiso-200.sql
-- =============================================================================
begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='sgc' and table_name='bitacoras' and column_name='bloque_entrepiso'
      and character_maximum_length < 200
  ) then
    alter table sgc.bitacoras alter column bloque_entrepiso type varchar(200);
  end if;
end $$;

commit;
