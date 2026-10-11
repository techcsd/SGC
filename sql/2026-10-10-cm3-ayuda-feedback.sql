-- 2026-10-10-cm3-ayuda-feedback.sql — CM3 (reglas 18/19)
--
-- "¿Te sirvió? Sí/No" del reproductor de videos de Dudas. Tabla aditiva + RPC upsert.
-- (Los campos de video siguen viviendo en ayuda_contenido.contenido jsonb — CK5 —;
-- capitulos_path/vertical_path/plataforma/orden_video/nuevo_hasta se agregan ahí sin DDL.)
--
--   node scripts/apply-migration.mjs sql/2026-10-10-cm3-ayuda-feedback.sql --env dev

begin;

create table if not exists sgc.ayuda_feedback (
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  slug       text not null,               -- id/slug de la guía o video
  util       boolean not null,            -- true = «Sí me sirvió»
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (usuario_id, slug)
);

alter table sgc.ayuda_feedback enable row level security;

drop policy if exists ayuda_feedback_propio_sel on sgc.ayuda_feedback;
create policy ayuda_feedback_propio_sel on sgc.ayuda_feedback
  for select to authenticated using (usuario_id = auth.uid());

-- Escritura solo por el RPC (definer). Agregados para admin/tecnología por si se reporta.
drop policy if exists ayuda_feedback_admin_sel on sgc.ayuda_feedback;
create policy ayuda_feedback_admin_sel on sgc.ayuda_feedback
  for select to authenticated using (sgc.is_admin() or sgc.es_tecnologia());

create or replace function sgc.ayuda_feedback_set(p_slug text, p_util boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_slug,'')),'') is null then raise exception 'Falta la guía'; end if;
  insert into sgc.ayuda_feedback (usuario_id, slug, util)
    values (auth.uid(), p_slug, coalesce(p_util,false))
  on conflict (usuario_id, slug) do update set util = excluded.util, updated_at = now();
end $function$;

grant select on sgc.ayuda_feedback to authenticated;
grant select, insert, update, delete on sgc.ayuda_feedback to service_role;
grant execute on function sgc.ayuda_feedback_set(text, boolean) to authenticated, service_role;

commit;
