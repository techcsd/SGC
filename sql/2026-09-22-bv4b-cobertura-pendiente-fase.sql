-- BV4 (capa 2/2) — La cobertura implícita AHORA CUENTA: los renglones pendientes de una
-- requisición se reducen por lo despachado explícito + lo cubierto por movimientos que
-- matchearon (requisicion_cubierta_por). Cuando el pendiente llega a 0, la FASE derivada
-- pasa sola a 'completada' — SIN tocar el estado real (transición segura, reversible al
-- desvincular). Extiende la fase para que parcial/por_despachar también cierren al llegar a 0.
-- No hay recursión: vincular_movimiento_requisiciones lee el pendiente UNA vez (snapshot en
-- _pend) y luego inserta cobertura; no vuelve a leer.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv4b-cobertura-pendiente-fase.sql --env dev  →  --env prod
begin;

create or replace function sgc.requisicion_pendiente_items(p_solicitud_id uuid)
 returns table(item_id uuid, articulo_id uuid, solicitado numeric, despachado numeric, pendiente numeric, estado text)
 language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  with despachos as (
    select ds.articulo_id, sum(coalesce(ds.cantidad,0)) as cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    where (s.origen_requisicion_id = p_solicitud_id
           or s.id in (select ce.salida_id from sgc.conduces_externos ce
                       where ce.origen_requisicion_id = p_solicitud_id and ce.salida_id is not null))
      and coalesce(s.anulado_por is null, true)
    group by ds.articulo_id
  ),
  -- BV4 — cobertura implícita: material llegado por movimientos NO ligados a esta
  -- requisición pero que matchea sus renglones (motor vincular_movimiento_requisiciones).
  cobertura as (
    select rc.requisicion_item_id, sum(coalesce(rc.cantidad,0)) as cant
    from sgc.requisicion_cubierta_por rc
    join sgc.solicitud_material_items smi on smi.id = rc.requisicion_item_id
    where smi.solicitud_id = p_solicitud_id
    group by rc.requisicion_item_id
  )
  select smi.id, smi.articulo_id,
         coalesce(smi.cantidad,0) as solicitado,
         coalesce(d.cant,0) + coalesce(c.cant,0) as despachado,
         case
           when coalesce(smi.estado,'pendiente') = 'cancelada' then 0
           -- ¿el faltante de esta línea ya se envió a compra? → no queda por despachar.
           when exists (select 1 from sgc.solicitud_compra_items sci
                        join sgc.solicitudes_compra sc on sc.id = sci.solicitud_id
                        where sc.origen_requisicion_id = p_solicitud_id
                          and sci.origen_item_id = smi.id) then 0
           else greatest(coalesce(smi.cantidad,0) - coalesce(d.cant,0) - coalesce(c.cant,0), 0)
         end as pendiente,
         coalesce(smi.estado,'pendiente') as estado
  from sgc.solicitud_material_items smi
  left join despachos d on d.articulo_id is not distinct from smi.articulo_id
  left join cobertura c on c.requisicion_item_id = smi.id
  where smi.solicitud_id = p_solicitud_id;
$function$;

create or replace function sgc.requisicion_fase(p_id uuid)
 returns text language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  -- Estados reales → fase de UI. Cualquier estado de cumplimiento (aprobada/parcial/
  -- por_despachar) cierra a 'completada' en cuanto no quedan renglones pendientes
  -- (incluye la cobertura implícita BV4). rechazada/cancelada→rechazada; los estados de
  -- cierre explícito→completada; el resto (sin aprobar)→pendiente.
  select case
    when s.estado in ('rechazada', 'cancelada') then 'rechazada'
    when s.estado in ('completada', 'entregada', 'cerrada') then 'completada'
    when s.estado in ('aprobada', 'parcial', 'por_despachar') then
      case when exists (select 1 from sgc.requisicion_pendiente_items(s.id) pi where pi.pendiente > 0)
           then 'en_proceso' else 'completada' end
    else 'pendiente'
  end
  from sgc.solicitudes_material s where s.id = p_id
$function$;

commit;
