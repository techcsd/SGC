-- ============================================================================
-- W3 — crear_entrega_vehiculo idempotente + handover + pre-check
-- ----------------------------------------------------------------------------
-- Antes: si un vehículo tenía una recepción 'abierta', el RPC lanzaba
--   `raise exception 'Este vehículo ya tiene una entrega abierta'` SIEMPRE.
--   Esto rompía el outbox del chofer (reintento tras "todo correcto") y no daba
--   forma de resolverlo ni de saberlo antes de llenar el formulario.
--
-- Ahora (aditivo, retrocompatible — la app v1.x sigue funcionando):
--   (a) Idempotencia: si la recepción abierta es del MISMO conductor, el RPC
--       devuelve la existente (no-op) en vez de fallar. Elimina los errores por
--       reintento del outbox.
--   (b) Handover: si la recepción abierta es de OTRO conductor:
--         - por defecto (p_forzar_handover=false) → ERROR ESTRUCTURADO
--           (errcode DR409 + hint 'handover_requerido' + detail JSON con
--            conductor actual, fecha, km, entrega_id). PostgREST expone
--            message/details/hint/code; la app parsea `details`.
--         - con p_forzar_handover=true → cierra la recepción anterior como
--           devolución implícita (deja rastro en ambas) y abre la nueva.
--   (c) Guardrail de integridad: índice único parcial que garantiza UNA sola
--       recepción abierta por vehículo (a prueba de carreras). El RPC captura la
--       unique_violation y la resuelve como (a)/(b).
--   (d) Pre-check ligero para la app: `entrega_abierta_de(p_vehiculo_id)`.
--
-- `p_forzar_handover` se agrega con DEFAULT al FINAL → las llamadas por nombre
-- existentes (app y web) siguen resolviendo sin cambios.
-- Idempotente.
-- ============================================================================

-- (c) Guardrail: una sola recepción abierta por vehículo.
create unique index if not exists uq_entrega_recepcion_abierta
  on sgc.vehiculo_entregas (vehiculo_id)
  where tipo = 'recepcion' and estado = 'abierta';

