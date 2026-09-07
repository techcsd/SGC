-- BK1 — Panel maestro de notificaciones: BACKEND CORE.
-- La queja: "apagar un aviso no lo apaga". Causa: el filtro sólo vivía en
-- send_push; los 6 helpers + el trigger de versión insertaban el inbox sin
-- consultar nada, y no había nivel de usuario. Esta migración:
--   1) catálogo de tipos → TABLA (sgc.notif_tipo), con los 13 vigentes + los que
--      el sistema ya emite y nadie podía apagar.
--   2) nivel de usuario: notif_regla gana usuario_id (precedencia usuario>rol>global).
--   3) el predicado ÚNICO sgc.notif_permitida(usuario,tipo) — la 7ª regla hecha
--      código: TODOS los emisores lo consultan (inbox + push).
--   4) send_push registra en notif_entregas los motivos silenciada/fuera_de_matriz.
-- Aditivo, retrocompatible, gate admin. Alto blast-radius (toca todo aviso):
-- aplicar con smoke (scripts/smoke-notif-panel.mjs) y revisar antes.

begin;

-- ── 1) Catálogo de tipos como tabla ─────────────────────────────────────────
create table if not exists sgc.notif_tipo (
  tipo         text primary key,
  etiqueta     text not null,
  descripcion  text,
  es_operativa boolean not null default false,  -- operativa = no se silencia a la ligera
  canales      text[]  not null default '{in_app,push}',
  activo       boolean not null default true,
  orden        int     not null default 100
);
alter table sgc.notif_tipo enable row level security;
drop policy if exists "notif_tipo: select" on sgc.notif_tipo;
create policy "notif_tipo: select" on sgc.notif_tipo for select to authenticated using (true);
drop policy if exists "notif_tipo: admin" on sgc.notif_tipo;
create policy "notif_tipo: admin" on sgc.notif_tipo for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());
grant select on sgc.notif_tipo to authenticated, service_role;

-- Semilla: 13 vigentes + los ~16 que el sistema emite y no estaban catalogados.
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, orden) values
  ('version_publicada','Nuevas versiones','Nueva versión de la app disponible', false, 10),
  ('material_no_catalogado','Material no catalogado','Ítems libres sin vincular', false, 20),
  ('otros_valor','Valores fuera de catálogo','Valores "Otros" registrados', false, 30),
  ('solicitud_movimiento','Solicitudes de movimiento','Logística: ingeniero→transporte', false, 40),
  ('flota','Avisos de flota','Novedades de vehículos', false, 50),
  ('transporte','Transporte y rutas','Movimientos de transporte', false, 60),
  ('conduce','Conduces','Conduces y trazabilidad', false, 70),
  ('novedad','Novedades','Novedades generales', false, 80),
  ('consumo_anormal','Consumo anómalo','Alertas de consumo de combustible', true, 90),
  ('ruta_asignada','Ruta asignada','Se te asignó una ruta', true, 100),
  ('conduce_por_confirmar','Conduce por confirmar','Tienes un conduce por confirmar', true, 110),
  ('outbox_atascado','Registros atascados (outbox)','Envíos pendientes por reintentar', true, 120),
  ('retiro_material','Retiro de material dañado','Retiro de equipo/material', true, 130),
  -- Los que hacían ruido y nadie podía apagar:
  ('mensaje','Mensajes de chat','Mensajería interna (DMs y grupos)', false, 140),
  ('soporte','Soporte','Respuestas de soporte/dudas', false, 150),
  ('nota_compartida','Notas compartidas','Alguien compartió/editó una nota', false, 160),
  ('alarma-reporte-semanal','Alarma: reporte semanal','Alarma dominical del reporte semanal', true, 170),
  ('alarm-weekly-inspection','Alarma: inspección semanal','Alarma dominical de inspección de vehículo', true, 180),
  ('echada_duplicada','Echada duplicada','Posible echada de combustible duplicada', true, 190),
  ('estancamiento','Estancamiento','Ruta/tarea estancada', true, 200),
  ('ruta_sin_metrica','Ruta sin métrica','Ruta cerrada sin distancia/tiempo', true, 210),
  ('entrega','Entregas','Confirmaciones de entrega', true, 220),
  ('firma','Firmas','Documentos por firmar / firmados', true, 230),
  ('tarea','Tareas','Tareas asignadas / actualizadas', false, 240),
  ('revisar_lectura','Revisar lectura','Lectura de odómetro por revisar', true, 250),
  ('info','Información','Avisos informativos genéricos', false, 900),
  ('warning','Advertencias','Advertencias genéricas', true, 910),
  ('alerta','Alertas','Alertas genéricas', true, 920)
