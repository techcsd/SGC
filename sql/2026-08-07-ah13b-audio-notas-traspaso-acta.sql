-- =============================================================================
-- PROMPT-10 FASE 5 (AH13) — habilitar notas de voz por falla del checklist de
-- recepción de vehículo. El contrato de PROMPT-9 (acta_traspaso_detalle) ya LEE
-- audios con entidad_tipo='traspaso_acta', pero el CHECK de sgc.audio_notas.entidad_tipo
-- no incluía ese valor → agregar_audio_nota lo rechazaría. Aditivo: solo amplía el
-- CHECK. Mismo pipeline/almacenamiento que las voces de bitácora (AA8-AA12).
-- =============================================================================

begin;

alter table sgc.audio_notas drop constraint if exists audio_notas_entidad_tipo_check;
alter table sgc.audio_notas add constraint audio_notas_entidad_tipo_check
  check (entidad_tipo = any (array[
    'bitacora','incidente','accidente','reporte_semanal','preuso',
    'mantenimiento','ruta','checklist','otro','traspaso_acta'
  ]));

commit;
