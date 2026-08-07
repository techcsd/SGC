-- =============================================================================
-- PROMPT-9 FASE 2 (AH12, cont.) — Higiene del roster: una sola asignación activa
-- por vehículo. Aditivo/correctivo.
--
-- Hallazgo: varios vehículos tenían >1 `vehiculo_asignaciones.activa=true`
-- simultáneas (Amarok=5, D-Max=2, Frontier=2), reliquia de rutas de asignación
-- previas que no desactivaban la anterior. `vehiculos_asignados()` las mostraba
-- todas → "asignado a" con personas de más (misma familia del síntoma AH12).
-- Un vehículo lo tiene UN responsable a la vez (la custodia es 1-a-la-vez).
--
-- Este script conserva, por vehículo, la asignación activa "verdadera":
--   1) la que coincide con una custodia abierta (vehiculo_entregas), si existe;
--   2) si no, la más reciente por `desde`.
-- Desactiva el resto. NO añade constraint dura (los caminos de asignación varían);
-- el traspaso ya desactiva-antes-de-insertar, así que se mantiene sano hacia
-- adelante para ese flujo.
-- =============================================================================

begin;

with activas as (
  select a.id, a.vehiculo_id, a.usuario_id, a.desde,
         exists (
           select 1 from sgc.vehiculo_entregas e
           where e.vehiculo_id = a.vehiculo_id and e.tipo='recepcion'
             and e.estado='abierta' and e.conductor_usuario_id = a.usuario_id
         ) as tiene_custodia,
         row_number() over (
           partition by a.vehiculo_id
           order by
             (exists (
               select 1 from sgc.vehiculo_entregas e
               where e.vehiculo_id = a.vehiculo_id and e.tipo='recepcion'
                 and e.estado='abierta' and e.conductor_usuario_id = a.usuario_id
             ))::int desc,
             a.desde desc nulls last
         ) as rn
  from sgc.vehiculo_asignaciones a
  where a.activa
)
update sgc.vehiculo_asignaciones va
   set activa = false, hasta = coalesce(va.hasta, now())
  from activas
 where va.id = activas.id
   and activas.rn > 1;

commit;
