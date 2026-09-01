-- ════════════════════════════════════════════════════════════════════════════
-- BF4 — Notificaciones: (1) RASTRO DE ENTREGA — cada push deja traza
--   (enviada/entregada/fallida/omitida + por qué), visible en Administración;
--   (2) silenciado REAL — `send_push` respeta las preferencias del usuario
--   (notif_pref_usuario) a nivel de servidor, no solo en la vista in-app.
--   Decisión Xaviel: "ambos niveles" (el usuario silencia informativas + el admin
--   administra). Las operativas no aparecen en el catálogo silenciable (UI), así
--   que el filtro por preferencia solo afecta a informativas.
-- Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── (1) Bitácora de entregas de notificaciones ──────────────────────────────
create table if not exists sgc.notif_entregas (
  id          uuid primary key default gen_random_uuid(),
  canal       text not null default 'push' check (canal in ('push','email')),
  usuario_id  uuid references sgc.usuarios(id),
  tipo        text,
  titulo      text,
  destino     text,                                    -- token (parcial) o email
  estado      text not null check (estado in ('enviada','entregada','fallida','omitida')),
  motivo      text,                                    -- token_vencido|sin_dispositivo|fuera_de_matriz|silenciada|fcm_apagado|error:<...>
  created_at  timestamptz not null default now()
);
comment on table sgc.notif_entregas is
  'BF4 — traza por notificación (push/email): enviada/entregada/fallida/omitida + motivo. Diagnóstico de "no me llegó".';
create index if not exists ix_notif_entregas_recientes on sgc.notif_entregas (created_at desc);
create index if not exists ix_notif_entregas_usuario on sgc.notif_entregas (usuario_id, created_at desc);

alter table sgc.notif_entregas enable row level security;
do $$ begin
  create policy notif_entregas_sel on sgc.notif_entregas
    for select using (sgc.is_admin());
exception when duplicate_object then null; end $$;
-- Escribe el edge (service_role); lectura solo admin.
grant select on sgc.notif_entregas to authenticated;
grant select, insert on sgc.notif_entregas to service_role;

-- ── (2) send_push: filtra silenciados + pasa el tipo al edge (para la traza) ─
-- Se DROPea la firma 4-arg (para no dejar overload ambiguo con el default nuevo).
drop function if exists sgc.send_push(uuid[], text, text, jsonb);

create or replace function sgc.send_push(
  p_user_ids uuid[],
  p_titulo   text,
  p_cuerpo   text,
  p_data     jsonb default '{}'::jsonb,
  p_tipo     text  default null       -- BF4 — tipo de aviso (para traza + silenciado)
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp', 'extensions', 'public'
as $$
declare
  v_secret text;
  v_users  uuid[];
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;

  -- BF4 — silenciado REAL: si el tipo es informativo y el usuario lo silenció
  -- (notif_pref_usuario), se excluye del push. Las operativas no tienen fila de
  -- silencio (el catálogo silenciable de la UI las excluye) → no se filtran.
  if p_tipo is not null then
    select array_agg(u) into v_users
    from unnest(p_user_ids) u
    where not exists (
      select 1 from sgc.notif_pref_usuario np
      where np.usuario_id = u and np.tipo = p_tipo and np.silenciado
    );
  else
    v_users := p_user_ids;
  end if;

  if v_users is null or array_length(v_users, 1) is null then return; end if;

  if not exists (
    select 1 from sgc.device_tokens dt where dt.activo and dt.usuario_id = any(v_users)
  ) then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';

  begin
    perform net.http_post(
      url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', coalesce(v_secret, '')),
      body := jsonb_build_object(
        'user_ids', to_jsonb(v_users),
        'titulo', p_titulo,
        'cuerpo', p_cuerpo,
        'data', coalesce(p_data, '{}'::jsonb),
        'tipo', p_tipo
      )
    );
  exception when others then null; end;
end;
$$;
grant execute on function sgc.send_push(uuid[], text, text, jsonb, text) to authenticated, service_role;

-- ── (3) Lectura para Administración (entregas recientes) ────────────────────
create or replace function sgc.notif_entregas_recientes(p_limite int default 100)
returns table(
  canal text, usuario_id uuid, usuario_nombre text, tipo text, titulo text,
  destino text, estado text, motivo text, created_at timestamptz
)
language sql stable security definer set search_path = sgc, public as $$
  select e.canal, e.usuario_id, u.nombre, e.tipo, e.titulo,
         e.destino, e.estado, e.motivo, e.created_at
    from sgc.notif_entregas e
    left join sgc.usuarios u on u.id = e.usuario_id
   where sgc.is_admin()
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limite, 100), 500));
$$;
grant execute on function sgc.notif_entregas_recientes(int) to authenticated, service_role;

commit;
