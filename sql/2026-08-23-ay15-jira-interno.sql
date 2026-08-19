-- ════════════════════════════════════════════════════════════════════════════
-- AY15 — Jira interno (v1): board Kanban de issues para Tecnología (solo-admin)
-- ════════════════════════════════════════════════════════════════════════════
-- Aditivo/retrocompatible. Acceso: es_tecnologia() (admin | tecnologia | gerencia |
-- direccion). Issues tipados (tarea/bug/mejora/epica), 5 estados (columnas), prioridad,
-- labels, asignado, épica, orden (drag&drop), comentarios, historial, adjuntos y el
-- vínculo AW14 "crear issue desde un reporte de error".
-- ════════════════════════════════════════════════════════════════════════════

set search_path = sgc, public;

-- ── Épicas ───────────────────────────────────────────────────────────────────
create table if not exists sgc.jira_epicas (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  descripcion text,
  color       text default '#4a90e2',
  estado      text not null default 'abierta' check (estado in ('abierta','cerrada')),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- ── Issues ───────────────────────────────────────────────────────────────────
create table if not exists sgc.jira_issues (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null default 'tarea' check (tipo in ('tarea','bug','mejora','epica')),
  titulo          text not null,
  descripcion     text,
  estado          text not null default 'backlog' check (estado in ('backlog','por_hacer','en_progreso','en_revision','hecho')),
  prioridad       text not null default 'media' check (prioridad in ('baja','media','alta','urgente')),
  labels          text[] not null default '{}',
  asignado_a      uuid references sgc.usuarios(id) on delete set null,
  epica_id        uuid references sgc.jira_epicas(id) on delete set null,
  orden           numeric not null default 0,
  origen_reporte_id uuid references sgc.app_error_reports(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_jira_issues_estado on sgc.jira_issues(estado, orden);
create index if not exists idx_jira_issues_epica  on sgc.jira_issues(epica_id);

create table if not exists sgc.jira_comentarios (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references sgc.jira_issues(id) on delete cascade,
  autor_id   uuid,
  texto      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_jira_comentarios_issue on sgc.jira_comentarios(issue_id, created_at);

create table if not exists sgc.jira_historial (
  id        uuid primary key default gen_random_uuid(),
  issue_id  uuid not null references sgc.jira_issues(id) on delete cascade,
  actor_id  uuid,
  campo     text not null,
  antes     text,
  despues   text,
  at        timestamptz not null default now()
);
create index if not exists idx_jira_historial_issue on sgc.jira_historial(issue_id, at);

create table if not exists sgc.jira_adjuntos (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references sgc.jira_issues(id) on delete cascade,
  path       text not null,
  nombre     text,
  size       bigint,
  mime       text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_jira_adjuntos_issue on sgc.jira_adjuntos(issue_id);

-- ── RLS: todo gated por es_tecnologia() ─────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['jira_epicas','jira_issues','jira_comentarios','jira_historial','jira_adjuntos'] loop
    execute format('alter table sgc.%I enable row level security', t);
    execute format('drop policy if exists "jira: tecnologia lee" on sgc.%I', t);
    execute format('create policy "jira: tecnologia lee" on sgc.%I for select to authenticated using (sgc.es_tecnologia())', t);
    execute format('grant select on sgc.%I to authenticated', t);
    execute format('grant select, insert, update, delete on sgc.%I to service_role', t);
  end loop;
end $$;

-- ── Bucket privado sgc-jira (adjuntos) + policies (es_tecnologia) ─────────────
insert into storage.buckets (id, name, public) values ('sgc-jira','sgc-jira', false)
  on conflict (id) do nothing;

drop policy if exists "sgc-jira tecnologia read" on storage.objects;
create policy "sgc-jira tecnologia read" on storage.objects
  for select to authenticated using (bucket_id = 'sgc-jira' and sgc.es_tecnologia());
drop policy if exists "sgc-jira tecnologia write" on storage.objects;
create policy "sgc-jira tecnologia write" on storage.objects
  for insert to authenticated with check (bucket_id = 'sgc-jira' and sgc.es_tecnologia());
drop policy if exists "sgc-jira tecnologia delete" on storage.objects;
create policy "sgc-jira tecnologia delete" on storage.objects
  for delete to authenticated using (bucket_id = 'sgc-jira' and sgc.es_tecnologia());

-- ── Helper: guard + log de historial ────────────────────────────────────────
create or replace function sgc._jira_guard() returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$ begin if not sgc.es_tecnologia() then raise exception 'Solo Tecnología puede usar el gestor de issues.' using errcode='42501'; end if; end $$;

-- ── Listar issues (filtros) ─────────────────────────────────────────────────
create or replace function sgc.jira_issues_listar(
  p_tipo text default null, p_prioridad text default null, p_label text default null,
  p_epica_id uuid default null, p_q text default null
) returns table (
  id uuid, tipo text, titulo text, estado text, prioridad text, labels text[],
  asignado_a uuid, asignado text, epica_id uuid, epica text, orden numeric,
  origen_reporte_id uuid, comentarios int, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select i.id, i.tipo, i.titulo, i.estado, i.prioridad, i.labels,
         i.asignado_a, u.nombre as asignado, i.epica_id, e.titulo as epica, i.orden,
         i.origen_reporte_id,
         (select count(*)::int from sgc.jira_comentarios c where c.issue_id = i.id) as comentarios,
         i.created_at, i.updated_at
  from sgc.jira_issues i
  left join sgc.usuarios u on u.id = i.asignado_a
  left join sgc.jira_epicas e on e.id = i.epica_id
  where sgc.es_tecnologia()
    and (p_tipo is null or i.tipo = p_tipo)
    and (p_prioridad is null or i.prioridad = p_prioridad)
    and (p_label is null or p_label = any(i.labels))
    and (p_epica_id is null or i.epica_id = p_epica_id)
    and (p_q is null or i.titulo ilike '%'||p_q||'%' or i.descripcion ilike '%'||p_q||'%')
  order by
    case i.estado when 'backlog' then 0 when 'por_hacer' then 1 when 'en_progreso' then 2 when 'en_revision' then 3 else 4 end,
    i.orden, i.created_at;
$$;
grant execute on function sgc.jira_issues_listar(text,text,text,uuid,text) to authenticated, service_role;

-- ── Detalle (comentarios + historial + adjuntos) ────────────────────────────
create or replace function sgc.jira_issue_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $$
declare v jsonb;
begin
  perform sgc._jira_guard();
  select jsonb_build_object(
    'issue', (select to_jsonb(i) || jsonb_build_object(
        'asignado', (select nombre from sgc.usuarios where id = i.asignado_a),
        'epica', (select titulo from sgc.jira_epicas where id = i.epica_id))
      from sgc.jira_issues i where i.id = p_id),
    'comentarios', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'autor',u.nombre,'texto',c.texto,'at',c.created_at) order by c.created_at)
        from sgc.jira_comentarios c left join sgc.usuarios u on u.id=c.autor_id where c.issue_id = p_id), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('actor',u.nombre,'campo',h.campo,'antes',h.antes,'despues',h.despues,'at',h.at) order by h.at desc)
        from sgc.jira_historial h left join sgc.usuarios u on u.id=h.actor_id where h.issue_id = p_id), '[]'::jsonb),
    'adjuntos', coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'nombre',a.nombre,'size',a.size,'mime',a.mime) order by a.created_at)
        from sgc.jira_adjuntos a where a.issue_id = p_id), '[]'::jsonb)
  ) into v;
  return v;
