-- ============================================================================
-- AI9 + AI12 — Conductor vínculo garantizado + Seguimiento SOLO choferes (SGC padre).
-- ----------------------------------------------------------------------------
-- Contexto (verificado en prod 07/08/2026):
--   • "Mi actividad" de la app muestra "Aún no eres conductor" cuando el usuario
--     no tiene fila en sgc.conductores vinculada (usuario_id = auth.uid()).
--   • Un usuario con rol 'chofer_transportista' SIEMPRE debe tener perfil de
--     conductor. Hoy los 7 rol-chofer sí lo tienen (0 huérfanos), pero no había
--     garantía automática: si a un usuario se le asigna el rol chofer sin pasar
--     por el edge conductor-crear-acceso, quedaba sin fila → pantalla vacía.
--   • AI12: el Seguimiento (choferes_estado) enumera TODA la tabla conductores
--     (12 activos) — deben salir solo los usuarios con rol chofer (7).
--
-- Esta migración (aditiva, idempotente):
--   1) asegurar_conductor_de_usuario(uuid): crea/vincula la fila de conductor de
--      un usuario con rol chofer (deriva la cédula del email sintético; si no,
--      vincula por cédula existente; si no, crea con cédula placeholder).
--   2) asegurar_mi_conductor(): wrapper para auth.uid() (lo llama la app al abrir
--      Mi actividad → nunca más el vacío para un chofer).
--   3) Trigger en usuarios_roles: al asignar rol chofer, garantiza la fila.
--   4) Migración de datos: repara cualquier chofer existente sin fila (no-op hoy).
--   5) choferes_estado(): filtra a usuarios con rol chofer_transportista.
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Garantiza/repara la fila de conductor de un usuario con rol chofer ────
create or replace function sgc.asegurar_conductor_de_usuario(p_usuario_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_cid    uuid;
  v_nombre text;
  v_email  text;
  v_cedula text;
begin
  if p_usuario_id is null then return null; end if;

  -- Ya tiene registro de conductor vinculado.
  select id into v_cid from sgc.conductores where usuario_id = p_usuario_id limit 1;
  if v_cid is not null then return v_cid; end if;

  -- Solo garantizamos el perfil para usuarios con rol chofer.
  if not exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = p_usuario_id and r.codigo = 'chofer_transportista'
  ) then
    return null;
  end if;

  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;
  select email  into v_email  from auth.users where id = p_usuario_id;

  -- La cédula se codifica en el email sintético c-{cedula}@conductores.constructorasd.local
  if v_email ~ '^c-[0-9]+@conductores\.constructorasd\.local$' then
    v_cedula := split_part(substring(v_email from 3), '@', 1);
  end if;

  -- Si hay un conductor por esa cédula sin usuario, vincularlo (no duplicar).
  if v_cedula is not null then
    select id into v_cid from sgc.conductores
     where cedula = v_cedula and usuario_id is null limit 1;
    if v_cid is not null then
      update sgc.conductores
         set usuario_id = p_usuario_id, updated_at = now()
       where id = v_cid;
      return v_cid;
    end if;
  end if;

  -- Cédula placeholder única si no se pudo derivar o ya está tomada por otro.
  if v_cedula is null or exists (select 1 from sgc.conductores where cedula = v_cedula) then
    v_cedula := coalesce(v_cedula, 'SIN-CED') || '-' || left(replace(p_usuario_id::text, '-', ''), 8);
  end if;

  insert into sgc.conductores
    (cedula, nombre, licencia_tipo, tipo_vehiculo_autorizado, activo, usuario_id)
  values
    (v_cedula, coalesce(nullif(v_nombre, ''), 'Conductor'), '01', 'Liviano', true, p_usuario_id)
  returning id into v_cid;

  return v_cid;
end;
$$;
grant execute on function sgc.asegurar_conductor_de_usuario(uuid) to authenticated, service_role;

-- ── 2) Wrapper para el usuario actual (lo llama la app al abrir Mi actividad) ─
create or replace function sgc.asegurar_mi_conductor()
returns uuid
language sql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.asegurar_conductor_de_usuario(auth.uid());
$$;
grant execute on function sgc.asegurar_mi_conductor() to authenticated, service_role;

-- ── 3) Trigger: al asignar rol chofer, garantizar la fila de conductor ──────
create or replace function sgc.tg_usuarios_roles_asegura_conductor()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if exists (select 1 from sgc.roles r where r.id = new.rol_id and r.codigo = 'chofer_transportista') then
    perform sgc.asegurar_conductor_de_usuario(new.usuario_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_roles_asegura_conductor on sgc.usuarios_roles;
create trigger trg_usuarios_roles_asegura_conductor
  after insert on sgc.usuarios_roles
  for each row execute function sgc.tg_usuarios_roles_asegura_conductor();

-- ── 4) Migración de datos: reparar choferes existentes sin fila (idempotente) ─
do $$
declare r record;
begin
  for r in
    select distinct ur.usuario_id
    from sgc.usuarios_roles ur
    join sgc.roles rr on rr.id = ur.rol_id
    where rr.codigo = 'chofer_transportista'
  loop
    perform sgc.asegurar_conductor_de_usuario(r.usuario_id);
  end loop;
end $$;

-- ── 5) AI12 — Seguimiento: choferes_estado SOLO usuarios con rol chofer ─────
create or replace function sgc.choferes_estado()
returns table (
  usuario_id      uuid,
  conductor_id    uuid,
  nombre          text,
  estado          text,
  otros_texto     text,
  almuerzo_inicio timestamptz,
  desde           timestamptz,
  updated_at      timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  -- DISTINCT ON usuario_id: un chofer se lista UNA vez aunque existan filas
  -- de conductor duplicadas por usuario (se prefiere la más antigua).
  select q.usuario_id, q.conductor_id, q.nombre, q.estado,
         q.otros_texto, q.almuerzo_inicio, q.desde, q.updated_at
  from (
    select distinct on (c.usuario_id)
      c.usuario_id, c.id as conductor_id, c.nombre,
      coalesce(e.estado, 'inactivo') as estado, e.otros_texto, e.almuerzo_inicio,
      e.desde, e.updated_at
    from sgc.conductores c
    left join sgc.chofer_estado e on e.usuario_id = c.usuario_id
    where coalesce(c.activo, true)
      -- AI12: únicamente usuarios con rol chofer_transportista (no todos los conductores).
      and exists (
        select 1 from sgc.usuarios_roles ur
        join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = c.usuario_id and r.codigo = 'chofer_transportista'
      )
      and (sgc.es_flota_elevado() or c.usuario_id = auth.uid())
    order by c.usuario_id, c.created_at
  ) q
  order by q.nombre;
$$;
grant execute on function sgc.choferes_estado() to authenticated, service_role;
