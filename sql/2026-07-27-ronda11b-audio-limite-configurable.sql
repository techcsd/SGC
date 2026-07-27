-- Ronda 11b — límite de notas de voz configurable (cierre de alcance).
-- Antes era una constante 5 en el RPC; ahora sale de flota_config.max_audio_notas
-- (default 5), editable sin re-deploy. Idempotente.

insert into sgc.flota_config (clave, valor)
values ('max_audio_notas', '5')
on conflict (clave) do nothing;

-- Getter para que el cliente refleje el límite real (definer; flota_config no es
-- legible directo por authenticated).
create or replace function sgc.max_audio_notas()
returns int
language sql
security definer
set search_path to 'sgc','pg_temp'
as $$
  select coalesce((select valor::int from sgc.flota_config where clave='max_audio_notas'), 5);
$$;
grant execute on function sgc.max_audio_notas() to authenticated;

-- Recrear agregar_audio_nota para leer el límite de config (fallback 5).
create or replace function sgc.agregar_audio_nota(
  p_entidad_tipo text, p_entidad_id uuid, p_bucket text, p_path text,
  p_duracion_seg numeric default null, p_tipo_mime text default null,
  p_tamano_bytes bigint default null, p_es_prueba boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_limite int := sgc.max_audio_notas();
  v_uid  uuid := auth.uid();
  v_n    int;
  v_id   uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- Idempotencia: mismo path ya registrado → devolverlo
  select id into v_id from sgc.audio_notas
  where entidad_tipo = p_entidad_tipo and entidad_id = p_entidad_id and path = p_path;
  if v_id is not null then return v_id; end if;

  select count(*) into v_n from sgc.audio_notas
  where entidad_tipo = p_entidad_tipo and entidad_id = p_entidad_id;
  if v_n >= v_limite then
    raise exception 'Máximo % notas de voz por registro', v_limite
      using errcode = 'P0001', hint = 'limite_audios';
  end if;

  insert into sgc.audio_notas (
    entidad_tipo, entidad_id, bucket, path, duracion_seg, tipo_mime, tamano_bytes,
    es_prueba, creado_por
  ) values (
    p_entidad_tipo, p_entidad_id, p_bucket, p_path, p_duracion_seg, p_tipo_mime, p_tamano_bytes,
    coalesce(p_es_prueba, false), v_uid
  ) returning id into v_id;

  return v_id;
end;
$function$;
