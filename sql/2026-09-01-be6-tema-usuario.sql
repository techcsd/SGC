-- ════════════════════════════════════════════════════════════════════════════
--  BE6 — preferencia de TEMA por usuario (claro/oscuro), server-side.
--  Mismo patrón que las prefs de notificaciones (tabla + RPCs SECURITY DEFINER).
--  El front usa localStorage como fuente instantánea (sin parpadeo) y sincroniza
--  con estas RPCs en best-effort; si esta migración aún no se aplicó, el toggle
--  sigue funcionando por dispositivo (localStorage) y no rompe nada.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists sgc.usuario_preferencias (
  usuario_id      uuid primary key references auth.users (id) on delete cascade,
  tema            text not null default 'claro' check (tema in ('claro', 'oscuro')),
  actualizado_en  timestamptz not null default now()
);

alter table sgc.usuario_preferencias enable row level security;

-- Grants de esquema/tabla (evita "permission denied for schema sgc" — gotcha histórico).
grant usage on schema sgc to authenticated;
grant select, insert, update on sgc.usuario_preferencias to authenticated;

-- RLS: cada quien ve/edita solo su propia fila.
drop policy if exists up_select_own on sgc.usuario_preferencias;
create policy up_select_own on sgc.usuario_preferencias
  for select using (usuario_id = auth.uid());

drop policy if exists up_insert_own on sgc.usuario_preferencias;
create policy up_insert_own on sgc.usuario_preferencias
  for insert with check (usuario_id = auth.uid());

drop policy if exists up_update_own on sgc.usuario_preferencias;
create policy up_update_own on sgc.usuario_preferencias
  for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Lee el tema del usuario actual (default 'claro' si no tiene fila).
create or replace function sgc.mi_tema()
returns text
language sql
security definer
set search_path = sgc, public
as $$
  select coalesce(
    (select tema from sgc.usuario_preferencias where usuario_id = auth.uid()),
    'claro'
  );
$$;

-- Guarda el tema (upsert). Valida el valor.
create or replace function sgc.set_tema(p_tema text)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
begin
  if p_tema not in ('claro', 'oscuro') then
    raise exception 'tema inválido: %', p_tema;
  end if;
  insert into sgc.usuario_preferencias (usuario_id, tema, actualizado_en)
  values (auth.uid(), p_tema, now())
  on conflict (usuario_id)
  do update set tema = excluded.tema, actualizado_en = now();
end;
$$;

grant execute on function sgc.mi_tema() to authenticated;
grant execute on function sgc.set_tema(text) to authenticated;
