-- 2026-10-08-cj6-recepcion-unificada.sql
-- CJ6 — "Entregado" no se actualizaba cuando la recepción venía por conduce externo: el
-- despacho quedaba en "Despachado" y no se creaba la entrada al almacén de la obra. Y crear
-- un conduce externo "de un despacho" creaba OTRA salida → doble descuento del almacén.
-- Fix: helper único _aplicar_recepcion_salida (estado + entrada a la obra, idempotente) usado
-- por confirmar_recepcion_salida Y conduce_externo_confirmar_receptor; y crear_conduce_externo
-- gana p_salida_id para enlazar una salida existente sin crear otra.
-- Reescribe sobre la definición VIVA en prod (regla 19). Aditivo.
--   node scripts/apply-migration.mjs sql/2026-10-08-cj6-recepcion-unificada.sql --env dev

-- ── Helper único de recepción (estado entregado + entrada al almacén de la obra) ──
create or replace function sgc._aplicar_recepcion_salida(
  p_salida_id uuid, p_foto text default null, p_firma text default null,
  p_notas text default null, p_cantidades jsonb default null)
returns boolean                                  -- true = entregado_incompleto
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_bodega_obra_id uuid; v_entrada_id uuid; v_item jsonb;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Salida no encontrada.'; end if;

  -- Idempotente: si ya está entregada, no dupliques estado ni entrada.
  if v_salida.estado in ('entregado','entregado_incompleto') then
    return v_salida.estado = 'entregado_incompleto';
  end if;

  -- Cantidades recibidas (si vienen); si no, recibido = enviado por línea.
  if p_cantidades is not null then
    for v_item in select * from jsonb_array_elements(p_cantidades) loop
      update sgc.detalle_salidas set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
        where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
    end loop;
  end if;
  update sgc.detalle_salidas set cantidad_recibida = cantidad
    where salida_id = p_salida_id and cantidad_recibida is null;

  select exists (select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and coalesce(cantidad_recibida,0) < cantidad) into v_incompleto;

  update sgc.salidas_inventario
     set estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
         recibido_por = coalesce(recibido_por, auth.uid()),
         recibido_en  = coalesce(recibido_en, now()),
         notas_recepcion = coalesce(nullif(p_notas,''), notas_recepcion),
         recepcion_foto_path = coalesce(p_foto, recepcion_foto_path),
         firma_pendiente_usuario_id = null, firma_pendiente_nombre = null, firma_pendiente_almacen = false
   where id = p_salida_id;

  -- Entrada al almacén de la obra (si la obra tiene almacén distinto del de origen),
  -- idempotente: solo si no existe ya una entrada para esta salida.
  if v_salida.proyecto_id is not null then
    select id into v_bodega_obra_id from sgc.bodegas where proyecto_id = v_salida.proyecto_id limit 1;
    if v_bodega_obra_id is not null and v_bodega_obra_id <> v_salida.bodega_id
       and not exists (select 1 from sgc.entradas_inventario where salida_id = p_salida_id) then
      insert into sgc.entradas_inventario (fecha, bodega_id, referencia, observaciones, creado_por, origen_tipo, origen_proyecto_id, salida_id)
      values (current_date, v_bodega_obra_id, 'Recepción de material despachado a la obra',
              nullif(p_notas,''), auth.uid(), 'recepcion_obra', v_salida.proyecto_id, p_salida_id)
      returning id into v_entrada_id;
      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
      select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id and coalesce(d.cantidad_recibida, d.cantidad) > 0;
    end if;
  end if;

  return v_incompleto;
end;
$function$;
grant execute on function sgc._aplicar_recepcion_salida(uuid, text, text, text, jsonb) to authenticated, service_role;

