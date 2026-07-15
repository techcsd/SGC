-- ============================================================================
-- Actualización 3 — V14 (talla): EPP con "INDICAR TALLA" exige talla al pedir.
-- ----------------------------------------------------------------------------
-- La talla viaja DENTRO de cada item jsonb (item->>'talla'), así NO cambian las
-- firmas de los RPCs (retrocompatible). Se persiste en el detalle del movimiento:
--   detalle_salidas.talla y solicitud_material_items.talla.
-- El campo es obligatorio en la UI cuando el artículo tiene requiere_talla=true.
-- Aditivo/retrocompatible/idempotente.
-- ============================================================================

set search_path = sgc, public;

alter table sgc.detalle_salidas        add column if not exists talla text;
alter table sgc.solicitud_material_items add column if not exists talla text;

-- ── Salida directa (web) ─────────────────────────────────────────────────────
create or replace function sgc.registrar_salida_inventario(
  p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text,
  p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb
)
returns uuid
language plpgsql
as $function$
declare
  v_salida_id       uuid;
  v_item            jsonb;
  v_stock_actual    numeric;
  v_articulo_nombre varchar;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    select s.cantidad, a.nombre into v_stock_actual, v_articulo_nombre
    from sgc.stock_por_bodega s
    join sgc.articulos a on a.id = s.articulo_id
    where s.articulo_id = (v_item->>'articulo_id')::uuid
      and s.bodega_id   = p_bodega_id;

    if v_stock_actual is null then v_stock_actual := 0; end if;
    if v_stock_actual < (v_item->>'cantidad')::numeric then
      raise exception 'Stock insuficiente para "%". Disponible: %, Solicitado: %',
        v_articulo_nombre, v_stock_actual, (v_item->>'cantidad')::numeric;
    end if;
  end loop;

  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, observaciones, creado_por)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, p_responsable, p_observaciones, p_creado_por)
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', '')
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;

-- ── Salida (app móvil, offline-idempotente) ─────────────────────────────────
create or replace function sgc.registrar_salida_app(
  p_id uuid, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_items jsonb,
  p_foto_path text default null, p_capturado_en timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_item   jsonb;
  v_stock  numeric;
  v_nombre text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.salidas_inventario where id = p_id) then
    return p_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select s.cantidad, a.nombre into v_stock, v_nombre
    from sgc.stock_por_bodega s join sgc.articulos a on a.id = s.articulo_id
    where s.articulo_id = (v_item->>'articulo_id')::uuid and s.bodega_id = p_bodega_id;
    v_stock := coalesce(v_stock, 0);
    if v_stock < (v_item->>'cantidad')::numeric then
      raise exception 'Stock insuficiente para "%". Disponible: %, Solicitado: %',
        coalesce(v_nombre, 'material'), v_stock, (v_item->>'cantidad')::numeric;
    end if;
  end loop;

  insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, creado_por, foto_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_proyecto_id, coalesce(p_motivo, 'Consumo en obra'), auth.uid(), p_foto_path);

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', '')
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$function$;

-- ── Requisición (crear) ─────────────────────────────────────────────────────
create or replace function sgc.crear_solicitud_material(
  p_proyecto_id uuid, p_solicitante_id uuid, p_urgencia text, p_notas text, p_items jsonb
)
returns uuid
language plpgsql
as $function$
declare v_solicitud_id uuid;
begin
  if not sgc.requisicion_permitida(p_proyecto_id, p_solicitante_id) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;
  insert into sgc.solicitudes_material (proyecto_id, solicitante_id, urgencia, notas)
  values (p_proyecto_id, p_solicitante_id, p_urgencia, p_notas)
  returning id into v_solicitud_id;
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, talla)
  select v_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion',
         (i->>'cantidad')::numeric, i->>'unidad', nullif(i->>'talla', '')
  from jsonb_array_elements(p_items) as i;
  return v_solicitud_id;
end;
$function$;

-- ── Aprobar requisición: la talla del item aprobado viaja al despacho ────────
create or replace function sgc.aprobar_requisicion(
  p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
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
      v_despacho   := v_despacho || jsonb_build_object(
        'articulo_id', v_articulo_id, 'cantidad', v_desp, 'talla', v_item->>'talla');
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

    if v_has_cuadre and v_articulo_id is not null and v_desp > 0 then
      insert into sgc.cuadre_consumo (proyecto_id, articulo_id, fase, cantidad, requisicion_id)
      values (v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
      perform sgc.evaluar_alerta_cuadre(v_sol.proyecto_id, v_articulo_id, v_fase, v_desp, p_solicitud_id);
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
$function$;
