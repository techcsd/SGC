-- ============================================================================
-- Ronda 17/07/2026 — C7: resumen de documentos por conductor (badge "incompletos")
-- ----------------------------------------------------------------------------
-- Vista agregada para que el LISTADO de conductores sepa qué documentos
-- destacados (cédula, licencia) tiene cada quien SIN cargar todos los documentos
-- por fila. security_invoker: aplica la RLS de `documentos`/`conductores` al que
-- consulta (flota/admin), no la del dueño de la vista. Aditivo.
-- ============================================================================

set search_path = sgc, public;

create or replace view sgc.v_conductor_documentos
with (security_invoker = on) as
select
  c.id                                     as conductor_id,
  coalesce(bool_or(d.tipo = 'cedula'),   false) as tiene_cedula,
  coalesce(bool_or(d.tipo = 'licencia'), false) as tiene_licencia,
  count(d.id)                              as total_documentos
from sgc.conductores c
left join sgc.documentos d
  on d.entidad = 'conductor' and d.entidad_id = c.id
group by c.id;

grant select on sgc.v_conductor_documentos to authenticated;
