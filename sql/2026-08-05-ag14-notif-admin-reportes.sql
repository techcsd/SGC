-- ============================================================================
-- AG14 — Notificar al admin cuando entra un reporte/ticket de soporte nuevo:
-- in-app + push (AF7) + email (Resend, edge notificar-soporte). Configurable por
-- evento/canal + antispam (throttle de email). Aditivo/retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- ── Config de notificaciones por evento/canal (editable por admin) ──────────
create table if not exists sgc.notificaciones_config (
  evento      text primary key,
  descripcion text,
  in_app      boolean not null default true,
  push        boolean not null default true,
  email       boolean not null default true,
  activo      boolean not null default true,
  updated_at  timestamptz not null default now()
);

insert into sgc.notificaciones_config (evento, descripcion) values
  ('soporte_nuevo', 'Nuevo comentario/reporte/sugerencia en Soporte')
on conflict (evento) do nothing;

alter table sgc.notificaciones_config enable row level security;
drop policy if exists notif_config_admin on sgc.notificaciones_config;
create policy notif_config_admin on sgc.notificaciones_config
  for all using (sgc.is_admin()) with check (sgc.is_admin());
grant select, update on sgc.notificaciones_config to authenticated;

-- ── Helper: ids de admins activos ───────────────────────────────────────────
create or replace function sgc.destinatarios_admin()
returns setof uuid
language sql stable
set search_path to 'sgc','pg_temp'
as $$
  select distinct u.id
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo,true) and 'admin' = any(r.modulos);
$$;
grant execute on function sgc.destinatarios_admin() to authenticated, service_role;

-- ── Trigger: reporte de soporte nuevo → in-app + push + email ───────────────
create or replace function sgc.tg_reporte_usuario_notifica()
returns trigger
language plpgsql
security definer
set search_path to 'sgc','pg_temp','extensions','public'
as $function$
declare
  v_cfg    sgc.notificaciones_config;
  v_uid    uuid;
  v_titulo text;
  v_msg    text;
  v_autor  text;
  v_secret text;
  v_recientes int;
begin
  select * into v_cfg from sgc.notificaciones_config where evento='soporte_nuevo';
  if v_cfg.evento is null or not v_cfg.activo then return NEW; end if;

  select nombre into v_autor from sgc.usuarios where id = NEW.usuario_id;
  v_titulo := case NEW.tipo when 'bug' then 'Nuevo reporte de error'
                            when 'sugerencia' then 'Nueva sugerencia'
                            else 'Nuevo comentario de soporte' end;
  v_msg := coalesce(v_autor,'Un usuario')||': '||coalesce(NEW.asunto,'(sin asunto)');

  -- In-app + push (según canales configurados) a cada admin.
  for v_uid in select sgc.destinatarios_admin() loop
    if v_cfg.in_app then
      insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
      values (v_uid, 'info', v_titulo, v_msg, '/soporte');
    end if;
    if v_cfg.push then
      perform sgc.send_push(array[v_uid], v_titulo, v_msg,
        jsonb_build_object('tipo','soporte','ruta','/soporte'));
    end if;
  end loop;

  -- Email (Resend) vía edge notificar-soporte — antispam: como máximo 1 email por
  -- cada 10 min (si ya hubo tickets en ese lapso, se omite el correo pero NO el
  -- in-app/push, que sí son por-ticket).
  if v_cfg.email then
    select count(*) into v_recientes
      from sgc.reportes_usuario
      where id <> NEW.id and created_at > now() - interval '10 minutes';
    if coalesce(v_recientes,0) = 0 then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name='infra_sync_secret';
      begin
        perform net.http_post(
          url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/notificar-soporte',
          headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_secret,'')),
          body := jsonb_build_object('reporte_id', NEW.id)
        );
      exception when others then null;  -- best-effort
      end;
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_reporte_usuario_notifica on sgc.reportes_usuario;
create trigger trg_reporte_usuario_notifica
  after insert on sgc.reportes_usuario
  for each row execute function sgc.tg_reporte_usuario_notifica();
