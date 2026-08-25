-- AX4 — ACTIVAR la penalización por estado estancado (decisión de Xaviel, 25-ago-2026):
-- cada día laborable INACTIVO (sin señal: ni cambio de estado ni actividad) resta
-- 1 punto, con gracia de 2 días y tope de 4 por semana. Espeja exactamente lo que
-- hace sgc.incentivo_set_penalizacion(2, 1, 4), pero como UPDATE directo: corre como
-- postgres (Management API) y así evita el gate puede_gestionar_incentivos() que
-- exige un auth.uid autenticado. Mutación in-place de la config ACTIVA (misma
-- versión), idéntica a la función. Idempotente. AX4c ya exime la semana 34 (penal_desde).
-- Toma efecto en el próximo incentivo_generar_semana (Recalcular / cierre de semana).
update sgc.incentivo_config
   set pesos = pesos
       || jsonb_build_object('_penal_gracia_dias', 2)
       || jsonb_build_object('_penal_pts_dia', 1)
       || jsonb_build_object('_penal_tope', 4)
 where activo;
