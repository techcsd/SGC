-- BK1 (cierre FASE 1) — retirar notificaciones_config y meter el CORREO a la matriz.
--
-- (A) notificaciones_config era un switchboard paralelo (7 eventos × in_app/push/
--     email/activo) con 2 consumidores vivos: obra_notif_activo() y el trigger de
--     soporte. Se migra al modelo nuevo usando notif_tipo.canales[] + activo (la
--     dimensión de canal que faltaba), se reimplantan los 2 consumidores sobre
--     notif_tipo y se retira la tabla + su pantalla.
-- (B) Los correos (informes) entran a la matriz: por TIPO (canal email en
--     notif_tipo) y por ROL/USUARIO (notif_permitida en los resolvedores).

begin;

-- ── (A1) Migrar los 6 eventos obra_* + soporte a notif_tipo ──────────────────
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden) values
  ('obra_accion_correctiva','Acción correctiva en obra','Acción correctiva asignada a un responsable', true, '{in_app,push}', true, 300),
  ('obra_accion_vencida','Acción correctiva vencida','Recordatorio de acción correctiva vencida', true, '{in_app,push}', true, 310),
  ('obra_cubicacion_revision','Cubicación en revisión','Cubicación enviada a revisión', true, '{in_app,push}', true, 320),
  ('obra_cubicacion_resuelta','Cubicación resuelta','Cubicación aprobada o rechazada', true, '{in_app,push}', true, 330),
  ('obra_incidente_nuevo','Incidente en obra','Incidente / casi-accidente registrado en obra', true, '{in_app,push}', true, 340),
  ('obra_informe_enviado','Informe semanal de obra','Informe semanal de obra enviado a Gerencia', true, '{in_app,push,email}', true, 350)
on conflict (tipo) do nothing;

-- Tipos de los CORREOS de informe (para meterlos a la matriz — parte B).
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden) values
  ('informe_incentivo','Informe de incentivo (semanal)','Correo semanal del incentivo de choferes', true, '{email}', true, 360),
  ('informe_incentivo_diario','Actividad diaria de choferes','Correo diario informativo de actividad', true, '{email}', true, 370),
  ('resumen_operaciones','Resumen semanal de operaciones','Correo semanal de operaciones', true, '{email}', true, 380)
on conflict (tipo) do nothing;

-- Copiar los valores REALES de notificaciones_config (por si un admin los cambió).
update sgc.notif_tipo t set
  canales = coalesce((select array_remove(array[
              case when c.in_app then 'in_app' end,
              case when c.push then 'push' end,
              case when c.email then 'email' end], null) from sgc.notificaciones_config c
              where c.evento = t.tipo or (t.tipo='soporte' and c.evento='soporte_nuevo')), t.canales),
  activo = coalesce((select c.activo from sgc.notificaciones_config c
              where c.evento = t.tipo or (t.tipo='soporte' and c.evento='soporte_nuevo')), t.activo)
  where t.tipo in ('obra_accion_correctiva','obra_accion_vencida','obra_cubicacion_revision',
                   'obra_cubicacion_resuelta','obra_incidente_nuevo','obra_informe_enviado','soporte');

-- ── (A2) Reimplantar los 2 consumidores sobre notif_tipo ─────────────────────
create or replace function sgc.obra_notif_activo(p_evento text, p_canal text)
returns boolean language sql stable set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce((select p_canal = any(canales) and activo from sgc.notif_tipo where tipo = p_evento), false);
$function$;

create or replace function sgc.tg_reporte_usuario_notifica()
returns trigger language plpgsql security definer
set search_path to 'sgc', 'pg_temp', 'extensions', 'public'
as $function$
declare
  v_canales text[]; v_activo boolean;
  v_uid uuid; v_titulo text; v_msg text; v_autor text; v_secret text; v_recientes int;
begin
  select canales, activo into v_canales, v_activo from sgc.notif_tipo where tipo = 'soporte';
  if not coalesce(v_activo, false) then return NEW; end if;

  select nombre into v_autor from sgc.usuarios where id = NEW.usuario_id;
  v_titulo := case NEW.tipo when 'bug' then 'Nuevo reporte de error'
                            when 'sugerencia' then 'Nueva sugerencia'
                            else 'Nuevo comentario de soporte' end;
  v_msg := coalesce(v_autor,'Un usuario')||': '||coalesce(NEW.asunto,'(sin asunto)');

  for v_uid in select sgc.destinatarios_admin() loop
    if 'in_app' = any(v_canales) and sgc.notif_permitida(v_uid, 'soporte') then
      insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
      values (v_uid, 'soporte', v_titulo, v_msg, '/soporte');
    end if;
    if 'push' = any(v_canales) then
      perform sgc.send_push(array[v_uid], v_titulo, v_msg, jsonb_build_object('tipo','soporte','ruta','/soporte'));
    end if;
  end loop;

  if 'email' = any(v_canales) then
    select count(*) into v_recientes from sgc.reportes_usuario
      where id <> NEW.id and created_at > now() - interval '10 minutes';
    if coalesce(v_recientes,0) = 0 then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name='infra_sync_secret';
      begin
        perform net.http_post(
          url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/notificar-soporte',
          headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_secret,'')),
          body := jsonb_build_object('reporte_id', NEW.id)
        );
      exception when others then null;
      end;
    end if;
  end if;
  return NEW;
end;
$function$;

-- ── (A3) Setter de canales/activo por tipo (admin) + retirar la tabla vieja ──
create or replace function sgc.set_notif_tipo_canales(p_tipo text, p_canales text[], p_activo boolean)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede configurar los canales de aviso.'; end if;
  update sgc.notif_tipo
     set canales = coalesce(p_canales, '{}'), activo = coalesce(p_activo, true)
   where tipo = p_tipo;
end;
$function$;
grant execute on function sgc.set_notif_tipo_canales(text,text[],boolean) to authenticated, service_role;

drop table if exists sgc.notificaciones_config;

-- ── (B) El correo entra a la matriz: filtrar resolvedores por tipo + rol/usuario ─
create or replace function sgc.destinatarios_informe_incentivo()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and r.codigo = any (sgc.param_csv('incentivo_informe_roles','admin,direccion,gerencia,logistica,jefe_flota'))
    and coalesce((select 'email' = any(canales) and activo from sgc.notif_tipo where tipo='informe_incentivo'), true)
    and sgc.notif_permitida(u.id, 'informe_incentivo');
$function$;

create or replace function sgc.destinatarios_resumen_operaciones()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and r.codigo = any (sgc.param_csv('resumen_operaciones_roles','admin,direccion,gerencia,logistica,jefe_flota'))
    and coalesce((select 'email' = any(canales) and activo from sgc.notif_tipo where tipo='resumen_operaciones'), true)
    and sgc.notif_permitida(u.id, 'resumen_operaciones');
$function$;

-- diario: usuarios explícitos + roles, ahora también respetando la matriz.
create or replace function sgc.destinatarios_informe_diario()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and coalesce((select 'email' = any(canales) and activo from sgc.notif_tipo where tipo='informe_incentivo_diario'), true)
    and sgc.notif_permitida(u.id, 'informe_incentivo_diario')
    and (
      u.id::text = any (
        select trim(x) from unnest(string_to_array(
          coalesce((select valor from sgc.parametros where clave='incentivo_diario_usuarios'),''), ',')) x
        where trim(x) <> '')
      or exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = u.id and r.codigo = any (sgc.param_csv('incentivo_diario_roles','')))
    );
$function$;

commit;
