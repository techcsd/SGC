-- PROMPT-28 (AX1) — 🔴 RAÍZ REAL de las notas de voz que nunca llegaban.
-- `enviar_nota_voz` inserta en sgc.mensajes con tipo='audio', pero el CHECK
-- `mensajes_tipo_chk` solo permitía ('texto','sistema','sticker') → CADA nota de
-- voz era rechazada con 23514 (check_violation) desde AV5. Los "fixes" de mime
-- (AW13/AW15) nunca pudieron ayudar: el INSERT moría en la BD, no en el upload.
-- Evidencia: sgc.app_error_reports → "[nota_voz_enviar] ... violates check
-- constraint mensajes_tipo_chk" (1.88.1, 1.89.0 y 1.90.0, Huawei + Xiaomi).
--
-- Fix ADITIVO y retrocompatible: se ensancha el allowlist para incluir 'audio'
-- (solo agrega un valor permitido; ninguna fila existente lo viola). Arregla la
-- voz en la app Y en la web (ambas usan enviar_nota_voz con tipo='audio').
set search_path = sgc, public;

alter table sgc.mensajes drop constraint if exists mensajes_tipo_chk;
alter table sgc.mensajes add constraint mensajes_tipo_chk
  check (tipo = any (array['texto','sistema','sticker','audio']));

-- Verificación
select pg_get_constraintdef(oid) as def
from pg_constraint where conrelid='sgc.mensajes'::regclass and conname='mensajes_tipo_chk';
