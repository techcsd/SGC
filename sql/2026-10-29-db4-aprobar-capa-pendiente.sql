-- sql/2026-10-29-db4-aprobar-capa-pendiente.sql — Ronda DB (PROMPT-124 F1, DB9)
-- Reporte #e665fd63 (Raykler): el formulario de aprobar sembraba el SOLICITADO (200)
-- aunque 15 ya estaban cubiertos por material llegado a la obra (BV4/CD7), y
-- aprobar_requisicion aceptaba esa cantidad sin tope → se podía despachar/comprar
-- de más. Verificado en F0 (29-oct): la definición dev == prod no menciona
-- requisicion_item_pendiente en el loop.
--
-- Cambio ADITIVO (create or replace, conserva ACL): dentro del loop, la cantidad de
-- cada renglón REAL (item_id) se capa a sgc.requisicion_item_pendiente(item_id).
-- El front (requisicion-items-mapper) ahora siembra el pendiente; este tope es la
-- misma regla en servidor.
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db4-aprobar-capa-pendiente.sql --env dev

CREATE OR REPLACE FUNCTION sgc.aprobar_requisicion(p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid)
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
  v_unidad_cap text; v_factor numeric;
  v_autoaprobada boolean := false;   -- CO4
  v_pend numeric;                    -- DB9
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;
  if not found then raise exception 'Requisición no encontrada.'; end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esta requisición ya fue procesada.'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para aprobar requisiciones.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    -- CO4 — con el permiso explícito, el autor SÍ puede; queda marcada para que
    -- gerencia/dirección lo vea (auditoría), no es un escape silencioso.
    if sgc.puede_autoaprobar_requisicion() then
      v_autoaprobada := true;
    else
      raise exception 'No puedes aprobar tu propia requisición.';
    end if;
  end if;

  select coalesce((select valor from sgc.parametros where clave = 'requisicion_auto_conduce'), 'true') = 'true'
    into v_auto;

  select fase_activa into v_fase from sgc.cuadre_obra where proyecto_id = v_sol.proyecto_id;
  v_has_cuadre := found;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_articulo_id := nullif(v_item->>'articulo_id', '')::uuid;
    v_cant := coalesce((v_item->>'cantidad')::numeric, 0);
    v_item_id := nullif(v_item->>'item_id', '')::uuid;
    if v_item_id is not null and exists (
      select 1 from sgc.solicitud_material_items smi
      where smi.id = v_item_id and coalesce(smi.estado,'pendiente') = 'cancelada'
    ) then continue; end if;
    -- DB9 — capa la cantidad al PENDIENTE real del renglón (solicitado − despachado −
    -- cubierto por material llegado a la obra, CD7/BV4). El formulario ya siembra el
    -- pendiente; este tope cierra la puerta a clientes viejos o payloads manuales
    -- (regla 14: un solo predicado, el de requisicion_item_pendiente). Los renglones
    -- agregados por el aprobador (item_id null) no se capan: no existen en el pedido.
    if v_item_id is not null then
      v_pend := sgc.requisicion_item_pendiente(v_item_id);
      if v_pend is not null and v_cant > v_pend then
        v_cant := v_pend;
      end if;
    end if;
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
      -- CJ7 — recordar en el renglón el artículo con que se despacha (clave para renglones LIBRE).
      if v_item_id is not null then
        update sgc.solicitud_material_items
           set articulo_despacho_id = v_articulo_id
         where id = v_item_id and articulo_despacho_id is null;
      end if;
    else
      v_desp := 0;
    end if;

    v_falt := v_cant - v_desp;

    if v_desp > 0 then
      v_unidad_cap := null; v_factor := 1;
      if v_item_id is not null then
        select smi.unidad_capturada, coalesce(smi.factor_aplicado, 1)
          into v_unidad_cap, v_factor
          from sgc.solicitud_material_items smi where smi.id = v_item_id;
      end if;
      v_despacho := v_despacho || jsonb_build_object(
        'articulo_id', v_articulo_id, 'cantidad', v_desp, 'talla', v_item->>'talla',
        'unidad_capturada', v_unidad_cap, 'factor_aplicado', coalesce(v_factor, 1),
        'origen_item_id', v_item_id);   -- CJ7
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
        'origen_item_id', v_item_id);
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
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto', p_responsable, p_observaciones, auth.uid(), v_despacho, p_responsable_id);
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

  -- CJ7 — marca despachada contando por renglón (función compartida), no por artículo.
  update sgc.solicitud_material_items smi
     set estado = 'despachada'
   where smi.solicitud_id = p_solicitud_id
     and coalesce(smi.estado,'pendiente') = 'pendiente'
     and coalesce(smi.cantidad,0) <= sgc.requisicion_item_despachado(smi.id);

  v_estado := sgc.requisicion_estado_despacho(p_solicitud_id);

  update sgc.solicitudes_material
     set estado = v_estado,
         salida_id = coalesce(v_salida_id, salida_id),
         solicitud_compra_id = coalesce(v_sc_id, solicitud_compra_id),
         bodega_id = p_bodega_id, atendido_por = auth.uid(), atendido_en = now(), updated_at = now(),
         autoaprobada = v_autoaprobada
   where id = p_solicitud_id;

  -- CO4 — aviso a gerencia/dirección cuando el autor se aprobó a sí mismo.
  if v_autoaprobada then
    perform sgc.notificar_modulo('direccion', 'requisicion',
      'Requisición aprobada por su propio autor',
      format('%s aprobó su propia requisición (permiso de autoaprobación).',
        coalesce((select nombre from sgc.usuarios where id = auth.uid()), 'Un usuario')),
      '/inventario/requisiciones?id=' || p_solicitud_id::text, p_solicitud_id, 'solicitud_material');
  end if;

  return jsonb_build_object('salida_id', v_salida_id, 'solicitud_compra_id', v_sc_id,
    'despachado_total', v_desp_total, 'faltante_total', v_falt_total,
    'auto_conduce', v_auto, 'estado', v_estado, 'autoaprobada', v_autoaprobada);
end;
$function$
;
