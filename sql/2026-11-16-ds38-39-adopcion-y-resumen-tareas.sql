-- DS-38/DS-39 (ronda DS, 16-nov-2026) — #62/#83 tablero de adopción por rol; #82 resumen diario de tareas.
-- Aditiva. Todo editable en sgc.parametros. El resumen diario queda APAGADO por defecto (el issue pide
-- entrevistar a usuarios): al encenderlo envía aviso en la app + push, una vez por usuario y día.
-- Canal WhatsApp/correo del resumen diario: pendiente (ver docs/avance-lotes/F8abc.md).
--   node scripts/apply-migration.mjs sql/2026-11-16-ds38-39-adopcion-y-resumen-tareas.sql --env dev
begin;
set local search_path = sgc, public;

insert into sgc.parametros (clave, valor, descripcion) values
  ('adopcion_dias_activo', '14', 'DS-38/#62: un usuario cuenta como activo si entró en los últimos N días.'),
  ('tareas_resumen_diario_activo', 'false', 'DS-39/#82: activa el resumen diario de tareas (hoy y vencidas) por aviso en la app + push (apagado hasta entrevistar usuarios).'),
  ('tareas_resumen_diario_min', '1', 'DS-39/#82: mínimo de tareas (hoy + vencidas) para enviar el resumen a un usuario.')
on conflict (clave) do nothing;

-- ── DS-38: adopción por rol. Admin o dirección. Excluye usuarios de prueba. ──────────────
create or replace function sgc.adopcion_por_rol()
returns table (rol text, rol_codigo text, total int, nunca_entraron int, activos_n_dias int, sin_actividad_n_dias int)
language plpgsql stable security definer
set search_path to 'sgc', 'auth', 'pg_temp'
as $function$
declare v_dias int := coalesce(nullif((select valor from sgc.parametros where clave = 'adopcion_dias_activo'), '')::int, 14);
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('direccion')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  return query
  with u as (
    select usr.id,
           greatest(au.last_sign_in_at, usr.ultima_actividad_web, usr.ultima_actividad_app) as ultima
      from sgc.usuarios usr
      join auth.users au on au.id = usr.id
     where usr.activo and not coalesce(usr.es_prueba, false)
  )
  select coalesce(r.nombre, 'Sin rol')::text, coalesce(r.codigo, 'sin_rol')::text, count(*)::int,
         (count(*) filter (where u.ultima is null))::int,
         (count(*) filter (where u.ultima >= now() - make_interval(days => v_dias)))::int,
         (count(*) filter (where u.ultima is not null and u.ultima < now() - make_interval(days => v_dias)))::int
    from u
    left join sgc.usuarios_roles ur on ur.usuario_id = u.id
    left join sgc.roles r on r.id = ur.rol_id
   group by r.nombre, r.codigo
   order by 3 desc, 1;
end $function$;
grant execute on function sgc.adopcion_por_rol() to authenticated;

-- Lista de quienes nunca entraron / llevan N días sin entrar (para depurar o capacitar). Solo admin.
create or replace function sgc.adopcion_usuarios_inactivos(p_solo_nunca boolean default false)
returns table (usuario_id uuid, nombre text, rol text, ultima_actividad timestamptz, dias_sin_entrar int)
language plpgsql stable security definer
set search_path to 'sgc', 'auth', 'pg_temp'
as $function$
declare v_dias int := coalesce(nullif((select valor from sgc.parametros where clave = 'adopcion_dias_activo'), '')::int, 14);
begin
  if not sgc.is_admin() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  return query
  select usr.id, usr.nombre::text,
         (select string_agg(r.nombre, ', ') from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id where ur.usuario_id = usr.id)::text,
         greatest(au.last_sign_in_at, usr.ultima_actividad_web, usr.ultima_actividad_app),
         (extract(day from now() - greatest(au.last_sign_in_at, usr.ultima_actividad_web, usr.ultima_actividad_app)))::int
    from sgc.usuarios usr
    join auth.users au on au.id = usr.id
   where usr.activo and not coalesce(usr.es_prueba, false)
     and (greatest(au.last_sign_in_at, usr.ultima_actividad_web, usr.ultima_actividad_app) is null
          or (not p_solo_nunca and greatest(au.last_sign_in_at, usr.ultima_actividad_web, usr.ultima_actividad_app) < now() - make_interval(days => v_dias)))
   order by 4 asc nulls first, 2
   limit 300;
end $function$;
grant execute on function sgc.adopcion_usuarios_inactivos(boolean) to authenticated;

-- ── DS-39: resumen diario de tareas (cron 8:15 RD). service_role. ──────────────────────────
create or replace function sgc.tareas_resumen_diario()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_activo boolean := coalesce((select valor from sgc.parametros where clave = 'tareas_resumen_diario_activo'), 'false') in ('true','t','1','si','sí');
  v_min int := coalesce(nullif((select valor from sgc.parametros where clave = 'tareas_resumen_diario_min'), '')::int, 1);
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_rec record; v_n int := 0;
begin
  if not v_activo then return 0; end if;
  for v_rec in
    select t.asignado_a,
           count(*) filter (where t.fecha_limite = v_hoy) as hoy,
           count(*) filter (where t.fecha_limite < v_hoy) as vencidas
      from sgc.tareas t
      join sgc.usuarios u on u.id = t.asignado_a and u.activo and not coalesce(u.es_prueba, false)
     where t.estado in ('pendiente', 'en_progreso')
       and t.fecha_limite is not null and t.fecha_limite <= v_hoy
     group by t.asignado_a
    having count(*) >= v_min
  loop
    perform sgc.notificar_usuarios(array[v_rec.asignado_a], 'warning', 'Tus tareas de hoy',
      format('Tienes %s tarea(s) para hoy y %s vencida(s).', v_rec.hoy, v_rec.vencidas), '/tareas');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
revoke execute on function sgc.tareas_resumen_diario() from public, anon, authenticated;
grant execute on function sgc.tareas_resumen_diario() to service_role;

do $$ begin perform cron.unschedule('sgc-tareas-resumen-diario'); exception when others then null; end $$;
select cron.schedule('sgc-tareas-resumen-diario', '15 12 * * *', $cron$select sgc.tareas_resumen_diario();$cron$);
commit;
