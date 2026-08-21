-- AT23 — preferencias de notificación POR USUARIO: cada quien puede SILENCIAR los
-- tipos de aviso que no le aportan. Solo afecta la VISIBILIDAD in-app del propio
-- usuario (bandeja + badge en el cliente); NO cambia a quién le llega el evento
-- (eso es la matriz de destinatarios server-side, trabajo de PROMPT-3). Aditivo.

create table if not exists sgc.notif_pref_usuario (
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  tipo       text not null,
  silenciado boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (usuario_id, tipo)
);

alter table sgc.notif_pref_usuario enable row level security;
drop policy if exists notif_pref_own on sgc.notif_pref_usuario;
create policy notif_pref_own on sgc.notif_pref_usuario
  for all
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

grant select, insert, update, delete on sgc.notif_pref_usuario to authenticated;

-- Tipos silenciados del usuario actual.
create or replace function sgc.mis_notif_prefs()
returns table(tipo text, silenciado boolean)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select tipo, silenciado from sgc.notif_pref_usuario where usuario_id = auth.uid();
$function$;
grant execute on function sgc.mis_notif_prefs() to authenticated;

-- Silencia/reactiva un tipo para el usuario actual (upsert).
create or replace function sgc.set_notif_pref(p_tipo text, p_silenciado boolean)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  insert into sgc.notif_pref_usuario(usuario_id, tipo, silenciado, updated_at)
  values (auth.uid(), p_tipo, p_silenciado, now())
  on conflict (usuario_id, tipo) do update
    set silenciado = excluded.silenciado, updated_at = now();
end;
$function$;
grant execute on function sgc.set_notif_pref(text, boolean) to authenticated;
