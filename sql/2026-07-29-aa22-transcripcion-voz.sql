-- ============================================================================
-- PROMPT-9 · FASE 6 — AA22: transcripción automática de notas de voz
-- Fecha: 2026-07-29. Aditivo / idempotente. Ver docs/PROPUESTA-TRANSCRIPCION-VOZ.md.
--
-- Diseño genérico por adjunto de audio. Cubre las dos rutas de audio del sistema:
--   • sgc.audio_notas          (incidentes, reporte semanal, flota, preuso…)  → (bucket, path)
--   • sgc.bitacora_archivos    (notas de voz de bitácora)                     → bucket 'sgc-bitacora', path = url
--
-- La edge `transcribe-audio` (provider configurable por secret STT_PROVIDER +
-- STT_API_KEY; default OpenAI gpt-4o-mini-transcribe) barre los pendientes por
-- cron y llena `transcripcion`. Sin la key, la edge no rompe nada: marca
-- 'fallida' con un mensaje claro y el reintento acotado la retoma cuando exista.
-- ============================================================================

-- ── Columnas de transcripción ────────────────────────────────────────────────
alter table sgc.audio_notas
  add column if not exists transcripcion         text,
  add column if not exists transcripcion_estado  text default 'pendiente',
  add column if not exists transcripcion_intentos int not null default 0,
  add column if not exists transcripcion_error    text,
  add column if not exists transcrito_at          timestamptz;

alter table sgc.bitacora_archivos
  add column if not exists transcripcion         text,
  add column if not exists transcripcion_estado  text,           -- null en no-audio
  add column if not exists transcripcion_intentos int not null default 0,
  add column if not exists transcripcion_error    text,
  add column if not exists transcrito_at          timestamptz;

do $$ begin
  alter table sgc.audio_notas add constraint audio_notas_transcripcion_estado_chk
    check (transcripcion_estado in ('pendiente','procesando','completada','fallida','omitida'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table sgc.bitacora_archivos add constraint bitacora_archivos_transcripcion_estado_chk
    check (transcripcion_estado is null or transcripcion_estado in ('pendiente','procesando','completada','fallida','omitida'));
exception when duplicate_object then null; end $$;

-- Búsqueda por texto de la transcripción (donde tenga sentido).
create index if not exists idx_audio_notas_transcripcion
  on sgc.audio_notas using gin (to_tsvector('spanish', coalesce(transcripcion, '')));
create index if not exists idx_bitacora_archivos_transcripcion
  on sgc.bitacora_archivos using gin (to_tsvector('spanish', coalesce(transcripcion, '')));

-- Semilla: marcar como 'pendiente' los audios existentes de bitácora (los no-audio quedan null).
update sgc.bitacora_archivos
   set transcripcion_estado = 'pendiente'
 where transcripcion_estado is null
   and (tipo_mime ilike 'audio%' or url ~* '\.(webm|m4a|mp3|ogg|wav|aac)(\?|$)');

-- ── On-demand: re-encolar la transcripción de un audio (web/app) ──────────────
create or replace function sgc.solicitar_transcripcion(p_tabla text, p_id uuid)
returns void language plpgsql security definer set search_path = sgc, public as $$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_tabla = 'audio_notas' then
    update sgc.audio_notas
       set transcripcion_estado = 'pendiente', transcripcion_intentos = 0, transcripcion_error = null
     where id = p_id;
  elsif p_tabla = 'bitacora_archivos' then
    update sgc.bitacora_archivos
       set transcripcion_estado = 'pendiente', transcripcion_intentos = 0, transcripcion_error = null
     where id = p_id;
  else
    raise exception 'Tabla no soportada' using errcode = '22023';
  end if;
end;
$$;
grant execute on function sgc.solicitar_transcripcion(text, uuid) to authenticated, service_role;

-- ── audios_de: incluir la transcripción en el contrato de lectura ─────────────
drop function if exists sgc.audios_de(text, uuid);
create function sgc.audios_de(p_entidad_tipo text, p_entidad_id uuid)
returns table(id uuid, bucket text, path text, duracion_seg numeric, tipo_mime text,
              tamano_bytes bigint, es_prueba boolean, creado_por uuid, created_at timestamptz,
              transcripcion text, transcripcion_estado text)
language sql security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select a.id, a.bucket, a.path, a.duracion_seg, a.tipo_mime, a.tamano_bytes,
         a.es_prueba, a.creado_por, a.created_at, a.transcripcion, a.transcripcion_estado
  from sgc.audio_notas a
  where a.entidad_tipo = p_entidad_tipo and a.entidad_id = p_entidad_id
    and auth.uid() is not null
    and (not a.es_prueba or sgc.is_admin())
  order by a.created_at;
$function$;
grant execute on function sgc.audios_de(text, uuid) to authenticated, service_role;
