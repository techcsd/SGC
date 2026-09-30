-- ⛑️ RECONSTRUIDA — INTENCIÓN (CD10 / regla 19) — ver sql/_recuperadas/README.md
-- Original corrida desde scratchpad el 2026-08-29, nunca versionada ni en ledger.
-- NO había objeto persistente que introspectar (fue DML puntual). Esto reconstruye
-- la INTENCIÓN a partir de la evidencia viva en `sgc.vehiculo_asignaciones`:
-- 4 asignaciones `origen='auto'`, `activa=true`, `hasta=null`, con la nota
-- "Alineada al vehículo en uso (2026-08-29)" — una por cada uso abierto de ese día.
--
-- 🔴 ESTA ES LA CAUSA DE CD3: convirtió cada `vehiculo_usos` abierto en una asignación
-- permanente. Edward Mota → MT 03 quedó "pegado" porque su uso de MT 03 (abierto desde
-- el 2026-08-14, un uso de prueba nunca cerrado) generó una asignación AUTO que el
-- dashboard lee como "Mi vehículo". Choferes afectados (4): POLIN RAMIREZ (L441660),
-- ing.Misael Encarnacion (L478815), MANOLO DURAN (L473027), EDWARD MOTA (MT 03).
--
-- ⚠️ NO RE-EJECUTAR. Se deja SOLO como trazabilidad. La corrección va en
-- sql/2026-09-30-cd3-asignaciones-auto.sql (retira las AUTO sin respaldo).
--
-- La intención original fue aproximadamente:
--
--   insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, desde, activa, origen, notas)
--   select vu.vehiculo_id, vu.usuario_id, vu.inicio_at, true, 'auto',
--          'Alineada al vehículo en uso (2026-08-29)'
--     from sgc.vehiculo_usos vu
--    where vu.fin_at is null
--      and not exists (
--        select 1 from sgc.vehiculo_asignaciones va
--         where va.vehiculo_id = vu.vehiculo_id and va.usuario_id = vu.usuario_id and va.activa
--      )
--   on conflict do nothing;

do $$ begin
  raise notice 'Migración de trazabilidad (CD10). NO ejecuta DML. Ver cabecera.';
end $$;
