-- DX10 (ronda 23-nov-2026) -- los reportes de usuario aceptan DOCUMENTOS (PDF, Word, Excel, CSV, TXT) además de fotos.
-- Aditivo: tabla hija nueva + RPC de alta con validación + bucket `reportes` con tipos permitidos y 10 MB.
-- Los reportes y fotos antiguos no cambian. Máx. 5 adjuntos (documentos) por reporte. Sin previsualización de Office.
begin;

-- 1) Bucket `reportes`: lista de tipos permitidos (imágenes ya existentes + documentos) y 10 MB por archivo.
update storage.buckets set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
    'application/pdf',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv','text/plain','application/csv','application/octet-stream'
  ]
where id = 'reportes';

-- 2) Tabla de adjuntos (documentos), misma RLS de lectura que las fotos.
create table if not exists sgc.reportes_usuario_adjuntos (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null references sgc.reportes_usuario(id) on delete cascade,
  storage_path    text not null,
  nombre_original text not null,
  mime            text not null,
  tamano_bytes    bigint not null check (tamano_bytes > 0 and tamano_bytes <= 10485760),
  created_at      timestamptz not null default now()
);
create index if not exists idx_reportes_usuario_adjuntos_reporte on sgc.reportes_usuario_adjuntos(reporte_id);
alter table sgc.reportes_usuario_adjuntos enable row level security;
drop policy if exists "reportes_adjuntos_select" on sgc.reportes_usuario_adjuntos;
create policy "reportes_adjuntos_select" on sgc.reportes_usuario_adjuntos for select to authenticated
  using (exists (select 1 from sgc.reportes_usuario r where r.id = reporte_id
                 and (r.usuario_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('admin') or sgc.es_tecnologia())));
grant select on sgc.reportes_usuario_adjuntos to authenticated;

-- 3) Alta validada (el autor del reporte; el servidor re-valida tipo, tamaño, cupo y ruta).
create or replace function sgc.agregar_adjunto_reporte(
  p_reporte_id uuid, p_storage_path text, p_nombre text, p_mime text, p_tamano bigint
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_n integer;
  v_ext text := lower(coalesce(substring(p_nombre from '\.([A-Za-z0-9]+)$'), ''));
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if not exists (select 1 from sgc.reportes_usuario r where r.id = p_reporte_id and r.usuario_id = v_uid) then
    raise exception 'El reporte no es tuyo' using errcode = '42501';
  end if;
  if p_storage_path is null or p_storage_path not like (v_uid::text || '/' || p_reporte_id::text || '/%') then
    raise exception 'Ruta de archivo inválida' using errcode = '22023';
  end if;
  if v_ext not in ('pdf','doc','docx','xls','xlsx','csv','txt') then
    raise exception 'Tipo de documento no permitido' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano <= 0 or p_tamano > 10485760 then
    raise exception 'El documento supera los 10 MB' using errcode = '22023';
  end if;
  select count(*) into v_n from sgc.reportes_usuario_adjuntos where reporte_id = p_reporte_id;
  if v_n >= 5 then raise exception 'Máximo 5 documentos por reporte' using errcode = '22023'; end if;
  insert into sgc.reportes_usuario_adjuntos (reporte_id, storage_path, nombre_original, mime, tamano_bytes)
  values (p_reporte_id, p_storage_path, left(p_nombre, 200), left(coalesce(p_mime, 'application/octet-stream'), 120), p_tamano)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function sgc.agregar_adjunto_reporte(uuid, text, text, text, bigint) from public, anon;
grant execute on function sgc.agregar_adjunto_reporte(uuid, text, text, text, bigint) to authenticated;

commit;
