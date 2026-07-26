-- Ronda 11 · Z23c — Contrato de notas de voz múltiples y transversales
-- Tabla genérica de adjuntos de audio (una sola pieza de infraestructura para
-- todos los formularios: incidentes, reporte semanal, pre-uso, mantenimiento,
-- rutas...). Bitácora ya tiene sus N audios en bitacora_archivos y se mantiene.
-- Reutiliza los buckets existentes (sgc-bitacora, flota-documentos). Idempotente.

create table if not exists sgc.audio_notas (
  id           uuid primary key default gen_random_uuid(),
  entidad_tipo text not null check (entidad_tipo in
                 ('bitacora','incidente','accidente','reporte_semanal',
                  'preuso','mantenimiento','ruta','checklist','otro')),
  entidad_id   uuid not null,
  bucket       text not null,
  path         text not null,
  duracion_seg numeric,
  tipo_mime    text,
  tamano_bytes bigint,
  es_prueba    boolean not null default false,
  creado_por   uuid references sgc.usuarios(id),
  created_at   timestamptz not null default now()
);

create unique index if not exists uq_audio_notas_path
  on sgc.audio_notas (entidad_tipo, entidad_id, path);
create index if not exists ix_audio_notas_entidad
  on sgc.audio_notas (entidad_tipo, entidad_id);

alter table sgc.audio_notas enable row level security;

drop policy if exists "audio_notas: select" on sgc.audio_notas;
create policy "audio_notas: select" on sgc.audio_notas
  for select using ( auth.uid() is not null );
drop policy if exists "audio_notas: insert" on sgc.audio_notas;
create policy "audio_notas: insert" on sgc.audio_notas
  for insert with check ( creado_por = auth.uid() );
drop policy if exists "audio_notas: delete" on sgc.audio_notas;
create policy "audio_notas: delete" on sgc.audio_notas
  for delete using ( creado_por = auth.uid() or sgc.is_admin() );

-- Ocultar audios de prueba a no-admin (paridad con es_prueba del resto)
drop policy if exists "audio_notas: oculta prueba a no-admin" on sgc.audio_notas;
create policy "audio_notas: oculta prueba a no-admin" on sgc.audio_notas
  as restrictive for select using ( not es_prueba or sgc.is_admin() );

grant select, insert, delete on sgc.audio_notas to authenticated;

-- Agregar una nota de voz. Límite configurable (default 5). Idempotente por path.
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
  c_limite constant int := 5;
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
  if v_n >= c_limite then
    raise exception 'Máximo % notas de voz por registro', c_limite
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

create or replace function sgc.audios_de(p_entidad_tipo text, p_entidad_id uuid)
returns table (
  id uuid, bucket text, path text, duracion_seg numeric,
  tipo_mime text, tamano_bytes bigint, es_prueba boolean,
  creado_por uuid, created_at timestamptz
)
language sql
security definer
set search_path to 'sgc','pg_temp'
as $function$
  select a.id, a.bucket, a.path, a.duracion_seg, a.tipo_mime, a.tamano_bytes,
         a.es_prueba, a.creado_por, a.created_at
  from sgc.audio_notas a
  where a.entidad_tipo = p_entidad_tipo and a.entidad_id = p_entidad_id
    and auth.uid() is not null
    and (not a.es_prueba or sgc.is_admin())
  order by a.created_at;
$function$;

create or replace function sgc.eliminar_audio_nota(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  delete from sgc.audio_notas
  where id = p_id and (creado_por = auth.uid() or sgc.is_admin());
end;
$function$;

grant execute on function sgc.agregar_audio_nota(text,uuid,text,text,numeric,text,bigint,boolean) to authenticated;
grant execute on function sgc.audios_de(text,uuid) to authenticated;
grant execute on function sgc.eliminar_audio_nota(uuid) to authenticated;
