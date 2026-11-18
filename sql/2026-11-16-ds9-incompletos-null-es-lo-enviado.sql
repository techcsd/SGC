-- DS-09 (ronda DS, 16-nov-2026) / ADR 14: una cantidad_recibida NULL = lo enviado, NO un faltante.
-- Antes, 3 RPC contaban NULL como faltante y marcaban «entregado_incompleto» (160/227 en prod, solo 4 faltantes reales).
-- Cambia UNA expresion en cada funcion: (cantidad_recibida is null or cantidad_recibida < cantidad) -> coalesce(cantidad_recibida, cantidad) < cantidad.
-- _aplicar_recepcion_salida ya trataba NULL como lo enviado. El saneo de las salidas ya marcadas va en scripts/data-fixes/2026-11-16-ds9-incompletos-falsos.mjs (dry-run por defecto).

CREATE OR REPLACE FUNCTION sgc.conduce_confirmar_receptor(p_salida_id uuid, p_foto_path text, p_firma_path text, p_checklist jsonb DEFAULT NULL::jsonb, p_items jsonb DEFAULT NULL::jsonb, p_notas text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_item jsonb; v_incompleto boolean; v_recibida numeric; v_enviada numeric; v_nombre text;
  v_autorizado boolean; v_bodega_destino_id uuid; v_entrada_id uuid; v_notas text;
  v_receptor_nombre text; v_proyecto_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;
  if v_s.recibido_por is not null then
    raise exception 'Esta entrega ya fue confirmada.';
  end if;

  -- Anti-suplantación: el chofer/emisor no confirma su propia entrega (salvo admin).
  if sgc.es_chofer_de_conduce(p_salida_id) and not sgc.is_admin() then
    raise exception 'La recepción debe confirmarla el responsable del destino desde SU dispositivo, no el transportista.';
  end if;

  -- Autorizado = admin, puede_confirmar_recepcion, receptor de obra, o confirmador
  -- de la matriz (cubre destino almacén central).
  v_autorizado := sgc.is_admin()
    or sgc.puede_confirmar_recepcion()
    or exists (select 1 from sgc.receptores_de_destino(p_salida_id) r where r.usuario_id = v_uid)
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_autorizado then
    raise exception 'No estás autorizado para confirmar la recepción de este destino.';
  end if;

  -- BD2: la foto es obligatoria PERO NO BLOQUEANTE — si no se pudo tomar (cámara/
  -- permiso/sin señal) se acepta con una NOTA que lo explique. La firma sí es
  -- siempre obligatoria.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null
     and nullif(trim(coalesce(p_notas,'')),'') is null then
    raise exception 'Toma la foto de la recepción; si no puedes, explica por qué en las notas.';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma de recepción es obligatoria.';
  end if;

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
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
      update sgc.detalle_salidas set cantidad_recibida = v_recibida
        where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
    end loop;
  end if;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and coalesce(cantidad_recibida, cantidad) < cantidad
  ) into v_incompleto;

  v_notas := concat_ws(' · ', nullif(p_notas,''), 'Confirmado por el receptor en su dispositivo');

  -- BD2: limpia también los flags de firma pendiente. Antes, una entrega
  -- entregada-con-firma-pendiente seguía saliendo en "Por firmar" tras confirmarla
  -- (la redundancia de las dos bandejas). Confirmar YA deja la firma del receptor,
  -- así que la firma pendiente queda saldada.
  update sgc.salidas_inventario set
    estado             = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    recibido_por       = v_uid,
    recibido_en        = now(),
    recepcion_foto_path= coalesce(p_foto_path, recepcion_foto_path),
    notas_recepcion    = coalesce(v_notas, notas_recepcion),
    firma_pendiente_usuario_id = null,
    firma_pendiente_nombre     = null,
    firma_pendiente_almacen    = false
  where id = p_salida_id;

  select nombre into v_receptor_nombre from sgc.usuarios where id = v_uid;
  delete from sgc.salida_firmas where salida_id = p_salida_id and rol = 'receptor';
  insert into sgc.salida_firmas (salida_id, rol, nombre, usuario_id, firma_path, metodo, firmado_en)
  values (p_salida_id, 'receptor', coalesce(v_receptor_nombre,'Receptor'), v_uid, p_firma_path, 'pad', now());

  insert into sgc.recepcion_confirmaciones (
    entidad_tipo, entidad_id, confirmado_por, modo, fotos, notas, checklist,
    es_prueba, es_prueba_origen
  ) values (
    'salida', p_salida_id, v_uid, 'presencial',
    case when nullif(trim(coalesce(p_foto_path,'')),'') is null then '{}'::text[] else array[p_foto_path] end,
    p_notas, p_checklist,
    coalesce(v_s.es_prueba, false), case when coalesce(v_s.es_prueba,false) then 'heredado' else 'manual' end
  );

  -- Entrada de inventario al destino: almacén central (AL10) o bodega de la obra.
  v_bodega_destino_id := v_s.destino_almacen_id;
  if v_bodega_destino_id is null and v_s.proyecto_id is not null then
    select id into v_bodega_destino_id from sgc.bodegas where proyecto_id = v_s.proyecto_id limit 1;
  end if;
  if v_bodega_destino_id is not null and v_bodega_destino_id <> v_s.bodega_id
     and not exists (select 1 from sgc.entradas_inventario where salida_id = p_salida_id) then
    insert into sgc.entradas_inventario (
      fecha, bodega_id, referencia, observaciones, creado_por,
      origen_tipo, origen_proyecto_id, salida_id
    ) values (
      current_date, v_bodega_destino_id,
      case when v_s.destino_almacen_id is not null then 'Recepción de material trasladado al almacén'
           else 'Recepción de material despachado a la obra' end,
      v_notas, v_uid,
      case when v_s.destino_almacen_id is not null then 'traslado_almacen' else 'recepcion_obra' end,
      v_s.proyecto_id, p_salida_id
    ) returning id into v_entrada_id;
    insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
    select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id and coalesce(d.cantidad_recibida, d.cantidad) > 0;
  end if;

  if v_s.creado_por is not null then
    perform sgc.notificar(v_s.creado_por, 'entrega',
      'Entrega confirmada',
      'El receptor confirmó la recepción de tu conduce.',
      '/transporte/mis-conduces');
  end if;

  return sgc.conduce_fase(p_salida_id);
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.entregar_conduce(p_salida_id uuid, p_items jsonb, p_receptor text, p_firma_url text, p_foto_url text, p_notas text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_item jsonb;
  v_pendiente boolean;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotencia: un reenvío de quien ya entregó pasa en silencio.
  if v_salida.estado in ('entregado', 'entregado_incompleto') then
    if v_salida.entregado_por = auth.uid() then return v_salida.estado; end if;
    raise exception 'Este conduce ya fue entregado.';
  end if;
  if v_salida.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota')
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No eres el conductor asignado a este conduce.';
  end if;

  -- AU1/AS2 — no se puede ENTREGAR sin la firma del despachante (transitar sí).
  -- Misma regla que conduce_marcar_entregado; cierra la brecha que dejó llegar el
  -- conduce de Xaviel a "entregado" sin la firma de Papo.
  if sgc.conduce_firma_despachante_pendiente(p_salida_id) then
    raise exception 'Falta la firma del despachante. No puedes marcar la entrega hasta que el despachante firme el conduce desde su sesión.'
      using errcode = 'DR456';
  end if;

  -- AH7 — foto de evidencia OBLIGATORIA en toda confirmación de entrega.
  if nullif(trim(coalesce(p_foto_url,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la entrega.';
  end if;
  -- AH6 — firma del receptor obligatoria, salvo entrega dejada pendiente/remota
  -- (receptor ausente: la firma del autorizado se aporta luego vía firmar_conduce).
  v_pendiente := (v_salida.firma_pendiente_usuario_id is not null)
                 or coalesce(v_salida.firma_pendiente_almacen, false);
  if nullif(trim(coalesce(p_firma_url,'')),'') is null and not v_pendiente then
    raise exception 'Falta la firma de recepción. Pide la firma o marca la entrega como pendiente (receptor ausente).';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    update sgc.detalle_salidas
    set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and coalesce(cantidad_recibida, cantidad) < cantidad
  ) into v_incompleto;

  update sgc.salidas_inventario set
    estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    entregado_por = auth.uid(),
    entregado_en = now(),
    entrega_receptor = p_receptor,
    entrega_firma_path = p_firma_url,
    entrega_foto_path = p_foto_url,
    recibido_en = now(),
    notas_recepcion = coalesce(p_notas, notas_recepcion)
  where id = p_salida_id;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$function$;

CREATE OR REPLACE FUNCTION sgc.recibir_conduce_app(p_salida_id uuid, p_items jsonb, p_notas text DEFAULT NULL::text, p_foto_path text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_item jsonb;
  v_autorizado boolean;
  v_bodega_obra_id uuid;
  v_entrada_id uuid;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotency: already received (by the app, a chofer, or the web) → succeed.
  if v_salida.estado in ('entregado', 'entregado_incompleto') then
    return v_salida.estado;
  end if;
  if v_salida.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  select
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
    into v_autorizado;
  if not v_autorizado then
    raise exception 'No autorizado para recibir este conduce.';
  end if;

  -- AH7 — foto de evidencia OBLIGATORIA en toda confirmación de recepción.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la recepción.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    update sgc.detalle_salidas
    set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and coalesce(cantidad_recibida, cantidad) < cantidad
  ) into v_incompleto;

  update sgc.salidas_inventario set
    estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    recibido_por = auth.uid(),
    recibido_en = now(),
    notas_recepcion = p_notas,
    foto_path = coalesce(p_foto_path, foto_path)
  where id = p_salida_id;

  -- ── T15 (W8): entrada automática en el almacén de la obra destino ───────────
  if v_salida.proyecto_id is not null then
    select id into v_bodega_obra_id
    from sgc.bodegas
    where proyecto_id = v_salida.proyecto_id
    limit 1;

    if v_bodega_obra_id is not null
       and v_bodega_obra_id <> v_salida.bodega_id
       and not exists (select 1 from sgc.entradas_inventario where salida_id = p_salida_id)
    then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, salida_id
      ) values (
        current_date, v_bodega_obra_id,
        'Recepción de material despachado a la obra',
        p_notas, auth.uid(),
        'recepcion_obra', v_salida.proyecto_id, p_salida_id
      ) returning id into v_entrada_id;

      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
      select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id
        and coalesce(d.cantidad_recibida, d.cantidad) > 0;
    end if;
  end if;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$function$;
