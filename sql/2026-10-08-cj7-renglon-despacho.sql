-- 2026-10-08-cj7-renglon-despacho.sql
-- CJ7 — Los renglones LIBRE nunca cuentan como despachados: el artículo elegido al
-- aprobar no se guardaba en el renglón, y todo el avance comparaba por artículo (null).
-- Fix: recordar el artículo del despacho en el renglón (articulo_despacho_id) y de qué
-- renglón sale cada línea del despacho (detalle_salidas.origen_item_id). Una función
-- escalar compartida cuenta primero por origen_item_id; datos viejos por
-- coalesce(articulo_despacho_id, articulo_id). Reescribe sobre la definición VIVA en prod
-- (regla 19, verificada por objeto). Aditivo/retrocompatible.
--   node scripts/apply-migration.mjs sql/2026-10-08-cj7-renglon-despacho.sql --env dev

-- ── Columnas nuevas ──────────────────────────────────────────────────────────────
alter table sgc.solicitud_material_items
  add column if not exists articulo_despacho_id uuid references sgc.articulos(id);
alter table sgc.detalle_salidas
  add column if not exists origen_item_id uuid references sgc.solicitud_material_items(id) on delete set null;
create index if not exists detalle_salidas_origen_item on sgc.detalle_salidas(origen_item_id) where origen_item_id is not null;
create index if not exists smi_articulo_despacho on sgc.solicitud_material_items(articulo_despacho_id) where articulo_despacho_id is not null;

comment on column sgc.solicitud_material_items.articulo_despacho_id is
  'CJ7 — artículo del catálogo con que se despacha este renglón (para renglones LIBRE sin articulo_id).';
comment on column sgc.detalle_salidas.origen_item_id is
  'CJ7 — de qué renglón de la requisición sale esta línea del despacho.';

-- ── Función escalar compartida: cuánto se ha despachado de un renglón ─────────────
-- Cuenta primero por origen_item_id (camino nuevo, exacto); las líneas viejas sin
-- origen_item_id caen al match por coalesce(articulo_despacho_id, articulo_id).
create or replace function sgc.requisicion_item_despachado(p_item_id uuid)
returns numeric
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with it as (
    select smi.id, smi.solicitud_id,
           coalesce(smi.articulo_despacho_id, smi.articulo_id) as art_desp
    from sgc.solicitud_material_items smi where smi.id = p_item_id
  ),
  -- líneas que ya declaran su renglón de origen (exacto)
  por_item as (
    select coalesce(sum(coalesce(ds.cantidad,0)),0) as cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    where ds.origen_item_id = p_item_id
      and coalesce(s.anulado_por is null, true)
  ),
  -- fallback por artículo para datos viejos: SOLO líneas sin origen_item_id,
  -- de salidas enlazadas a esta requisición (directo o por conduce externo).
  por_art as (
    select coalesce(sum(coalesce(ds.cantidad,0)),0) as cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    join it on ds.articulo_id is not distinct from it.art_desp
    where ds.origen_item_id is null
      and it.art_desp is not null
      and (s.origen_requisicion_id = it.solicitud_id
           or s.id in (select ce.salida_id from sgc.conduces_externos ce
                       where ce.origen_requisicion_id = it.solicitud_id and ce.salida_id is not null))
      and coalesce(s.anulado_por is null, true)
  )
  select (select cant from por_item) + (select cant from por_art);
$function$;
grant execute on function sgc.requisicion_item_despachado(uuid) to authenticated, service_role;

-- ── requisicion_item_pendiente (usa la función compartida) ───────────────────────
create or replace function sgc.requisicion_item_pendiente(p_item_id uuid)
returns numeric
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with it as (
    select smi.id, smi.solicitud_id, coalesce(smi.cantidad,0) as cantidad,
           coalesce(smi.estado,'pendiente') as estado
    from sgc.solicitud_material_items smi where smi.id = p_item_id
  )
  select case
    when it.estado = 'cancelada' then 0
    when exists (select 1 from sgc.solicitud_compra_items sci
                 join sgc.solicitudes_compra sc on sc.id = sci.solicitud_id
                 where sc.origen_requisicion_id = it.solicitud_id and sci.origen_item_id = it.id) then 0
    else greatest(it.cantidad - sgc.requisicion_item_despachado(it.id) - sgc.requisicion_item_cubierto(it.id), 0)
  end
  from it;
$function$;
grant execute on function sgc.requisicion_item_pendiente(uuid) to authenticated, service_role;

