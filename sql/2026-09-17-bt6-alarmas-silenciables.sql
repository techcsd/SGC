-- BT6 — Las alarmas «Reporte semanal» e «Inspección semanal» también con interruptor,
-- pero solo para admin, Gerencia y usuarios elegidos. Nota #45: "In alerts, the 'Alarma:
-- reporte semanal' and 'Alarma: inspección semanal' must be a switch too, but only for me
-- and Gerencia and certain users that I can select." (captura 6: ambas «Siempre activa».)
--
-- Modelo: los tipos `es_operativa` son "siempre activos" (BF4/BK1) → ignoran el silencio del
-- usuario. BT6 abre una excepción CONTROLADA: un tipo operativo puede declarar QUIÉN puede
-- silenciarlo (`silenciable_por` usuarios + `silenciable_por_roles`). Para esos usuarios se
-- respeta su preferencia; para el resto sigue siendo insilenciable.
--
-- DEFAULT sembrado: `silenciable_por_roles = {admin,gerencia,direccion}` en las dos alarmas
-- (códigos reales: `alarm-weekly-inspection`, `alarma-reporte-semanal`). Xaviel edita la
-- lista de usuarios en Admin › Matriz de notificaciones (nada espera decisión).
--
-- Aditiva y retrocompatible: para tipos NO operativos `puede_silenciar_notif` = true → el
-- comportamiento de silencio actual no cambia. begin/rollback validado en prod.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-17-bt6-alarmas-silenciables.sql

begin;

-- 1) Columnas de "quién puede silenciar" ----------------------------------------
alter table sgc.notif_tipo
  add column if not exists silenciable_por uuid[] null,
  add column if not exists silenciable_por_roles text[] null;

comment on column sgc.notif_tipo.silenciable_por is
  'BT6 — usuarios que PUEDEN silenciar este tipo operativo (además de su regla/preferencia).';
comment on column sgc.notif_tipo.silenciable_por_roles is
  'BT6 — roles (roles.codigo) cuyos usuarios pueden silenciar este tipo operativo.';

-- 2) Predicado único: ¿este usuario puede silenciar este tipo? (regla 14) --------
create or replace function sgc.puede_silenciar_notif(p_usuario uuid, p_tipo text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  -- No operativa → siempre silenciable (comportamiento actual). Operativa → solo si el
  -- usuario está en la lista o tiene un rol de la lista. Tipo desconocido → silenciable.
  select coalesce(
    (select case
       when not coalesce(nt.es_operativa, false) then true
       else (
         p_usuario = any(coalesce(nt.silenciable_por, '{}'::uuid[]))
         or exists (
           select 1 from sgc.usuarios_roles ur
           join sgc.roles r on r.id = ur.rol_id
           where ur.usuario_id = p_usuario
             and r.codigo = any(coalesce(nt.silenciable_por_roles, '{}'::text[])))
       )
     end
     from sgc.notif_tipo nt where nt.tipo = p_tipo),
    true);
$function$;

grant execute on function sgc.puede_silenciar_notif(uuid, text) to authenticated, service_role;

-- 3) notif_permitida respeta el silencio SOLO si el usuario puede silenciar ------
create or replace function sgc.notif_permitida(p_usuario uuid, p_tipo text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select case
    when p_tipo is null then true
    else coalesce(sgc.notif_regla_habilitado(p_usuario, p_tipo), true)
         and not (
           sgc.puede_silenciar_notif(p_usuario, p_tipo)
           and exists (
             select 1 from sgc.notif_pref_usuario np
             where np.usuario_id = p_usuario and np.tipo = p_tipo and np.silenciado)
         )
  end
$function$;

-- 4) destinatarios_notificacion: misma regla (gate por puede_silenciar) ----------
create or replace function sgc.destinatarios_notificacion(p_tipo text, p_modulo text default null, p_usuarios uuid[] default null, p_canal text default 'email')
 returns table(usuario_id uuid, email text, nombre text, excluido_por text)
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  return query
  with base as (
    select distinct u.id, u.email::text as email, u.nombre::text as nombre
    from sgc.usuarios u
    where u.activo
      and (
        (p_usuarios is not null and u.id = any(p_usuarios))
        or (p_usuarios is null and p_modulo is not null and exists (
              select 1 from sgc.usuarios_roles ur
              join sgc.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id
                and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos))))
      )
  ),
  reglas as (
    select b.id,
           (select case
                     when nr.usuario_id is not null then 'regla_usuario'
                     when nr.rol is not null        then 'regla_rol'
                     else 'regla_global'
                   end
              from sgc.notif_regla nr
             where nr.tipo = p_tipo
               and (
                 nr.usuario_id = b.id
                 or (nr.usuario_id is null and nr.rol is null)
                 or (nr.usuario_id is null and nr.rol is not null and exists (
                       select 1 from sgc.usuarios_roles ur
                       join sgc.roles ro on ro.id = ur.rol_id
                       where ur.usuario_id = b.id and ro.codigo = nr.rol))
               )
               and nr.habilitado = false
             order by (nr.usuario_id is not null) desc, (nr.rol is not null) desc
             limit 1) as regla_bloquea
    from base b
  )
  select b.id, b.email, b.nombre,
         case
           when coalesce(sgc.notif_regla_habilitado(b.id, p_tipo), true) = false
             then coalesce(r.regla_bloquea, 'regla_global')
           -- BT6: el silencio del usuario cuenta solo si PUEDE silenciar este tipo.
           when sgc.puede_silenciar_notif(b.id, p_tipo) and exists (
                  select 1 from sgc.notif_pref_usuario np
                  where np.usuario_id = b.id and np.tipo = p_tipo and np.silenciado)
             then 'pref_usuario'
           else null
         end as excluido_por
  from base b
  left join reglas r on r.id = b.id;
