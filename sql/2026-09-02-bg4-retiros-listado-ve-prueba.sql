-- =============================================================================
-- PROMPT-29 (BG4 fix) — retiros_listado muestra sus propios retiros de PRUEBA
-- a los usuarios de prueba (convención AZ3: un usuario es_prueba ve la data de
-- prueba). Ronda 19/08-03/09/2026. Aditivo, retrocompatible.
--
-- Antes: `((not es_prueba) or is_admin())` ocultaba TODO es_prueba a no-admins,
-- así que un tester (es_prueba) no veía sus propios retiros de prueba en "Mis
-- retiros" — aunque retiro_detalle sí los devolvía (inconsistencia). Ahora un
-- usuario es_prueba también los ve (como el admin), igual que en el resto de la app.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-02-bg4-retiros-listado-ve-prueba.sql
-- =============================================================================
begin;

create or replace function sgc.retiros_listado(
  p_estado text default null, p_solo_mios boolean default false, p_limite int default 300
) returns table (
  id uuid, folio bigint, proyecto_id uuid, proyecto_nombre text,
  solicitante_nombre text, motivo_dano text, motivo_dano_detalle text, estado text,
  disposicion text, items_count int, fotos_count int, es_prueba boolean, created_at timestamptz
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select r.id, r.folio, r.proyecto_id, p.nombre,
         u.nombre, r.motivo_dano, r.motivo_dano_detalle, r.estado,
         r.disposicion,
         (select count(*)::int from sgc.retiro_material_items it where it.retiro_id=r.id),
         (select count(*)::int from sgc.retiro_material_fotos f where f.retiro_id=r.id),
         r.es_prueba, r.created_at
  from sgc.retiros_material r
  left join sgc.proyectos p on p.id = r.proyecto_id
  left join sgc.usuarios  u on u.id = r.solicitante_id
  where (
      r.solicitante_id = auth.uid() or sgc.is_admin()
      or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras')
      or sgc.tiene_modulo('direccion') or sgc.es_responsable_de_proyecto(r.proyecto_id)
    )
    and (
      (not r.es_prueba) or sgc.is_admin()
      or exists (select 1 from sgc.usuarios u2 where u2.id = auth.uid() and u2.es_prueba)
    )
    and (p_estado is null or r.estado = p_estado)
    and (not p_solo_mios or r.solicitante_id = auth.uid())
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limite,300), 1000));
$$;
grant execute on function sgc.retiros_listado(text, boolean, int) to authenticated, service_role;

commit;
