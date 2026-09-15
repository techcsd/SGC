-- ============================================================================
-- PROMPT-48 (BP) — BP4 (cont.): Origen "desde bitácora" en el listado de Retiros.
-- Ronda 14/09/2026. Aditivo, idempotente, retrocompatible.
--
-- Un retiro puede nacer de un daño reportado en el parte diario (bitacora_danos.
-- retiro_id → retiros_material.id). El listado no exponía ese origen, así que en
-- /inventario/retiros no se sabía que un retiro vino de una bitácora ni se podía
-- saltar a ella (AT11 — toda data enviada es visualizable; regla 1 — interconexión).
-- Aquí `retiros_listado` devuelve `bitacora_id` (por el enlace inverso) sin tocar
-- filtros, RLS ni el resto de columnas. Como cambia el tipo de retorno de la
-- función table, hay que DROP + CREATE.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp4c-retiro-origen-bitacora.sql
-- ============================================================================
begin;

drop function if exists sgc.retiros_listado(text, boolean, int);

create function sgc.retiros_listado(
  p_estado text default null, p_solo_mios boolean default false, p_limite int default 300
) returns table (
  id uuid, folio bigint, proyecto_id uuid, proyecto_nombre text,
  solicitante_nombre text, motivo_dano text, motivo_dano_detalle text, estado text,
  disposicion text, items_count int, fotos_count int, es_prueba boolean, created_at timestamptz,
  bitacora_id uuid
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select r.id, r.folio, r.proyecto_id, p.nombre,
         u.nombre, r.motivo_dano, r.motivo_dano_detalle, r.estado,
         r.disposicion,
         (select count(*)::int from sgc.retiro_material_items it where it.retiro_id=r.id),
         (select count(*)::int from sgc.retiro_material_fotos f where f.retiro_id=r.id),
         r.es_prueba, r.created_at,
         -- BP4 — origen: bitácora que originó este retiro (enlace inverso), si aplica.
         (select bd.bitacora_id from sgc.bitacora_danos bd where bd.retiro_id = r.id limit 1)
  from sgc.retiros_material r
  left join sgc.proyectos p on p.id = r.proyecto_id
  left join sgc.usuarios  u on u.id = r.solicitante_id
  where (
      r.solicitante_id = auth.uid() or sgc.is_admin()
      or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras')
      or sgc.tiene_modulo('direccion') or sgc.es_responsable_de_proyecto(r.proyecto_id)
    )
    and ((not r.es_prueba) or sgc.is_admin())
    and (p_estado is null or r.estado = p_estado)
    and (not p_solo_mios or r.solicitante_id = auth.uid())
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limite,300), 1000));
$$;
grant execute on function sgc.retiros_listado(text, boolean, int) to authenticated, service_role;

commit;
