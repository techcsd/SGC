-- Solo lectura. No aplicar como migración ni ejecutar con un rol de escritura.
-- Lista eventos del outbox (salida_inventario) en error/incierto/bloqueado por
-- falta de existencias en Odoo, con folio, almacén, artículo y cantidades.
-- Pensado para los 24 conduces del 18-nov (#202) y casos parecidos.
--
-- Cómo: en un cliente SQL contra DEV o PROD, como rol de solo lectura (o
-- Tecnología). Revisar con logística antes de reintentar desde
-- Tecnología › Sincronización. No ajustar stock ni reencolar desde aquí.

select
  'CND-' || upper(substr(s.id::text, 1, 8)) as folio,
  b.nombre as almacen,
  b.codigo_odoo,
  a.codigo as articulo_codigo,
  a.nombre as articulo,
  d.cantidad as solicitado,
  e.estado as outbox_estado,
  e.error,
  e.intentos,
  e.creado_en,
  e.actualizado_en,
  e.id as evento_id,
  s.id as salida_id
from sgc.odoo_eventos e
join sgc.salidas_inventario s on s.id::text = e.agregado_id
join sgc.bodegas b on b.id = s.bodega_id
join sgc.detalle_salidas d on d.salida_id = s.id
join sgc.articulos a on a.id = d.articulo_id
where e.agregado_tipo = 'salida_inventario'
  and e.estado in ('error', 'incierto', 'bloqueado')
  and (
    e.error ilike '%existencia%'
    or e.error ilike '%existencias%'
    or e.error ilike '%sin_stock%'
    or e.error ilike '%almacén de origen%'
  )
order by b.nombre, a.nombre, e.creado_en;

-- Resumen por almacén y artículo
-- (correr por separado si se prefiere una vista agrupada)
select
  b.nombre as almacen,
  a.codigo as articulo_codigo,
  a.nombre as articulo,
  count(distinct s.id) as conduces,
  sum(d.cantidad) as cantidad_total,
  min(e.creado_en) as primero,
  max(e.actualizado_en) as ultimo
from sgc.odoo_eventos e
join sgc.salidas_inventario s on s.id::text = e.agregado_id
join sgc.bodegas b on b.id = s.bodega_id
join sgc.detalle_salidas d on d.salida_id = s.id
join sgc.articulos a on a.id = d.articulo_id
where e.agregado_tipo = 'salida_inventario'
  and e.estado in ('error', 'incierto', 'bloqueado')
  and (
    e.error ilike '%existencia%'
    or e.error ilike '%existencias%'
    or e.error ilike '%sin_stock%'
    or e.error ilike '%almacén de origen%'
  )
group by b.nombre, a.codigo, a.nombre
order by count(distinct s.id) desc, b.nombre, a.nombre;
