-- BV6 — El conduce externo mueve inventario de verdad, pero el material que ENTRA a un
-- almacén nuestro queda PENDIENTE hasta que el receptor confirma (foto+firma). Antes la
-- entrada subía stock al emitir; ahora sube al recibir (paridad con la recepción normal).
-- La SALIDA (material que sale de nuestro almacén) sí baja stock al emitir — ya salió
-- físicamente — y al confirmar se marca recibida (dispara la cobertura BV4 de requisiciones).
-- Anular un conduce con entrada aún pendiente la borra (no había stock).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv6-conduce-externo-inventario.sql --env dev  →  --env prod
begin;

-- 1) Crear: la entrada entrante nace PENDIENTE (items_propuestos), sin tocar stock.
create or replace function sgc.crear_conduce_externo(
  p_transporta_proveedor_id uuid, p_transporta_texto text, p_placa_foto_path text,
  p_carga_foto_path text default null, p_material_descripcion text default null,
  p_items jsonb default null, p_origen text default null, p_origen_lat numeric default null,
  p_origen_lng numeric default null, p_origen_proyecto_id uuid default null,
  p_origen_bodega_id uuid default null, p_destino text default null, p_destino_lat numeric default null,
  p_destino_lng numeric default null, p_destino_proyecto_id uuid default null,
  p_destino_bodega_id uuid default null, p_emisor_firma_path text default null,
  p_origen_requisicion_id uuid default null)
 returns uuid language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_prueba boolean := sgc.usuario_actual_es_prueba();
  v_salida_id uuid;
  v_entrada_id uuid;
  v_afecta boolean := false;
  v_resp text;
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

  -- BT7: valida el proveedor de transporte ANTES del insert (regla 9/16).
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

  -- Impacto de inventario (solo si hay items del catálogo y toca un almacén nuestro).
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    if p_origen_bodega_id is not null then
      -- Sale de NUESTRO almacén → baja stock al emitir (ya salió físicamente).
      v_salida_id := sgc.registrar_salida_inventario(
        current_date, p_origen_bodega_id, p_destino_proyecto_id, 'conduce_externo',
        coalesce(v_resp,'')::varchar, coalesce(p_material_descripcion,''), auth.uid(), p_items);
      v_afecta := true;
    elsif p_destino_bodega_id is not null then
      -- ENTRA a NUESTRO almacén → PENDIENTE hasta que el receptor confirme (no sube stock aún).
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

-- 2) Confirmar recepción: materializa la entrada pendiente (sube stock) y marca la salida
--    recibida (dispara cobertura BV4). La evidencia foto+firma ya la exige esta función.
create or replace function sgc.conduce_externo_confirmar_receptor(
  p_id uuid, p_foto_path text, p_firma_path text, p_notas text default null)
 returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
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

  -- Entrada entrante pendiente → materializa detalle (el trigger sube stock) y confírmala.
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

  -- Salida saliente → marca recibida (dispara el hook de cobertura de requisiciones BV4).
  if v_c.salida_id is not null then
    update sgc.salidas_inventario
       set recibido_por = auth.uid(), recibido_en = now()
     where id = v_c.salida_id and recibido_por is null;
  end if;
end;
$function$;

-- 3) Anular: si la entrada entrante seguía pendiente (sin stock), se borra. Una entrada ya
--    confirmada o una salida ya despachada NO se revierten aquí (fuera de alcance).
create or replace function sgc.conduce_externo_anular(p_id uuid, p_motivo text)
 returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_c sgc.conduces_externos%rowtype;
begin
  select * into v_c from sgc.conduces_externos where id = p_id;
  if not found then raise exception 'Conduce externo no encontrado.'; end if;
  if not (v_c.creado_por = auth.uid() or sgc.es_logistica()) then
    raise exception 'No tienes permiso para anular este conduce.';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then raise exception 'El motivo de anulación es obligatorio.'; end if;
  if v_c.estado = 'recibido' then
    raise exception 'No se puede anular un conduce ya recibido.' using errcode = '22023';
  end if;

  update sgc.conduces_externos
     set estado = 'anulado', anulado_por = auth.uid(), anulado_en = now(),
         motivo_anulacion = btrim(p_motivo), updated_at = now()
   where id = p_id;

  -- Entrada entrante aún pendiente (sin stock materializado) → se elimina limpio.
  if v_c.entrada_id is not null then
    delete from sgc.entradas_inventario
     where id = v_c.entrada_id and coalesce(pendiente_confirmacion, false) = true;
  end if;
end;
$function$;

commit;