on conflict (tipo) do nothing;

-- Wrapper retrocompatible: notif_tipos_catalogo() ahora lee de la tabla (y así
-- incluye TODOS los tipos). Misma firma → no rompe llamadores.
create or replace function sgc.notif_tipos_catalogo()
returns table(tipo text, etiqueta text, es_operativa boolean)
language sql stable
set search_path to 'sgc', 'pg_temp'
as $$
  select tipo, etiqueta, es_operativa from sgc.notif_tipo where activo order by orden, tipo;
$$;

-- ── 2) notif_regla gana nivel de usuario ────────────────────────────────────
alter table sgc.notif_regla add column if not exists usuario_id uuid references sgc.usuarios(id) on delete cascade;

-- Unicidad por ámbito (tipo, rol, usuario). Reemplaza el índice viejo (tipo,rol).
drop index if exists sgc.ux_notif_regla_tipo_rol;
create unique index if not exists ux_notif_regla_scope
  on sgc.notif_regla (tipo, coalesce(rol, '*'), coalesce(usuario_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Auditoría de cambios de regla (patrón roles_permisos_auditoria).
create table if not exists sgc.notif_regla_audit (
  id         bigint generated always as identity primary key,
  tipo       text not null,
  rol        text,
  usuario_id uuid,
  habilitado boolean,
  actor      uuid,
  at         timestamptz not null default now()
);
alter table sgc.notif_regla_audit enable row level security;
drop policy if exists "notif_regla_audit: admin" on sgc.notif_regla_audit;
create policy "notif_regla_audit: admin" on sgc.notif_regla_audit for select to authenticated using (sgc.is_admin());
grant select on sgc.notif_regla_audit to authenticated, service_role;

-- ── 3) El predicado ÚNICO: precedencia usuario > rol > global ────────────────
-- Devuelve la decisión de la regla más específica (NULL si no hay regla).
create or replace function sgc.notif_regla_habilitado(p_usuario uuid, p_tipo text)
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select r.habilitado
  from sgc.notif_regla r
  where r.tipo = p_tipo
    and (
      r.usuario_id = p_usuario                                          -- nivel usuario
      or (r.usuario_id is null and r.rol is null)                        -- global
      or (r.usuario_id is null and r.rol is not null and exists (        -- nivel rol
            select 1 from sgc.usuarios_roles ur
            join sgc.roles ro on ro.id = ur.rol_id
            where ur.usuario_id = p_usuario and ro.codigo = r.rol))
    )
  order by
    (r.usuario_id is not null) desc,   -- usuario primero
    (r.rol is not null) desc,          -- luego rol, luego global
    r.habilitado asc                    -- entre empates (varios roles), gana el más restrictivo
  limit 1
$$;

-- ¿Se le permite este aviso a este usuario? (regla + su preferencia de silencio).
-- tipo NULL → permitido (no se filtra). Default sin regla → permitido.
create or replace function sgc.notif_permitida(p_usuario uuid, p_tipo text)
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case
    when p_tipo is null then true
    else coalesce(sgc.notif_regla_habilitado(p_usuario, p_tipo), true)
         and not exists (
           select 1 from sgc.notif_pref_usuario np
           where np.usuario_id = p_usuario and np.tipo = p_tipo and np.silenciado)
  end
$$;
grant execute on function sgc.notif_regla_habilitado(uuid,text) to authenticated, service_role;
grant execute on function sgc.notif_permitida(uuid,text) to authenticated, service_role;

-- ── 4) send_push: usa el predicado + registra el rastro de los descartados ───
create or replace function sgc.send_push(p_user_ids uuid[], p_titulo text, p_cuerpo text, p_data jsonb default '{}'::jsonb, p_tipo text default null)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp', 'extensions', 'public'
as $function$
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
      url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', coalesce(v_secret, '')),
      body := jsonb_build_object('user_ids', to_jsonb(v_users), 'titulo', p_titulo,
        'cuerpo', p_cuerpo, 'data', coalesce(p_data, '{}'::jsonb), 'tipo', v_tipo)
    );
  exception when others then null; end;
