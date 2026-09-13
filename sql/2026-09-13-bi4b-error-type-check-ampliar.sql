-- BI4b — Ampliar el CHECK de sgc.app_error_reports.error_type (regla 3 del checklist).
--
-- BUG detectado en la auditoría del 13-sep (ronda imp 01092026): la migración
-- sql/2026-09-03-bi4-panel-errores.sql amplió la whitelist INTERNA de la función
-- report_app_error (línea 104: v_type in ('...','tracking','login','gps','voice')) y su
-- cabecera afirma "se añaden al CHECK" — pero NUNCA escribió el ALTER TABLE. El CHECK de
-- la tabla siguió con los 6 valores originales de 2026-07-28-y6 ('crash','error','camera',
-- 'sync','permission','other').
--
-- Efecto: cuando la app/web reporta un error de tipo tracking/login/gps/voice
-- (friendly-error.util.ts:90-94 los emite), report_app_error deja pasar el valor y el
-- INSERT posterior VIOLA el CHECK con 23514. Como report_app_error se llama en un camino
-- silencioso (SILENT_OP), ese reporte se PIERDE por completo — justo las categorías que
-- BI4 quería sacar a la luz. Es la 3ª regla del checklist (valor nuevo ⇒ constraint
-- actualizado en la misma migración) incumplida por la propia migración que la cita.
--
-- Fix ADITIVO: ampliar el CHECK para que incluya los 4 tipos nuevos. Ampliar una lista de
-- CHECK nunca viola filas existentes (regla de amplitud, checklist §3). Sin backfill:
-- las filas que fallaron nunca llegaron a existir.

alter table sgc.app_error_reports
  drop constraint if exists app_error_reports_error_type_check;

alter table sgc.app_error_reports
  add constraint app_error_reports_error_type_check
  check (error_type in (
    'crash','error','camera','sync','permission','other',
    'tracking','login','gps','voice'
  ));
