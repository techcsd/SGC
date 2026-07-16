-- ============================================================================
-- Actualización 5 (QA) — correcciones de BD
--   QA-001: registrar_combustible_app rechaza vehículos no_disponible/baja.
--   QA-010: confirmar_recepcion_salida rechaza recibido > enviado (descuadre).
--   QA-028: aprobar_requisicion arrastra la talla del EPP al ítem de compra.
--   QA-074: RLS `tareas: update` — WITH CHECK impide que un mero asignado se
--           reasigne la tarea a otro (antes: with_check null → cualquier columna).
-- Aditivo/retrocompatible/idempotente. Firmas de RPC intactas.
-- ============================================================================

set search_path = sgc, public;

-- ── QA-001 · combustible: no permitir vehículo no_disponible/baja ────────────
create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date,
  p_kilometraje integer, p_galones numeric, p_monto numeric,
  p_estacion text default null, p_foto_recibo_path text default null,
  p_foto_tablero_path text default null, p_notas text default null
)
returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid; v_km_anterior int; v_km_recorridos int; v_precio numeric;
  v_rendimiento numeric; v_costo_km numeric; v_prom numeric; v_n_prev int;
  v_umbral numeric; v_alerta boolean := false; v_placa text; v_estado text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  select estado into v_estado from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true);
  if not found then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;
  if coalesce(v_estado,'') in ('no_disponible','baja') then
    raise exception 'El vehículo está % y no puede registrar combustible.', v_estado;
  end if;
  if coalesce(p_kilometraje, 0) <= 0 then raise exception 'El kilometraje debe ser mayor que 0'; end if;
  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if coalesce(p_monto, 0)   <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  select max(kilometraje) into v_km_anterior
    from sgc.registros_combustible where vehiculo_id = p_vehiculo_id and kilometraje is not null;
  if v_km_anterior is not null and p_kilometraje <= v_km_anterior then
    raise exception 'El kilometraje (%) debe ser mayor al de la última echada del vehículo (% km).',
      p_kilometraje, v_km_anterior;
  end if;

  v_precio := round(p_monto / p_galones, 2);
  if v_km_anterior is not null then
    v_km_recorridos := p_kilometraje - v_km_anterior;
    if v_km_recorridos > 0 then
      v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
      v_costo_km    := round(p_monto / v_km_recorridos, 2);
    end if;
  end if;

  if v_rendimiento is not null then
    select count(*), avg(rendimiento_km_gal) into v_n_prev, v_prom
      from sgc.registros_combustible where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null;
    if v_n_prev >= 3 and v_prom is not null then
      select valor into v_umbral from sgc.flota_config where clave = 'umbral_consumo_pct';
      v_umbral := coalesce(v_umbral, 20);
      if v_rendimiento < (1 - v_umbral / 100.0) * v_prom then v_alerta := true; end if;
    end if;
  end if;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, alerta_consumo, client_uuid
  ) values (
    v_id, p_vehiculo_id, p_conductor_id, coalesce(p_fecha, current_date), p_kilometraje,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), v_alerta, p_client_uuid
  );

  update sgc.vehiculos set kilometraje = p_kilometraje
   where id = p_vehiculo_id and p_kilometraje > coalesce(kilometraje, 0);

  if v_alerta then
    select placa into v_placa from sgc.vehiculos where id = p_vehiculo_id;
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
      format('Consumo anormal en %s: %s km/gal (%s%% bajo el promedio de %s km/gal). Posible fuga, problema mecánico o combustible desviado.',
        coalesce(v_placa,'vehículo'), v_rendimiento, round((1 - v_rendimiento / v_prom) * 100), round(v_prom,2)),
      'alta');
    perform sgc.notificar_modulo('flota', 'warning', 'Consumo anormal de combustible',
      format('%s registró %s km/gal, bajo el promedio del vehículo.', coalesce(v_placa,'Un vehículo'), v_rendimiento),
      '/flota/combustible');
  end if;

  return jsonb_build_object('id', v_id, 'precio_por_galon', v_precio, 'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos, 'rendimiento_km_gal', v_rendimiento, 'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'promedio_rendimiento', case when v_n_prev >= 3 then round(v_prom, 2) else null end);
end;
$function$;

-- ── QA-010 · recepción: recibido no puede ser mayor que lo enviado ───────────
create or replace function sgc.confirmar_recepcion_salida(p_salida_id uuid, p_items jsonb, p_notas text)
returns boolean language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_autorizado boolean; v_incompleto boolean; v_item jsonb;
  v_recibida numeric; v_enviada numeric; v_nombre text;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Salida no encontrada.'; end if;
  if v_salida.estado <> 'despachado' then raise exception 'Esta salida ya tiene una recepción confirmada.'; end if;

  select sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
  into v_autorizado;
  if not v_autorizado then raise exception 'No autorizado para confirmar esta entrega.'; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_recibida := (v_item->>'cantidad_recibida')::numeric;
    if v_recibida is not null and v_recibida < 0 then
      raise exception 'La cantidad recibida no puede ser negativa.';
    end if;
    -- QA-010: recibido no puede exceder lo enviado.
    select d.cantidad, a.nombre into v_enviada, v_nombre
    from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
    where d.id = (v_item->>'detalle_id')::uuid and d.salida_id = p_salida_id;
    if v_recibida is not null and v_enviada is not null and v_recibida > v_enviada then
      raise exception 'La cantidad recibida (%) de "%" no puede ser mayor que la enviada (%).',
        v_recibida, coalesce(v_nombre,'artículo'), v_enviada;
    end if;

    update sgc.detalle_salidas
    set cantidad_recibida = v_recibida
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  update sgc.salidas_inventario
  set estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
      recibido_por = auth.uid(), recibido_en = now(), notas_recepcion = p_notas
  where id = p_salida_id;

  return v_incompleto;
