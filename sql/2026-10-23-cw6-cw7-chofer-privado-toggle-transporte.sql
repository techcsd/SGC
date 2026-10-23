-- CW6/CW7 — Interruptor "Permitir también conduces y rutas de empresa" por chofer
-- privado, y mensaje más claro cuando chofer_crear_ruta falla por falta de vehículo.
-- -------------------------------------------------------------------------------------
-- Diagnóstico (PROMPT-114 FASE 0, prod solo lectura, 23-oct-2026): Carlos Encarnacion y
-- Dallin Vido (ambos chofer_privado) tienen fila activa en sgc.conductores pero CERO
-- vehículo en ningún lado (conductores.vehiculo_id null, cero vehiculo_autorizaciones,
-- cero rutas creadas jamás, cero conduces en servidor). El rol chofer_privado SÍ tiene
-- permiso para Rutas por diseño (sql/2026-10-03-rol-chofer-privado.sql — "para crearse
-- sus propias rutas" de su vehículo privado); no hay bug de permiso ahí. La causa real
-- de "no puedo crear ruta" es que sin vehículo autorizado, chofer_crear_ruta no tiene
-- qué vehículo usar. Eso ya es visible en Flota › Choferes privados ("Sin vehículos
-- autorizados"); lo que faltaba es un mensaje de servidor que lo diga explícitamente,
-- y un interruptor para cuando Central decide que un privado también haga trabajo de
-- transportista (conduces de empresa, que el privado NO tiene por diseño).
--
--   node scripts/apply-migration.mjs sql/2026-10-23-cw6-cw7-chofer-privado-toggle-transporte.sql --env dev
-- -------------------------------------------------------------------------------------
begin;
set local search_path = sgc, public;

-- ── 1) Mensaje más claro al fallar por falta de vehículo ─────────────────────────────
create or replace function sgc.chofer_crear_ruta(
  p_id uuid, p_tipo text, p_fecha date, p_origen text, p_destino text,
  p_vehiculo_id uuid default null, p_destino_proyecto_id uuid default null,
  p_notas text default null, p_paradas jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_conductor uuid;
  v_veh uuid;
  v_tipo text := lower(coalesce(nullif(p_tipo,''),'material'));
  v_existing uuid;
  v_dup uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_tipo not in ('material','personal','traslado') then v_tipo := 'material'; end if;

  select id, vehiculo_id into v_conductor, v_veh
    from sgc.conductores where usuario_id = v_uid and coalesce(activo,true) limit 1;
  if v_conductor is null and not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo un chofer o Flota puede crear rutas';
  end if;

  v_veh := coalesce(p_vehiculo_id, v_veh);
  if v_veh is null then
    -- CW6 — mensaje más claro: distingue "no elegiste" de "no tienes ninguno".
    if exists (select 1 from sgc.vehiculo_autorizaciones va
                where va.usuario_id = v_uid and va.activa
                  and va.desde <= current_date and (va.hasta is null or va.hasta >= current_date)) then
      raise exception 'Selecciona un vehículo para la ruta.';
    else
      raise exception 'No tienes ningún vehículo autorizado todavía. Pide a Central que te autorice uno en Flota › Choferes privados.';
    end if;
  end if;

  -- idempotencia por p_id
  select id into v_existing from sgc.rutas where id = p_id;
  if v_existing is not null then return v_existing; end if;

  -- AV11 — dedup por contenido (mismo chofer + destino + ventana).
  v_dup := sgc._ruta_duplicada_reciente(v_conductor, nullif(p_destino,''), p_destino_proyecto_id, null);
  if v_dup is not null then return v_dup; end if;

  insert into sgc.rutas (id, tipo, vehiculo_id, conductor_id, origen, destino, fecha, estado, notas, destino_proyecto_id, creado_por)
  values (coalesce(p_id, gen_random_uuid()), v_tipo, v_veh, v_conductor,
          nullif(p_origen,''), nullif(p_destino,''), coalesce(p_fecha, current_date),
          'planificada', nullif(p_notas,''), p_destino_proyecto_id, v_uid)
  returning id into v_existing;

  if p_paradas is not null and jsonb_array_length(p_paradas) > 0 then
    perform sgc.set_ruta_paradas(v_existing, p_paradas);
  end if;

  return v_existing;
end;
$$;
grant execute on function sgc.chofer_crear_ruta(uuid,text,date,text,text,uuid,uuid,text,jsonb) to authenticated;
comment on function sgc.chofer_crear_ruta is 'AD6 + AV11 + CW6 — el chofer crea ruta (idempotente por p_id y por contenido); mensaje distingue sin-vehículo-elegido de sin-ninguno-autorizado.';

-- ── 2) listar_choferes_privados: +tiene_transportista (estado del interruptor) ───────
-- Cambia el tipo de retorno (columna nueva) → hay que dropearla antes de recrear.
drop function if exists sgc.listar_choferes_privados();
create or replace function sgc.listar_choferes_privados()
returns table(
  usuario_id uuid, nombre text, cedula text, telefono text,
  autorizadas jsonb, en_uso jsonb, ultimo_uso_at timestamptz, n_autorizadas int,
  tiene_transportista boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    u.id,
    u.nombre::text,
    coalesce(c.cedula, u.cedula)::text,
    coalesce(c.telefono, u.telefono)::text,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'autorizacion_id', a.id, 'vehiculo_id', a.vehiculo_id, 'placa', v.placa,
        'marca', v.marca, 'modelo', v.modelo, 'desde', a.desde, 'hasta', a.hasta) order by v.placa)
      from sgc.vehiculo_autorizaciones a
      join sgc.vehiculos v on v.id = a.vehiculo_id
      where a.usuario_id = u.id and a.activa
        and a.desde <= current_date and (a.hasta is null or a.hasta >= current_date)
    ), '[]'::jsonb) as autorizadas,
    (select jsonb_build_object('vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
            'modelo', v.modelo, 'desde', vu.inicio_at)
       from sgc.vehiculo_usos vu join sgc.vehiculos v on v.id = vu.vehiculo_id
      where vu.usuario_id = u.id and vu.fin_at is null limit 1) as en_uso,
    (select max(vu.inicio_at) from sgc.vehiculo_usos vu where vu.usuario_id = u.id) as ultimo_uso_at,
    (select count(*)::int from sgc.vehiculo_autorizaciones a
      where a.usuario_id = u.id and a.activa
        and a.desde <= current_date and (a.hasta is null or a.hasta >= current_date)) as n_autorizadas,
    -- CW6 — ya tiene el rol chofer_transportista (interruptor "en" = también hace conduces/rutas de empresa).
    exists (
      select 1 from sgc.usuarios_roles ur2
      join sgc.roles r2 on r2.id = ur2.rol_id and r2.codigo = 'chofer_transportista'
      where ur2.usuario_id = u.id
    ) as tiene_transportista
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id and r.codigo = 'chofer_privado'
  left join sgc.conductores c on c.usuario_id = u.id
  where (sgc.is_admin() or sgc.es_flota_elevado())
  order by u.nombre;
