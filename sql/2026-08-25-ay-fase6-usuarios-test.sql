-- ============================================================================
-- AY FASE 6 — Usuarios de PRUEBA con roles (AY7). Infraestructura de calidad.
--
-- Un usuario test es un usuario real de auth con email sintético SIN buzón
-- (t-<n>@test.constructorasd.local), rol(es) reales, y `es_prueba=true`
-- inmutable. Se comporta 100% como su rol (mismo menú/guards/tools/RPCs), con
-- una diferencia: banner "USUARIO DE PRUEBA" y exclusión de lo real.
--
-- Esta migración añade la COLUMNA + los candados de BD. La creación/borrado/
-- "entrar como" van por edge functions (service_role) admin-only.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ── Columna es_prueba en usuarios (default false; inmutable por convención) ─
alter table sgc.usuarios add column if not exists es_prueba boolean not null default false;
create index if not exists idx_usuarios_es_prueba on sgc.usuarios (es_prueba) where es_prueba;

-- ── Helper: ¿el usuario actual es de prueba? (fuente única para banner/candados)
create or replace function sgc.soy_usuario_prueba()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce((select es_prueba from sgc.usuarios where id = auth.uid()), false);
$$;
grant execute on function sgc.soy_usuario_prueba() to authenticated, service_role;

-- ── buscar_usuarios: ocultar usuarios test a usuarios REALES ────────────────
-- Un usuario real no debe encontrar (ni asignarle tareas a) un usuario test.
-- Admin y otros usuarios test sí los ven (para QA/gestión).
create or replace function sgc.buscar_usuarios(p_term text)
returns table(id uuid, nombre text, email text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre, u.email
  from sgc.usuarios u
  where coalesce(u.activo, true) = true
    and u.id <> auth.uid()
    and (not coalesce(u.es_prueba, false) or sgc.is_admin() or sgc.soy_usuario_prueba())
    and length(trim(coalesce(p_term, ''))) >= 2
    and (u.nombre ilike '%' || trim(p_term) || '%'
         or coalesce(u.email, '') ilike '%' || trim(p_term) || '%')
  order by u.nombre
  limit 20;
$function$;
grant execute on function sgc.buscar_usuarios(text) to authenticated, service_role;

-- ── listar_usuarios_test() — panel admin ───────────────────────────────────
create or replace function sgc.listar_usuarios_test()
returns table (
  id uuid, nombre text, email text, activo boolean,
  roles jsonb, ultimo_uso timestamptz, created_at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede ver los usuarios de prueba.' using errcode = 'P0001';
  end if;
  return query
  select u.id, u.nombre::text, u.email::text, u.activo,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'nombre', r.nombre) order by r.nombre)
                   from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                   where ur.usuario_id = u.id), '[]'::jsonb) as roles,
         (select max(a.created_at) from sgc.audit_log a
           where a.target_user_id = u.id and a.action = 'usuario_test_login') as ultimo_uso,
         u.created_at
  from sgc.usuarios u
  where coalesce(u.es_prueba, false) = true
  order by u.created_at desc nulls last;
end;
$$;
grant execute on function sgc.listar_usuarios_test() to authenticated;

-- ── Candado de dinero/nómina (AY7 f) — un actor test NO decide incentivos ───
-- Doble candado: además de `es_prueba` en el dato, el ACTOR test queda vetado de
-- aprobar/declinar incentivos reales. Recreamos incentivo_decidir agregando la
-- verificación al inicio (resto idéntico al cuerpo en prod).
create or replace function sgc.incentivo_decidir(p_informe_id uuid, p_decision text, p_motivo text default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'public'
as $function$
declare v_inf sgc.incentivo_semana%rowtype;
begin
  if sgc.soy_usuario_prueba() then
    raise exception 'Un usuario de prueba no puede aprobar/declinar incentivos reales.' using errcode = '42501';
  end if;
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado para decidir incentivos' using errcode = '42501';
  end if;
  if p_decision not in ('aprobado','declinado') then
    raise exception 'Decisión inválida' using errcode = 'AT400';
  end if;
  if p_decision = 'declinado' and (p_motivo is null or length(trim(p_motivo)) = 0) then
    raise exception 'Al declinar debes indicar el motivo' using errcode = 'AT422';
  end if;
  select * into v_inf from sgc.incentivo_semana where id = p_informe_id;
  if not found then
    raise exception 'Informe no encontrado' using errcode = 'AT404';
  end if;

  insert into sgc.incentivo_aprobacion (informe_id, decision, motivo, puntaje, config_version, decidido_por)
  values (p_informe_id, p_decision, nullif(trim(p_motivo), ''), v_inf.puntaje, v_inf.config_version, auth.uid());

  if p_decision = 'aprobado' then
    perform sgc.notificar(v_inf.usuario_id, 'exito', 'Incentivo aprobado',
      format('Cumpliste el puntaje esta semana. ¡Tu incentivo fue aprobado!'), '/mi-rendimiento');
  else
    perform sgc.notificar(v_inf.usuario_id, 'info', 'Resultado de tu incentivo',
      format('Tu incentivo de la semana no fue aprobado. Motivo: %s', p_motivo), '/mi-rendimiento');
  end if;
end;
$function$;
grant execute on function sgc.incentivo_decidir(uuid, text, text) to authenticated;

commit;
