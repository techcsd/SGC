-- ============================================================================
-- PROMPT-9 · FASE 7 — AA23: costeo de material por obra (QW1–QW4)
-- Fecha: 2026-07-29. Aditivo / idempotente. Ver docs/PROPUESTA-REQUISICIONES-COSTOS.md.
--
-- Aprobado: arrancar con los quick wins.
--   QW1 — valuación de inventario (costo promedio móvil ponderado) en articulos.
--   QW2 — estampar el costo unitario en la salida al despachar (detalle_salidas).
--   QW3 — costo de material REAL por obra = Σ(cantidad × costo_unit) de salidas.
--   QW4 — reporte/RPC de costo por obra (desglose por artículo) para la web.
--
-- No toca el flujo de aprobación de requisiciones. Los movimientos de prueba no
-- afectan la valuación (se respeta el aislamiento es_prueba de AA21).
-- ============================================================================

-- ── Columnas aditivas ────────────────────────────────────────────────────────
alter table sgc.articulos       add column if not exists costo_promedio numeric;
alter table sgc.detalle_salidas add column if not exists costo_unit    numeric;

comment on column sgc.articulos.costo_promedio is
  'AA23 QW1 — costo promedio móvil ponderado (RD$), recalculado en cada entrada real con precio_unit.';
comment on column sgc.detalle_salidas.costo_unit is
  'AA23 QW2 — costo unitario congelado al despachar (del costo_promedio del artículo).';

-- ── QW1 — entrada: recalcula el costo promedio móvil (real + con precio) ──────
create or replace function sgc.trg_detalle_entradas_stock()
returns trigger language plpgsql as $function$
declare
  v_bodega_id uuid; v_prueba boolean;
  v_stock_before numeric; v_cost_before numeric;
begin
  if tg_op = 'INSERT' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = new.entrada_id;
    if not v_prueba then
      -- QW1 — promedio móvil: (stock·costo + cant·precio) / (stock + cant), ANTES de sumar stock.
      if new.precio_unit is not null and new.precio_unit >= 0 then
        select coalesce(sum(cantidad), 0) into v_stock_before
          from sgc.stock_por_bodega where articulo_id = new.articulo_id;
        select coalesce(costo_promedio, 0) into v_cost_before
          from sgc.articulos where id = new.articulo_id;
        if (v_stock_before + new.cantidad) > 0 then
          update sgc.articulos
             set costo_promedio = round((v_stock_before * v_cost_before + new.cantidad * new.precio_unit)
                                        / (v_stock_before + new.cantidad), 4)
           where id = new.articulo_id;
        end if;
      end if;
      perform sgc.adjust_stock(new.articulo_id, v_bodega_id, new.cantidad);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = old.entrada_id;
    if not v_prueba then perform sgc.adjust_stock(old.articulo_id, v_bodega_id, -old.cantidad); end if;
    return old;
  elsif tg_op = 'UPDATE' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = old.entrada_id;
    if not v_prueba then perform sgc.adjust_stock(old.articulo_id, v_bodega_id, -old.cantidad); end if;
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = new.entrada_id;
    if not v_prueba then perform sgc.adjust_stock(new.articulo_id, v_bodega_id, new.cantidad); end if;
    return new;
  end if;
  return null;
end;
$function$;

-- ── QW2 — salida: estampa costo_unit al insertar el detalle (todas las vías) ──
create or replace function sgc.tg_detalle_salidas_costo()
returns trigger language plpgsql as $function$
begin
  if new.costo_unit is null then
    select coalesce(costo_promedio, precio_estimado) into new.costo_unit
      from sgc.articulos where id = new.articulo_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists detalle_salidas_costo_trigger on sgc.detalle_salidas;
create trigger detalle_salidas_costo_trigger
  before insert on sgc.detalle_salidas
  for each row execute function sgc.tg_detalle_salidas_costo();

-- ── Backfill (una vez) ───────────────────────────────────────────────────────
-- QW1: costo_promedio inicial = promedio ponderado histórico de entradas reales.
update sgc.articulos a
   set costo_promedio = sub.avg
from (
  select de.articulo_id, sum(de.cantidad * de.precio_unit) / nullif(sum(de.cantidad), 0) as avg
  from sgc.detalle_entradas de
  join sgc.entradas_inventario e on e.id = de.entrada_id
  where not coalesce(e.es_prueba, false) and de.precio_unit is not null
  group by de.articulo_id
) sub
where a.id = sub.articulo_id and a.costo_promedio is null;

-- QW2: estampar costo_unit en salidas existentes (best-effort, con el costo actual).
update sgc.detalle_salidas ds
   set costo_unit = coalesce(a.costo_promedio, a.precio_estimado)
from sgc.articulos a
where ds.articulo_id = a.id and ds.costo_unit is null;

-- ── QW3 — costo de material real por obra (vista) ─────────────────────────────
create or replace view sgc.v_costo_material_obra
with (security_invoker = true) as
  select sa.proyecto_id,
         sum(ds.cantidad * coalesce(ds.costo_unit, 0)) as costo_material,
         count(distinct sa.id) as n_salidas
  from sgc.detalle_salidas ds
  join sgc.salidas_inventario sa on sa.id = ds.salida_id
  where sa.proyecto_id is not null and not coalesce(sa.es_prueba, false)
  group by sa.proyecto_id;

-- ── QW4 — reporte de costo por obra (desglose por artículo) ───────────────────
create or replace function sgc.costo_material_obra(p_proyecto_id uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = sgc, public as $$
declare v_result jsonb;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('direccion')) then
    raise exception 'Sin permiso para ver costos de obra' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', coalesce(sum(t.costo), 0),
    'por_articulo', coalesce(jsonb_agg(jsonb_build_object(
        'articulo_id', t.articulo_id, 'nombre', t.nombre, 'unidad', t.unidad,
        'cantidad', t.cantidad, 'costo_unit_prom', t.costo_unit_prom, 'costo', t.costo)
        order by t.costo desc), '[]'::jsonb)
  ) into v_result
  from (
    select ds.articulo_id, a.nombre, a.unidad,
           sum(ds.cantidad) as cantidad,
           round(sum(ds.cantidad * coalesce(ds.costo_unit,0)) / nullif(sum(ds.cantidad),0), 2) as costo_unit_prom,
           sum(ds.cantidad * coalesce(ds.costo_unit,0)) as costo
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario sa on sa.id = ds.salida_id
    left join sgc.articulos a on a.id = ds.articulo_id
    where sa.proyecto_id = p_proyecto_id
      and not coalesce(sa.es_prueba, false)
      and (p_desde is null or sa.fecha >= p_desde)
      and (p_hasta is null or sa.fecha <= p_hasta)
    group by ds.articulo_id, a.nombre, a.unidad
  ) t;
  return v_result;
end;
$$;
grant execute on function sgc.costo_material_obra(uuid, date, date) to authenticated, service_role;