$function$;
grant execute on function sgc.listar_choferes_privados() to authenticated;

-- ── 3) Interruptor D5: permitir/retirar conduces+rutas de empresa a un privado ───────
-- Da (o quita) el rol chofer_transportista. NO toca el rol chofer_privado (se acumulan).
-- Reversible, con confirmación (del lado del cliente) y auditoría (sgc.audit_log).
create or replace function sgc.chofer_privado_permitir_transporte(
  p_usuario uuid, p_permitir boolean, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_u record;
  v_rol_id int;
  v_cond_id uuid;
  v_creada boolean := false;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select id, nombre into v_u from sgc.usuarios where id = p_usuario;
  if v_u.id is null then raise exception 'Usuario no encontrado' using errcode = 'P0002'; end if;

  if not exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = p_usuario and r.codigo = 'chofer_privado'
  ) then
    raise exception 'Este usuario no es chofer privado.' using errcode = '22023';
  end if;

  select id into v_rol_id from sgc.roles where codigo = 'chofer_transportista';
  if v_rol_id is null then
    raise exception 'No existe el rol chofer_transportista. Configúralo en Administración › Roles.' using errcode = '22023';
  end if;

  if coalesce(p_permitir, false) then
    -- Asegura ficha de conductor (reusa si ya existe).
    select id into v_cond_id from sgc.conductores where usuario_id = p_usuario limit 1;
    if v_cond_id is null then
      insert into sgc.conductores (nombre, cedula, telefono, usuario_id, activo)
      select coalesce(v_u.nombre,'Conductor'), nullif(regexp_replace(coalesce(u.cedula,''),'\D','','g'),''), u.telefono, p_usuario, true
      from sgc.usuarios u where u.id = p_usuario
      returning id into v_cond_id;
      v_creada := true;
    end if;
    insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
    values (p_usuario, v_rol_id, auth.uid())
    on conflict (usuario_id, rol_id) do nothing;
  else
    delete from sgc.usuarios_roles where usuario_id = p_usuario and rol_id = v_rol_id;
  end if;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'chofer_privado_permitir_transporte', p_usuario,
          jsonb_build_object('permitir', coalesce(p_permitir,false), 'motivo', p_motivo,
                              'conductor_id', v_cond_id, 'ficha_creada', v_creada));

  return jsonb_build_object('usuario_id', p_usuario, 'permitido', coalesce(p_permitir,false));
end;
$function$;
grant execute on function sgc.chofer_privado_permitir_transporte(uuid, boolean, text) to authenticated;
comment on function sgc.chofer_privado_permitir_transporte is 'CW6/CW7 D5 — interruptor por chofer: da/quita el rol chofer_transportista (conduces+rutas de empresa) sin tocar chofer_privado. Reversible, auditado.';

commit;
