-- ============================================================================
-- CD7 (nota #98) — En "Requisición" lo cubierto por material llegado a la obra no se
-- marca ni descuenta en "Avance de despacho".
--
-- Diagnóstico: DOS cálculos de "pendiente" (regla 14). `requisicion_pendiente_items`
-- (BV4b) YA resta la cobertura implícita (requisicion_cubierta_por) → la FASE derivada
-- sabe que está cubierto. Pero `requisicion_avance` (bj4) calcula pendiente = solicitado
-- − despachado SIN restar lo cubierto → la tabla de Avance muestra Pendiente 100 mientras
-- el bloque "Cubierto por material llegado" dice que descuenta. Divergencia.
--
-- Fix (predicado ÚNICO): escalar `sgc.requisicion_item_pendiente(item)` =
-- greatest(solicitado − despachado − cubierto, 0) (con las reglas cancelada / enviado a
-- compra → 0). TODO lo que calcula pendiente lo llama: requisicion_avance,
-- requisicion_pendiente_items (→ fase BV9, bandeja, contadores, avisos, Compa, app).
-- Además ambas tablas exponen `cubierto` para que la UI lo marque. Sin compras
-- automáticas por lo cubierto (eso ya lo decide requisicion_estado_despacho aparte).
--
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd7-requisicion-pendiente.sql --env dev  →  --env prod
-- ============================================================================
begin;

-- ── 1. Escalar ÚNICO: cubierto por ítem ────────────────────────────────────
create or replace function sgc.requisicion_item_cubierto(p_item_id uuid)
returns numeric
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(sum(coalesce(rc.cantidad,0)), 0)
  from sgc.requisicion_cubierta_por rc
  where rc.requisicion_item_id = p_item_id;
$function$;

-- ── 2. Escalar ÚNICO: pendiente por ítem = solicitado − despachado − cubierto ──
create or replace function sgc.requisicion_item_pendiente(p_item_id uuid)
returns numeric
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with it as (
    select smi.id, smi.solicitud_id, smi.articulo_id,
           coalesce(smi.cantidad,0) as cantidad, coalesce(smi.estado,'pendiente') as estado
    from sgc.solicitud_material_items smi where smi.id = p_item_id
  ),
  desp as (
    select coalesce(sum(coalesce(ds.cantidad,0)),0) as cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    join it on ds.articulo_id is not distinct from it.articulo_id
    where (s.origen_requisicion_id = it.solicitud_id
           or s.id in (select ce.salida_id from sgc.conduces_externos ce
                       where ce.origen_requisicion_id = it.solicitud_id and ce.salida_id is not null))
      and coalesce(s.anulado_por is null, true)
  )
  select case
    when it.estado = 'cancelada' then 0
    -- ¿el faltante de esta línea ya se envió a compra? → no queda por despachar.
    when exists (select 1 from sgc.solicitud_compra_items sci
                 join sgc.solicitudes_compra sc on sc.id = sci.solicitud_id
                 where sc.origen_requisicion_id = it.solicitud_id and sci.origen_item_id = it.id) then 0
    else greatest(it.cantidad - (select cant from desp) - sgc.requisicion_item_cubierto(it.id), 0)
  end
  from it;
$function$;

grant execute on function sgc.requisicion_item_cubierto(uuid) to authenticated, service_role;
grant execute on function sgc.requisicion_item_pendiente(uuid) to authenticated, service_role;

-- ── 3. requisicion_pendiente_items → usa el escalar único + expone cubierto ──
drop function if exists sgc.requisicion_pendiente_items(uuid);
create or replace function sgc.requisicion_pendiente_items(p_solicitud_id uuid)
returns table(item_id uuid, articulo_id uuid, solicitado numeric, despachado numeric,
              cubierto numeric, pendiente numeric, estado text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
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
  )
  select smi.id, smi.articulo_id,
         coalesce(smi.cantidad,0)                as solicitado,
         coalesce(d.cant,0)                      as despachado,
         sgc.requisicion_item_cubierto(smi.id)   as cubierto,
         sgc.requisicion_item_pendiente(smi.id)  as pendiente,
         coalesce(smi.estado,'pendiente')        as estado
  from sgc.solicitud_material_items smi
  left join despachos d on d.articulo_id is not distinct from smi.articulo_id
  where smi.solicitud_id = p_solicitud_id;
$function$;
grant execute on function sgc.requisicion_pendiente_items(uuid) to authenticated, service_role;

-- ── 4. requisicion_avance → usa el escalar único + expone cubierto ──────────
drop function if exists sgc.requisicion_avance(uuid);
create or replace function sgc.requisicion_avance(p_solicitud_id uuid)
returns table(
  articulo_id uuid, descripcion text, unidad text, talla text,
  solicitado numeric, despachado numeric, cubierto numeric, pendiente numeric,
  estado text, item_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
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
  )
  select smi.articulo_id,
         coalesce(nullif(btrim(smi.descripcion),''), a.nombre, '—') as descripcion,
         smi.unidad, smi.talla,
         coalesce(smi.cantidad, 0)               as solicitado,
         coalesce(d.cant, 0)                     as despachado,
         sgc.requisicion_item_cubierto(smi.id)   as cubierto,
         sgc.requisicion_item_pendiente(smi.id)  as pendiente,
         coalesce(smi.estado,'pendiente')        as estado,
         smi.id                                  as item_id
  from sgc.solicitud_material_items smi
  left join sgc.articulos a on a.id = smi.articulo_id
  left join despachos d on d.articulo_id is not distinct from smi.articulo_id
  where smi.solicitud_id = p_solicitud_id
  order by descripcion;
$function$;
grant execute on function sgc.requisicion_avance(uuid) to authenticated, service_role;

commit;
