-- AZ7 (d/f) — Marca como PRUEBA los residuos de las corridas E2E (usuarios "QA %") y los
-- "Test User" / "*Terrero Test" que quedaron como reales (es_prueba=false), sacándolos de
-- KPIs/correos/incentivos y de los selectores reales. REVERSIBLE (no elimina).
-- La ELIMINACIÓN definitiva queda pendiente del OK de Xaviel (ver reporte).

update sgc.usuarios
   set es_prueba = true
 where (nombre ilike 'QA %' or nombre ilike 'QA%'
        or nombre ilike 'Test User%' or nombre ilike '%Terrero Test%')
   and coalesce(es_prueba, false) = false;