end $$;
grant execute on function sgc.jira_issue_detalle(uuid) to authenticated, service_role;

-- ── Crear issue ─────────────────────────────────────────────────────────────
create or replace function sgc.jira_issue_crear(
  p_titulo text, p_tipo text default 'tarea', p_descripcion text default null,
  p_prioridad text default 'media', p_labels text[] default '{}', p_asignado_a uuid default null,
  p_epica_id uuid default null, p_estado text default 'backlog', p_origen_reporte_id uuid default null
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id uuid; v_orden numeric;
begin
  perform sgc._jira_guard();
  if nullif(trim(coalesce(p_titulo,'')),'') is null then raise exception 'El issue necesita un título.'; end if;
  select coalesce(max(orden),0)+10 into v_orden from sgc.jira_issues where estado = coalesce(p_estado,'backlog');
  insert into sgc.jira_issues (tipo, titulo, descripcion, estado, prioridad, labels, asignado_a, epica_id, orden, origen_reporte_id, created_by)
  values (coalesce(p_tipo,'tarea'), trim(p_titulo), nullif(trim(p_descripcion),''), coalesce(p_estado,'backlog'),
          coalesce(p_prioridad,'media'), coalesce(p_labels,'{}'), p_asignado_a, p_epica_id, v_orden, p_origen_reporte_id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.jira_issue_crear(text,text,text,text,text[],uuid,uuid,text,uuid) to authenticated, service_role;

-- ── Actualizar campos (con log de historial) ────────────────────────────────
create or replace function sgc.jira_issue_actualizar(
  p_id uuid, p_titulo text, p_descripcion text, p_tipo text, p_prioridad text,
  p_labels text[], p_asignado_a uuid, p_epica_id uuid
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v sgc.jira_issues%rowtype;
begin
  perform sgc._jira_guard();
  select * into v from sgc.jira_issues where id = p_id;
  if not found then raise exception 'Issue no encontrado.'; end if;

  if coalesce(v.prioridad,'') is distinct from coalesce(p_prioridad, v.prioridad) then
    insert into sgc.jira_historial(issue_id, actor_id, campo, antes, despues) values (p_id, auth.uid(), 'prioridad', v.prioridad, p_prioridad);
  end if;
  if coalesce(v.asignado_a::text,'') is distinct from coalesce(p_asignado_a::text, v.asignado_a::text) then
    insert into sgc.jira_historial(issue_id, actor_id, campo, antes, despues) values (p_id, auth.uid(), 'asignado',
      (select nombre from sgc.usuarios where id=v.asignado_a), (select nombre from sgc.usuarios where id=p_asignado_a));
  end if;

  update sgc.jira_issues set
    titulo = coalesce(nullif(trim(p_titulo),''), titulo),
    descripcion = nullif(trim(p_descripcion),''),
    tipo = coalesce(p_tipo, tipo),
    prioridad = coalesce(p_prioridad, prioridad),
    labels = coalesce(p_labels, labels),
    asignado_a = p_asignado_a,
    epica_id = p_epica_id,
    updated_at = now()
  where id = p_id;
end $$;
grant execute on function sgc.jira_issue_actualizar(uuid,text,text,text,text,text[],uuid,uuid) to authenticated, service_role;

-- ── Mover (drag&drop: cambia estado + orden) ────────────────────────────────
create or replace function sgc.jira_issue_mover(p_id uuid, p_estado text, p_orden numeric)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_estado text;
begin
  perform sgc._jira_guard();
  select estado into v_estado from sgc.jira_issues where id = p_id;
  if v_estado is null then raise exception 'Issue no encontrado.'; end if;
  if v_estado is distinct from p_estado then
    insert into sgc.jira_historial(issue_id, actor_id, campo, antes, despues) values (p_id, auth.uid(), 'estado', v_estado, p_estado);
  end if;
  update sgc.jira_issues set estado = p_estado, orden = coalesce(p_orden, orden), updated_at = now() where id = p_id;
end $$;
grant execute on function sgc.jira_issue_mover(uuid,text,numeric) to authenticated, service_role;

-- ── Comentar ────────────────────────────────────────────────────────────────
create or replace function sgc.jira_issue_comentar(p_id uuid, p_texto text)
returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_cid uuid;
begin
  perform sgc._jira_guard();
  if nullif(trim(coalesce(p_texto,'')),'') is null then raise exception 'El comentario está vacío.'; end if;
  insert into sgc.jira_comentarios (issue_id, autor_id, texto) values (p_id, auth.uid(), trim(p_texto)) returning id into v_cid;
  return v_cid;
end $$;
grant execute on function sgc.jira_issue_comentar(uuid,text) to authenticated, service_role;

-- ── Eliminar issue ──────────────────────────────────────────────────────────
create or replace function sgc.jira_issue_eliminar(p_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$ begin perform sgc._jira_guard(); delete from sgc.jira_issues where id = p_id; end $$;
grant execute on function sgc.jira_issue_eliminar(uuid) to authenticated, service_role;

-- ── Registrar adjunto (tras subir al bucket) ────────────────────────────────
create or replace function sgc.jira_adjuntar(p_issue_id uuid, p_path text, p_nombre text, p_size bigint, p_mime text)
returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id uuid;
begin
  perform sgc._jira_guard();
  insert into sgc.jira_adjuntos (issue_id, path, nombre, size, mime, created_by)
  values (p_issue_id, p_path, p_nombre, p_size, p_mime, auth.uid()) returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.jira_adjuntar(uuid,text,text,bigint,text) to authenticated, service_role;

-- ── Épicas: listar + crear ──────────────────────────────────────────────────
create or replace function sgc.jira_epicas_listar()
returns table (id uuid, titulo text, descripcion text, color text, estado text, issues int, hechos int)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select e.id, e.titulo, e.descripcion, e.color, e.estado,
         (select count(*)::int from sgc.jira_issues i where i.epica_id = e.id),
         (select count(*)::int from sgc.jira_issues i where i.epica_id = e.id and i.estado = 'hecho')
  from sgc.jira_epicas e where sgc.es_tecnologia() order by e.created_at desc;
$$;
grant execute on function sgc.jira_epicas_listar() to authenticated, service_role;

create or replace function sgc.jira_epica_crear(p_titulo text, p_descripcion text default null, p_color text default '#4a90e2')
returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id uuid;
begin
  perform sgc._jira_guard();
  if nullif(trim(coalesce(p_titulo,'')),'') is null then raise exception 'La épica necesita un título.'; end if;
  insert into sgc.jira_epicas (titulo, descripcion, color, created_by)
  values (trim(p_titulo), nullif(trim(p_descripcion),''), coalesce(p_color,'#4a90e2'), auth.uid()) returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.jira_epica_crear(text,text,text) to authenticated, service_role;

-- ── AW14 — crear issue (bug) desde un reporte de error ──────────────────────
create or replace function sgc.jira_crear_desde_reporte(p_reporte_id uuid)
returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare r sgc.app_error_reports%rowtype; v_id uuid; v_desc text;
begin
  perform sgc._jira_guard();
  select * into r from sgc.app_error_reports where id = p_reporte_id;
  if not found then raise exception 'Reporte no encontrado.'; end if;

  -- Idempotente: si ya hay issue de este reporte, devolverlo.
  select id into v_id from sgc.jira_issues where origen_reporte_id = p_reporte_id limit 1;
  if v_id is not null then return v_id; end if;

  v_desc := 'Reporte de error ('||r.error_type||')'||chr(10)||
            'Plataforma: '||coalesce(r.platform,'—')||' · '||coalesce(r.device_brand,'')||' '||coalesce(r.device_model,'')||
            ' · '||coalesce(r.os_version,'')||' · app '||coalesce(r.app_version,'')||chr(10)||chr(10)||
            'Mensaje: '||coalesce(r.message,'')||
            case when r.stack is not null then chr(10)||chr(10)||'Stack:'||chr(10)||left(r.stack, 2000) else '' end;

  v_id := sgc.jira_issue_crear(
    left('Bug: '||coalesce(r.message,'error'), 120), 'bug', v_desc, 'alta',
    array['app', coalesce(r.error_type,'error')], null, null, 'por_hacer', p_reporte_id);
  return v_id;
end $$;
grant execute on function sgc.jira_crear_desde_reporte(uuid) to authenticated, service_role;
