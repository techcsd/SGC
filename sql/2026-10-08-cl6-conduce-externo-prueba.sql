-- 2026-10-08-cl6-conduce-externo-prueba.sql — CL6 (reglas 18/19)
--
-- El admin puede marcar un conduce externo como DATO DE PRUEBA (nota #186), igual que
-- AT10 con los conduces normales. Un conduce de prueba NO toca stock real, NO notifica
-- y NO entra en KPIs; al des/marcarlo se revierte/re-aplica el stock que movió (bv6).
--
-- Regla 19 (verificado en vivo prod==dev antes de reemplazar):
--   · crear_conduce_externo       → 19 args (idénticos prod/dev)  → +p_es_prueba (20)
--   · registrar_salida_inventario → 9 args  (idénticos prod/dev)  → +p_es_prueba (10)
--   · marcar_prueba_cascada       → 3 args  (idénticos prod/dev)  → CREATE OR REPLACE
--   · marcar_movimiento_inventario_prueba (ya existe) se REUTILIZA para el stock.
-- Las dos firmas que cambian se DROPEAN en la misma transacción (sin sobrecarga ambigua)
-- y se re-otorgan los mismos grants.
--
--   node scripts/apply-migration.mjs sql/2026-10-08-cl6-conduce-externo-prueba.sql --env dev
--   node scripts/apply-migration.mjs sql/2026-10-08-cl6-conduce-externo-prueba.sql --env prod  (tras OK)

begin;

-- ── 1) registrar_salida_inventario: +p_es_prueba (no valida ni mueve stock real) ──────
drop function if exists sgc.registrar_salida_inventario(date, uuid, uuid, text, character varying, text, uuid, jsonb, uuid);

create or replace function sgc.registrar_salida_inventario(
  p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text,
  p_responsable character varying, p_observaciones text, p_creado_por uuid,
  p_items jsonb, p_responsable_id uuid default null, p_es_prueba boolean default false)
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

  -- CL6 — un movimiento de PRUEBA no valida existencia ni mueve stock real.
  if not coalesce(p_es_prueba, false) then
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
  end if;

  -- es_prueba se fija en la CABECERA antes de insertar el detalle: así el trigger de
  -- stock (trg_detalle_salidas_stock) ve es_prueba=true y NO ajusta existencias.
  -- es_prueba_origen es NOT NULL DEFAULT 'manual' → se deja que lo ponga el default.
  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, responsable_id, observaciones, creado_por, es_prueba)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, v_responsable, p_responsable_id, p_observaciones, p_creado_por,
          coalesce(p_es_prueba, false))
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla, unidad_capturada, factor_aplicado, origen_item_id)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1),
         nullif(i->>'origen_item_id', '')::uuid
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;

grant execute on function sgc.registrar_salida_inventario(date, uuid, uuid, text, character varying, text, uuid, jsonb, uuid, boolean) to authenticated, service_role;

-- ── 2) crear_conduce_externo: +p_es_prueba (solo admin; propaga a salida/entrada) ─────
drop function if exists sgc.crear_conduce_externo(uuid, text, text, text, text, jsonb, text, numeric, numeric, uuid, uuid, text, numeric, numeric, uuid, uuid, text, uuid, uuid);

create or replace function sgc.crear_conduce_externo(
  p_transporta_proveedor_id uuid, p_transporta_texto text, p_placa_foto_path text,
  p_carga_foto_path text default null, p_material_descripcion text default null, p_items jsonb default null,
  p_origen text default null, p_origen_lat numeric default null, p_origen_lng numeric default null,
  p_origen_proyecto_id uuid default null, p_origen_bodega_id uuid default null,
  p_destino text default null, p_destino_lat numeric default null, p_destino_lng numeric default null,
  p_destino_proyecto_id uuid default null, p_destino_bodega_id uuid default null,
  p_emisor_firma_path text default null, p_origen_requisicion_id uuid default null,
  p_salida_id uuid default null, p_es_prueba boolean default false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_prueba boolean;
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

  -- CL6 — solo un admin puede marcar un conduce nuevo como prueba; no se ignora en silencio.
  if coalesce(p_es_prueba, false) and not sgc.is_admin() then
    raise exception 'Solo un administrador puede marcar datos de prueba.';
  end if;
  -- Hereda del usuario de prueba (comportamiento previo) o lo fuerza el admin.
  v_prueba := sgc.usuario_actual_es_prueba() or coalesce(p_es_prueba, false);

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

  -- CJ6 — si viene una salida existente (despacho ya emitido), se ENLAZA (no se crea otra).
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
        coalesce(v_resp,'')::varchar, coalesce(p_material_descripcion,''), auth.uid(), p_items,
        p_es_prueba => v_prueba);
      v_afecta := true;
    elsif p_destino_bodega_id is not null then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, pendiente_confirmacion, items_propuestos, es_prueba)
      values (
        current_date, p_destino_bodega_id, null, null, 'Conduce externo',
        coalesce(p_material_descripcion,''), auth.uid(), 'otro', p_origen_proyecto_id, true, p_items, v_prueba)
      returning id into v_entrada_id;
      v_afecta := true;
    end if;
  end if;

  insert into sgc.conduces_externos (
    transporta_proveedor_id, transporta_texto, placa_foto_path, carga_foto_path,
    material_descripcion, afecta_inventario, salida_id, entrada_id,
    origen, origen_lat, origen_lng, origen_proyecto_id, origen_bodega_id,
    destino, destino_lat, destino_lng, destino_proyecto_id, destino_bodega_id,
    emisor_firma_path, origen_requisicion_id, es_prueba, es_prueba_origen)
  values (
    p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), p_placa_foto_path, p_carga_foto_path,
    nullif(btrim(p_material_descripcion),''), v_afecta, v_salida_id, v_entrada_id,
    nullif(btrim(p_origen),''), p_origen_lat, p_origen_lng, p_origen_proyecto_id, p_origen_bodega_id,
    nullif(btrim(p_destino),''), p_destino_lat, p_destino_lng, p_destino_proyecto_id, p_destino_bodega_id,
    p_emisor_firma_path, p_origen_requisicion_id, v_prueba,
    case when v_prueba then (case when coalesce(p_es_prueba,false) then 'manual' else 'heredado' end) else null end)
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

