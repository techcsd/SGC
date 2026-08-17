-- AT16 — Stickers tipo WhatsApp en la mensajería.
--
-- Modelo: packs (del sistema + creados por el usuario) con stickers dentro. Un sticker
-- es una imagen: los del sistema son ASSETS empaquetados (asset_path, ej.
-- 'assets/stickers/thumbsup.svg'); los del usuario se suben al bucket público
-- 'sgc-stickers' (storage_path). El envío reutiliza sgc.mensajes con tipo='sticker'
-- y archivo_path = referencia del sticker (asset o storage) — render sin burbuja.
-- Contrato compartido con la app (PROMPT-20).
--
-- Aditivo y retrocompatible.

set search_path = sgc, public;

-- ── mensajes.tipo admite 'sticker' ───────────────────────────────────────────
alter table sgc.mensajes drop constraint if exists mensajes_tipo_chk;
alter table sgc.mensajes add constraint mensajes_tipo_chk
  check (tipo = any (array['texto','sistema','sticker']));

-- ── Packs de stickers ────────────────────────────────────────────────────────
create table if not exists sgc.sticker_packs (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  es_sistema  boolean not null default false,
  usuario_id  uuid references sgc.usuarios(id) on delete cascade,  -- null = pack del sistema
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);
comment on table sgc.sticker_packs is 'AT16: packs de stickers. es_sistema=pack global; usuario_id=pack propio del usuario.';

-- ── Stickers ─────────────────────────────────────────────────────────────────
create table if not exists sgc.stickers (
  id           uuid primary key default gen_random_uuid(),
  pack_id      uuid not null references sgc.sticker_packs(id) on delete cascade,
  asset_path   text,   -- sticker del sistema (asset empaquetado)
  storage_path text,   -- sticker del usuario (bucket sgc-stickers)
  orden        int not null default 0,
  created_at   timestamptz not null default now(),
  check (asset_path is not null or storage_path is not null)
);
comment on table sgc.stickers is 'AT16: un sticker = asset del sistema (asset_path) o imagen subida por el usuario (storage_path en sgc-stickers).';

create index if not exists idx_stickers_pack on sgc.stickers(pack_id);

-- ── Recientes por usuario ────────────────────────────────────────────────────
create table if not exists sgc.sticker_recientes (
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  ref        text not null,               -- misma referencia que va en mensajes.archivo_path
  used_at    timestamptz not null default now(),
  primary key (usuario_id, ref)
);
comment on table sgc.sticker_recientes is 'AT16: últimos stickers usados por el usuario (para la pestaña Recientes del picker).';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table sgc.sticker_packs enable row level security;
alter table sgc.stickers enable row level security;
alter table sgc.sticker_recientes enable row level security;

drop policy if exists sticker_packs_read on sgc.sticker_packs;
create policy sticker_packs_read on sgc.sticker_packs for select to authenticated
  using (es_sistema or usuario_id = auth.uid());

drop policy if exists stickers_read on sgc.stickers;
create policy stickers_read on sgc.stickers for select to authenticated
  using (exists (select 1 from sgc.sticker_packs p
                 where p.id = stickers.pack_id and (p.es_sistema or p.usuario_id = auth.uid())));

drop policy if exists sticker_recientes_rw on sgc.sticker_recientes;
create policy sticker_recientes_rw on sgc.sticker_recientes for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

grant select on sgc.sticker_packs, sgc.stickers to authenticated, service_role;
grant select, insert, update, delete on sgc.sticker_recientes to authenticated, service_role;

-- ── Bucket público para stickers de usuario ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('sgc-stickers', 'sgc-stickers', true)
on conflict (id) do nothing;

-- Escritura solo en la propia carpeta {usuario_id}/…; lectura pública.
drop policy if exists sgc_stickers_insert on storage.objects;
create policy sgc_stickers_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-stickers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists sgc_stickers_delete on storage.objects;
create policy sgc_stickers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sgc-stickers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Seed del pack del sistema "Básico" ───────────────────────────────────────
insert into sgc.sticker_packs (id, nombre, es_sistema, orden)
select '00000000-0000-0000-0000-0000000000a1', 'Básico', true, 0
where not exists (select 1 from sgc.sticker_packs where id = '00000000-0000-0000-0000-0000000000a1');

