-- BM5d — el empaque (atado/paquete) viaja del renglón de requisición al despacho
-- y se hace VISIBLE en el conduce (AT11: dato enviado = dato visualizable).
--
-- Contexto: bm5/bm5b/bm5c dejaron `detalle_salidas.unidad_capturada`/`factor_aplicado`
-- (cantidad SIEMPRE en unidad base) y `registrar_salida_inventario` ya los persiste,
-- pero (1) `aprobar_requisicion` no los arrastraba del renglón al despacho, y
-- (2) `conduce_detalle_app` no los devolvía → la data se escribía pero no se veía.
-- Aditivo y retrocompatible: la cantidad no cambia; unidad_capturada/factor_aplicado
-- son solo traza. Artículos sin factor → unidad_capturada=null, factor=1 (idéntico a antes).
-- CREATE OR REPLACE preserva grants; firmas intactas.

-- ── 1) aprobar_requisicion: arrastra el empaque del renglón al despacho ──────────
CREATE OR REPLACE FUNCTION sgc.aprobar_requisicion(p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_sol sgc.solicitudes_material%rowtype;
  v_item jsonb; v_articulo_id uuid; v_cant numeric; v_stock numeric; v_desp numeric; v_falt numeric;
  v_nombre text; v_codigo text; v_desc text; v_talla text; v_unidad text; v_item_id uuid;
  v_despacho jsonb := '[]'::jsonb; v_compra jsonb := '[]'::jsonb;
  v_falt_total numeric := 0; v_desp_total numeric := 0;
  v_salida_id uuid; v_sc_id uuid; v_fase int; v_has_cuadre boolean := false;
  v_auto boolean;
  v_estado text;
  v_unidad_cap text; v_factor numeric;   -- BM5d — empaque del renglón (traza al despacho)
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

  select coalesce((select valor from sgc.parametros where clave = 'requisicion_auto_conduce'), 'true') = 'true'
    into v_auto;

  select fase_activa into v_fase from sgc.cuadre_obra where proyecto_id = v_sol.proyecto_id;
  v_has_cuadre := found;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_articulo_id := nullif(v_item->>'articulo_id', '')::uuid;
    v_cant := coalesce((v_item->>'cantidad')::numeric, 0);
    v_item_id := nullif(v_item->>'item_id', '')::uuid;   -- BJ4 — línea de origen (si viene)
    -- (7) Nunca despachar/comprar una línea cancelada, aunque el cliente la mande.
    if v_item_id is not null and exists (
      select 1 from sgc.solicitud_material_items smi
      where smi.id = v_item_id and coalesce(smi.estado,'pendiente') = 'cancelada'
    ) then continue; end if;
    if v_cant <= 0 then continue; end if;
    v_desc := coalesce(v_item->>'descripcion', '');
    v_talla := nullif(v_item->>'talla', '');
    v_unidad := nullif(v_item->>'unidad', '');
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
      -- BM5d — arrastra el empaque del renglón (cómo se pidió: "2 atados") al despacho.
      -- La cantidad SIGUE en unidad base; unidad_capturada/factor_aplicado son solo traza.
      v_unidad_cap := null; v_factor := 1;
      if v_item_id is not null then
        select smi.unidad_capturada, coalesce(smi.factor_aplicado, 1)
          into v_unidad_cap, v_factor
          from sgc.solicitud_material_items smi where smi.id = v_item_id;
      end if;
      v_despacho := v_despacho || jsonb_build_object(
        'articulo_id', v_articulo_id, 'cantidad', v_desp, 'talla', v_item->>'talla',
        'unidad_capturada', v_unidad_cap, 'factor_aplicado', coalesce(v_factor, 1));
      v_desp_total := v_desp_total + v_desp;
    end if;
    if v_falt > 0 then
      v_compra := v_compra || jsonb_build_object(
        'descripcion',
          (case when v_codigo is not null then '[' || v_codigo || '] ' || v_desc else v_desc end)
          || case when v_talla is not null then ' (Talla ' || v_talla || ')' else '' end,
        'cantidad', v_falt, 'proveedor_sugerido', null,
        'articulo_id', v_articulo_id,
        'unidad', v_unidad,
        'origen_item_id', v_item_id);   -- BJ4/BH7 — traza inversa a la línea
      v_falt_total := v_falt_total + v_falt;
    end if;

    if v_auto and v_has_cuadre and v_articulo_id is not null and v_desp > 0 then
      insert into sgc.cuadre_consumo (proyecto_id, articulo_id, fase, cantidad, requisicion_id)
      values (v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
      perform sgc.evaluar_alerta_cuadre(v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
    end if;
  end loop;

  if v_auto and jsonb_array_length(v_despacho) > 0 then
    v_salida_id := sgc.registrar_salida_inventario(
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto', p_responsable, p_observaciones, auth.uid(), v_despacho);
    if v_salida_id is not null then
      update sgc.salidas_inventario set origen_requisicion_id = p_solicitud_id where id = v_salida_id;
    end if;
  end if;

  if jsonb_array_length(v_compra) > 0 then
    insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, estado, notas, origen_requisicion_id)
    values (v_sol.proyecto_id, v_sol.solicitante_id, 'pendiente',
            'Generada automáticamente por el faltante de la requisición al aprobar.', p_solicitud_id)
    returning id into v_sc_id;
    insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, articulo_id, unidad, origen_item_id)
    select v_sc_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido',
           nullif(i->>'articulo_id','')::uuid, nullif(i->>'unidad',''), nullif(i->>'origen_item_id','')::uuid
    from jsonb_array_elements(v_compra) as i;
  end if;

  -- Marca como 'despachada' las líneas totalmente servidas (para el UI por línea).
  update sgc.solicitud_material_items smi
     set estado = 'despachada'
   where smi.solicitud_id = p_solicitud_id
     and coalesce(smi.estado,'pendiente') = 'pendiente'
     and coalesce(smi.cantidad,0) <= coalesce((
         select sum(ds.cantidad) from sgc.detalle_salidas ds
         join sgc.salidas_inventario s on s.id = ds.salida_id
         where s.origen_requisicion_id = p_solicitud_id
           and ds.articulo_id is not distinct from smi.articulo_id
           and coalesce(s.anulado_por is null, true)), 0);

  -- (1) Estado por AVANCE real (no por los p_items de este approval).
  v_estado := sgc.requisicion_estado_despacho(p_solicitud_id);

  update sgc.solicitudes_material
     set estado = v_estado,
         salida_id = coalesce(v_salida_id, salida_id),
         solicitud_compra_id = coalesce(v_sc_id, solicitud_compra_id),
         bodega_id = p_bodega_id, atendido_por = auth.uid(), atendido_en = now(), updated_at = now()
   where id = p_solicitud_id;

  return jsonb_build_object('salida_id', v_salida_id, 'solicitud_compra_id', v_sc_id,
    'despachado_total', v_desp_total, 'faltante_total', v_falt_total,
    'auto_conduce', v_auto, 'estado', v_estado);
end;
$function$;

-- ── 2) conduce_detalle_app: devuelve el empaque por renglón (para verlo en la app) ──
CREATE OR REPLACE FUNCTION sgc.conduce_detalle_app(p_salida_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_out jsonb;
  v_puede boolean;
  v_fase text;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  v_puede := sgc.is_admin()
    or v_s.creado_por = auth.uid()
    or v_s.entregado_por = auth.uid()
    or v_s.recibido_por = auth.uid()
    or v_s.despachante_usuario_id = auth.uid()
    or exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = auth.uid())
    or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_puede then
    raise exception 'No autorizado para ver este conduce.';
  end if;

  v_fase := sgc.conduce_fase(v_s.id);

  select jsonb_build_object(
    'id', v_s.id,
    'numero', 'CND-' || upper(left(v_s.id::text, 8)),
    'fecha', v_s.fecha,
    'created_at', v_s.created_at,
    'estado', v_s.estado,
    'estado_label', sgc.label_estado_salida(v_s.estado),
    'fase', v_fase,
    'fase_label', sgc.label_fase_conduce(v_fase),
    'motivo', v_s.motivo,
    'motivo_label', sgc.label_motivo_salida(v_s.motivo),
    'responsable', v_s.responsable,
    'observaciones', v_s.observaciones,
    'proyecto_id', v_s.proyecto_id,
    'proyecto', (select nombre from sgc.proyectos where id = v_s.proyecto_id),
    'bodega_id', v_s.bodega_id,
    'bodega', (select nombre from sgc.bodegas where id = v_s.bodega_id),
    'destino_almacen_id', v_s.destino_almacen_id,
    'destino_almacen', (select nombre from sgc.bodegas where id = v_s.destino_almacen_id),
    'conductor_id', v_s.conductor_id,
    'conductor', (select u.nombre from sgc.conductores c
                    left join sgc.usuarios u on u.id = c.usuario_id
                  where c.id = v_s.conductor_id),
    'despachante', coalesce(
        nullif(v_s.despachante_nombre,''),
        (select nombre from sgc.usuarios  where id = v_s.despachante_usuario_id),
        (select nombre from sgc.empleados where id = v_s.despachante_empleado_id)),
    'despachante_usuario_id', v_s.despachante_usuario_id,
    'despachante_empleado_id', v_s.despachante_empleado_id,
    'carga_foto_path', v_s.carga_foto_path,
    'firma_despachante_pendiente', sgc.conduce_firma_despachante_pendiente(v_s.id),
    'creado_por', v_s.creado_por,
    'creado_por_nombre', (select nombre from sgc.usuarios where id = v_s.creado_por),
    'entregado_por', v_s.entregado_por,
    'entregado_por_nombre', (select nombre from sgc.usuarios where id = v_s.entregado_por),
    'entregado_en', v_s.entregado_en,
    'entrega_foto_path', v_s.entrega_foto_path,
    'entrega_receptor', v_s.entrega_receptor,
    'entrega_firma_path', v_s.entrega_firma_path,
    'firma_path', v_s.firma_path,
    'firma_pendiente_nombre', v_s.firma_pendiente_nombre,
    'recibido_por', v_s.recibido_por,
    'recibido_por_nombre', (select nombre from sgc.usuarios where id = v_s.recibido_por),
    'recibido_en', v_s.recibido_en,
    'recepcion_foto_path', v_s.recepcion_foto_path,
    'notas_recepcion', v_s.notas_recepcion,
    'ruta_id', v_s.ruta_id,
    'es_prueba', coalesce(v_s.es_prueba, false),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'detalle_id', d.id,
                'articulo_id', d.articulo_id,
                'articulo', a.nombre,
                'codigo', a.codigo,
                'unidad', a.unidad,
                'propiedad', a.propiedad,
                'cantidad', d.cantidad,
                'unidad_capturada', d.unidad_capturada,   -- BM5d
                'factor_aplicado', d.factor_aplicado,     -- BM5d
                'cantidad_recibida', d.cantidad_recibida)
                order by a.nombre)
              from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
              where d.salida_id = v_s.id), '[]'::jsonb),
    -- AU4 — items libres (material no catalogado) que viajan en el conduce.
    'items_libres', coalesce((select jsonb_agg(jsonb_build_object(
                'id', il.id,
                'nombre', il.nombre,
                'cantidad', il.cantidad,
                'unidad', il.unidad,
                'articulo_vinculado_id', il.articulo_vinculado_id)
                order by il.created_at)
              from sgc.salida_items_libres il where il.salida_id = v_s.id), '[]'::jsonb),
    'firmas', coalesce((select jsonb_agg(jsonb_build_object(
                'rol', sf.rol, 'nombre', sf.nombre, 'firma_path', sf.firma_path, 'firmado_en', sf.firmado_en))
               from sgc.salida_firmas sf where sf.salida_id = v_s.id), '[]'::jsonb),
    'transferencias', coalesce((select jsonb_agg(jsonb_build_object(
                'id', t.id, 'estado', t.estado, 'fase_al_transferir', t.fase_al_transferir,
                'de', (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.de_conductor_id),
                'a',  (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.a_conductor_id),
                'ofrecida_en', t.ofrecida_en, 'resuelta_en', t.resuelta_en)
                order by t.ofrecida_en)
               from sgc.conduce_transferencias t where t.salida_id = v_s.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;
