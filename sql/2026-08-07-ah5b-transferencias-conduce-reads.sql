-- =============================================================================
-- PROMPT-10 FASE 2 (AH5) — lecturas para la app de transferencia de conduces.
-- Complementa 2026-08-07-ah4-ah5 (que dejó ofrecer/aceptar/rechazar). Aditivo.
--   • mis_transferencias_conduce()  → ofertas ABIERTAS dirigidas a MÍ (inbox del
--     receptor) con un resumen del conduce y quién ofrece.
--   • transferencias_de_conduce(id) → historial completo de transferencias de un
--     conduce (para el detalle/trazabilidad). Visibilidad ya la garantiza la RLS
--     de conduce_transferencias (partes/flota/admin) — estos RPCs SECURITY DEFINER
--     resuelven nombres/resúmenes pasando la RLS de proyectos/conductores.
-- =============================================================================

begin;

create or replace function sgc.mis_transferencias_conduce()
returns table (
  id uuid, salida_id uuid, estado text, ofrecida_en timestamptz,
  de_conductor_id uuid, de_nombre text, notas text,
  conduce_fecha date, conduce_obra text, conduce_bodega text,
  conduce_estado text, items_count integer
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select t.id, t.salida_id, t.estado, t.ofrecida_en,
         t.de_conductor_id, ud.nombre as de_nombre, t.notas,
         s.fecha, p.nombre as conduce_obra, b.nombre as conduce_bodega,
         s.estado as conduce_estado,
         (select count(*)::int from sgc.detalle_salidas d where d.salida_id = s.id) as items_count
  from sgc.conduce_transferencias t
  join sgc.salidas_inventario s on s.id = t.salida_id
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas b on b.id = s.bodega_id
  left join sgc.conductores dc on dc.id = t.de_conductor_id
  left join sgc.usuarios ud on ud.id = dc.usuario_id
  where t.estado = 'ofrecida'
    and t.a_conductor_id in (select sgc.mis_conductor_ids())
    and (not coalesce(t.es_prueba,false) or sgc.is_admin())
  order by t.ofrecida_en desc;
$function$;
grant execute on function sgc.mis_transferencias_conduce() to authenticated;

create or replace function sgc.transferencias_de_conduce(p_salida_id uuid)
returns table (
  id uuid, estado text, ofrecida_en timestamptz, resuelta_en timestamptz,
  de_conductor_id uuid, de_nombre text, a_conductor_id uuid, a_nombre text, notas text
)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select t.id, t.estado, t.ofrecida_en, t.resuelta_en,
         t.de_conductor_id, ud.nombre as de_nombre,
         t.a_conductor_id,  ua.nombre as a_nombre, t.notas
  from sgc.conduce_transferencias t
  left join sgc.conductores dc on dc.id = t.de_conductor_id
  left join sgc.usuarios ud on ud.id = dc.usuario_id
  left join sgc.conductores ac on ac.id = t.a_conductor_id
  left join sgc.usuarios ua on ua.id = ac.usuario_id
  where t.salida_id = p_salida_id
    and (not coalesce(t.es_prueba,false) or sgc.is_admin())
  order by t.ofrecida_en asc;
$function$;
grant execute on function sgc.transferencias_de_conduce(uuid) to authenticated;

commit;
