-- CP8c (app) — "Foto de pizarra" en Mis notas de una reunión (mock Reunion-app.dc.html,
-- FASE 5.4 del PROMPT-101). El esquema de cp8-reuniones.sql trae `reunion_notas.texto`
-- pero ninguna columna de foto; esto lo completa: aditivo y retrocompatible
-- (reunion_nota_guardar gana un 4º parámetro OPCIONAL con default null, así que
-- cualquier caller viejo sigue funcionando igual).
--
-- Apply: node scripts/apply-migration.mjs sql-para-sgc/2026-10-16-cp8c-reunion-notas-foto.sql --env dev

begin;

-- 1) Columna aditiva ----------------------------------------------------------
alter table sgc.reunion_notas add column if not exists foto_path text;

-- 2) Bucket 'reuniones' (privado, mismo patrón simple que conductores/vehiculos:
--    cualquier autenticado puede subir/leer — la ruta incluye el reunion_id, no
--    hay dato sensible de identidad en la foto de una pizarra). ------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('reuniones', 'reuniones', false, 15728640)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'csd_reuniones_bucket_insert') then
    create policy csd_reuniones_bucket_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'reuniones');
  end if;
  if not exists (select 1 from pg_policy where polname = 'csd_reuniones_bucket_select') then
    create policy csd_reuniones_bucket_select on storage.objects
      for select to authenticated
      using (bucket_id = 'reuniones');
  end if;
end
$$;

-- 3) reunion_nota_guardar — +p_foto_path opcional -----------------------------
create or replace function sgc.reunion_nota_guardar(p_reunion_id uuid, p_texto text, p_foto_path text default null)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
begin
  if not sgc.puede_ver_reunion(p_reunion_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  insert into sgc.reunion_notas (reunion_id, usuario_id, texto, foto_path)
  values (p_reunion_id, auth.uid(), p_texto, p_foto_path)
  on conflict (reunion_id, usuario_id) do update
    set texto = excluded.texto,
        foto_path = coalesce(excluded.foto_path, sgc.reunion_notas.foto_path),
        updated_at = now();
end $$;
grant execute on function sgc.reunion_nota_guardar(uuid, text, text) to authenticated;

-- 4) reunion_detalle — las notas ahora incluyen foto_path (aditivo en el jsonb) --
create or replace function sgc.reunion_detalle(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp' as $$
declare v jsonb;
begin
  if not sgc.puede_ver_reunion(p_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'reunion', (select to_jsonb(r) || jsonb_build_object('tipo_codigo', rt.codigo, 'tipo_nombre', rt.nombre, 'tipo_color', rt.color,
                  'proyecto_nombre', p.nombre, 'organizador_nombre', u.nombre)
                from sgc.reuniones r join sgc.reunion_tipos rt on rt.id = r.tipo_id
                left join sgc.proyectos p on p.id = r.proyecto_id
                join sgc.usuarios u on u.id = r.organizador_id
                where r.id = p_id),
    'participantes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', rp.id, 'usuario_id', rp.usuario_id, 'nombre', coalesce(pu.nombre, rp.nombre_externo),
                  'correo_externo', rp.correo_externo, 'asistio', rp.asistio)), '[]'::jsonb)
                from sgc.reunion_participantes rp left join sgc.usuarios pu on pu.id = rp.usuario_id
                where rp.reunion_id = p_id),
    'agenda', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'orden', a.orden, 'texto', a.texto) order by a.orden), '[]'::jsonb)
                from sgc.reunion_agenda a where a.reunion_id = p_id),
    'notas', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'usuario_id', n.usuario_id, 'usuario_nombre', nu.nombre,
                  'texto', n.texto, 'foto_path', n.foto_path, 'es_mia', n.usuario_id = auth.uid())), '[]'::jsonb)
                from sgc.reunion_notas n join sgc.usuarios nu on nu.id = n.usuario_id where n.reunion_id = p_id),
    'acuerdos', (select coalesce(jsonb_agg(jsonb_build_object('id', ac.id, 'texto', ac.texto, 'responsable_id', ac.responsable_id,
                  'responsable_nombre', au.nombre, 'fecha', ac.fecha, 'tarea_id', ac.tarea_id) order by ac.created_at), '[]'::jsonb)
                from sgc.reunion_acuerdos ac left join sgc.usuarios au on au.id = ac.responsable_id where ac.reunion_id = p_id),
    'acta', (select to_jsonb(ac) from sgc.reunion_actas ac where ac.reunion_id = p_id)
  ) into v;
  return v;
end $$;
grant execute on function sgc.reunion_detalle(uuid) to authenticated;

commit;
