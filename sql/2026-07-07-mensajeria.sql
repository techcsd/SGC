-- Mensajería interna: 1:1 direct messages and group channels with file
-- attachments, updating live via Supabase Realtime. Available to every
-- authenticated user (no module gate — anyone in the company can message).
--
-- RLS note: "can I see this conversation / message" hinges on "am I a
-- participant", which lives in conversacion_participantes. A policy on that
-- table that queries itself recurses infinitely (classic Supabase trap), so
-- membership is resolved through a SECURITY DEFINER helper that reads the table
-- with RLS bypassed. Row creation (new conversation + its participants) goes
-- through SECURITY DEFINER RPCs so the multi-row insert is atomic and doesn't
-- need permissive table-level insert policies.

create table sgc.conversaciones (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('directa', 'grupo')),
  nombre     text,                       -- group name; null for direct
  creado_por uuid references sgc.usuarios(id),
  created_at timestamptz not null default now()
);

create table sgc.conversacion_participantes (
  conversacion_id uuid not null references sgc.conversaciones(id) on delete cascade,
  usuario_id      uuid not null references sgc.usuarios(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  added_at        timestamptz not null default now(),
  primary key (conversacion_id, usuario_id)
);
create index idx_conv_participantes_usuario on sgc.conversacion_participantes(usuario_id);

create table sgc.mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references sgc.conversaciones(id) on delete cascade,
  autor_id        uuid not null references sgc.usuarios(id),
  contenido       text,
  archivo_path    text,
  archivo_nombre  text,
  archivo_mime    text,
  created_at      timestamptz not null default now()
);
create index idx_mensajes_conversacion on sgc.mensajes(conversacion_id, created_at);

-- ── Membership helper (bypasses RLS to avoid recursion) ──
create or replace function sgc.es_participante(p_conv uuid)
returns boolean
language sql
security definer
stable
set search_path = sgc
as $$
  select exists (
    select 1 from sgc.conversacion_participantes
    where conversacion_id = p_conv and usuario_id = auth.uid()
  );
$$;
revoke all on function sgc.es_participante(uuid) from public;
grant execute on function sgc.es_participante(uuid) to authenticated;

alter table sgc.conversaciones enable row level security;
alter table sgc.conversacion_participantes enable row level security;
alter table sgc.mensajes enable row level security;

create policy "conversaciones: select" on sgc.conversaciones for select to authenticated
  using (sgc.is_admin() or sgc.es_participante(id));

create policy "conv_participantes: select" on sgc.conversacion_participantes for select to authenticated
  using (sgc.is_admin() or sgc.es_participante(conversacion_id));
-- A user can only touch their own membership row (used to bump last_read_at).
create policy "conv_participantes: update" on sgc.conversacion_participantes for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

create policy "mensajes: select" on sgc.mensajes for select to authenticated
  using (sgc.es_participante(conversacion_id));
create policy "mensajes: insert" on sgc.mensajes for insert to authenticated
  with check (autor_id = auth.uid() and sgc.es_participante(conversacion_id));

grant select on sgc.conversaciones to authenticated;
grant select, update on sgc.conversacion_participantes to authenticated;
grant select, insert on sgc.mensajes to authenticated;

-- ── Create-or-find a direct conversation between me and another user ──
create or replace function sgc.crear_conversacion_directa(p_otro uuid)
returns uuid
language plpgsql
security definer
set search_path = sgc
as $$
declare
  v_id uuid;
  v_me uuid := auth.uid();
begin
  if p_otro = v_me then
    raise exception 'No puedes iniciar una conversación contigo mismo.';
  end if;

  select c.id into v_id
  from sgc.conversaciones c
  join sgc.conversacion_participantes p1 on p1.conversacion_id = c.id and p1.usuario_id = v_me
  join sgc.conversacion_participantes p2 on p2.conversacion_id = c.id and p2.usuario_id = p_otro
  where c.tipo = 'directa'
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into sgc.conversaciones (tipo, creado_por) values ('directa', v_me) returning id into v_id;
  insert into sgc.conversacion_participantes (conversacion_id, usuario_id) values (v_id, v_me), (v_id, p_otro);
  return v_id;
end;
$$;
revoke all on function sgc.crear_conversacion_directa(uuid) from public;
grant execute on function sgc.crear_conversacion_directa(uuid) to authenticated;

-- ── Create a group channel with an initial participant list (creator added) ──
create or replace function sgc.crear_grupo(p_nombre text, p_participantes uuid[])
returns uuid
language plpgsql
security definer
set search_path = sgc
as $$
declare
  v_id uuid;
  v_me uuid := auth.uid();
begin
  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El grupo necesita un nombre.';
  end if;

  insert into sgc.conversaciones (tipo, nombre, creado_por) values ('grupo', trim(p_nombre), v_me) returning id into v_id;
  insert into sgc.conversacion_participantes (conversacion_id, usuario_id)
    select v_id, uid from unnest(array_append(p_participantes, v_me)) as uid
    on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function sgc.crear_grupo(text, uuid[]) from public;
grant execute on function sgc.crear_grupo(text, uuid[]) to authenticated;

-- ── Total unread messages across my conversations (for the nav badge) ──
create or replace function sgc.contar_mensajes_no_leidos()
returns integer
language sql
security definer
stable
set search_path = sgc
as $$
  select coalesce(count(m.id), 0)::int
  from sgc.mensajes m
  join sgc.conversacion_participantes p
    on p.conversacion_id = m.conversacion_id and p.usuario_id = auth.uid()
  where m.created_at > p.last_read_at and m.autor_id <> auth.uid();
$$;
revoke all on function sgc.contar_mensajes_no_leidos() from public;
grant execute on function sgc.contar_mensajes_no_leidos() to authenticated;

-- ── Enable Realtime on mensajes so clients get live INSERTs ──
alter publication supabase_realtime add table sgc.mensajes;

-- ── Private bucket for chat attachments ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sgc-mensajes', 'sgc-mensajes', false, 26214400,
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'
  ]
)
on conflict (id) do nothing;

-- Attachments are stored under `${conversacion_id}/…`; only participants of that
-- conversation can read/upload.
create policy "sgc-mensajes: scoped read" on storage.objects for select to authenticated
  using (bucket_id = 'sgc-mensajes' and sgc.es_participante(((storage.foldername(name))[1])::uuid));
create policy "sgc-mensajes: scoped upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-mensajes' and sgc.es_participante(((storage.foldername(name))[1])::uuid));
