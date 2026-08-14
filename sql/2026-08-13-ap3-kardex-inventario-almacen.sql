-- =============================================================================
-- PROMPT-11 FASE 2 (AP2 + AP3) — Inventario por almacén + Kardex por artículo.
-- SGC padre. El sketch de Xaviel manda: tabla Mov.|Origen|Destino|Fecha|Entrega|
-- Recibe|Transporte|Conduce + timeline del stock + link al conduce (fotos/firmas).
--
-- Un movimiento afecta un almacén X por su bodega_id:
--   · entrada  con bodega_id = X → +cantidad
--   · salida   con bodega_id = X → −cantidad
--   · conteo/ajuste (conteos_inventario) → ±(contada − antes)   [reconcilia]
-- (los traslados suman en el destino como su propia ENTRADA al confirmarse.)
-- Esto casa exactamente con stock_por_bodega.cantidad = apertura + Σ movimientos.
--
-- El timeline parte de la APERTURA EFECTIVA (AP5) como base — NO como movimiento.
-- Sólo movimientos NO-prueba entran en el saldo (stock_por_bodega ignora prueba).
-- =============================================================================

begin;

-- ── Gate de visibilidad de inventario por almacén ────────────────────────────
create or replace function sgc.puede_ver_inventario_bodega(p_bodega_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras')
      or sgc.tiene_modulo('proyectos')  or sgc.tiene_modulo('obra')
      or exists (
        select 1 from sgc.bodegas b
        where b.id = p_bodega_id and (
          exists (select 1 from sgc.proyectos p
                   where p.id = b.proyecto_id and p.responsable_id = auth.uid())
          or exists (select 1 from sgc.proyecto_responsables pr
                      where pr.proyecto_id = b.proyecto_id
                        and pr.usuario_id = auth.uid()
                        and coalesce(pr.activo, true))
        )
      );
$$;
grant execute on function sgc.puede_ver_inventario_bodega(uuid) to authenticated;
comment on function sgc.puede_ver_inventario_bodega(uuid) is
  'AP2 — verdad de acceso al inventario de un almacén: admin, módulo inventario/compras/proyectos/obra, o responsable de la obra de ese almacén.';

-- ── AP2 — Inventario de un almacén (lista de artículos con existencias) ───────
create or replace function sgc.inventario_almacen(
  p_bodega_id     uuid,
  p_incluir_cero  boolean default true,
  p_busqueda      text default null
) returns table (
  articulo_id uuid, codigo text, nombre text, categoria text, unidad text,
  propiedad text, cantidad numeric, apertura numeric, es_cero boolean, es_prueba boolean
)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_ver_inventario_bodega(p_bodega_id) then
    raise exception 'No tienes acceso al inventario de este almacén.' using errcode = '42501';
  end if;
  return query
  select a.id, a.codigo::text, a.nombre::text, c.nombre::text as categoria,
         a.unidad::text, a.propiedad::text,
         coalesce(s.cantidad, 0) as cantidad,
         sgc.apertura_efectiva(a.id, p_bodega_id) as apertura,
         coalesce(s.cantidad, 0) <= 0 as es_cero,
         coalesce(a.es_prueba, false) as es_prueba
  from sgc.articulos a
  left join sgc.categorias_inventario c on c.id = a.categoria_id
  left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
  left join sgc.stock_apertura   ap on ap.articulo_id = a.id and ap.bodega_id = p_bodega_id
  where (s.articulo_id is not null or ap.articulo_id is not null)
    and (not coalesce(a.es_prueba, false) or sgc.is_admin())
    and (p_incluir_cero or coalesce(s.cantidad, 0) > 0)
    and (p_busqueda is null or p_busqueda = ''
         or a.nombre ilike '%' || p_busqueda || '%'
         or a.codigo ilike '%' || p_busqueda || '%')
  order by a.nombre;
end;
$$;
grant execute on function sgc.inventario_almacen(uuid, boolean, text) to authenticated;
comment on function sgc.inventario_almacen(uuid, boolean, text) is
  'AP2 — inventario de un almacén: artículos con existencia actual (stock_por_bodega) + apertura efectiva (AP5). p_incluir_cero=false oculta ceros (para selectores); en la vista sí se ven con 0.';

-- ── AP3 — Kardex por artículo×almacén (histórico + serie del stock) ──────────
create or replace function sgc.kardex_articulo(
  p_articulo_id   uuid,
  p_bodega_id     uuid,
  p_tipo          text default null,   -- 'entrada' | 'salida' | 'ajuste' | null
  p_transportista uuid default null,   -- conductor_id
  p_entrega       uuid default null,   -- usuario que entrega/despacha
  p_desde         date default null,
  p_hasta         date default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_res jsonb;
begin
  if not sgc.puede_ver_inventario_bodega(p_bodega_id) then
    raise exception 'No tienes acceso al inventario de este almacén.' using errcode = '42501';
  end if;

  with apertura as (
    select sgc.apertura_efectiva(p_articulo_id, p_bodega_id) as base
  ),
  raw as (
    -- SALIDAS (origen = esta bodega) → negativo
    select
      'salida'::text as mov,
      s.id as referencia_id, 'salida'::text as referencia_tipo, s.id as conduce_id,
      s.fecha as fecha, coalesce(s.created_at, s.fecha::timestamptz) as ts,
      d.cantidad as cantidad, (-d.cantidad) as delta,
      bo.nombre::text as origen,
      coalesce(pr.nombre, dbo.nombre)::text as destino,
      coalesce(s.despachante_nombre, ude.nombre, ue.nombre, uc.nombre, s.responsable)::text as entrega_nombre,
      coalesce(ur.nombre, s.entrega_receptor, s.firma_pendiente_nombre)::text as recibe_nombre,
      co.nombre::text as transporte_nombre,
      s.conductor_id as conductor_id,
      coalesce(s.despachante_usuario_id, s.entregado_por, s.creado_por) as entrega_uid,
      (select coalesce(jsonb_agg(jsonb_build_object(
                'rol', sf.rol, 'nombre', sf.nombre,
                'firma_path', sf.firma_path, 'firmado_en', sf.firmado_en) order by sf.firmado_en), '[]'::jsonb)
         from sgc.salida_firmas sf where sf.salida_id = s.id) as firmas,
      (select coalesce(jsonb_agg(p), '[]'::jsonb) from (
          select s.foto_path as p where s.foto_path is not null
          union all select s.entrega_foto_path where s.entrega_foto_path is not null
          union all select s.recepcion_foto_path where s.recepcion_foto_path is not null
          union all select s.carga_foto_path where s.carga_foto_path is not null
        ) ff) as fotos
    from sgc.detalle_salidas d
    join sgc.salidas_inventario s on s.id = d.salida_id
    left join sgc.bodegas bo  on bo.id  = s.bodega_id
    left join sgc.proyectos pr on pr.id = s.proyecto_id
    left join sgc.bodegas dbo on dbo.id = s.destino_almacen_id
    left join sgc.conductores co on co.id = s.conductor_id
    left join sgc.usuarios ude on ude.id = s.despachante_usuario_id
    left join sgc.usuarios ue  on ue.id  = s.entregado_por
    left join sgc.usuarios uc  on uc.id  = s.creado_por
    left join sgc.usuarios ur  on ur.id  = s.recibido_por
    where d.articulo_id = p_articulo_id and s.bodega_id = p_bodega_id
      and not coalesce(s.es_prueba, false)

    union all
    -- ENTRADAS (destino = esta bodega) → positivo
    select
      'entrada'::text, e.id, 'entrada'::text, e.salida_id,
      e.fecha, coalesce(e.created_at, e.fecha::timestamptz),
      de.cantidad, de.cantidad,
      coalesce(prov.nombre, opr.nombre, e.referencia)::text as origen,
      bo.nombre::text as destino,
      coalesce(ureg.nombre, uce.nombre)::text as entrega_nombre,
      uce.nombre::text as recibe_nombre,
      null::text as transporte_nombre,
      null::uuid as conductor_id,
      coalesce(e.registrado_por, e.creado_por) as entrega_uid,
      case when e.firma_path is not null
           then jsonb_build_array(jsonb_build_object('rol', 'entrada', 'firma_path', e.firma_path))
           else '[]'::jsonb end,
      (select coalesce(jsonb_agg(p), '[]'::jsonb) from (
          select e.foto_path as p where e.foto_path is not null
          union all select e.foto_mercancia_path where e.foto_mercancia_path is not null
        ) ef)
    from sgc.detalle_entradas de
    join sgc.entradas_inventario e on e.id = de.entrada_id
    left join sgc.bodegas bo on bo.id = e.bodega_id
    left join sgc.proveedores prov on prov.id = e.proveedor_id
    left join sgc.proyectos opr on opr.id = e.origen_proyecto_id
    left join sgc.usuarios ureg on ureg.id = e.registrado_por
    left join sgc.usuarios uce  on uce.id  = e.creado_por
    where de.articulo_id = p_articulo_id and e.bodega_id = p_bodega_id
      and not coalesce(e.es_prueba, false)

    union all
    -- CONTEOS / AJUSTES (conteos_inventario) → ±(contada − antes)
    select
      'ajuste'::text, c.id, 'ajuste'::text, null::uuid,
      c.created_at::date, c.created_at,
      abs(ci.cantidad_contada - ci.cantidad_antes),
      (ci.cantidad_contada - ci.cantidad_antes),
      null::text as origen, bo.nombre::text as destino,
      ucc.nombre::text as entrega_nombre,
      null::text as recibe_nombre,
      null::text as transporte_nombre, null::uuid as conductor_id,
      c.creado_por as entrega_uid,
      '[]'::jsonb, '[]'::jsonb
    from sgc.conteo_items ci
    join sgc.conteos_inventario c on c.id = ci.conteo_id
    left join sgc.bodegas bo on bo.id = c.bodega_id
    left join sgc.usuarios ucc on ucc.id = c.creado_por
    where ci.articulo_id = p_articulo_id and c.bodega_id = p_bodega_id
      and not coalesce(c.es_prueba, false)
      and ci.cantidad_contada <> ci.cantidad_antes
  ),
  ordered as (
    select r.*,
      (select base from apertura)
        + sum(r.delta) over (order by r.ts, r.referencia_id
                             rows between unbounded preceding and current row) as saldo
    from raw r
  )
  select jsonb_build_object(
    'apertura', (select base from apertura),
    'saldo_actual', coalesce(
        (select saldo from ordered order by ts desc, referencia_id desc limit 1),
        (select base from apertura)),
    'serie', (select coalesce(jsonb_agg(
                jsonb_build_object('ts', ts, 'saldo', saldo) order by ts, referencia_id), '[]'::jsonb)
              from ordered),
    'movimientos', (
      select coalesce(jsonb_agg(to_jsonb(m) order by m.ts desc, m.referencia_id desc), '[]'::jsonb)
      from (
        select o.mov, o.referencia_id, o.referencia_tipo, o.conduce_id,
               case when o.conduce_id is not null
                    then 'CND-' || upper(substr(o.conduce_id::text, 1, 8)) end as conduce_numero,
               o.fecha, o.ts, o.cantidad, o.delta, o.saldo, o.origen, o.destino,
               o.entrega_nombre, o.recibe_nombre, o.transporte_nombre, o.conductor_id,
               o.firmas, o.fotos
        from ordered o
        where (p_tipo is null or o.mov = p_tipo)
          and (p_transportista is null or o.conductor_id = p_transportista)
          and (p_entrega is null or o.entrega_uid = p_entrega)
          and (p_desde is null or o.fecha >= p_desde)
          and (p_hasta is null or o.fecha <= p_hasta)
      ) m
    )
  ) into v_res;

  return v_res;
end;
$$;
grant execute on function sgc.kardex_articulo(uuid, uuid, text, uuid, uuid, date, date) to authenticated;
comment on function sgc.kardex_articulo(uuid, uuid, text, uuid, uuid, date, date) is
  'AP3 — kardex de un artículo en un almacén: movimientos (mov/origen/destino/fecha/entrega/recibe/transporte/conduce/cantidad/saldo/firmas/fotos) + serie del stock (apertura efectiva + Σ movimientos) para el timeline. Filtros: tipo, transportista, quien entrega, rango de fechas. Sólo movimientos no-prueba. El saldo es acumulado real; los filtros sólo recortan la lista, no la serie.';

commit;
