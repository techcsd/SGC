-- ============================================================================
-- P12 — Entrada "Devolución de obra": origen + traspaso desde el almacén de la
--       obra (20/07/2026)
-- ----------------------------------------------------------------------------
-- Migración ADITIVA y RETROCOMPATIBLE.
--
--   1. Columnas de origen en sgc.entradas_inventario (origen_tipo,
--      origen_proyecto_id, salida_id) — nullable para filas viejas.
--   2. RPC atómico sgc.registrar_devolucion_obra(...): en UNA transacción, si la
--      obra de origen tiene almacén y se pide descontar, registra la SALIDA de
--      esa bodega + la ENTRADA en la bodega destino, enlazadas por salida_id;
--      si no aplica, entrada simple con la obra como referencia.
--   3. Extensión de sgc.registrar_entrada_inventario para persistir el origen en
--      entradas normales (compra/sobrante/otro) — parámetros nuevos con DEFAULT.
--   4. Vista sgc.v_movimientos_inventario: columnas de origen añadidas al final.
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Columnas de origen en entradas ───────────────────────────────────────
alter table sgc.entradas_inventario
  add column if not exists origen_tipo        text,
  add column if not exists origen_proyecto_id uuid references sgc.proyectos(id),
  add column if not exists salida_id          uuid references sgc.salidas_inventario(id);

do $$ begin
  alter table sgc.entradas_inventario
    add constraint entradas_inventario_origen_tipo_chk
    check (origen_tipo is null or origen_tipo in ('compra','devolucion_obra','sobrante','otro'));
exception when duplicate_object then null; end $$;

comment on column sgc.entradas_inventario.origen_tipo is
  'De dónde viene el material: compra | devolucion_obra | sobrante | otro (nullable = filas legacy).';
comment on column sgc.entradas_inventario.origen_proyecto_id is
  'Obra de origen cuando origen_tipo = devolucion_obra.';
comment on column sgc.entradas_inventario.salida_id is
  'Salida enlazada cuando la entrada proviene de un traspaso desde el almacén de una obra.';

create index if not exists idx_entradas_origen_proyecto on sgc.entradas_inventario(origen_proyecto_id);
create index if not exists idx_entradas_salida          on sgc.entradas_inventario(salida_id);

-- ── 2) RPC atómico: registrar devolución de obra ────────────────────────────
-- SECURITY DEFINER + gate por módulo Inventario (mismos permisos que
-- entradas/salidas). Si p_descontar y la obra tiene almacén: salida de la obra
-- + entrada en destino, enlazadas. Si no: entrada simple con la obra como
-- referencia. Valida stock disponible en la bodega origen (P0001 si no alcanza).
create or replace function sgc.registrar_devolucion_obra(
  p_fecha              date,
  p_bodega_destino_id  uuid,
  p_origen_proyecto_id uuid,
  p_descontar          boolean,
  p_referencia         text,
  p_observaciones      text,
  p_creado_por         uuid,
  p_items              jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid          uuid := auth.uid();
  v_entrada_id   uuid;
  v_salida_id    uuid := null;
  v_bodega_orig  uuid;
  v_bodega_dest_nombre text;
  v_obra_nombre  text;
  v_item         jsonb;
  v_stock        numeric;
  v_nombre       text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;

  if p_bodega_destino_id is null then raise exception 'Falta el almacén destino.'; end if;
  if p_origen_proyecto_id is null then raise exception 'Selecciona la obra de origen.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un artículo.';
  end if;

  select nombre into v_obra_nombre from sgc.proyectos where id = p_origen_proyecto_id;
  if v_obra_nombre is null then raise exception 'Obra de origen no encontrada.'; end if;

  -- ── Traspaso: descontar del almacén de la obra de origen ─────────────────
  if coalesce(p_descontar, false) then
    -- Almacén de la obra (principal primero).
    select id into v_bodega_orig
      from sgc.bodegas
     where proyecto_id = p_origen_proyecto_id and coalesce(activo, true)
     order by coalesce(es_principal, false) desc, created_at asc
     limit 1;

    if v_bodega_orig is null then
      raise exception 'La obra "%" no tiene almacén propio para descontar. Registra la entrada sin descontar.', v_obra_nombre;
    end if;
    if v_bodega_orig = p_bodega_destino_id then
      raise exception 'El almacén de origen y el de destino no pueden ser el mismo.';
    end if;

    -- Validar stock disponible en la bodega de origen.
    for v_item in select * from jsonb_array_elements(p_items) loop
      select s.cantidad, a.nombre into v_stock, v_nombre
      from sgc.stock_por_bodega s join sgc.articulos a on a.id = s.articulo_id
      where s.articulo_id = (v_item->>'articulo_id')::uuid and s.bodega_id = v_bodega_orig;
      v_stock := coalesce(v_stock, 0);
      if v_stock < (v_item->>'cantidad')::numeric then
        raise exception 'Stock insuficiente en el almacén de "%": "%" disponible %, solicitado %.',
          v_obra_nombre, coalesce(v_nombre,'material'), v_stock, (v_item->>'cantidad')::numeric;
      end if;
    end loop;

    select nombre into v_bodega_dest_nombre from sgc.bodegas where id = p_bodega_destino_id;

    -- Salida desde el almacén de la obra (baja stock vía trigger de detalle).
    insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, observaciones, creado_por)
    values (p_fecha, v_bodega_orig, p_origen_proyecto_id,
            format('Traspaso a %s (devolución de obra)', coalesce(v_bodega_dest_nombre,'almacén')),
            p_observaciones, coalesce(p_creado_por, v_uid))
    returning id into v_salida_id;

    insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad)
    select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
    from jsonb_array_elements(p_items) as i;
  end if;

  -- ── Entrada en el almacén destino (sube stock vía trigger de detalle) ────
  insert into sgc.entradas_inventario (
    fecha, bodega_id, referencia, observaciones, creado_por,
    origen_tipo, origen_proyecto_id, salida_id
  ) values (
    p_fecha, p_bodega_destino_id,
    coalesce(nullif(p_referencia,''), format('Devolución de %s', v_obra_nombre)),
    p_observaciones, coalesce(p_creado_por, v_uid),
    'devolucion_obra', p_origen_proyecto_id, v_salida_id
  ) returning id into v_entrada_id;

  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
  select v_entrada_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric,
         nullif(i->>'precio_unit','')::numeric
  from jsonb_array_elements(p_items) as i;

  return v_entrada_id;