end;
$function$;

-- 5) mis_notif_operativas() + notif en mis_preferencias() (contrato app PROMPT-57 F4) --
create or replace function sgc.mis_notif_operativas()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'tipo',        nt.tipo,
      'etiqueta',    nt.etiqueta,
      'descripcion', nt.descripcion,
      'silenciable', sgc.puede_silenciar_notif(auth.uid(), nt.tipo),
      'activa',      sgc.notif_permitida(auth.uid(), nt.tipo)
    ) order by nt.orden nulls last, nt.etiqueta), '[]'::jsonb)
  from sgc.notif_tipo nt
  where coalesce(nt.activo, true) and coalesce(nt.es_operativa, false);
$function$;

grant execute on function sgc.mis_notif_operativas() to authenticated, service_role;

create or replace function sgc.mis_preferencias()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'sgc', 'public'
as $function$
  select jsonb_build_object(
    'idioma',            coalesce(up.idioma, u.idioma, 'es'),
    'tema',              coalesce(up.tema, 'sistema'),
    'densidad',          coalesce(up.densidad, 'normal'),
    'tamano_letra',      coalesce(up.tamano_letra, 'normal'),
    'modulo_inicio',     up.modulo_inicio,
    'idioma_elegido_at', up.idioma_elegido_at,
    'notif',             sgc.mis_notif_operativas()   -- BT6: [{tipo,etiqueta,activa,silenciable}]
  )
  from sgc.usuarios u
  left join sgc.usuario_preferencias up on up.usuario_id = u.id
  where u.id = auth.uid();
$function$;

-- 6) Admin escribe la lista (gate is_admin) -------------------------------------
create or replace function sgc.set_notif_tipo_silenciable(p_tipo text, p_roles text[], p_usuarios uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.notif_tipo
     set silenciable_por_roles = nullif(coalesce(p_roles, '{}'::text[]), '{}'::text[]),
         silenciable_por       = nullif(coalesce(p_usuarios, '{}'::uuid[]), '{}'::uuid[])
   where tipo = p_tipo;
  if not found then
    raise exception 'Tipo de notificación no encontrado: %', p_tipo;
  end if;
end;
$function$;

grant execute on function sgc.set_notif_tipo_silenciable(text, text[], uuid[]) to authenticated, service_role;

-- 7) Seed DEFAULT de las dos alarmas semanales ----------------------------------
update sgc.notif_tipo
   set silenciable_por_roles = array['admin','gerencia','direccion'],
       silenciable_por = null
 where tipo in ('alarm-weekly-inspection', 'alarma-reporte-semanal');

-- 8) El emisor de las alarmas respeta el silencio (regla 7) ----------------------
create or replace function sgc.recordatorio_reporte_semanal(p_alarma boolean default false)
 returns integer
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_anio   int := extract(isoyear from (now() at time zone 'America/Santo_Domingo'))::int;
  v_semana int := extract(week   from (now() at time zone 'America/Santo_Domingo'))::int;
  v_ini_semana timestamptz := date_trunc('week', (now() at time zone 'America/Santo_Domingo')) at time zone 'America/Santo_Domingo';
  r record;
  v_n int := 0;
begin
  for r in
    select c.vehiculo_id, c.placa,
      coalesce(
        c.chofer_usuario_id,
        (select vu.usuario_id from sgc.vehiculo_usos vu
          where vu.vehiculo_id = c.vehiculo_id and vu.inicio_at >= v_ini_semana
          order by vu.inicio_at desc limit 1)
      ) as usuario_id
    from sgc.v_reporte_semanal_cumplimiento c
    join sgc.vehiculos v on v.id = c.vehiculo_id
    where c.anio = v_anio and c.semana = v_semana
      and not coalesce(c.tiene_reporte, false)
      and not coalesce(v.es_prueba, false)
  loop
    if r.usuario_id is null then continue; end if;
    -- BT6: si el destinatario silenció la alarma (y puede hacerlo — admin/gerencia/lista),
    -- no se le manda. Para un chofer normal `notif_permitida` = true (insilenciable).
    if not sgc.notif_permitida(r.usuario_id, 'alarm-weekly-inspection') then continue; end if;

    perform sgc.notificar(
      r.usuario_id, 'warning',
      case when p_alarma then '⏰ Inspección de tu vehículo' else 'Inspección de vehículo pendiente' end,
      format('%s Envía la inspección de %s desde la app.',
             case when p_alarma then 'Hazla ahora:' else 'Aún no la has enviado.' end,
             coalesce(r.placa, 'tu vehículo')),
      '/flota/reporte-semanal'
    );

    if p_alarma then
      perform sgc.send_push(
        array[r.usuario_id],
        'Inspección de tu vehículo',
        format('Haz ahora la inspección de %s. Sonará hasta que la completes.', coalesce(r.placa, 'tu vehículo')),
        jsonb_build_object(
          'tipo', 'alarm-weekly-inspection',
          'legacy_tipo', 'alarma-reporte-semanal',
          'ruta', '/flota/reporte-semanal',
          'alarma', true,
          'prioridad', 'alta',
          'channel_id', 'alarma_inspeccion',
          'vehiculo_id', r.vehiculo_id)
      );
    end if;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

commit;
