-- ============================================================================
-- PROMPT-48 (BQ) — BP5 seguimiento: ampliar `nota_checklist_items.ref_tipo`.
-- Ronda 14/09/2026.  Aditivo, idempotente, retrocompatible.
--
-- El CHECK original (migración AD9, 2026-07-31) solo permitía 'tarea' (+ NULL):
--     ref_tipo text check (ref_tipo in ('tarea'))
-- Como era un CHECK inline SIN nombre, Postgres lo autonombró
-- `nota_checklist_items_ref_tipo_check`. Lo dropeamos por-si-existe y lo
-- recreamos incluyendo los tipos nuevos que las Dev notes pueden vincular:
-- 'issue' (Jira interno) y 'version' (historial de versiones), además de 'tarea'.
-- NULL sigue permitido (columna nullable = ítem de checklist libre).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bq-bp5-ref-tipo-ampliar.sql
-- ============================================================================
begin;

alter table sgc.nota_checklist_items
  drop constraint if exists nota_checklist_items_ref_tipo_check;

alter table sgc.nota_checklist_items
  add constraint nota_checklist_items_ref_tipo_check
  check (ref_tipo in ('tarea','issue','version'));

commit;
