-- ============================================================================
-- A3.1 hook — aprobar_requisicion registra el CONSUMO contra el cuadre de la
-- fase activa (por artículo mapeado). Misma firma (retro-compatible). El motor
-- de alertas (A4) se enchufa justo después de registrar el consumo.
-- ============================================================================
set search_path = sgc, public;

create or replace function sgc.aprobar_requisicion(
  p_solicitud_id  uuid,
  p_bodega_id     uuid,
  p_fecha         date,
  p_responsable   text,
  p_observaciones text,
  p_items         jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_sol         sgc.solicitudes_material%rowtype;
  v_item        jsonb;
  v_articulo_id uuid;
  v_cant        numeric;
  v_stock       numeric;
  v_desp        numeric;
  v_falt        numeric;
  v_nombre      text;
  v_codigo      text;
  v_desc        text;
  v_despacho    jsonb := '[]'::jsonb;
  v_compra      jsonb := '[]'::jsonb;
  v_falt_total  numeric := 0;
  v_desp_total  numeric := 0;
  v_salida_id   uuid;
  v_sc_id       uuid;
  v_fase        int;
  v_has_cuadre  boolean := false;
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

  -- Fase activa del cuadre (si el proyecto tiene cuadre configurado).
  select fase_activa into v_fase from sgc.cuadre_obra where proyecto_id = v_sol.proyecto_id;
  v_has_cuadre := found;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_articulo_id := nullif(v_item->>'articulo_id', '')::uuid;
    v_cant        := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cant <= 0 then continue; end if;
    v_desc   := coalesce(v_item->>'descripcion', '');
    v_nombre := null; v_codigo := null;

    if v_articulo_id is not null then
      select coalesce(s.cantidad, 0), a.nombre, a.codigo
        into v_stock, v_nombre, v_codigo
      from sgc.articulos a
      left join sgc.stock_por_bodega s
        on s.articulo_id = a.id and s.bodega_id = p_bodega_id
      where a.id = v_articulo_id;
      v_stock := coalesce(v_stock, 0);
      v_desp  := least(v_cant, v_stock);
      if v_desc = '' then v_desc := coalesce(v_nombre, ''); end if;
    else
      v_desp := 0;
    end if;

    v_falt := v_cant - v_desp;

    if v_desp > 0 then
      v_despacho   := v_despacho || jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', v_desp);
      v_desp_total := v_desp_total + v_desp;
    end if;
    if v_falt > 0 then
      v_compra := v_compra || jsonb_build_object(
        'descripcion', case when v_codigo is not null then '[' || v_codigo || '] ' || v_desc else v_desc end,
        'cantidad', v_falt,
        'proveedor_sugerido', null
      );
      v_falt_total := v_falt_total + v_falt;
    end if;

    -- A3.1 — registrar consumo contra el cuadre (solo artículos de catálogo).
    if v_has_cuadre and v_articulo_id is not null then
      insert into sgc.cuadre_consumo (proyecto_id, articulo_id, fase, cantidad, requisicion_id)
      values (v_sol.proyecto_id, v_articulo_id, v_fase, v_cant, p_solicitud_id);
      -- A4 (alertas antifraude) se evalúa aquí — ver sgc.evaluar_alerta_cuadre.
      perform sgc.evaluar_alerta_cuadre(v_sol.proyecto_id, v_articulo_id, v_fase, v_cant, p_solicitud_id);
    end if;
  end loop;

  if jsonb_array_length(v_despacho) > 0 then
    v_salida_id := sgc.registrar_salida_inventario(
      p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto',
      p_responsable, p_observaciones, auth.uid(), v_despacho
    );
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
     set estado              = case when v_falt_total > 0 then 'aprobada' else 'entregada' end,
         salida_id           = coalesce(v_salida_id, salida_id),
         solicitud_compra_id = coalesce(v_sc_id, solicitud_compra_id),
         bodega_id           = p_bodega_id,
         atendido_por        = auth.uid(),
         atendido_en         = now(),
         updated_at          = now()
   where id = p_solicitud_id;

  return jsonb_build_object(
    'salida_id',           v_salida_id,
    'solicitud_compra_id', v_sc_id,
    'despachado_total',    v_desp_total,
    'faltante_total',      v_falt_total
  );
end;
$$;

grant execute on function sgc.aprobar_requisicion(uuid, uuid, date, text, text, jsonb)
  to authenticated, service_role;
