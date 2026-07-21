-- ============================================================================
-- Actualización 3 · PROMPT-9 · S20 + S21 — Vehículos.
--   S20: rendimiento esperado (referencia manual) para comparar vs real.
--   S21: documentos vencidos → estado 'no_disponible' (+ aviso dedup) y de vuelta
--        a 'activo' al actualizar la vigencia. Re-evaluación por vehículo (trigger,
--        para reaccionar al instante) + barrido diario (pg_cron). crear_entrega_
--        vehiculo permite la DEVOLUCIÓN pero bloquea la RECEPCIÓN de un vehículo
--        no disponible.
-- Aditivo / idempotente / retrocompatible.
-- ============================================================================
set search_path = sgc, public;

-- ── S20) Rendimiento esperado ───────────────────────────────────────────────
alter table sgc.vehiculos add column if not exists rendimiento_esperado_km_gal numeric;
comment on column sgc.vehiculos.rendimiento_esperado_km_gal is
  'Rendimiento de referencia (km/gal) definido por el usuario, para comparar contra el promedio real.';

-- ── S21) Re-evaluación de vencimientos de UN vehículo ───────────────────────
create or replace function sgc.reevaluar_vencimiento_vehiculo(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v         sgc.vehiculos;
  mat_venc  boolean;
  seg_venc  boolean;
begin
  select * into v from sgc.vehiculos where id = p_id;
  if not found or not coalesce(v.activo, true) or coalesce(v.estado,'activo') = 'baja' then
    return;
  end if;

  mat_venc := v.vencimiento_matricula is not null and v.vencimiento_matricula < current_date;
  seg_venc := v.vencimiento_seguro    is not null and v.vencimiento_seguro    < current_date;

  -- Aviso matrícula (upsert por dedup_key único; se re-abre si estaba atendido).
  if mat_venc then
    insert into sgc.avisos_flota (tipo, vehiculo_id, mensaje, severidad, estado, dedup_key)
    values ('matricula', p_id,
      'Matrícula vencida el ' || to_char(v.vencimiento_matricula,'DD/MM/YYYY') || '. Vehículo No disponible hasta actualizar.',
      'alta', 'pendiente', 'docvenc:mat:'||p_id::text)
    on conflict (dedup_key) do update
      set estado='pendiente', severidad='alta', mensaje=excluded.mensaje, atendido_at=null, atendido_por=null;
  else
    update sgc.avisos_flota set estado='atendido', atendido_at=now(),
      nota_atencion=coalesce(nota_atencion,'Documento actualizado')
    where dedup_key='docvenc:mat:'||p_id::text and estado='pendiente';
  end if;

  -- Aviso seguro.
  if seg_venc then
    insert into sgc.avisos_flota (tipo, vehiculo_id, mensaje, severidad, estado, dedup_key)
    values ('seguro', p_id,
      'Seguro vencido el ' || to_char(v.vencimiento_seguro,'DD/MM/YYYY') || '. Vehículo No disponible hasta actualizar.',
      'alta', 'pendiente', 'docvenc:seg:'||p_id::text)
    on conflict (dedup_key) do update
      set estado='pendiente', severidad='alta', mensaje=excluded.mensaje, atendido_at=null, atendido_por=null;
  else
    update sgc.avisos_flota set estado='atendido', atendido_at=now(),
      nota_atencion=coalesce(nota_atencion,'Documento actualizado')
    where dedup_key='docvenc:seg:'||p_id::text and estado='pendiente';
  end if;

  -- Estado del vehículo.
  if (mat_venc or seg_venc) and coalesce(v.estado,'activo') <> 'no_disponible' then
    update sgc.vehiculos set estado='no_disponible', updated_at=now() where id=p_id;
  elsif not mat_venc and not seg_venc and coalesce(v.estado,'') = 'no_disponible'
        and exists (select 1 from sgc.avisos_flota a
                    where a.dedup_key in ('docvenc:mat:'||p_id::text,'docvenc:seg:'||p_id::text)) then
    -- Solo reactiva si fue puesto no_disponible por documentos (tiene aviso docvenc).
    update sgc.vehiculos set estado='activo', updated_at=now() where id=p_id;
  end if;
end;
$$;
revoke execute on function sgc.reevaluar_vencimiento_vehiculo(uuid) from authenticated;
grant  execute on function sgc.reevaluar_vencimiento_vehiculo(uuid) to service_role;

-- Trigger: reacciona al instante al cambiar las vigencias (o al crear el vehículo).
create or replace function sgc.tg_reevaluar_vencimiento()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  perform sgc.reevaluar_vencimiento_vehiculo(new.id);
  return new;
end;
$$;
drop trigger if exists trg_reevaluar_vencimiento on sgc.vehiculos;
create trigger trg_reevaluar_vencimiento
  after insert or update of vencimiento_matricula, vencimiento_seguro on sgc.vehiculos
  for each row execute function sgc.tg_reevaluar_vencimiento();

-- ── S21) Barrido masivo (para pg_cron y ejecución manual) ───────────────────
create or replace function sgc.aplicar_vencimientos_vehiculos()
returns int
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare r record; n int := 0;
begin
  for r in select id from sgc.vehiculos where coalesce(activo, true) loop
    perform sgc.reevaluar_vencimiento_vehiculo(r.id);
  end loop;
  select count(*) into n from sgc.vehiculos where coalesce(estado,'') = 'no_disponible';
  return n;