insert into sgc.stickers (pack_id, asset_path, orden)
select '00000000-0000-0000-0000-0000000000a1', v.asset, v.orden
from (values
  ('assets/stickers/thumbsup.svg', 0), ('assets/stickers/heart.svg', 1),
  ('assets/stickers/ok.svg', 2),       ('assets/stickers/clap.svg', 3),
  ('assets/stickers/fire.svg', 4),     ('assets/stickers/laugh.svg', 5),
  ('assets/stickers/party.svg', 6),    ('assets/stickers/hundred.svg', 7),
  ('assets/stickers/pray.svg', 8),     ('assets/stickers/muscle.svg', 9),
  ('assets/stickers/check.svg', 10),   ('assets/stickers/thinking.svg', 11),
  ('assets/stickers/sad.svg', 12),     ('assets/stickers/cool.svg', 13),
  ('assets/stickers/rocket.svg', 14),  ('assets/stickers/warning.svg', 15)
) as v(asset, orden)
where not exists (
  select 1 from sgc.stickers s
  where s.pack_id = '00000000-0000-0000-0000-0000000000a1' and s.asset_path = v.asset);

-- ── RPCs ─────────────────────────────────────────────────────────────────────
-- Todos mis packs (sistema + propios) con sus stickers, listo para el picker.
create or replace function sgc.mis_stickers()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(pack order by pack->>'es_sistema' desc, (pack->>'orden')::int, pack->>'nombre'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'es_sistema', p.es_sistema, 'orden', p.orden,
      'stickers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id,
                 'ref', coalesce(s.asset_path, s.storage_path),
                 'es_asset', s.asset_path is not null
               ) order by s.orden, s.created_at)
        from sgc.stickers s where s.pack_id = p.id), '[]'::jsonb)
    ) as pack
    from sgc.sticker_packs p
    where p.es_sistema or p.usuario_id = auth.uid()
  ) x;
$$;
grant execute on function sgc.mis_stickers() to authenticated, service_role;

-- Mis stickers recientes (referencias), más nuevos primero.
create or replace function sgc.stickers_recientes(p_limite int default 16)
returns table (ref text, used_at timestamptz)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select ref, used_at from sgc.sticker_recientes
  where usuario_id = auth.uid()
  order by used_at desc
  limit greatest(1, coalesce(p_limite, 16));
$$;
grant execute on function sgc.stickers_recientes(int) to authenticated, service_role;

-- Registrar un sticker como reciente (al enviarlo).
create or replace function sgc.registrar_sticker_reciente(p_ref text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if p_ref is null or p_ref = '' then return; end if;
  insert into sgc.sticker_recientes (usuario_id, ref, used_at)
  values (auth.uid(), p_ref, now())
  on conflict (usuario_id, ref) do update set used_at = now();
end;
$$;
grant execute on function sgc.registrar_sticker_reciente(text) to authenticated, service_role;

-- Crear un pack propio.
create or replace function sgc.crear_pack_sticker(p_nombre text)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El pack necesita un nombre'; end if;
  insert into sgc.sticker_packs (nombre, es_sistema, usuario_id)
  values (trim(p_nombre), false, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.crear_pack_sticker(text) to authenticated, service_role;

-- Agregar un sticker (imagen ya subida a sgc-stickers) a un pack propio. Si no se
-- pasa pack, usa/crea el pack "Mis stickers" del usuario.
create or replace function sgc.agregar_sticker(p_storage_path text, p_pack_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_pack uuid := p_pack_id; v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if coalesce(p_storage_path,'') = '' then raise exception 'Falta la imagen del sticker'; end if;

  if v_pack is null then
    select id into v_pack from sgc.sticker_packs
     where usuario_id = auth.uid() and nombre = 'Mis stickers' limit 1;
    if v_pack is null then
      insert into sgc.sticker_packs (nombre, es_sistema, usuario_id)
      values ('Mis stickers', false, auth.uid()) returning id into v_pack;
    end if;
  else
    -- Solo se puede agregar a un pack propio.
    if not exists (select 1 from sgc.sticker_packs where id = v_pack and usuario_id = auth.uid()) then
      raise exception 'No autorizado sobre ese pack';
    end if;
  end if;

  insert into sgc.stickers (pack_id, storage_path, orden)
  values (v_pack, p_storage_path,
    (select coalesce(max(orden)+1,0) from sgc.stickers where pack_id = v_pack))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.agregar_sticker(text, uuid) to authenticated, service_role;

-- Eliminar un sticker propio.
create or replace function sgc.eliminar_sticker(p_sticker_id uuid)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  delete from sgc.stickers s
   using sgc.sticker_packs p
   where s.id = p_sticker_id and s.pack_id = p.id and p.usuario_id = auth.uid();
end;
$$;
grant execute on function sgc.eliminar_sticker(uuid) to authenticated, service_role;

-- Eliminar un pack propio (y sus stickers por cascade).
create or replace function sgc.eliminar_pack_sticker(p_pack_id uuid)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  delete from sgc.sticker_packs where id = p_pack_id and usuario_id = auth.uid() and es_sistema = false;
end;
$$;
grant execute on function sgc.eliminar_pack_sticker(uuid) to authenticated, service_role;
