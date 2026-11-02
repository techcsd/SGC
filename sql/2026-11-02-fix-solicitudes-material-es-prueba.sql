-- fix: sgc.solicitudes_material le faltaba es_prueba (toda otra tabla de negocio
-- lo tiene, esta se quedó fuera). requisiciones_vencidas_avisar() ya asumía que
-- existía (coalesce(es_prueba, false)) y por eso el cron sgc-requisiciones-vencidas
-- llevaba fallando a diario desde al menos el 31-oct-2026 (ERROR: column "es_prueba"
-- does not exist). Encontrado por el panel nuevo "Pulso del sistema" (ronda DF).
alter table sgc.solicitudes_material
  add column if not exists es_prueba boolean not null default false;
