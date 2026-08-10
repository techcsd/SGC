-- =============================================================================
-- PROMPT-1 FASE 3 (AK17 + AK18) — Ronda 10/08/2026. SGC padre. Aditivo.
--
-- AK17 (FALLA DE SEGURIDAD): registrar_multa_app (SECURITY DEFINER) aceptaba
--   cualquier p_conductor_id y saltaba la RLS cm_insert → un chofer podía multar a
--   cualquiera. FIX: un no-elevado SOLO puede registrarse multas a SÍ MISMO
--   (conductor forzado a su propia ficha); solo roles elevados eligen a otro.
--   Además: listado de conductores para el picker con la definición NUEVA (ya no
--   depende de asignación; Papo entra tras el dedup de FASE 2).
--
-- AK18: historiales de usos e inspecciones (checklists_vehiculo) filtrables —
--   RPC para el chofer (sus registros) y RPC para roles elevados (todos, con filtros).
-- =============================================================================

begin;

-- ── 0) ¿Puede el usuario actual multar a OTROS? (configurable) ─────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('multa_roles_elevados', 'admin,direccion,gerencia,jefe_flota,logistica',
   'AK17 — roles que pueden registrar multas a CUALQUIER conductor (CSV roles.codigo). El resto solo a sí mismo.')
on conflict (clave) do nothing;

create or replace function sgc.puede_multar_a_otros()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = auth.uid()
                   and r.codigo = any(sgc.param_csv('multa_roles_elevados',
                         'admin,direccion,gerencia,jefe_flota,logistica')));
$$;
grant execute on function sgc.puede_multar_a_otros() to authenticated, service_role;