-- ── confirmar_recepcion_salida: usa el helper para estado + entrada ──────────────
create or replace function sgc.confirmar_recepcion_salida(p_salida_id uuid, p_items jsonb, p_notas text, p_receptor text DEFAULT NULL::text, p_foto_path text DEFAULT NULL::text, p_firma_path text DEFAULT NULL::text)
returns boolean
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_autorizado boolean; v_incompleto boolean; v_item jsonb;
  v_recibida numeric; v_enviada numeric; v_nombre text;
  v_notas text; v_yo text;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Salida no encontrada.'; end if;
  if v_salida.estado <> 'despachado' then raise exception 'Esta salida ya tiene una recepción confirmada.'; end if;

  select sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
    or (v_salida.proyecto_id is not null and sgc.es_responsable_de_proyecto(v_salida.proyecto_id))
    or (v_salida.proyecto_id is not null and sgc.es_capataz_de_proyecto(v_salida.proyecto_id))
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  into v_autorizado;
  if not v_autorizado then raise exception 'No autorizado para confirmar esta entrega.'; end if;

  if nullif(trim(coalesce(p_foto_path,'')),'') is null
     and nullif(trim(coalesce(p_notas,'')),'') is null
     and not sgc.is_admin() then
    raise exception 'Toma la foto de la recepción; si no puedes, explica por qué en las notas.';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null and not sgc.is_admin() then
    raise exception 'La firma del receptor es obligatoria para confirmar la recepción.';
  end if;

  -- Valida las cantidades recibidas (sin escribirlas aún: lo hace el helper).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_recibida := (v_item->>'cantidad_recibida')::numeric;
    if v_recibida is not null and v_recibida < 0 then
      raise exception 'La cantidad recibida no puede ser negativa.';
    end if;
    select d.cantidad, a.nombre into v_enviada, v_nombre
    from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
    where d.id = (v_item->>'detalle_id')::uuid and d.salida_id = p_salida_id;
    if v_recibida is not null and v_enviada is not null and v_recibida > v_enviada then
      raise exception 'La cantidad recibida (%) de "%" no puede ser mayor que la enviada (%).',
        v_recibida, coalesce(v_nombre,'artículo'), v_enviada;
    end if;
  end loop;

  v_notas := concat_ws(' · ', nullif(p_notas,''),
    case when nullif(p_receptor,'') is not null then 'Recibió: '||p_receptor end);

  -- CJ6 — estado entregado/incompleto + entrada al almacén de la obra (helper único).
  v_incompleto := sgc._aplicar_recepcion_salida(p_salida_id, p_foto_path, p_firma_path, v_notas, p_items);

  -- AY2 — firma del receptor (directo).
  if nullif(trim(coalesce(p_firma_path,'')),'') is not null then
    select nombre into v_yo from sgc.usuarios where id = auth.uid();
    delete from sgc.salida_firmas where salida_id = p_salida_id and rol = 'receptor';
    insert into sgc.salida_firmas (salida_id, rol, nombre, usuario_id, firma_path, metodo)
    values (p_salida_id, 'receptor', coalesce(v_yo, nullif(p_receptor,''), 'Receptor'), auth.uid(), p_firma_path, 'pad');
  end if;

  insert into sgc.recepcion_confirmaciones (entidad_tipo, entidad_id, confirmado_por, modo, fotos, notas, es_prueba)
  values ('salida', p_salida_id, auth.uid(), 'presencial',
          case when nullif(p_foto_path,'') is not null then array[p_foto_path] else '{}'::text[] end,
          v_notas, coalesce(v_salida.es_prueba, false));

  return v_incompleto;
end;
$function$;
grant execute on function sgc.confirmar_recepcion_salida(uuid, jsonb, text, text, text, text) to authenticated, service_role;

-- ── conduce_externo_confirmar_receptor: aplica recepción completa a la salida ─────
create or replace function sgc.conduce_externo_confirmar_receptor(p_id uuid, p_foto_path text, p_firma_path text, p_notas text DEFAULT NULL::text)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_c sgc.conduces_externos%rowtype;
  it jsonb;
  v_items jsonb;
