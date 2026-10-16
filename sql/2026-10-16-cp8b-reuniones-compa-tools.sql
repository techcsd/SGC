-- CP8.7 — RPCs de apoyo para las herramientas de Compa (mis_reuniones ya usa
-- reuniones_listado tal cual; estas dos son nuevas: acuerdos pendientes del
-- propio usuario, y un resumen buscable por título/fecha para "resumen_reunion".

create or replace function sgc.reunion_acuerdos_pendientes_mios()
returns table(
  id uuid, texto text, fecha date, reunion_id uuid, reunion_titulo text,
  reunion_inicio timestamptz, tarea_id uuid
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select a.id, a.texto, a.fecha, r.id, r.titulo, r.inicio, a.tarea_id
    from sgc.reunion_acuerdos a
    join sgc.reuniones r on r.id = a.reunion_id
   where a.responsable_id = auth.uid()
     and (a.tarea_id is null or not exists (
           select 1 from sgc.tareas t where t.id = a.tarea_id and t.estado in ('completada','cancelada')))
   order by coalesce(a.fecha, r.inicio::date) asc;
$$;
grant execute on function sgc.reunion_acuerdos_pendientes_mios() to authenticated;

-- Busca UNA reunión por texto (título, case-insensitive) entre las que el
-- usuario puede ver; si no da texto, la más próxima (o si no hay, la más
-- reciente pasada). Devuelve lo esencial para que Compa lo resuma.
create or replace function sgc.reunion_resumen_compa(p_texto text default null)
returns table(
  id uuid, titulo text, tipo_nombre text, inicio timestamptz, estado text,
  organizador_nombre text, agenda text[], acuerdos_n bigint, acta_resumen text, acta_aprobada boolean
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if p_texto is not null and trim(p_texto) <> '' then
    select r.id into v_id from sgc.reuniones r
     where sgc.puede_ver_reunion(r.id) and r.titulo ilike '%'||trim(p_texto)||'%'
     order by abs(extract(epoch from (r.inicio - now()))) asc limit 1;
  end if;
  if v_id is null then
    select r.id into v_id from sgc.reuniones r
     where sgc.puede_ver_reunion(r.id) and r.inicio >= now() - interval '1 day' and r.estado <> 'cancelada'
     order by r.inicio asc limit 1;
  end if;
  if v_id is null then
    select r.id into v_id from sgc.reuniones r
     where sgc.puede_ver_reunion(r.id)
     order by r.inicio desc limit 1;
  end if;
  if v_id is null then return; end if;

  return query
    select r.id, r.titulo, rt.nombre, r.inicio, r.estado, u.nombre::text,
           (select array_agg(ag.texto order by ag.orden) from sgc.reunion_agenda ag where ag.reunion_id = r.id),
           (select count(*) from sgc.reunion_acuerdos ac where ac.reunion_id = r.id),
           (select act.resumen from sgc.reunion_actas act where act.reunion_id = r.id),
           (select act.aprobada_at is not null from sgc.reunion_actas act where act.reunion_id = r.id)
      from sgc.reuniones r join sgc.reunion_tipos rt on rt.id = r.tipo_id join sgc.usuarios u on u.id = r.organizador_id
     where r.id = v_id;
end $$;
grant execute on function sgc.reunion_resumen_compa(text) to authenticated;
