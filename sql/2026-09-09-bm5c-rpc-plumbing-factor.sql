-- ============================================================================
-- PROMPT-40 (BM) FASE 4 — BM5c: plumbing de los RPCs para persistir el factor de
-- empaque capturado.  Ronda 09/09/2026.  Aditivo, retrocompatible, idempotente.
--
-- Igual que `talla` (2026-07-15): `unidad_capturada` y `factor_aplicado` viajan
-- DENTRO de cada item jsonb → NO cambian las firmas.  `cantidad` sigue llegando en
-- unidad BASE (la UI multiplica antes de enviar), así el stock/kardex/costeo no se
-- tocan; sólo se guarda con qué unidad/factor se capturó, para mostrar "2 atados
-- (240 PZA)".  factor ausente → 1 (comportamiento idéntico al de hoy).
--
-- Cuerpos copiados VERBATIM de prod (pg_get_functiondef, 09-sep); el ÚNICO cambio
-- es el `insert into detalle_salidas / solicitud_material_items` (+2 columnas).
-- `create or replace` preserva los grants existentes.
--
-- aprobar_requisicion (carry-through del factor al despacho) queda para cuando la
-- aprobación muestre el desglose: el renglón de la requisición YA guarda el factor;
-- el despacho lo hereda en una pasada posterior.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-09-bm5c-rpc-plumbing-factor.sql
-- ============================================================================

begin;

-- ── Salida directa (web) ─────────────────────────────────────────────────────
create or replace function sgc.registrar_salida_inventario(
  p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text,
  p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb)
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
begin
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

  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, observaciones, creado_por)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, p_responsable, p_observaciones, p_creado_por)
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla, unidad_capturada, factor_aplicado)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;

-- ── Salida (app móvil, offline-idempotente) ─────────────────────────────────
create or replace function sgc.registrar_salida_app(
  p_id uuid, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_items jsonb,
  p_foto_path text default null, p_capturado_en timestamp with time zone default now())
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_item          jsonb;
  v_stock         numeric;
  v_nombre        text;
  v_bodega_nombre text;
  v_solicitado    numeric;
  v_faltantes     text[] := array[]::text[];
  v_faltantes_j   jsonb  := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.salidas_inventario where id = p_id) then
    return p_id;
  end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad, 0)
      into v_nombre, v_stock
    from sgc.articulos a
    left join sgc.stock_por_bodega s
      on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;

    v_nombre := coalesce(v_nombre, 'artículo desconocido');
    v_stock := coalesce(v_stock, 0);

    if v_stock < v_solicitado then
      v_faltantes := v_faltantes || format(
        'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega_nombre,
        trim(to_char(v_stock, 'FM999999990.###')),
        trim(to_char(v_solicitado, 'FM999999990.###'))
      );
      v_faltantes_j := v_faltantes_j || jsonb_build_object(
        'articulo_id', v_item->>'articulo_id',
        'articulo', v_nombre,
        'bodega', v_bodega_nombre,
        'disponible', v_stock,
        'solicitado', v_solicitado
      );
    end if;
  end loop;

  if array_length(v_faltantes, 1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n')
      using hint = 'sin_existencias',
            detail = jsonb_build_object('faltantes', v_faltantes_j)::text;
  end if;

  insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, creado_por, foto_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_proyecto_id, coalesce(p_motivo, 'Consumo en obra'), auth.uid(), p_foto_path);

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla, unidad_capturada, factor_aplicado)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$function$;

-- ── Requisición (crear, web) ─────────────────────────────────────────────────
create or replace function sgc.crear_solicitud_material(
  p_proyecto_id uuid, p_solicitante_id uuid, p_urgencia text, p_notas text, p_items jsonb)
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
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, talla, unidad_capturada, factor_aplicado)
  select v_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion',
         (i->>'cantidad')::numeric, i->>'unidad', nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;
  return v_solicitud_id;
end;
$function$;

-- ── Requisición (crear, app móvil) ───────────────────────────────────────────
create or replace function sgc.crear_solicitud_app(
  p_id uuid, p_proyecto_id uuid, p_urgencia text, p_notas text, p_items jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (
    sgc.tiene_modulo('compras')
    or sgc.tiene_modulo('obra')
    or sgc.puede_operar_submodulo('obra.plan_dia')
  ) then
    raise exception 'Tu usuario no tiene el módulo Solicitudes ni acceso a Obra';
  end if;
  if exists (select 1 from sgc.solicitudes_material where id = p_id) then
    return p_id;
  end if;
  if not sgc.requisicion_permitida(p_proyecto_id, auth.uid()) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;

  insert into sgc.solicitudes_material (id, proyecto_id, solicitante_id, estado, urgencia, notas)
  values (p_id, p_proyecto_id, auth.uid(), 'pendiente', coalesce(p_urgencia, 'normal'), p_notas);
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad, unidad_capturada, factor_aplicado)
  select p_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion', (i->>'cantidad')::numeric, i->>'unidad',
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1)
  from jsonb_array_elements(p_items) as i;
  return p_id;
end;
$function$;

commit;
