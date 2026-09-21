-- BU1 F4 — Crons por entorno + config_entorno + edge_url()/sync_secret() (GENERADO).
-- De raíz: ninguna función/cron vuelve a escribir el ref de prod; la URL base
-- de las edges sale de sgc.config_entorno (distinta por entorno). El secreto de
-- los crons se lee del Vault local (env-agnostic).
-- POST-PASO OBLIGATORIO tras aplicar:  node scripts/set-config-entorno.mjs --env <dev|prod>
-- Apply: node scripts/apply-migration.mjs sql/2026-09-18-bu1-crons-por-entorno.sql --env dev  →  --env prod
begin;
set check_function_bodies = off;

create table if not exists sgc.config_entorno (clave text primary key, valor text not null default '');
alter table sgc.config_entorno enable row level security;
drop policy if exists config_entorno_sel on sgc.config_entorno;
create policy config_entorno_sel on sgc.config_entorno for select to authenticated using (true);
grant select on sgc.config_entorno to authenticated, anon, service_role;
grant all on sgc.config_entorno to service_role;
insert into sgc.config_entorno (clave,valor) values ('entorno',''),('edge_base_url',''),('web_url',''),('app_url','') on conflict (clave) do nothing;

create or replace function sgc.edge_base_url() returns text language sql stable as $fn$ select valor from sgc.config_entorno where clave='edge_base_url' $fn$;
create or replace function sgc.edge_url(slug text) returns text language sql stable as $fn$ select sgc.edge_base_url() || '/functions/v1/' || slug $fn$;
create or replace function sgc.sync_secret() returns text language sql stable as $fn$ select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret' $fn$;
revoke all on function sgc.sync_secret() from public, anon, authenticated;

