-- El pack de stickers del sistema quedó con el nombre mal codificado ("B�sico")
-- en prod al aplicar el seed de AT16 (corrupción de UTF-8 en el apply; el seed
-- 2026-08-18-at16-stickers.sql está bien codificado). Repara el dato. Idempotente.
-- Detectado en el device-QA de la app (PROMPT-20).
update sgc.sticker_packs
set nombre = 'Básico'
where es_sistema and nombre <> 'Básico';

select id, nombre, es_sistema from sgc.sticker_packs where es_sistema;
