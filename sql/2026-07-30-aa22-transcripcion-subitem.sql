-- ============================================================================
-- AA22 (cont.) — transcripción de audios de SUB-ÍTEM (voz por restricción y por
-- falla del reporte semanal), guardados en columnas `audio_path`.
-- PROMPT-10 · aditivo. La edge `transcribe-audio` las barre igual que
-- audio_notas / bitacora_archivos.
--   • bitacora_restricciones.audio_path        → bucket 'sgc-bitacora'
--   • checklist_vehiculo_respuestas.audio_path → bucket 'vehiculos'
-- ============================================================================
alter table sgc.bitacora_restricciones
  add column if not exists transcripcion          text,
  add column if not exists transcripcion_estado   text,
  add column if not exists transcripcion_intentos int not null default 0,
  add column if not exists transcripcion_error     text,
  add column if not exists transcrito_at           timestamptz;

alter table sgc.checklist_vehiculo_respuestas
  add column if not exists transcripcion          text,
  add column if not exists transcripcion_estado   text,
  add column if not exists transcripcion_intentos int not null default 0,
  add column if not exists transcripcion_error     text,
  add column if not exists transcrito_at           timestamptz;

do $$ begin
  alter table sgc.bitacora_restricciones add constraint bitacora_restricciones_transcripcion_estado_chk
    check (transcripcion_estado is null or transcripcion_estado in ('pendiente','procesando','completada','fallida','omitida'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table sgc.checklist_vehiculo_respuestas add constraint chk_vresp_transcripcion_estado_chk
    check (transcripcion_estado is null or transcripcion_estado in ('pendiente','procesando','completada','fallida','omitida'));
exception when duplicate_object then null; end $$;

-- Semilla: los audios ya existentes quedan pendientes de transcribir.
update sgc.bitacora_restricciones
   set transcripcion_estado = 'pendiente'
 where transcripcion_estado is null and audio_path is not null;
update sgc.checklist_vehiculo_respuestas
   set transcripcion_estado = 'pendiente'
 where transcripcion_estado is null and audio_path is not null;

-- El app/web puede re-encolar estos audios (extiende solicitar_transcripcion).
create or replace function sgc.solicitar_transcripcion(p_tabla text, p_id uuid)
returns void language plpgsql security definer set search_path = sgc, public as $$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_tabla = 'audio_notas' then
    update sgc.audio_notas set transcripcion_estado='pendiente', transcripcion_intentos=0, transcripcion_error=null where id=p_id;
  elsif p_tabla = 'bitacora_archivos' then
    update sgc.bitacora_archivos set transcripcion_estado='pendiente', transcripcion_intentos=0, transcripcion_error=null where id=p_id;
  elsif p_tabla = 'bitacora_restricciones' then
    update sgc.bitacora_restricciones set transcripcion_estado='pendiente', transcripcion_intentos=0, transcripcion_error=null where id=p_id;
  elsif p_tabla = 'checklist_vehiculo_respuestas' then
    update sgc.checklist_vehiculo_respuestas set transcripcion_estado='pendiente', transcripcion_intentos=0, transcripcion_error=null where id=p_id;
  else
    raise exception 'Tabla no soportada' using errcode = '22023';
  end if;
end;
$$;
grant execute on function sgc.solicitar_transcripcion(text, uuid) to authenticated, service_role;