end;
$$;
grant execute on function sgc.registrar_devolucion_obra(
  date, uuid, uuid, boolean, text, text, uuid, jsonb
) to authenticated, service_role;

-- ── 3) Extender registrar_entrada_inventario con el origen (aditivo) ─────────
-- Parámetros nuevos con DEFAULT null: las llamadas existentes (8 args) siguen
-- resolviendo a esta función; las entradas normales ahora pueden registrar el
-- origen (compra/sobrante/otro).
create or replace function sgc.registrar_entrada_inventario(
  p_fecha date,
  p_bodega_id uuid,
  p_proveedor_id uuid,
  p_orden_compra_id uuid,
  p_referencia text,
  p_observaciones text,
  p_creado_por uuid,
  p_items jsonb,
  p_origen_tipo text default null,
  p_origen_proyecto_id uuid default null
) returns uuid
language plpgsql
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_entrada_id uuid;
  v_orden_estado text;
begin
  if p_orden_compra_id is not null then
    select estado into v_orden_estado from sgc.ordenes_compra where id = p_orden_compra_id;
    if v_orden_estado is null then
      raise exception 'Orden de compra no encontrada.';
    end if;
    if v_orden_estado not in ('aprobada', 'recibida_parcial') then
      raise exception 'Solo se pueden registrar entradas contra una orden aprobada o parcialmente recibida.';
    end if;
  end if;

  insert into sgc.entradas_inventario (
    fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones, creado_por,
    origen_tipo, origen_proyecto_id
  )
  values (
    p_fecha, p_bodega_id, p_proveedor_id, p_orden_compra_id, p_referencia, p_observaciones, p_creado_por,
    nullif(p_origen_tipo,''), p_origen_proyecto_id
  )
  returning id into v_entrada_id;

  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
  select v_entrada_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'precio_unit', '')::numeric
  from jsonb_array_elements(p_items) as i;

  return v_entrada_id;
end;
$function$;
grant execute on function sgc.registrar_entrada_inventario(
  date, uuid, uuid, uuid, text, text, uuid, jsonb, text, uuid
) to authenticated, service_role;

-- ── 4) Vista de movimientos: columnas de origen (añadidas al final) ─────────
create or replace view sgc.v_movimientos_inventario as
 SELECT s.id AS referencia_id,
    'salida'::text AS tipo,
    s.fecha,
    s.created_at,
    s.bodega_id,
    s.motivo AS concepto,
    s.responsable,
    s.proyecto_id,
    ( SELECT count(*) AS count
           FROM sgc.detalle_salidas d
          WHERE d.salida_id = s.id) AS items,
    s.creado_por,
    NULL::text AS origen_tipo,
    NULL::uuid AS origen_proyecto_id,
    NULL::uuid AS salida_id
   FROM sgc.salidas_inventario s
UNION ALL
 SELECT e.id AS referencia_id,
    'entrada'::text AS tipo,
    e.fecha,
    e.created_at,
    e.bodega_id,
    e.referencia AS concepto,
    NULL::character varying AS responsable,
    NULL::uuid AS proyecto_id,
    ( SELECT count(*) AS count
           FROM sgc.detalle_entradas d
          WHERE d.entrada_id = e.id) AS items,
    e.creado_por,
    e.origen_tipo,
    e.origen_proyecto_id,
    e.salida_id
   FROM sgc.entradas_inventario e;
