-- R14 — Adjuntar imágenes a los reportes de usuario desde la app.
-- Aditivo y retrocompatible: nueva tabla hija + bucket privado + crear_reporte_app
-- extendido con p_fotos (default '[]', la versión vieja sigue funcionando).

-- 1) Bucket privado para las fotos de reportes.
insert into storage.buckets (id, name, public)
values ('reportes', 'reportes', false)
on conflict (id) do nothing;

drop policy if exists "csd_reportes_bucket_insert" on storage.objects;
create policy "csd_reportes_bucket_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reportes');

drop policy if exists "csd_reportes_bucket_select" on storage.objects;
create policy "csd_reportes_bucket_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'reportes');

drop policy if exists "csd_reportes_bucket_update" on storage.objects;
create policy "csd_reportes_bucket_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'reportes')
  with check (bucket_id = 'reportes');

-- 2) Tabla hija de fotos (append-only, RLS de lectura).
create table if not exists sgc.reportes_usuario_fotos (
  id           uuid primary key default gen_random_uuid(),
  reporte_id   uuid not null references sgc.reportes_usuario(id) on delete cascade,
  storage_path text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_reportes_usuario_fotos_reporte on sgc.reportes_usuario_fotos(reporte_id);

alter table sgc.reportes_usuario_fotos enable row level security;

drop policy if exists "reportes_fotos_select" on sgc.reportes_usuario_fotos;
create policy "reportes_fotos_select" on sgc.reportes_usuario_fotos
  for select to authenticated
  using (
    exists (
      select 1 from sgc.reportes_usuario r
      where r.id = reporte_id
        and (r.usuario_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('admin'))
    )
  );

grant usage on schema sgc to authenticated;
grant select on sgc.reportes_usuario_fotos to authenticated;

-- 3) crear_reporte_app extendido con p_fotos.
create or replace function sgc.crear_reporte_app(
  p_id uuid, p_tipo text, p_asunto text, p_descripcion text,
  p_fotos jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if exists (select 1 from sgc.reportes_usuario where id = p_id) then return p_id; end if;
  insert into sgc.reportes_usuario (id, usuario_id, tipo, asunto, descripcion, estado)
  values (p_id, auth.uid(), coalesce(nullif(p_tipo,''),'error'),
          coalesce(nullif(p_asunto,''),'Reporte desde la app'), p_descripcion, 'abierto');

  insert into sgc.reportes_usuario_fotos (reporte_id, storage_path)
  select p_id, f->>'storage_path'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
  where nullif(f->>'storage_path','') is not null;

  return p_id;
end; $function$;

grant execute on function sgc.crear_reporte_app(uuid, text, text, text, jsonb) to authenticated;

-- Elimina la sobrecarga vieja (4 args) para evitar ambigüedad en PostgREST;
-- la nueva es retrocompatible porque p_fotos tiene default.
drop function if exists sgc.crear_reporte_app(uuid, text, text, text);