-- (d) Pre-check: ¿quién tiene este vehículo con recepción abierta?
create or replace function sgc.entrega_abierta_de(p_vehiculo_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select case when e.id is null then null else jsonb_build_object(
    'entrega_id',            e.id,
    'conductor_usuario_id',  e.conductor_usuario_id,
    'conductor', coalesce(
      (select nombre from sgc.usuarios where id = e.conductor_usuario_id),
      (select nombre from sgc.conductores where usuario_id = e.conductor_usuario_id order by created_at limit 1),
      (select email  from sgc.usuarios where id = e.conductor_usuario_id),
      'otro conductor'),
    'desde',  e.created_at,
    'km',     e.km,
    'es_mia', (e.conductor_usuario_id = auth.uid())
  ) end
  from (select 1) _
  left join lateral (
    select * from sgc.vehiculo_entregas
    where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta'
    order by created_at desc limit 1
  ) e on true
  where auth.uid() is not null;
$function$;

grant execute on function sgc.entrega_abierta_de(uuid) to authenticated;

-- Fix principal. Añadir `p_forzar_handover` cambia la firma, así que hay que
-- eliminar el overload de 12 args para no dejar la función ambigua (PostgREST
-- no puede elegir entre dos candidatas). El nuevo overload de 13 args acepta
-- todas las llamadas antiguas vía DEFAULT → retrocompatible.
drop function if exists sgc.crear_entrega_vehiculo(
  uuid, uuid, text, numeric, text, boolean, jsonb, text, jsonb, jsonb,
  timestamp with time zone, text);

create or replace function sgc.crear_entrega_vehiculo(
  p_id uuid,
  p_vehiculo_id uuid,
  p_tipo text,
  p_km numeric,
  p_combustible text,
  p_tiene_danos boolean,
  p_danos jsonb,
  p_firma_url text,
  p_fotos jsonb,
  p_gps jsonb,
  p_capturado_en timestamp with time zone,
  p_observacion text default null,
  p_forzar_handover boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_open sgc.vehiculo_entregas;      -- recepción abierta existente (si hay)
  v_recepcion sgc.vehiculo_entregas; -- para devolución
  v_estado text := 'abierta';
  v_recepcion_id uuid := null;
  v_requiere boolean := false;
  v_slots text[];
  v_required text[] := array['frente','atras','lado_izq','lado_der','tablero','combustible'];
  s text;
  v_nombre text;
  v_obs text := p_observacion;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('flota') then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotencia por id de op: un reenvío exacto devuelve el id, sin duplicar.
  if exists (select 1 from sgc.vehiculo_entregas where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id) then
    raise exception 'Vehículo no encontrado';
  end if;

  -- ── (a) Idempotencia por (vehículo + mismo conductor) ────────────────────
  -- Antes de validar fotos/estado: si YA hay recepción abierta de este vehículo
  -- por el MISMO conductor, un reintento del outbox (con otro id de op) NO debe
  -- fallar ni duplicar. Devolvemos la existente.
  if p_tipo = 'recepcion' then
    select * into v_open from sgc.vehiculo_entregas
      where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta'
      order by created_at desc limit 1;

    if v_open.id is not null and v_open.conductor_usuario_id = v_uid then
      return v_open.id;  -- no-op idempotente (retry del mismo chofer)
    end if;

    -- S21 — una recepción no puede usar un vehículo inactivo o No disponible.
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id
                   and coalesce(activo, true) and coalesce(estado,'activo') <> 'no_disponible') then
      raise exception 'Vehículo no disponible (inactivo o con documentos vencidos)';
    end if;
  end if;

  -- Fotos guiadas obligatorias (el server revalida al cliente).
  select array_agg(distinct f->>'slot')
    into v_slots
    from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f;
  foreach s in array v_required loop
    if v_slots is null or not (s = any(v_slots)) then
      raise exception 'Falta la foto obligatoria: %', s;
    end if;
  end loop;

  if p_tipo = 'recepcion' then
    -- Aquí v_open (si existe) es de OTRO conductor (el mismo-conductor ya salió).
    if v_open.id is not null then
      if not coalesce(p_forzar_handover, false) then
        select coalesce(
          (select nombre from sgc.usuarios where id = v_open.conductor_usuario_id),
          (select nombre from sgc.conductores where usuario_id = v_open.conductor_usuario_id order by created_at limit 1),
          (select email  from sgc.usuarios where id = v_open.conductor_usuario_id),
          'otro conductor')
        into v_nombre;

        -- (b) Error ESTRUCTURADO — no texto plano.
        raise exception 'Este vehículo figura entregado a %', coalesce(v_nombre,'otro conductor')
          using errcode = 'DR409',
                hint = 'handover_requerido',
                detail = json_build_object(
                  'code', 'entrega_abierta_otro_conductor',
                  'entrega_id', v_open.id,
                  'conductor_usuario_id', v_open.conductor_usuario_id,
                  'conductor', coalesce(v_nombre,'otro conductor'),
                  'desde', v_open.created_at,
                  'km', v_open.km
                )::text;
      else
        -- (b) Camino handover: cerrar la recepción anterior como devolución
        -- implícita, dejar rastro en ambas.
        update sgc.vehiculo_entregas
          set estado = 'cerrada',
              observacion = concat_ws(' · ', nullif(observacion,''),
                'Cerrada por handover el '||to_char(now(),'YYYY-MM-DD HH24:MI'))
          where id = v_open.id;
        update sgc.vehiculos set responsable_id = null where id = p_vehiculo_id;
        v_obs := concat_ws(' · ', nullif(v_obs,''),
          'Handover: recibido tras cierre implícito de la entrega anterior');
      end if;
    end if;
    v_estado := 'abierta';

  elsif p_tipo = 'devolucion' then
    select * into v_recepcion from sgc.vehiculo_entregas
      where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta'
      order by created_at desc limit 1;
    if v_recepcion.id is null then
      raise exception 'No hay una entrega abierta de este vehículo para devolver';
    end if;
    if v_recepcion.conductor_usuario_id <> v_uid and not sgc.is_admin() then
      raise exception 'La entrega abierta es de otro conductor';
    end if;
    v_recepcion_id := v_recepcion.id;
    v_estado := 'cerrada';
    v_requiere := coalesce(p_tiene_danos, false) or p_km < v_recepcion.km;
  else
    raise exception 'Tipo inválido: %', p_tipo;
  end if;

  begin
    insert into sgc.vehiculo_entregas(
      id, vehiculo_id, conductor_usuario_id, tipo, entrega_recepcion_id, estado,
      km, combustible, tiene_danos, observacion, firma_url, gps_lat, gps_lng,
      requiere_revision, capturado_en, creado_por
    ) values (
      p_id, p_vehiculo_id, v_uid, p_tipo, v_recepcion_id, v_estado,
      p_km, p_combustible, coalesce(p_tiene_danos, false), v_obs, p_firma_url,
      nullif(p_gps->>'lat', '')::numeric, nullif(p_gps->>'lng', '')::numeric,
      v_requiere, p_capturado_en, v_uid
    );
  exception when unique_violation then
    -- (c) Carrera: otra recepción abierta ganó entre el SELECT y el INSERT.
    -- Resolvemos como el flujo normal: re-consultar y devolver / lanzar handover.
    select * into v_open from sgc.vehiculo_entregas
      where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta'
      order by created_at desc limit 1;
    if v_open.id is not null and v_open.conductor_usuario_id = v_uid then
      return v_open.id;
    end if;
    raise exception 'Este vehículo ya tiene una entrega abierta'
      using errcode = 'DR409', hint = 'handover_requerido';
  end;

  insert into sgc.vehiculo_entrega_fotos(id, entrega_id, slot, storage_path)
  select coalesce(nullif(f->>'id', '')::uuid, gen_random_uuid()), p_id, f->>'slot', f->>'path'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f;

  insert into sgc.vehiculo_entrega_danos(id, entrega_id, zona, descripcion, foto_path, es_nuevo)
  select coalesce(nullif(d->>'id', '')::uuid, gen_random_uuid()), p_id,
         d->>'zona', d->>'descripcion', d->>'foto_path', (p_tipo = 'devolucion')
  from jsonb_array_elements(coalesce(p_danos, '[]'::jsonb)) d;

  if p_tipo = 'devolucion' then
    update sgc.vehiculo_entregas set estado = 'cerrada' where id = v_recepcion_id;
    update sgc.vehiculos set responsable_id = null where id = p_vehiculo_id;
  else
    update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;
  end if;

  -- P7 — el km de recepción/devolución también avanza el odómetro real.
  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);

  return p_id;
end;
$function$;