end;
$function$;

-- ── 5) Los emisores del INBOX respetan la regla (la parte que faltaba) ───────
create or replace function sgc.notificar(p_usuario uuid, p_tipo text, p_titulo text, p_mensaje text, p_ruta text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if p_usuario is null then return; end if;
  if sgc.notif_permitida(p_usuario, coalesce(p_tipo,'info')) then
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    values (p_usuario, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta);
  end if;
  perform sgc.send_push(array[p_usuario], p_titulo, coalesce(p_mensaje, ''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end;
$function$;

create or replace function sgc.notificar_modulo(p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u
    where u.activo and sgc.notif_permitida(u.id, coalesce(p_tipo,'info')) and exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
        and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))
    returning usuario_id)
  select array_agg(usuario_id) into v_ids from ins;
  -- send_push recibe TODO el módulo (filtra y registra rastro por su cuenta).
  perform sgc.send_push(
    (select array_agg(u.id) from sgc.usuarios u where u.activo and exists (
       select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
       where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
         and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end $function$;

create or replace function sgc.notificar_modulo(p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text, p_referencia_id uuid, p_referencia_tipo text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_id, referencia_tipo)
    select u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta, p_referencia_id, p_referencia_tipo
    from sgc.usuarios u
    where u.activo and sgc.notif_permitida(u.id, coalesce(p_tipo,'info')) and exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
        and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))
    returning usuario_id)
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(
    (select array_agg(u.id) from sgc.usuarios u where u.activo and exists (
       select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
       where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
         and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta,
      'referencia_id', p_referencia_id, 'referencia_tipo', p_referencia_tipo));
end $function$;

create or replace function sgc.notificar_rol(p_rol text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select distinct u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where u.activo and r.codigo = p_rol and sgc.notif_permitida(u.id, coalesce(p_tipo,'info'))
    returning usuario_id)
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(
    (select array_agg(distinct u.id) from sgc.usuarios u
       join sgc.usuarios_roles ur on ur.usuario_id = u.id
       join sgc.roles r on r.id = ur.rol_id
       where u.activo and r.codigo = p_rol),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end $function$;

-- Roles elevados de flota: se sacan del parámetro (antes hardcodeados).
insert into sgc.parametros (clave, valor, descripcion) values
  ('aviso_flota_elevado_roles','admin,direccion,gerencia,jefe_flota','Roles elevados que reciben avisos de flota (CSV de códigos)')
on conflict (clave) do nothing;

create or replace function sgc.notificar_flota_elevado(p_tipo text, p_titulo text, p_mensaje text, p_ruta text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ids uuid[]; v_roles text[];
begin
  v_roles := string_to_array(
    coalesce((select valor from sgc.parametros where clave='aviso_flota_elevado_roles'),
             'admin,direccion,gerencia,jefe_flota'), ',');
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select distinct u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where u.activo and r.codigo = any(v_roles) and sgc.notif_permitida(u.id, coalesce(p_tipo,'info'))
    returning usuario_id)
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(
    (select array_agg(distinct u.id) from sgc.usuarios u
       join sgc.usuarios_roles ur on ur.usuario_id = u.id
       join sgc.roles r on r.id = ur.rol_id
       where u.activo and r.codigo = any(v_roles)),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end $function$;

create or replace function sgc.notificar_todos(p_tipo text, p_titulo text, p_mensaje text, p_ruta text)
returns integer language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_n integer; v_ids uuid[];
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede notificar a todos los usuarios.';
  end if;
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
    from sgc.usuarios u where u.activo and sgc.notif_permitida(u.id, coalesce(p_tipo,'info'))
    returning usuario_id)
  select array_agg(usuario_id), count(*) into v_ids, v_n from ins;
  perform sgc.send_push((select array_agg(u.id) from sgc.usuarios u where u.activo),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
  return coalesce(v_n,0);
end $function$;

-- Trigger de versión móvil: también respeta la regla en el inbox.
create or replace function sgc.trg_app_version_push()
returns trigger language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ids uuid[]; v_titulo text; v_msg text;
begin
  if coalesce(new.plataforma,'') <> 'movil' then return new; end if;
  if not coalesce(new.publicada,false) then return new; end if;
  if new.push_notificada_at is not null then return new; end if;

  v_titulo := 'Nueva actualización disponible';
  v_msg := coalesce(nullif(new.titulo,''), 'Versión ' || new.version) || ' — toca para actualizar.';

  select array_agg(distinct dt.usuario_id) into v_ids
  from sgc.device_tokens dt where dt.activo and dt.plataforma = 'android';

  if v_ids is not null and array_length(v_ids,1) > 0 then
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_tipo)
    select uid, 'version_publicada', v_titulo, v_msg, null, 'version'
    from unnest(v_ids) uid
    where sgc.notif_permitida(uid, 'version_publicada');
    perform sgc.send_push(v_ids, v_titulo, v_msg,
      jsonb_build_object('tipo','version_publicada','ruta','/actualizar',
                         'referencia_tipo','version','version', new.version));
  end if;

  new.push_notificada_at := now();
  return new;
end $function$;

-- ── 6) Lectura y escritura de reglas (con nivel usuario + auditoría) ─────────
-- Cambian de firma → hay que dropearlas antes (no basta CREATE OR REPLACE).
-- La vieja set_notif_regla(text,text,boolean) usaba on-conflict sobre el índice
-- que este script elimina, así que además quedaría rota: se retira.
drop function if exists sgc.notif_reglas();
drop function if exists sgc.set_notif_regla(text, text, boolean);

create or replace function sgc.notif_reglas()
returns table(tipo text, rol text, usuario_id uuid, usuario_nombre text, habilitado boolean, updated_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'public'
as $function$
  select r.tipo, r.rol, r.usuario_id, u.nombre, r.habilitado, r.updated_at
  from sgc.notif_regla r
  left join sgc.usuarios u on u.id = r.usuario_id
  where sgc.is_admin()
  order by r.tipo, coalesce(r.rol,''), coalesce(u.nombre,'');
$function$;

create or replace function sgc.set_notif_regla(p_tipo text, p_rol text, p_habilitado boolean, p_usuario_id uuid default null)
returns void language plpgsql security definer
set search_path to 'sgc', 'public'
as $function$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede administrar las reglas de notificación.'; end if;
  insert into sgc.notif_regla (tipo, rol, usuario_id, habilitado, updated_by, updated_at)
  values (p_tipo, nullif(p_rol, ''), p_usuario_id, coalesce(p_habilitado, true), auth.uid(), now())
  on conflict (tipo, coalesce(rol, '*'), coalesce(usuario_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set habilitado = excluded.habilitado, updated_by = auth.uid(), updated_at = now();
  insert into sgc.notif_regla_audit (tipo, rol, usuario_id, habilitado, actor)
  values (p_tipo, nullif(p_rol,''), p_usuario_id, coalesce(p_habilitado,true), auth.uid());
end;
$function$;
grant execute on function sgc.notif_reglas() to authenticated, service_role;
grant execute on function sgc.set_notif_regla(text,text,boolean,uuid) to authenticated, service_role;

commit;