begin
  select * into v_c from sgc.conduces_externos where id = p_id;
  if not found then raise exception 'Conduce externo no encontrado.'; end if;
  if v_c.estado = 'recibido' then raise exception 'Este conduce ya fue confirmado.'; end if;
  if nullif(btrim(coalesce(p_foto_path,'')),'') is null then raise exception 'La foto de recepción es obligatoria.'; end if;
  if nullif(btrim(coalesce(p_firma_path,'')),'') is null then raise exception 'La firma de recepción es obligatoria.'; end if;
  if v_c.emisor_usuario_id = auth.uid() then
    raise exception 'Quien emite el conduce no puede confirmar su propia recepción.';
  end if;
  if not (sgc.is_admin() or sgc.puede_confirmar_recepcion()
          or (v_c.destino_proyecto_id is not null and sgc.es_responsable_de_proyecto(v_c.destino_proyecto_id))
          or sgc.es_logistica()) then
    raise exception 'Tu rol no está habilitado para confirmar esta recepción.';
  end if;

  update sgc.conduces_externos
     set estado = 'recibido', recibido_por = auth.uid(), recibido_en = now(),
         recepcion_foto_path = p_foto_path, receptor_firma_path = p_firma_path,
         notas_recepcion = nullif(btrim(p_notas),''), updated_at = now()
   where id = p_id;

  -- Entrada entrante pendiente (material que ENTRA a nuestro almacén) → materializa.
  if v_c.entrada_id is not null then
    select items_propuestos into v_items from sgc.entradas_inventario
      where id = v_c.entrada_id and coalesce(pendiente_confirmacion, false);
    if v_items is not null then
      for it in select * from jsonb_array_elements(v_items) loop
        insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
        values (v_c.entrada_id, (it->>'articulo_id')::uuid,
                coalesce((it->>'cantidad')::numeric, 0), nullif(it->>'precio_unit','')::numeric);
      end loop;
      update sgc.entradas_inventario
         set pendiente_confirmacion = false, items_propuestos = null,
             foto_mercancia_path = p_foto_path, firma_path = p_firma_path, registrado_por = auth.uid()
       where id = v_c.entrada_id;
    end if;
  end if;

  -- CJ6 — salida saliente → recepción COMPLETA (estado Entregado + entrada al almacén
  -- de la obra), por el mismo helper que la recepción normal. Idempotente.
  if v_c.salida_id is not null then
    perform sgc._aplicar_recepcion_salida(v_c.salida_id, p_foto_path, p_firma_path,
      nullif(btrim(p_notas),''), null);
  end if;
end;
$function$;
grant execute on function sgc.conduce_externo_confirmar_receptor(uuid, text, text, text) to authenticated, service_role;

-- ── crear_conduce_externo: + p_salida_id (enlaza salida existente, no crea otra) ──
-- Dropea el overload de 18 args para no dejar llamadas ambiguas (gotcha CH2).
drop function if exists sgc.crear_conduce_externo(uuid, text, text, text, text, jsonb, text, numeric, numeric, uuid, uuid, text, numeric, numeric, uuid, uuid, text, uuid);

create or replace function sgc.crear_conduce_externo(p_transporta_proveedor_id uuid, p_transporta_texto text, p_placa_foto_path text, p_carga_foto_path text DEFAULT NULL::text, p_material_descripcion text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb, p_origen text DEFAULT NULL::text, p_origen_lat numeric DEFAULT NULL::numeric, p_origen_lng numeric DEFAULT NULL::numeric, p_origen_proyecto_id uuid DEFAULT NULL::uuid, p_origen_bodega_id uuid DEFAULT NULL::uuid, p_destino text DEFAULT NULL::text, p_destino_lat numeric DEFAULT NULL::numeric, p_destino_lng numeric DEFAULT NULL::numeric, p_destino_proyecto_id uuid DEFAULT NULL::uuid, p_destino_bodega_id uuid DEFAULT NULL::uuid, p_emisor_firma_path text DEFAULT NULL::text, p_origen_requisicion_id uuid DEFAULT NULL::uuid, p_salida_id uuid DEFAULT NULL::uuid)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_prueba boolean := sgc.usuario_actual_es_prueba();
  v_salida_id uuid;
  v_entrada_id uuid;
  v_afecta boolean := false;
  v_resp text;
  v_sal sgc.salidas_inventario%rowtype;
