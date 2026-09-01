-- ════════════════════════════════════════════════════════════════════════════
-- BF4 (parte B) — "Ambos niveles" completo: el ADMIN puede deshabilitar un tipo
--   de alerta por ROL (o global) sin tocar código, y el usuario sigue silenciando
--   informativas (notif_pref_usuario, ya vivo). Sin churn de los ~30 call-sites:
--   `send_push` DERIVA el tipo del payload (`data->>'tipo'`, que los helpers ya
--   ponen) cuando no viene explícito, y aplica AMBOS filtros + deja la traza con
--   el tipo correcto. Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── (1) Regla de admin: deshabilitar un tipo por rol (rol null = global) ─────
create table if not exists sgc.notif_regla (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null,
  rol        text,                                   -- null = global
  habilitado boolean not null default true,
  updated_by uuid references sgc.usuarios(id),
  updated_at timestamptz not null default now()
);
comment on table sgc.notif_regla is
  'BF4 — el admin habilita/deshabilita un tipo de alerta por rol (rol null=global). Complementa notif_pref_usuario (silencio del propio usuario).';
create unique index if not exists ux_notif_regla_tipo_rol
  on sgc.notif_regla (tipo, coalesce(rol, '*'));

alter table sgc.notif_regla enable row level security;
do $$ begin
  create policy notif_regla_sel on sgc.notif_regla for select using (sgc.is_admin());
exception when duplicate_object then null; end $$;
grant select on sgc.notif_regla to authenticated;
grant select, insert, update on sgc.notif_regla to service_role;

-- ── (2) send_push: deriva el tipo del payload + aplica silencio (usuario) y
--        regla (admin) + deja la traza con el tipo. Solo cambia el cuerpo.
create or replace function sgc.send_push(
  p_user_ids uuid[],
  p_titulo   text,
  p_cuerpo   text,
  p_data     jsonb default '{}'::jsonb,
  p_tipo     text  default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp', 'extensions', 'public'
as $$
declare
  v_secret text;
  v_users  uuid[];
  v_tipo   text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;

  -- BF4 — el tipo viene explícito o dentro del payload (los helpers lo ponen).
  v_tipo := coalesce(nullif(p_tipo, ''), p_data->>'tipo');

  if v_tipo is not null then
    -- Excluye: (a) usuarios que silenciaron el tipo (informativas);
    --          (b) usuarios alcanzados por una regla de admin (global o por su rol).
    select array_agg(u) into v_users
    from unnest(p_user_ids) u
    where not exists (
            select 1 from sgc.notif_pref_usuario np
            where np.usuario_id = u and np.tipo = v_tipo and np.silenciado)
      and not exists (
            select 1 from sgc.notif_regla nr
            where nr.tipo = v_tipo and not nr.habilitado
              and (nr.rol is null
                   or exists (select 1 from sgc.usuarios_roles ur
                              join sgc.roles r on r.id = ur.rol_id
                              where ur.usuario_id = u and r.codigo = nr.rol)));
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
        'tipo', v_tipo
      )
    );
  exception when others then null; end;
end;
$$;
grant execute on function sgc.send_push(uuid[], text, text, jsonb, text) to authenticated, service_role;

-- ── (3) Catálogo de tipos (para la UI) + lectura/escritura de reglas ─────────
-- Tipos conocidos = los que el usuario puede silenciar (informativas) + los
-- operativos observados. `es_operativa` = el usuario NO la silencia (solo admin).
create or replace function sgc.notif_tipos_catalogo()
returns table(tipo text, etiqueta text, es_operativa boolean)
language sql stable as $$
  select * from (values
    ('version_publicada','Nuevas versiones', false),
    ('material_no_catalogado','Material no catalogado', false),
    ('otros_valor','Valores fuera de catálogo', false),
    ('solicitud_movimiento','Solicitudes de movimiento', false),
    ('flota','Avisos de flota', false),
    ('transporte','Transporte y rutas', false),
    ('conduce','Conduces', false),
    ('novedad','Novedades', false),
    ('consumo_anormal','Consumo anómalo', true),
    ('ruta_asignada','Ruta asignada', true),
    ('conduce_por_confirmar','Conduce por confirmar', true)
  ) as t(tipo, etiqueta, es_operativa);
$$;
grant execute on function sgc.notif_tipos_catalogo() to authenticated;

create or replace function sgc.notif_reglas()
returns table(tipo text, rol text, habilitado boolean, updated_at timestamptz)
language sql stable security definer set search_path = sgc, public as $$
  select tipo, rol, habilitado, updated_at from sgc.notif_regla
   where sgc.is_admin() order by tipo, coalesce(rol,'');
$$;
grant execute on function sgc.notif_reglas() to authenticated;

create or replace function sgc.set_notif_regla(p_tipo text, p_rol text, p_habilitado boolean)
returns void
language plpgsql security definer set search_path = sgc, public as $$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede administrar las reglas de notificación.'; end if;
  insert into sgc.notif_regla (tipo, rol, habilitado, updated_by, updated_at)
  values (p_tipo, nullif(p_rol, ''), coalesce(p_habilitado, true), auth.uid(), now())
  on conflict (tipo, coalesce(rol, '*'))
  do update set habilitado = excluded.habilitado, updated_by = auth.uid(), updated_at = now();
end;
$$;
grant execute on function sgc.set_notif_regla(text, text, boolean) to authenticated, service_role;

commit;
