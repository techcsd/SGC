-- =============================================================================
-- PROMPT-29 (BG1c / F3) — Publicar las señales "corregido" para el rescate.
-- Ronda 19/08-03/09/2026.
--
-- Publicado con la versión del APK de esta ronda (2.10.0) en min_app_version, para
-- que SOLO las apps con el código de reintento post-fix sugieran el reintento.
-- (Aplicado el 2026-09-02 junto con la publicación de la 2.10.0.)
--
-- Efecto: la app del ingeniero (ya actualizada) verá el banner "Hay una corrección
-- que puede resolver tus N pendientes — ¿reintentar?" para sus bitácoras atascadas
-- por RLS (42501) y por varchar (22001). El reintento re-envía payload + fotos y
-- crear_bitacora_app las graba idempotentemente.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-02-bg-publicar-fixes-rescate.sql
-- (idempotente por descripción: si ya existe activa una igual, no duplica.)
-- =============================================================================
begin;

-- RLS de bitácora (42501) — deployado en PROMPT-28 F1.
insert into sgc.outbox_fix_publicado (tipo_op, error_code, min_app_version, descripcion)
select 'bitacora', '42501', '2.10.0',
       'Se corrigió el permiso de envío de bitácoras (RLS). Reintenta tus partes atascados.'
where not exists (
  select 1 from sgc.outbox_fix_publicado
  where activo and tipo_op = 'bitacora' and error_code = '42501'
);

-- varchar de estructura (22001) — columna ampliada a 200 en PROMPT-28 F5.
insert into sgc.outbox_fix_publicado (tipo_op, error_code, min_app_version, descripcion)
select 'bitacora', '22001', '2.10.0',
       'Se amplió el límite de texto de la bitácora. Reintenta el parte atascado.'
where not exists (
  select 1 from sgc.outbox_fix_publicado
  where activo and tipo_op = 'bitacora' and error_code = '22001'
);

commit;
