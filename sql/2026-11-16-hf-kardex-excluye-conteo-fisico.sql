-- HF 16-nov-2026 — Hotfix kardex: el conteo físico (BL4) se contaba DOS veces.
-- Reporte Raykler (soporte addfd93e): "Al ajustar el conteo no se actualiza".
-- stock_movimientos_sigma excluye tipo='conteo_fisico' (rebasa la apertura), pero
-- kardex_articulo lo sumaba como movimiento -> saldo_actual/serie = stock + delta.
-- Solo cambia kardex_articulo (+1 filtro). Aditiva, idempotente (create or replace).
begin;
CREATE OR REPLACE FUNCTION sgc.kardex_articulo(p_articulo_id uuid, p_bodega_id uuid, p_tipo text DEFAULT NULL::text, p_transportista uuid DEFAULT NULL::uuid, p_entrega uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
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
      and coalesce(c.tipo,'') <> 'conteo_fisico'  -- HF: BL4 rebasa apertura; no es movimiento (alinea con stock_movimientos_sigma)
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
$function$
;
grant execute on function sgc.kardex_articulo(uuid,uuid,text,uuid,uuid,date,date) to authenticated, service_role;

commit;
