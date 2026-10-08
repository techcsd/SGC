-- 2026-10-08-cj5-conduce-externo-requisicion.sql
-- CJ5 — Asignar un conduce externo a una requisición: listar los emitidos sin
-- requisición y vincular uno. (El alta de uno NUEVO prellenado usa crear_conduce_externo
-- + p_origen_requisicion_id + p_salida_id, ya existentes.) Aditivo.
--   node scripts/apply-migration.mjs sql/2026-10-08-cj5-conduce-externo-requisicion.sql --env dev

-- ── Conduces externos emitidos SIN requisición (primero los de la obra) ──────────
create or replace function sgc.conduces_externos_sin_vincular(p_proyecto_id uuid default null)
returns table(
  id uuid, numero bigint, estado text, destino text, origen text,
  transporta text, created_at timestamptz, es_de_la_obra boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select ce.id, ce.numero, ce.estado,
         coalesce(ce.destino, dp.nombre)::text as destino,
         coalesce(ce.origen, op.nombre)::text  as origen,
         coalesce(pt.nombre, ce.transporta_texto)::text as transporta,
         ce.created_at,
         (p_proyecto_id is not null and ce.destino_proyecto_id = p_proyecto_id) as es_de_la_obra
  from sgc.conduces_externos ce
  left join sgc.proyectos dp on dp.id = ce.destino_proyecto_id
  left join sgc.proyectos op on op.id = ce.origen_proyecto_id
  left join sgc.proveedores pt on pt.id = ce.transporta_proveedor_id
  where ce.origen_requisicion_id is null
    and ce.anulado_por is null
    and (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.puede_crear_conduce())
  order by es_de_la_obra desc, ce.created_at desc
  limit 100;
$function$;
grant execute on function sgc.conduces_externos_sin_vincular(uuid) to authenticated;

-- ── Vincular un conduce externo a una requisición ────────────────────────────────
create or replace function sgc.requisicion_vincular_conduce_externo(
  p_solicitud_id uuid, p_conduce_externo_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_ce sgc.conduces_externos%rowtype;
  v_sol sgc.solicitudes_material%rowtype;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.puede_crear_conduce()) then
    raise exception 'No tienes permiso para asignar conduces a esta requisición.';
  end if;
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id;
  if not found then raise exception 'Requisición no encontrada.'; end if;
  select * into v_ce from sgc.conduces_externos where id = p_conduce_externo_id;
  if not found then raise exception 'Conduce externo no encontrado.'; end if;
  if v_ce.anulado_por is not null then raise exception 'Ese conduce externo está anulado.'; end if;

  -- Idempotente: si ya está vinculado a esta requisición, no hace nada.
  if v_ce.origen_requisicion_id = p_solicitud_id then return; end if;
  if v_ce.origen_requisicion_id is not null then
    raise exception 'Ese conduce externo ya está vinculado a otra requisición.';
  end if;

  update sgc.conduces_externos set origen_requisicion_id = p_solicitud_id, updated_at = now()
    where id = p_conduce_externo_id;

  -- Si el conduce arrastra una salida, cuélgale también la requisición (para el avance).
  if v_ce.salida_id is not null then
    update sgc.salidas_inventario set origen_requisicion_id = p_solicitud_id
      where id = v_ce.salida_id and origen_requisicion_id is null;
  end if;

  -- Recalcula el estado de despacho de la requisición (como despacho_marcar).
  update sgc.solicitudes_material sm
    set estado = sgc.requisicion_estado_despacho(p_solicitud_id), updated_at = now()
    where sm.id = p_solicitud_id and sm.estado in ('por_despachar','parcial');
end;
$function$;
grant execute on function sgc.requisicion_vincular_conduce_externo(uuid, uuid) to authenticated;
