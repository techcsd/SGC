-- ============================================================================
-- PROMPT-48 (BP) FASE 3 — BP3: dar el módulo `proyectos` al rol `logistica`.
-- Ronda 14/09/2026.  Aditivo, idempotente.  Decisión Xaviel: opción A (array_append).
--
-- EFECTO.  `sgc.puede_gestionar_proyectos()` = is_admin() OR módulo `proyectos` por un
--   rol que no sea ingeniero_oficina.  Con esto, quien tenga `logistica` gana el botón
--   "Nuevo proyecto", la ficha editable, responsables y cierre (AT19) — sin tocar código
--   (guard proyectosGestionGuard + UserService.puedeGestionarProyectos leen el módulo).
--
-- ⚠️ ALCANCE (§F-2: módulo ENTERO, recomendado).  `logistica` lo tienen HOY (verificado):
--     · Raykler Peña            (almacen@constructorasd.com)     ← lo pidió
--     · ing.Misael Encarnacion (transporte@constructorasd.com)  ← TAMBIÉN gana gestión
--     · QA logistica           (qa_logistica@…)                 ← usuario de prueba
--   Xaviel lo aceptó al elegir la opción. El sidebar les mostrará el grupo Proyectos
--   completo (Obras, Cronograma, Ranking, Personal, Clima). No cambia qué OBRAS ven en
--   los selectores (ya las veían por `inventario`).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp3-logistica-modulo-proyectos.sql
-- ============================================================================
begin;

update sgc.roles
   set modulos = array_append(modulos, 'proyectos')
 where codigo = 'logistica'
   and not ('proyectos' = any(modulos));

-- Verificación al pie.
do $$
declare v_mods text[];
begin
  select modulos into v_mods from sgc.roles where codigo = 'logistica';
  if not ('proyectos' = any(v_mods)) then
    raise exception 'BP3: logistica no quedó con el módulo proyectos (modulos=%).', v_mods;
  end if;
  raise notice 'BP3 OK: logistica.modulos = %', v_mods;
end $$;

commit;