begin
  if not sgc.puede_crear_conduce() then
    raise exception 'No puedes crear conduces (no eres transportista ni tienes el módulo Inventario).';
  end if;
  if nullif(btrim(coalesce(p_placa_foto_path,'')),'') is null then
    raise exception 'La foto de la placa del camión es obligatoria.';
  end if;
  if p_transporta_proveedor_id is null and nullif(btrim(coalesce(p_transporta_texto,'')),'') is null then
    raise exception 'Indica quién transporta (proveedor o texto «Otro»).';
  end if;

  if p_transporta_proveedor_id is not null
     and not exists (
       select 1 from sgc.proveedores p
       where p.id = p_transporta_proveedor_id
         and 'transportista' = any(coalesce(p.tipos, array[]::text[]))
         and coalesce(p.activo, true)
     ) then
    perform sgc.error_campo(
      'transporta_proveedor_id', 'no_existe',
      'Ese proveedor de transporte ya no está disponible. Elige otro o escribe quién transporta.');
  end if;

  select nombre into v_resp from sgc.usuarios where id = auth.uid();

  -- CJ6 — si viene una salida existente (despacho ya emitido), se ENLAZA (no se crea otra):
  -- el material ya salió del almacén con esa salida; el conduce solo le pone el camión.
  if p_salida_id is not null then
    select * into v_sal from sgc.salidas_inventario where id = p_salida_id for update;
    if not found then raise exception 'La salida indicada no existe.'; end if;
    if v_sal.estado not in ('despachado') then
      raise exception 'Esa salida ya no está en estado despachado; no se puede enlazar.';
    end if;
    if p_origen_bodega_id is not null and v_sal.bodega_id <> p_origen_bodega_id then
      raise exception 'La salida no es del almacén de origen indicado.';
    end if;
    v_salida_id := p_salida_id;
    v_afecta := true;
  -- Impacto de inventario (solo si hay items del catálogo y toca un almacén nuestro).
  elsif p_items is not null and jsonb_array_length(p_items) > 0 then
    if p_origen_bodega_id is not null then
      v_salida_id := sgc.registrar_salida_inventario(
        current_date, p_origen_bodega_id, p_destino_proyecto_id, 'conduce_externo',
        coalesce(v_resp,'')::varchar, coalesce(p_material_descripcion,''), auth.uid(), p_items);
      v_afecta := true;
    elsif p_destino_bodega_id is not null then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, pendiente_confirmacion, items_propuestos)
      values (
        current_date, p_destino_bodega_id, null, null, 'Conduce externo',
        coalesce(p_material_descripcion,''), auth.uid(), 'otro', p_origen_proyecto_id, true, p_items)
      returning id into v_entrada_id;
      v_afecta := true;
    end if;
  end if;

  insert into sgc.conduces_externos (
    transporta_proveedor_id, transporta_texto, placa_foto_path, carga_foto_path,
    material_descripcion, afecta_inventario, salida_id, entrada_id,
    origen, origen_lat, origen_lng, origen_proyecto_id, origen_bodega_id,
    destino, destino_lat, destino_lng, destino_proyecto_id, destino_bodega_id,
    emisor_firma_path, origen_requisicion_id, es_prueba)
  values (
    p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), p_placa_foto_path, p_carga_foto_path,
    nullif(btrim(p_material_descripcion),''), v_afecta, v_salida_id, v_entrada_id,
    nullif(btrim(p_origen),''), p_origen_lat, p_origen_lng, p_origen_proyecto_id, p_origen_bodega_id,
    nullif(btrim(p_destino),''), p_destino_lat, p_destino_lng, p_destino_proyecto_id, p_destino_bodega_id,
    p_emisor_firma_path, p_origen_requisicion_id, v_prueba)
  returning id into v_id;

  -- Si enlazamos una salida existente, cuélgale la requisición de origen si falta.
  if p_salida_id is not null and p_origen_requisicion_id is not null then
    update sgc.salidas_inventario set origen_requisicion_id = p_origen_requisicion_id
      where id = p_salida_id and origen_requisicion_id is null;
  end if;

  insert into sgc.viajes_transporte (proveedor_id, proveedor_texto, conduce_externo_id, fecha, es_prueba)
  values (p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), v_id, current_date, v_prueba);

  if nullif(btrim(p_origen),'') is not null and p_origen_lat is null
     and p_origen_proyecto_id is null and p_origen_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_origen, 'conduce_externo', v_id, 'origen');
  end if;
  if nullif(btrim(p_destino),'') is not null and p_destino_lat is null
     and p_destino_proyecto_id is null and p_destino_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_destino, 'conduce_externo', v_id, 'destino');
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.crear_conduce_externo(uuid, text, text, text, text, jsonb, text, numeric, numeric, uuid, uuid, text, numeric, numeric, uuid, uuid, text, uuid, uuid) to authenticated, service_role;
