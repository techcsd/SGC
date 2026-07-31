-- ============================================================================
-- AD6 — Ronda 31/07/2026 (PROMPT-15 FASE 5)
-- Funciones de inventario/logística del CHOFER dentro de "Transporte", como RPCs
-- de alcance limitado (NO el módulo Inventario completo). Reutiliza conduces+firmas
-- (AC7), rutas+paradas (AC13) y entradas. Modelo "almacén confirma" para lo inbound.
--
-- Reglas de negocio (ver docs/CHOFER-FLUJO.md):
--  - El chofer puede: crear conduces (crear_conduce_transportista, ya existe),
--    firmar (firmar_conduce, ya existe), confirmar recepción (confirmar_recepcion_salida,
--    ya existe), crear rutas por tipo (nuevo) y registrar una compra/retiro de
--    ferretería que queda PENDIENTE hasta que Almacén la confirme (antifraude).
--  - Tipos de ruta: material | personal | traslado.
--
-- NO se revierte aún el acceso temporal del chofer al módulo Inventario: se hace
-- en coordinación con PROMPT-16 (la app debe tener estas funciones primero).
-- Aquí solo se AGREGA el módulo 'transporte' (aditivo).
-- ============================================================================

-- 1) Tipos de ruta (aditivo, default 'material' → todas las rutas viejas válidas).
alter table sgc.rutas
  add column if not exists tipo text not null default 'material'
  check (tipo in ('material','personal','traslado'));

-- 2) Módulo 'transporte' (aditivo). Se agrega a admin y al rol chofer; el chofer
--    conserva 'inventario' por ahora (revert en PROMPT-16).
update sgc.roles set modulos = array_append(modulos, 'transporte')
  where not ('transporte' = any(modulos))
    and (nombre ilike '%admin%' or nombre ilike '%chofer%' or nombre ilike '%transportista%');

-- 3) Entradas de inventario: recepción/compra PENDIENTE de confirmación por Almacén.
alter table sgc.entradas_inventario
  add column if not exists pendiente_confirmacion boolean not null default false,
  add column if not exists items_propuestos jsonb,
  add column if not exists registrado_por uuid references sgc.usuarios(id);

-- 4) chofer_crear_ruta — el chofer crea una ruta de su tipo, con paradas. Reutiliza
--    set_ruta_paradas. Idempotente por p_id.
create or replace function sgc.chofer_crear_ruta(
  p_id uuid,
  p_tipo text,
  p_fecha date,
  p_origen text,
  p_destino text,
  p_vehiculo_id uuid default null,
  p_destino_proyecto_id uuid default null,
  p_notas text default null,
  p_paradas jsonb default '[]'::jsonb
) returns uuid
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
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_tipo not in ('material','personal','traslado') then v_tipo := 'material'; end if;

  -- Autorización: chofer (dueño de un conductor) o flota elevado/admin.
  select id, vehiculo_id into v_conductor, v_veh
    from sgc.conductores where usuario_id = v_uid and coalesce(activo,true) limit 1;
  if v_conductor is null and not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo un chofer o Flota puede crear rutas';
  end if;

  -- Vehículo: el indicado o, si no, el asignado al chofer. Una ruta siempre lleva vehículo.
  v_veh := coalesce(p_vehiculo_id, v_veh);
  if v_veh is null then raise exception 'Selecciona un vehículo para la ruta'; end if;

  -- Idempotencia.
  select id into v_existing from sgc.rutas where id = p_id;
  if v_existing is not null then return v_existing; end if;

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

-- 5) chofer_registrar_compra_ferreteria — el chofer registra una compra/retiro en
--    ferretería. Queda como entrada PENDIENTE (sin mover stock) hasta que Almacén
--    la confirme. Idempotente por p_id.
create or replace function sgc.chofer_registrar_compra_ferreteria(
  p_id uuid,
  p_fecha date,
  p_bodega_id uuid,
  p_proveedor_id uuid default null,
  p_proyecto_id uuid default null,
  p_orden_compra_id uuid default null,
  p_referencia text default null,
  p_observaciones text default null,
  p_foto_path text default null,
  p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_es_chofer boolean;
  v_existing uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  v_es_chofer := exists (select 1 from sgc.conductores where usuario_id = v_uid and coalesce(activo,true));
  if not (v_es_chofer or sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'Sin permiso para registrar compras de ferretería';
  end if;
  if p_bodega_id is null then raise exception 'La bodega/almacén destino es obligatoria'; end if;

  select id into v_existing from sgc.entradas_inventario where id = p_id;
  if v_existing is not null then return v_existing; end if;

  insert into sgc.entradas_inventario (
    id, fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones,
    origen_tipo, origen_proyecto_id, foto_path, creado_por, registrado_por,
    pendiente_confirmacion, items_propuestos
  ) values (
    coalesce(p_id, gen_random_uuid()), coalesce(p_fecha, current_date), p_bodega_id,
    p_proveedor_id, p_orden_compra_id, nullif(p_referencia,''), nullif(p_observaciones,''),
    'compra', p_proyecto_id, nullif(p_foto_path,''), v_uid, v_uid,
    true, coalesce(p_items,'[]'::jsonb)
  ) returning id into v_existing;

  -- Avisar a Inventario que hay una recepción por confirmar.
  perform sgc.notificar_modulo('inventario', 'info',
    'Compra de ferretería por confirmar',
    'Un chofer registró una compra/retiro que debe confirmar Almacén.',
    '/inventario/entradas');

  return v_existing;
end;
$$;

grant execute on function sgc.chofer_registrar_compra_ferreteria(uuid,date,uuid,uuid,uuid,uuid,text,text,text,jsonb) to authenticated;

-- 6) confirmar_entrada_chofer — Almacén confirma (y ajusta) una entrada pendiente:
--    materializa detalle_entradas (el trigger sube stock) y, si tiene OC, la marca
--    recibida. p_items opcional para ajustar cantidades.
create or replace function sgc.confirmar_entrada_chofer(
  p_entrada_id uuid,
  p_items jsonb default null
) returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  e record;
  v_items jsonb;
  it jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'Solo Almacén/Inventario puede confirmar la recepción';
  end if;

  select * into e from sgc.entradas_inventario where id = p_entrada_id;
  if e.id is null then raise exception 'Entrada no encontrada'; end if;
  if not coalesce(e.pendiente_confirmacion, false) then
    return true; -- idempotente: ya confirmada
  end if;

  v_items := coalesce(p_items, e.items_propuestos, '[]'::jsonb);

  -- Materializa el detalle (el trigger detalle_entradas_stock_trigger sube stock).
  for it in select * from jsonb_array_elements(v_items)
  loop
    insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
    values (
      p_entrada_id,
      (it->>'articulo_id')::uuid,
      coalesce((it->>'cantidad')::numeric, 0),
      nullif(it->>'precio_unit','')::numeric
    );
  end loop;

  update sgc.entradas_inventario
     set pendiente_confirmacion = false, items_propuestos = null
   where id = p_entrada_id;

  -- Si venía de una orden de compra, márcala recibida.
  if e.orden_compra_id is not null then
    update sgc.ordenes_compra set estado = 'recibida' where id = e.orden_compra_id and estado <> 'recibida';
  end if;

  return true;
end;
$$;

grant execute on function sgc.confirmar_entrada_chofer(uuid, jsonb) to authenticated;
