-- BV4 (visibilidad + control) — AT11: la cobertura implícita SE VE. requisicion_cobertura()
-- lista, por requisición, qué movimiento cubrió qué renglón, con vía/score/¿revisar? Y
-- desvincular_cobertura() permite deshacer un match dudoso (regla 10: acción explícita del
-- gestor). Al desvincular, el pendiente vuelve a subir solo (pendiente es coverage-aware).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv4d-cobertura-ver-desvincular.sql --env dev  →  --env prod
begin;

create or replace function sgc.requisicion_cobertura(p_solicitud_id uuid)
 returns table(
   id uuid, requisicion_item_id uuid, renglon text, movimiento_tipo text,
   movimiento_id uuid, cantidad numeric, via text, score numeric, revisar boolean, created_at timestamptz
 )
 language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select rc.id, rc.requisicion_item_id, coalesce(smi.descripcion,'—') as renglon,
         rc.movimiento_tipo, rc.movimiento_id, rc.cantidad, rc.via, rc.score, rc.revisar, rc.created_at
  from sgc.requisicion_cubierta_por rc
  join sgc.solicitud_material_items smi on smi.id = rc.requisicion_item_id
  where smi.solicitud_id = p_solicitud_id
  order by rc.revisar desc, rc.created_at desc;
$function$;

grant execute on function sgc.requisicion_cobertura(uuid) to authenticated, service_role;

create or replace function sgc.desvincular_cobertura(p_id uuid)
 returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  -- Gate: solo quien gestiona inventario/flota-elevado/admin puede deshacer un match.
  if not (sgc.is_admin() or sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then
    raise exception 'Sin permiso para desvincular cobertura de requisición'
      using errcode = '42501';
  end if;
  delete from sgc.requisicion_cubierta_por where id = p_id;
  if not found then
    raise exception 'La cobertura indicada ya no existe' using errcode = '22023';
  end if;
end $function$;

grant execute on function sgc.desvincular_cobertura(uuid) to authenticated, service_role;

commit;