grant execute on function sgc.crear_conduce_externo(uuid, text, text, text, text, jsonb, text, numeric, numeric, uuid, uuid, text, numeric, numeric, uuid, uuid, text, uuid, uuid, boolean) to authenticated, service_role;

-- ── 2b) marcar_movimiento_inventario_prueba: NO poner NULL en es_prueba_origen ────────
-- Bug pre-existente (prod==dev): es_prueba_origen es NOT NULL DEFAULT 'manual', pero al
-- DESmarcar la función lo ponía = null → 23502 (así, "volver a real" de AT10 también
-- fallaba). Fix: al desmarcar se conserva el valor; al marcar se fija 'manual'.
create or replace function sgc.marcar_movimiento_inventario_prueba(p_tabla text, p_id uuid, p_valor boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'public'
as $function$
declare v_bodega uuid; v_actual boolean; r record;
begin
  if not sgc.is_admin() then raise exception 'Solo un admin puede marcar datos de prueba' using errcode = '42501'; end if;
  if p_tabla = 'entradas_inventario' then
    select bodega_id, coalesce(es_prueba,false) into v_bodega, v_actual from sgc.entradas_inventario where id = p_id;
    if v_bodega is null then raise exception 'Entrada no encontrada'; end if;
    if v_actual = p_valor then return; end if;
    for r in select articulo_id, cantidad from sgc.detalle_entradas where entrada_id = p_id loop
      perform sgc.adjust_stock(r.articulo_id, v_bodega, case when p_valor then -r.cantidad else r.cantidad end);
    end loop;
    update sgc.entradas_inventario
       set es_prueba = p_valor,
           es_prueba_origen = case when p_valor then 'manual' else es_prueba_origen end
     where id = p_id;
  elsif p_tabla = 'salidas_inventario' then
    select bodega_id, coalesce(es_prueba,false) into v_bodega, v_actual from sgc.salidas_inventario where id = p_id;
    if v_bodega is null then raise exception 'Salida no encontrada'; end if;
    if v_actual = p_valor then return; end if;
    for r in select articulo_id, cantidad from sgc.detalle_salidas where salida_id = p_id loop
      perform sgc.adjust_stock(r.articulo_id, v_bodega, case when p_valor then r.cantidad else -r.cantidad end);
    end loop;
    update sgc.salidas_inventario
       set es_prueba = p_valor,
           es_prueba_origen = case when p_valor then 'manual' else es_prueba_origen end
     where id = p_id;
  else
    raise exception 'Tabla no soportada' using errcode = '22023';
  end if;
end $function$;

-- ── 3) marcar_prueba_cascada: soporta conduces_externos (revierte/re-aplica stock) ────
create or replace function sgc.marcar_prueba_cascada(p_tabla text, p_id uuid, p_valor boolean)
 returns integer
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_allowed text[] := array[
    'vehiculos','conductores','bitacoras','checklists_vehiculo','registros_combustible',
    'vehiculo_entregas','mantenimientos','rutas','entradas_inventario','salidas_inventario',
    'vehiculo_accidentes','conductor_multas','vehiculo_danos',
    'proyectos','bodegas','empleados','proveedores','ordenes_compra','articulos',
    'activos_fijos','conteos_inventario','conduces_externos'];
  v_afectados int := 0;
  v_sal uuid; v_ent uuid;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede marcar datos de prueba.'; end if;
  if not (p_tabla = any (v_allowed)) then raise exception 'Tabla no permitida: %', p_tabla; end if;

  -- CL6 — el conduce externo mueve inventario (bv6): su marcado de prueba revierte /
  -- re-aplica el stock de la salida/entrada enlazada (reusa el camino de AT10).
  if p_tabla = 'conduces_externos' then
    select salida_id, entrada_id into v_sal, v_ent from sgc.conduces_externos where id = p_id;
    if v_sal is not null then perform sgc.marcar_movimiento_inventario_prueba('salidas_inventario', v_sal, coalesce(p_valor, false)); end if;
    if v_ent is not null then perform sgc.marcar_movimiento_inventario_prueba('entradas_inventario', v_ent, coalesce(p_valor, false)); end if;
    update sgc.viajes_transporte set es_prueba = coalesce(p_valor, false) where conduce_externo_id = p_id;
    update sgc.conduces_externos
       set es_prueba = coalesce(p_valor, false),
           es_prueba_origen = case when coalesce(p_valor, false) then 'manual' else null end
     where id = p_id;
    return 1;
  end if;

  v_afectados := sgc._cascada_prueba(p_tabla, p_id, coalesce(p_valor,false), true);
  execute format('update sgc.%I set es_prueba = $1, es_prueba_origen = ''manual'' where id = $2', p_tabla)
    using coalesce(p_valor, false), p_id;
  return v_afectados;
end; $function$;

commit;