-- ── 1) AK17 — registrar_multa_app con gating server-side ──────────────────────
create or replace function sgc.registrar_multa_app(
  p_id uuid, p_conductor_id uuid, p_fecha date,
  p_motivo text default null, p_monto numeric default null,
  p_vehiculo_id uuid default null, p_accidente_id uuid default null,
  p_documento_path text default null, p_estado text default 'pendiente',
  p_capturado_en timestamptz default now()
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_mi_conductor uuid;
  v_conductor uuid := p_conductor_id;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  select id into v_mi_conductor from sgc.conductores
    where usuario_id = v_uid order by activo desc, created_at asc limit 1;

  -- AK17: un no-elevado SOLO puede multarse a sí mismo. Se fuerza (y se valida).
  if not sgc.puede_multar_a_otros() then
    if v_mi_conductor is null then
      raise exception 'Solo puedes registrarte multas a ti mismo, pero tu usuario no tiene ficha de conductor.'
        using errcode = '42501';
    end if;
    if v_conductor is not null and v_conductor <> v_mi_conductor then
      raise exception 'Solo puedes registrarte multas a ti mismo.' using errcode = '42501';
    end if;
    v_conductor := v_mi_conductor;  -- preseleccionado y forzado
  end if;

  if v_conductor is null then
    raise exception 'Debes indicar el conductor de la multa.';
  end if;

  if exists (select 1 from sgc.conductor_multas where id = p_id) then return p_id; end if;
  insert into sgc.conductor_multas (id, conductor_id, fecha, motivo, monto, vehiculo_id, accidente_id, documento_path, estado, registrado_por)
  values (p_id, v_conductor, coalesce(p_fecha, current_date), nullif(trim(p_motivo),''), p_monto,
          p_vehiculo_id, p_accidente_id, nullif(trim(p_documento_path),''),
          case when p_estado in ('pendiente','pagada') then p_estado else 'pendiente' end, v_uid);
  return p_id;
end;
$$;
grant execute on function sgc.registrar_multa_app(uuid, uuid, date, text, numeric, uuid, uuid, text, text, timestamptz) to authenticated, service_role;

-- ── 2) Listado de conductores para el picker de multas (definición nueva) ─────
-- Elevado → todos los conductores activos (con la def. nueva; Papo entra tras dedup).
-- No-elevado → solo su propia ficha (el picker queda bloqueado en él mismo).
create or replace function sgc.conductores_para_multa()
returns table (conductor_id uuid, nombre text, cedula text, es_yo boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select c.id, c.nombre::text, c.cedula::text, (c.usuario_id = auth.uid())
  from sgc.conductores c
  where coalesce(c.activo, true)
    and (
      sgc.puede_multar_a_otros()
      or c.usuario_id = auth.uid()
    )
    and ((not coalesce(c.es_prueba, false)) or sgc.is_admin())
  order by (c.usuario_id = auth.uid()) desc, c.nombre;
$$;
grant execute on function sgc.conductores_para_multa() to authenticated, service_role;

-- ── 3) AK18 — Historial de usos/inspecciones (checklists_vehiculo) ────────────
-- Roles elevados (admin/tecnología/jefe de flota/logística/gerencia) — filtrable.
create or replace function sgc.historial_checklists_vehiculo(
  p_vehiculo_id  uuid default null,
  p_conductor_id uuid default null,
  p_desde        date default null,
  p_hasta        date default null,
  p_tipo         text default null   -- 'pre_uso' (uso) | 'semanal' (inspección) | null
)
returns table (
  id uuid, tipo text, fecha date, capturado_en timestamptz,
  vehiculo_id uuid, placa text, conductor_id uuid, conductor text,
  kilometraje numeric, nivel_combustible text, tiene_criticos boolean,
  atendido boolean, resultado text, tiene_firma boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select cv.id, cv.tipo, cv.fecha, cv.capturado_en,
         cv.vehiculo_id, v.placa::text, cv.conductor_id, c.nombre::text,
         cv.kilometraje, cv.nivel_combustible, cv.tiene_criticos,
         cv.atendido, cv.resultado, (cv.firma_path is not null)
  from sgc.checklists_vehiculo cv
  left join sgc.vehiculos v on v.id = cv.vehiculo_id
  left join sgc.conductores c on c.id = cv.conductor_id
  where (sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_tecnologia()
         or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                    where ur.usuario_id = auth.uid() and r.codigo = 'logistica'))
    and (p_vehiculo_id  is null or cv.vehiculo_id  = p_vehiculo_id)
    and (p_conductor_id is null or cv.conductor_id = p_conductor_id)
    and (p_desde is null or cv.fecha >= p_desde)
    and (p_hasta is null or cv.fecha <= p_hasta)
    and (p_tipo  is null or cv.tipo  = p_tipo)
    and ((not coalesce(cv.es_prueba, false)) or sgc.is_admin())
  order by cv.capturado_en desc nulls last
  limit 500;
$$;
grant execute on function sgc.historial_checklists_vehiculo(uuid, uuid, date, date, text) to authenticated, service_role;

-- Chofer: sus propios usos e inspecciones (Mi actividad).
create or replace function sgc.mis_checklists_vehiculo(
  p_desde date default null, p_hasta date default null, p_tipo text default null
)
returns table (
  id uuid, tipo text, fecha date, capturado_en timestamptz,
  vehiculo_id uuid, placa text, kilometraje numeric, nivel_combustible text,
  tiene_criticos boolean, resultado text, tiene_firma boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select cv.id, cv.tipo, cv.fecha, cv.capturado_en,
         cv.vehiculo_id, v.placa::text, cv.kilometraje, cv.nivel_combustible,
         cv.tiene_criticos, cv.resultado, (cv.firma_path is not null)
  from sgc.checklists_vehiculo cv
  left join sgc.vehiculos v on v.id = cv.vehiculo_id
  where (cv.creado_por = auth.uid()
         or exists (select 1 from sgc.conductores c where c.id = cv.conductor_id and c.usuario_id = auth.uid()))
    and (p_desde is null or cv.fecha >= p_desde)
    and (p_hasta is null or cv.fecha <= p_hasta)
    and (p_tipo  is null or cv.tipo  = p_tipo)
  order by cv.capturado_en desc nulls last
  limit 300;
$$;
grant execute on function sgc.mis_checklists_vehiculo(date, date, text) to authenticated, service_role;

commit;