end;
$$;
revoke execute on function sgc.aplicar_vencimientos_vehiculos() from authenticated;
grant  execute on function sgc.aplicar_vencimientos_vehiculos() to service_role;

-- pg_cron: barrido diario 06:00 (por si un documento vence sin que se edite la fila).
do $$ begin perform cron.unschedule('sgc-aplicar-vencimientos'); exception when others then null; end $$;
select cron.schedule('sgc-aplicar-vencimientos', '0 6 * * *', $cron$select sgc.aplicar_vencimientos_vehiculos();$cron$);

-- Barrido inicial (aplica el estado a los que ya están vencidos hoy).
select sgc.aplicar_vencimientos_vehiculos();

-- ── S21) crear_entrega_vehiculo: recepción bloqueada si No disponible ───────
create or replace function sgc.crear_entrega_vehiculo(p_id uuid, p_vehiculo_id uuid, p_tipo text, p_km numeric, p_combustible text, p_tiene_danos boolean, p_danos jsonb, p_firma_url text, p_fotos jsonb, p_gps jsonb, p_capturado_en timestamp with time zone, p_observacion text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_recepcion sgc.vehiculo_entregas;
  v_estado text := 'abierta';
  v_recepcion_id uuid := null;
  v_requiere boolean := false;
  v_slots text[];
  v_required text[] := array['frente','atras','lado_izq','lado_der','tablero','combustible'];
  s text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('flota') then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotency: a re-sent op returns the existing id, no duplicate.
  if exists (select 1 from sgc.vehiculo_entregas where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id) then
    raise exception 'Vehículo no encontrado';
  end if;
  -- S21 — una recepción (salida nueva) no puede usar un vehículo inactivo o
  -- No disponible (p. ej. documentos vencidos). La devolución SÍ se permite,
  -- para no dejar el vehículo atrapado con el chofer.
  if p_tipo = 'recepcion' then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id
                   and coalesce(activo, true) and coalesce(estado,'activo') <> 'no_disponible') then
      raise exception 'Vehículo no disponible (inactivo o con documentos vencidos)';
    end if;
  end if;

  -- Required guided photos (server double-checks the client).
  select array_agg(distinct f->>'slot')
    into v_slots
    from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f;
  foreach s in array v_required loop
    if v_slots is null or not (s = any(v_slots)) then
      raise exception 'Falta la foto obligatoria: %', s;
    end if;
  end loop;

  if p_tipo = 'recepcion' then
    if exists (select 1 from sgc.vehiculo_entregas
               where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta') then
      raise exception 'Este vehículo ya tiene una entrega abierta';
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

  insert into sgc.vehiculo_entregas(
    id, vehiculo_id, conductor_usuario_id, tipo, entrega_recepcion_id, estado,
    km, combustible, tiene_danos, observacion, firma_url, gps_lat, gps_lng,
    requiere_revision, capturado_en, creado_por
  ) values (
    p_id, p_vehiculo_id, v_uid, p_tipo, v_recepcion_id, v_estado,
    p_km, p_combustible, coalesce(p_tiene_danos, false), p_observacion, p_firma_url,
    nullif(p_gps->>'lat', '')::numeric, nullif(p_gps->>'lng', '')::numeric,
    v_requiere, p_capturado_en, v_uid
  );

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
