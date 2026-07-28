-- ============================================================================
-- Z1 — Fix: `record "new" has no field "es_prueba_origen"` al marcar vehículo prueba
-- Ronda 28/07 PM · PROMPT-6 · FASE 1
-- ============================================================================
-- Causa: el trigger `trg_heredar_es_prueba` (fn tg_heredar_es_prueba) está en
-- avisos_flota y asigna NEW.es_prueba_origen, pero avisos_flota NO tiene esa
-- columna. Al marcar un vehículo como prueba, la reevaluación de vencimientos
-- inserta un aviso_flota → el trigger revienta.
--
-- Fix: agregar `es_prueba_origen` a las tablas que tienen `es_prueba` pero les
-- falta la columna (homogeneización — también prepara Z5). Aditivo.
-- ============================================================================

alter table sgc.avisos_flota     add column if not exists es_prueba_origen text;
alter table sgc.audio_notas      add column if not exists es_prueba_origen text;
alter table sgc.cronograma_tareas add column if not exists es_prueba_origen text;

-- Backfill: filas ya marcadas prueba sin origen → 'manual' (fueron marcadas directas).
update sgc.avisos_flota      set es_prueba_origen = 'manual' where coalesce(es_prueba,false) and es_prueba_origen is null;
update sgc.audio_notas       set es_prueba_origen = 'manual' where coalesce(es_prueba,false) and es_prueba_origen is null;
update sgc.cronograma_tareas set es_prueba_origen = 'manual' where coalesce(es_prueba,false) and es_prueba_origen is null;