end;
$function$;

-- ── QA-074 · RLS tareas update: un asignado no puede reasignar a otro ─────────
drop policy if exists "tareas: update" on sgc.tareas;
create policy "tareas: update" on sgc.tareas for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tareas') or (asignado_a = auth.uid()))
  with check (sgc.is_admin() or sgc.tiene_modulo('tareas') or (asignado_a = auth.uid()));

-- ── QA-028 · aprobar_requisicion: la talla del EPP viaja al ítem de compra ────
create or replace function sgc.aprobar_requisicion(
  p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_sol sgc.solicitudes_material%rowtype;
  v_item jsonb; v_articulo_id uuid; v_cant numeric; v_stock numeric; v_desp numeric; v_falt numeric;
  v_nombre text; v_codigo text; v_desc text; v_talla text;
  v_despacho jsonb := '[]'::jsonb; v_compra jsonb := '[]'::jsonb;
  v_falt_total numeric := 0; v_desp_total numeric := 0;
  v_salida_id uuid; v_sc_id uuid; v_fase int; v_has_cuadre boolean := false;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;
  if not found then raise exception 'Requisición no encontrada.'; end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esta requisición ya fue procesada.'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para aprobar requisiciones.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes aprobar tu propia requisición.';
  end if;

  select fase_activa into v_fase from sgc.cuadre_obra where proyecto_id = v_sol.proyecto_id;
  v_has_cuadre := found;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_articulo_id := nullif(v_item->>'articulo_id', '')::uuid;
    v_cant := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cant <= 0 then continue; end if;
    v_desc := coalesce(v_item->>'descripcion', '');
    v_talla := nullif(v_item->>'talla', '');
    v_nombre := null; v_codigo := null;

    if v_articulo_id is not null then
      select coalesce(s.cantidad, 0), a.nombre, a.codigo into v_stock, v_nombre, v_codigo
      from sgc.articulos a
      left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
      where a.id = v_articulo_id;
      v_stock := coalesce(v_stock, 0);
      v_desp := least(v_cant, v_stock);
      if v_desc = '' then v_desc := coalesce(v_nombre, ''); end if;
    else
      v_desp := 0;
    end if;

    v_falt := v_cant - v_desp;

    if v_desp > 0 then
      v_despacho := v_despacho || jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', v_desp, 'talla', v_item->>'talla');
      v_desp_total := v_desp_total + v_desp;
    end if;
    if v_falt > 0 then
      v_compra := v_compra || jsonb_build_object(
        'descripcion',
          (case when v_codigo is not null then '[' || v_codigo || '] ' || v_desc else v_desc end)
          || case when v_talla is not null then ' (Talla ' || v_talla || ')' else '' end,
        'cantidad', v_falt, 'proveedor_sugerido', null);
      v_falt_total := v_falt_total + v_falt;
    end if;

    if v_has_cuadre and v_articulo_id is not null and v_desp > 0 then
      insert into sgc.cuadre_consumo (proyecto_id, articulo_id, fase, cantidad, requisicion_id)
      values (v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
      perform sgc.evaluar_alerta_cuadre(v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
    end if;
  end loop;

  if jsonb_array_length(v_despacho) > 0 then
    v_salida_id := sgc.registrar_salida_inventario(
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto', p_responsable, p_observaciones, auth.uid(), v_despacho);
  end if;

  if jsonb_array_length(v_compra) > 0 then
    insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, estado, notas, origen_requisicion_id)
    values (v_sol.proyecto_id, v_sol.solicitante_id, 'pendiente',
            'Generada automáticamente por el faltante de la requisición al aprobar.', p_solicitud_id)
    returning id into v_sc_id;
    insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido)
    select v_sc_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido'
    from jsonb_array_elements(v_compra) as i;
  end if;

  update sgc.solicitudes_material
     set estado = case when v_falt_total > 0 then 'aprobada' else 'entregada' end,
         salida_id = coalesce(v_salida_id, salida_id),
         solicitud_compra_id = coalesce(v_sc_id, solicitud_compra_id),
         bodega_id = p_bodega_id, atendido_por = auth.uid(), atendido_en = now(), updated_at = now()
   where id = p_solicitud_id;

  return jsonb_build_object('salida_id', v_salida_id, 'solicitud_compra_id', v_sc_id,
    'despachado_total', v_desp_total, 'faltante_total', v_falt_total);
end;
$function$;
