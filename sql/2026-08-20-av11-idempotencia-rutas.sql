-- ════════════════════════════════════════════════════════════════════════════
-- AV11 — Idempotencia de creación de rutas (server-side)
-- ════════════════════════════════════════════════════════════════════════════
-- Problema (captura): el flujo del chofer crear ruta → checklist de uso →
-- "documentación pendiente" (hold) → continuar → crear de NUEVO producía la MISMA
-- ruta 2× ("Mi ubicación actual → KFC, Polígono Central"). La idempotencia por
-- p_id NO lo atrapa porque el segundo "crear" llega con un p_id NUEVO.
--
-- Solución server-side (aditiva, retrocompatible): dedup por CONTENIDO. Antes de
-- insertar, si ya existe una ruta del MISMO conductor, al MISMO destino (proyecto
-- o texto homologado), en estado no terminal (planificada|en_curso) y dentro de
-- una ventana de minutos → se DEVUELVE la ruta existente en vez de duplicar.
-- Los puntos crudos / conduces no se tocan. El fix del flujo cliente (reanudar en
-- vez de "crear" de nuevo) va en PROMPT-24; aquí el server lo hace imposible.
-- ════════════════════════════════════════════════════════════════════════════

-- Ventana de dedup configurable (minutos).
insert into sgc.parametros (clave, valor)
values ('ruta_dedup_ventana_min', '10')
on conflict (clave) do nothing;

-- ── Helper: ¿hay una ruta reciente equivalente del mismo conductor? ───────────
create or replace function sgc._ruta_duplicada_reciente(
  p_conductor   uuid,
  p_destino     text,
  p_proyecto    uuid,
  p_ventana_min int default null
) returns uuid
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select r.id
  from sgc.rutas r
  where r.conductor_id is not distinct from p_conductor
    and r.estado in ('planificada', 'en_curso')
    and r.created_at > now() - make_interval(mins => coalesce(
          p_ventana_min,
          (select nullif(valor,'')::int from sgc.parametros where clave = 'ruta_dedup_ventana_min'),
          10))
    and (
      -- mismo destino de obra…
      (p_proyecto is not null and r.destino_proyecto_id = p_proyecto)
      -- …o mismo destino de texto (cuando no es una obra)
      or (p_proyecto is null and r.destino_proyecto_id is null
          and lower(trim(coalesce(r.destino, ''))) = lower(trim(coalesce(p_destino, ''))))
    )
  order by r.created_at desc
  limit 1;
$$;
grant execute on function sgc._ruta_duplicada_reciente(uuid, text, uuid, int) to authenticated, service_role;
comment on function sgc._ruta_duplicada_reciente(uuid, text, uuid, int) is
  'AV11 — devuelve la ruta reciente equivalente (mismo conductor+destino, estado no terminal, dentro de la ventana) para no duplicar. null si no hay.';

-- ── crear_ruta_app: dedup por contenido antes de insertar ─────────────────────
-- Misma firma (15 args). Fiel al comportamiento Y4/AF25; sólo agrega el dedup.
create or replace function sgc.crear_ruta_app(
  p_id uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_origen text, p_destino text,
  p_fecha date default current_date, p_km_estimado numeric default null,
  p_notas text default null, p_destino_proyecto_id uuid default null,
  p_destino_lat numeric default null, p_destino_lng numeric default null,
  p_capturado_en timestamptz default now(), p_origen_lat numeric default null,
  p_origen_lng numeric default null, p_tiempo_estimado_min integer default null)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_cond uuid := p_conductor_id;
  v_dup  uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- idempotencia por p_id (reintento de outbox)
  if exists (select 1 from sgc.rutas where id = p_id) then
    return p_id;
  end if;

  if nullif(trim(p_origen), '') is null then raise exception 'El origen es obligatorio'; end if;
  if nullif(trim(p_destino), '') is null then raise exception 'El destino es obligatorio'; end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  if v_cond is null then
    select id into v_cond from sgc.conductores where usuario_id = v_uid and activo limit 1;
  end if;

  -- AV11 — dedup por contenido: no duplicar la MISMA ruta del flujo checklist→hold.
  v_dup := sgc._ruta_duplicada_reciente(v_cond, sgc.homologar_texto(p_destino), p_destino_proyecto_id, null);
  if v_dup is not null then
    return v_dup;
  end if;

  insert into sgc.rutas (
    id, vehiculo_id, conductor_id, origen, destino, fecha, km_estimado, tiempo_estimado_min, notas,
    destino_proyecto_id, destino_lat, destino_lng, origen_lat, origen_lng,
    estado, creado_por, created_at, updated_at
  ) values (
    p_id, p_vehiculo_id, v_cond, sgc.homologar_texto(p_origen), sgc.homologar_texto(p_destino),
    coalesce(p_fecha, current_date), p_km_estimado, p_tiempo_estimado_min, nullif(trim(p_notas), ''),
    p_destino_proyecto_id, p_destino_lat, p_destino_lng, p_origen_lat, p_origen_lng,
    'planificada', v_uid, coalesce(p_capturado_en, now()), now()
  );

  return p_id;
end;
$function$;
grant execute on function sgc.crear_ruta_app(uuid, uuid, uuid, text, text, date, numeric, text, uuid, numeric, numeric, timestamptz, numeric, numeric, integer) to authenticated, service_role;

-- ── chofer_crear_ruta: dedup por contenido antes de insertar ──────────────────
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
  if v_veh is null then raise exception 'Selecciona un vehículo para la ruta'; end if;

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

comment on function sgc.crear_ruta_app is 'Y4/AF25 + AV11 — crea ruta desde la app (idempotente por p_id y por contenido: no duplica la misma ruta del flujo checklist→hold).';
comment on function sgc.chofer_crear_ruta is 'AD6 + AV11 — el chofer crea ruta (idempotente por p_id y por contenido).';
