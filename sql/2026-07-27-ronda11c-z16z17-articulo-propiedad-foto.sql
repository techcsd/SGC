-- ============================================================================
-- RONDA 11c · Z16 + Z17 — Artículos: propiedad (CSD/alquilado) y foto
-- ----------------------------------------------------------------------------
-- Z16 — `articulos.propiedad` (propio_csd | alquilado, default propio_csd). La
--        requisición y los listados agrupan/etiquetan CSD vs Alquilados. Backfill
--        pendiente del jefe (todo queda como propio_csd por defecto; hay una lista
--        admin para marcarlos rápido).
-- Z17 — `articulos.imagen_url` YA existe (dormida); esta ronda la cablea la web.
--        Las fotos viven en el bucket `inventario` bajo `articulo/{id}/...` y se
--        sirven firmadas con SignedUrlCache (W9). No requiere DDL extra.
-- La columna `propiedad` e `imagen_url` viajan a la app vía `select *` sobre
-- articulos (RLS existente), así que el contrato queda expuesto sin más cambios.
-- Aditivo, idempotente.
-- ============================================================================

set search_path = sgc, public;

alter table sgc.articulos
  add column if not exists propiedad text not null default 'propio_csd';
do $$ begin
  alter table sgc.articulos add constraint articulos_propiedad_chk
    check (propiedad in ('propio_csd','alquilado'));
exception when duplicate_object then null; end $$;

comment on column sgc.articulos.propiedad is
  'Z16 — propio_csd (default) | alquilado. Requisición y listados agrupan/etiquetan por esto.';

-- mis_conduces_hoy — exponer propiedad + imagen del artículo (contrato app, aditivo).
create or replace function sgc.mis_conduces_hoy()
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'fecha', s.fecha, 'estado', s.estado,
    'destino', p.nombre, 'bodega', b.nombre,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'detalle_id', d.id, 'articulo', a.nombre, 'unidad', a.unidad,
        'cantidad', d.cantidad, 'propiedad', a.propiedad, 'imagen_url', a.imagen_url)), '[]'::jsonb)
      from sgc.detalle_salidas d
      join sgc.articulos a on a.id = d.articulo_id
      where d.salida_id = s.id
    )
  ) order by s.fecha desc), '[]'::jsonb)
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas b on b.id = s.bodega_id
  where s.estado = 'despachado'
    and s.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid())
    and ((not coalesce(s.es_prueba, false)) or sgc.is_admin());
$function$;
grant execute on function sgc.mis_conduces_hoy() to authenticated, service_role;