-- ── Funciones sgc que llamaban a una URL de edge con el ref hardcodeado ──
CREATE OR REPLACE FUNCTION sgc.enviar_informe_semanal(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp', 'extensions', 'public'
AS $function$
declare v_proy uuid; v_uid uuid; v_nombre text; v_secret text;
begin
  update sgc.informes_semanales
    set estado = 'enviado', enviado_en = now(), enviado_por = auth.uid()
    where id = p_id and estado = 'borrador'
    returning proyecto_id into v_proy;
  if v_proy is null then return; end if;
  select nombre into v_nombre from sgc.proyectos where id = v_proy;
  if sgc.obra_notif_activo('obra_informe_enviado','in_app') then
    for v_uid in
      select distinct u.id from sgc.usuarios u
      join sgc.usuarios_roles ur on ur.usuario_id = u.id
      join sgc.roles r on r.id = ur.rol_id
      where coalesce(u.activo,true) and ('direccion' = any(r.modulos) or 'admin' = any(r.modulos)
        or (exists (select 1 from unnest(r.modulos) m where m = 'proyectos') and r.codigo in ('gerencia','direccion')))
    loop
      perform sgc.notificar(v_uid, 'info', 'Informe semanal de obra',
        'Nuevo informe semanal de ' || coalesce(v_nombre,'obra') || '.', '/obra/informes');
    end loop;
  end if;
  begin
    if sgc.obra_notif_activo('obra_informe_enviado','email') then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret' limit 1;
      if v_secret is not null then
        perform net.http_post(
          url := '' || sgc.edge_base_url() || '/functions/v1/generar-informe-obra',
          headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
          body := jsonb_build_object('informe_id', p_id));
      end if;
    end if;
  exception when others then null; end;
end $function$;

CREATE OR REPLACE FUNCTION sgc.evaluar_avisos_cronograma()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public', 'vault'
AS $function$
declare
  r record;
  v_kind text;
  v_sev text;
  v_msg text;
  v_dedup text;
  v_was_insert boolean;
  v_n int := 0;
  v_secret text;
  v_proj_ref text := '';
  resp record;
begin
  -- Auto-resolución: avisos de tareas completadas, o "por_iniciar" de tareas ya iniciadas.
  update sgc.avisos_proyecto a
    set estado='resuelto_auto', resuelto_at=now(), resuelto_nota='Tarea completada'
  where a.tipo like 'cronograma_%' and a.estado='pendiente'
    and a.referencia_id in (select id from sgc.cronograma_tareas where estado='completada');
  update sgc.avisos_proyecto a
    set estado='resuelto_auto', resuelto_at=now(), resuelto_nota='Tarea iniciada'
  where a.tipo='cronograma_por_iniciar' and a.estado='pendiente'
    and a.referencia_id in (select id from sgc.cronograma_tareas where estado<>'pendiente');

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name='cronograma_sync_secret';
  exception when others then v_secret := null; end;

  for r in
    select t.*, p.nombre as proyecto_nombre
    from sgc.cronograma_tareas t
    join sgc.proyectos p on p.id = t.proyecto_id
    where t.estado <> 'completada'
      and not t.es_prueba
      and coalesce(p.activo, true)
      and p.estado not in ('completado','cancelado')
  loop
    v_kind := null;
    if r.estado = 'pendiente' and r.fecha_inicio_plan is not null
       and r.fecha_inicio_plan between current_date and current_date + 3 then
      v_kind := 'por_iniciar'; v_sev := 'media';
      v_msg := 'La tarea «'||r.nombre||'» inicia el '||to_char(r.fecha_inicio_plan,'DD/MM/YYYY')||'.';
    end if;
    if r.fecha_fin_plan is not null and r.fecha_fin_plan < current_date then
      v_kind := 'atrasada'; v_sev := 'alta';
      v_msg := 'La tarea «'||r.nombre||'» está atrasada (vencía el '||to_char(r.fecha_fin_plan,'DD/MM/YYYY')||'). Requiere justificación.';
    elsif r.fecha_fin_plan is not null and r.fecha_fin_plan between current_date and current_date + 2 then
      v_kind := 'por_vencer'; v_sev := 'media';
      v_msg := 'La tarea «'||r.nombre||'» vence el '||to_char(r.fecha_fin_plan,'DD/MM/YYYY')||'.';
    end if;

    if v_kind is null then continue; end if;

    v_dedup := 'crono:'||r.id||':'||v_kind;
    insert into sgc.avisos_proyecto (tipo, proyecto_id, referencia_id, mensaje, severidad, estado, dedup_key)
    values ('cronograma_'||v_kind, r.proyecto_id, r.id, v_msg, v_sev, 'pendiente', v_dedup)
    on conflict (dedup_key) where dedup_key is not null do update
      set mensaje = excluded.mensaje, severidad = excluded.severidad,
          estado = case when sgc.avisos_proyecto.estado = 'resuelto_auto' then 'pendiente' else sgc.avisos_proyecto.estado end
    returning (xmax = 0) into v_was_insert;

    if v_was_insert then
      v_n := v_n + 1;
      -- bell a cada responsable del proyecto
      for resp in
        select pr.usuario_id from sgc.proyecto_responsables pr
        where pr.proyecto_id = r.proyecto_id and pr.activo
      loop
        perform sgc.notificar(resp.usuario_id, case when v_kind='atrasada' then 'error' else 'warning' end,
          'Cronograma: '||r.proyecto_nombre, v_msg,
          '/proyectos/'||r.proyecto_id||'/cronograma?tarea='||r.id);
      end loop;

      -- email best-effort (si hay secreto y net disponible)
      if v_secret is not null then
        begin
          perform net.http_post(
            url := 'https://'||v_proj_ref||'.supabase.co/functions/v1/notificar-cronograma',
            headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
            body := jsonb_build_object('proyecto_id', r.proyecto_id, 'tarea_id', r.id,
                     'tipo', v_kind, 'tarea', r.nombre, 'proyecto', r.proyecto_nombre, 'mensaje', v_msg)
          );
          update sgc.avisos_proyecto set email_enviado_at = now() where dedup_key = v_dedup;
        exception when others then null; end;
      end if;
    end if;
  end loop;

  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.incentivo_cron_diario()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare v_fecha date := (now() at time zone 'America/Santo_Domingo')::date - 1; v_secret text;
begin
  perform sgc.incentivo_generar_dia(v_fecha);
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  begin
    perform net.http_post(
      url := '' || sgc.edge_base_url() || '/functions/v1/incentivo-diario',
      headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_secret,'')),
      body := jsonb_build_object('fecha', v_fecha::text)
    );
  exception when others then null; end;
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.incentivo_enviar_semana(p_anio integer, p_semana integer, p_forzar boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare v_url text; v_secret text; v_ya boolean;
begin
  if not (sgc.puede_gestionar_incentivos() or auth.uid() is null) then
    -- auth.uid() is null => llamada del cron (service context)
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select exists (select 1 from sgc.incentivo_envio where anio = p_anio and semana = p_semana and ok)
    into v_ya;
  if v_ya and not p_forzar then
    return 'ya_enviado';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  v_url := '' || sgc.edge_base_url() || '/functions/v1/incentivo-semanal';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
    body := jsonb_build_object('anio', p_anio, 'semana', p_semana)
  );
  return 'enviando';
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.incentivo_reenviar_version(p_anio integer, p_semana integer, p_motivo text DEFAULT NULL::text, p_destinatarios jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare
  v_secret     text;
  v_url        text;
  v_version    int;
  v_prev_ver   int;
  v_prev_fecha timestamptz;
  v_matriz     jsonb;
  v_dest       jsonb;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado para reenviar el informe.' using errcode = '42501';
  end if;

  -- Recalcula con el estado ACTUAL (población/pesos/incidencias). Las decisiones
  -- aprobado/declinado viven en incentivo_aprobacion (append-only) → se conservan.
  perform sgc.incentivo_generar_semana(p_anio, p_semana);

  -- Versión previa (para "reemplaza al enviado el …").
  select version, enviado_en into v_prev_ver, v_prev_fecha
    from sgc.incentivo_informe_version
   where anio = p_anio and semana = p_semana
   order by version desc limit 1;

  v_version := coalesce(v_prev_ver, 0) + 1;

  -- A partir de v2 el motivo es OBLIGATORIO (es materia de pago).
  if v_version > 1 and coalesce(nullif(trim(p_motivo), ''), '') = '' then
    raise exception 'El motivo del reenvío es obligatorio.' using errcode = 'BF3MO';
  end if;

  -- Snapshot congelado de la matriz que se envía.
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_matriz
    from sgc.incentivo_matriz_email(p_anio, p_semana) m;

  -- Destinatarios: dirigidos (si vienen) o los del informe por defecto.
  if p_destinatarios is not null and jsonb_typeof(p_destinatarios) = 'array'
     and jsonb_array_length(p_destinatarios) > 0 then
    v_dest := p_destinatarios;
  else
    select coalesce(jsonb_agg(jsonb_build_object('email', d.email, 'nombre', d.nombre)), '[]'::jsonb)
      into v_dest from sgc.destinatarios_informe_incentivo() d;
  end if;

  insert into sgc.incentivo_informe_version
    (anio, semana, version, matriz, destinatarios, motivo, reemplaza_version, reemplaza_fecha, enviado_por)
  values
    (p_anio, p_semana, v_version, v_matriz, v_dest, nullif(trim(p_motivo), ''),
     v_prev_ver, v_prev_fecha, auth.uid());

  -- Dispara la edge con los campos de versión (retrocompatible).
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  v_url := '' || sgc.edge_base_url() || '/functions/v1/incentivo-semanal';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
    body := jsonb_build_object(
      'anio', p_anio, 'semana', p_semana,
      'version', v_version,
      'reemplaza_fecha', v_prev_fecha,
      'motivo', nullif(trim(p_motivo), ''),
      'destinatarios', v_dest
    )
  );

  return jsonb_build_object(
    'version', v_version, 'reemplaza_version', v_prev_ver,
    'destinatarios', jsonb_array_length(v_dest)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.resumen_operaciones_enviar_semana(p_anio integer, p_semana integer, p_forzar boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare v_url text; v_secret text; v_ya boolean;
begin
  if not (sgc.es_tecnologia() or sgc.is_admin() or auth.uid() is null) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select exists(select 1 from sgc.resumen_operaciones_envio
                where anio = p_anio and semana = p_semana and ok) into v_ya;
  if v_ya and not p_forzar then return 'ya_enviado'; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  v_url := '' || sgc.edge_base_url() || '/functions/v1/resumen-semanal-operaciones';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('anio', p_anio, 'semana', p_semana));
  return 'enviando';
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.send_push(p_user_ids uuid[], p_titulo text, p_cuerpo text, p_data jsonb DEFAULT '{}'::jsonb, p_tipo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp', 'extensions', 'public'
AS $function$
declare
  v_secret text;
  v_users  uuid[];
  v_tipo   text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;
  v_tipo := coalesce(nullif(p_tipo, ''), p_data->>'tipo');

  if v_tipo is not null then
    -- BK1 — rastro de los descartados ANTES de filtrar (el panel responde
    -- "¿por qué el usuario Y no recibió X?"). silenciada = preferencia propia;
    -- fuera_de_matriz = regla de admin (usuario/rol/global).
    begin
      insert into sgc.notif_entregas (canal, usuario_id, tipo, titulo, destino, estado, motivo)
      select 'push', u, v_tipo, p_titulo, '', 'omitida',
             case when exists (select 1 from sgc.notif_pref_usuario np
                               where np.usuario_id = u and np.tipo = v_tipo and np.silenciado)
                  then 'silenciada' else 'fuera_de_matriz' end
      from unnest(p_user_ids) u
      where not sgc.notif_permitida(u, v_tipo);
    exception when others then null; end;

    select array_agg(u) into v_users
    from unnest(p_user_ids) u
    where sgc.notif_permitida(u, v_tipo);
  else
    v_users := p_user_ids;
  end if;

  if v_users is null or array_length(v_users, 1) is null then return; end if;
  if not exists (select 1 from sgc.device_tokens dt where dt.activo and dt.usuario_id = any(v_users)) then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  begin
    perform net.http_post(
      url := '' || sgc.edge_base_url() || '/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', coalesce(v_secret, '')),
      body := jsonb_build_object('user_ids', to_jsonb(v_users), 'titulo', p_titulo,
        'cuerpo', p_cuerpo, 'data', coalesce(p_data, '{}'::jsonb), 'tipo', v_tipo)
    );
  exception when others then null; end;
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.tg_reporte_usuario_notifica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp', 'extensions', 'public'
AS $function$
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
          url := '' || sgc.edge_base_url() || '/functions/v1/notificar-soporte',
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

-- ── Re-declaración de los cron jobs (upsert por jobname) ──
select cron.schedule('chequeo-semanal-almacenes', '0 6 * * 1', $cron$select sgc.generar_tareas_chequeo_semanal();$cron$);
select cron.schedule('outbox-atascados-diario', '0 12 * * *', $cron$select sgc.outbox_atascados_resumen_diario();$cron$);
select cron.schedule('sgc-aplicar-vencimientos', '0 6 * * *', $cron$select sgc.aplicar_vencimientos_vehiculos();$cron$);
select cron.schedule('sgc-check-domains', '0 */2 * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/check-domains',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);
select cron.schedule('sgc-check-subscriptions', '0 */12 * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/check-subscriptions',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);
select cron.schedule('sgc-consolidar-recorridos', '50 3 * * *', $cron$select sgc.consolidar_recorridos_del_dia();$cron$);
select cron.schedule('sgc-cronograma-avisos', '15 6 * * *', $cron$select sgc.evaluar_avisos_cronograma();$cron$);
select cron.schedule('sgc-fuel-prices', '0 6 * * 6', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/fuel-prices',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);
select cron.schedule('sgc-huecos-tracking', '*/5 * * * *', $cron$select sgc.detectar_huecos_tracking();$cron$);
select cron.schedule('sgc-incentivo-diario', '0 12 * * *', $cron$select sgc.incentivo_cron_diario();$cron$);
select cron.schedule('sgc-incentivo-semanal-lunes', '0 14 * * 1', $cron$select sgc.incentivo_cron_lunes();$cron$);
select cron.schedule('sgc-obra-avance', '30 6 * * *', $cron$select sgc.evaluar_avance_obra();$cron$);
select cron.schedule('sgc-obra-avisos', '20 6 * * *', $cron$select sgc.evaluar_avisos_obra();$cron$);
select cron.schedule('sgc-placas-pp-sweep', '15 6 * * *', $cron$select sgc.evaluar_avisos_placas_pp(null);$cron$);
select cron.schedule('sgc-preaviso-reporte-semanal-sabado', '0 22 * * 6', $cron$select sgc.recordatorio_reporte_semanal(false);$cron$);
select cron.schedule('sgc-purgar-posiciones', '30 4 * * *', $cron$select sgc.purgar_posiciones_viejas();$cron$);
select cron.schedule('sgc-recordar-estados-chofer', '5 * * * *', $cron$select sgc.recordar_estados_chofer();$cron$);
select cron.schedule('sgc-recordar-firma-despachante', '0 */2 * * *', $cron$select sgc.recordar_conduces_por_firmar();$cron$);
select cron.schedule('sgc-recordatorio-reporte-semanal-dia', '*/30 13-23 * * 0', $cron$select sgc.recordatorio_reporte_semanal(true);$cron$);
select cron.schedule('sgc-recordatorio-reporte-semanal-noche', '0 0 * * 1', $cron$select sgc.recordatorio_reporte_semanal(true);$cron$);
select cron.schedule('sgc-recordatorio-solicitudes-movimiento', '0 12 * * *', $cron$select sgc.recordatorio_solicitudes_movimiento();$cron$);
select cron.schedule('sgc-reporte-semanal-dia', '10 6 * * *', $cron$select sgc.sweep_avisos_reporte_semanal();$cron$);
select cron.schedule('sgc-requisiciones-vencidas', '15 11 * * *', $cron$select sgc.requisiciones_vencidas_avisar();$cron$);
select cron.schedule('sgc-reset-almuerzos', '*/5 * * * *', $cron$select sgc.resetear_almuerzos_vencidos();$cron$);
select cron.schedule('sgc-resumen-operaciones-lunes', '0 11 * * 1', $cron$select sgc.resumen_operaciones_cron_lunes();$cron$);
select cron.schedule('sgc-rutas-estancadas', '0 */2 * * *', $cron$select sgc.expirar_rutas_estancadas(18);$cron$);
select cron.schedule('sgc-transcribe-audio', '*/10 * * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/transcribe-audio',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);
select cron.schedule('sgc-vehiculos-sin-echada', '0 11 * * *', $cron$select sgc.avisar_vehiculos_sin_echada();$cron$);
select cron.schedule('weather-sync-obras', '0 */3 * * *', $cron$select net.http_post( url := '' || sgc.edge_base_url() || '/functions/v1/sync-weather-obras', headers := jsonb_build_object('Content-Type','application/json','x-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name='weather_sync_secret')), body := '{}'::jsonb );$cron$);

commit;