-- ── requisicion_avance (despachado por renglón, no por artículo) ──────────────────
create or replace function sgc.requisicion_avance(p_solicitud_id uuid)
returns table(articulo_id uuid, descripcion text, unidad text, talla text, solicitado numeric, despachado numeric, cubierto numeric, pendiente numeric, estado text, item_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select smi.articulo_id,
         coalesce(nullif(btrim(smi.descripcion),''), a.nombre, ad.nombre, '—') as descripcion,
         smi.unidad, smi.talla,
         coalesce(smi.cantidad, 0)                 as solicitado,
         sgc.requisicion_item_despachado(smi.id)   as despachado,
         sgc.requisicion_item_cubierto(smi.id)     as cubierto,
         sgc.requisicion_item_pendiente(smi.id)    as pendiente,
         coalesce(smi.estado,'pendiente')          as estado,
         smi.id                                    as item_id
  from sgc.solicitud_material_items smi
  left join sgc.articulos a on a.id = smi.articulo_id
  left join sgc.articulos ad on ad.id = smi.articulo_despacho_id
  where smi.solicitud_id = p_solicitud_id
  order by descripcion;
$function$;
grant execute on function sgc.requisicion_avance(uuid) to authenticated, service_role;

-- ── requisicion_pendiente_items (despachado por renglón) ─────────────────────────
create or replace function sgc.requisicion_pendiente_items(p_solicitud_id uuid)
returns table(item_id uuid, articulo_id uuid, solicitado numeric, despachado numeric, cubierto numeric, pendiente numeric, estado text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select smi.id, smi.articulo_id,
         coalesce(smi.cantidad,0)                  as solicitado,
         sgc.requisicion_item_despachado(smi.id)   as despachado,
         sgc.requisicion_item_cubierto(smi.id)     as cubierto,
         sgc.requisicion_item_pendiente(smi.id)    as pendiente,
         coalesce(smi.estado,'pendiente')          as estado
  from sgc.solicitud_material_items smi
  where smi.solicitud_id = p_solicitud_id;
$function$;
grant execute on function sgc.requisicion_pendiente_items(uuid) to authenticated, service_role;

-- ── registrar_salida_inventario (+ origen_item_id por línea; sigue INVOKER) ───────
create or replace function sgc.registrar_salida_inventario(p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid)
returns uuid
language plpgsql
as $function$
declare
  v_salida_id     uuid;
  v_item          jsonb;
  v_stock_actual  numeric;
  v_nombre        text;
  v_bodega_nombre text;
  v_solicitado    numeric;
  v_faltantes     text[] := array[]::text[];
  v_responsable   text := p_responsable;   -- BR2
begin
  if p_responsable_id is not null then
    select coalesce(nombre, p_responsable) into v_responsable from sgc.usuarios where id = p_responsable_id;
    v_responsable := coalesce(v_responsable, p_responsable);
  end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad, 0)
      into v_nombre, v_stock_actual
    from sgc.articulos a
    left join sgc.stock_por_bodega s
      on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;

    v_nombre := coalesce(v_nombre, 'artículo desconocido');
    v_stock_actual := coalesce(v_stock_actual, 0);

    if v_stock_actual < v_solicitado then
      v_faltantes := v_faltantes || format(
        'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega_nombre,
        trim(to_char(v_stock_actual, 'FM999999990.###')),
        trim(to_char(v_solicitado,  'FM999999990.###'))
      );
    end if;
  end loop;

  if array_length(v_faltantes, 1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n');
  end if;

  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, responsable_id, observaciones, creado_por)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, v_responsable, p_responsable_id, p_observaciones, p_creado_por)
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla, unidad_capturada, factor_aplicado, origen_item_id)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1),
         nullif(i->>'origen_item_id', '')::uuid
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;

-- ── aprobar_requisicion (guarda articulo_despacho_id + origen_item_id; marca por renglón) ──
create or replace function sgc.aprobar_requisicion(p_solicitud_id uuid, p_bodega_id uuid, p_fecha date, p_responsable text, p_observaciones text, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
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
    v_item_id := nullif(v_item->>'item_id', '')::uuid;
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
         bodega_id = p_bodega_id, atendido_por = auth.uid(), atendido_en = now(), updated_at = now()
   where id = p_solicitud_id;

  return jsonb_build_object('salida_id', v_salida_id, 'solicitud_compra_id', v_sc_id,
    'despachado_total', v_desp_total, 'faltante_total', v_falt_total,
    'auto_conduce', v_auto, 'estado', v_estado);
end;
$function$;
grant execute on function sgc.aprobar_requisicion(uuid, uuid, date, text, text, jsonb, uuid) to authenticated, service_role;
