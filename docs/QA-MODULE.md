# Módulo QA (Gestión de Pruebas) — SGC · Tecnología

> AC3. Registrar los QA tests y el listado a seguir para probar cada actualización.
> Investigación de gestores de prueba reales + decisiones de diseño para el SGC.

## 1. Cómo lo hacen los gestores de prueba reales

Se revisaron los modelos conceptuales de **TestRail, Qase, Zephyr (Scale/Squad), Xray y TestLink**. Todos comparten la misma columna vertebral, con matices:

| Concepto | TestRail | Qase | Zephyr / Xray | Denominador común |
|---|---|---|---|---|
| **Caso de prueba** | Case (title, preconds, steps, expected, priority, refs) organizado en *Sections/Suites* | Case con *severity/priority*, *steps* estructurados | Test (Jira issue) con steps | Título + precondiciones + pasos + resultado esperado + módulo/feature + prioridad |
| **Agrupación** | Suites/Sections | Suites | Folders / Test Sets | Por módulo/feature |
| **Plan de prueba** | Test Plan (varios runs) | Plan | Test Plan | Selección de casos para un objetivo (p. ej. "regresión de release") |
| **Ejecución** | Test Run: cada caso → *Passed/Failed/Blocked/Retest/Untested* con comentario + adjuntos | Run con resultados y *defects* | Test Execution contra una versión | Corrida contra **una versión concreta**; cada caso queda passed/failed/blocked/skipped con evidencia |
| **Defecto** | link Case↔Bug (Jira) | link a issue | link a Jira bug | Caso fallado → **defecto/bug** |
| **Métricas** | % pass, progreso, histórico por milestone | dashboards | gadgets | Avance de la corrida, % pass, historial por versión |
| **Smoke/checklist** | Plantillas de run | plantillas | — | Checklist de smoke test por release |

**Aprendizajes que adoptamos:**
1. **Separar el "caso" (reutilizable) de la "corrida" (ejecución fechada contra una versión).** Un caso vive mucho; se ejecuta muchas veces.
2. **La corrida guarda un *snapshot* del caso** (título/módulo) para que el historial sobreviva a la edición o borrado del caso — patrón de TestRail/Qase.
3. **Estados estándar:** `passed | failed | blocked | skipped` (+ `pendiente` mientras no se ejecuta). Son los universales; evitamos inventar estados nuevos.
4. **Prioridad** por caso (alta/media/baja) para poder correr solo lo crítico en un hotfix.
5. **Evidencia + link al defecto** desde un resultado fallado — integración directa con nuestro **Reportes de errores** (Y6, `app_error_reports`).
6. **Plataforma** (web/app/ambas): el SGC tiene web y app móvil con releases independientes; un caso puede aplicar a una o ambas.

**Lo que NO hacemos en v1** (deliberado, evitar sobre-ingeniería): árbol de suites/carpetas anidadas (usamos `modulo` plano), planes reutilizables separados de la corrida (la corrida se arma eligiendo casos o "todos los de un módulo"), integraciones con Jira (usamos nuestro Reportes de errores), automatización/CI de tests.

## 2. Decisiones de diseño (SGC)

- **Ubicación y gating:** sección **QA dentro de Tecnología**, con el **mismo gating restringido que "Versiones de App"** (`sgc.es_tecnologia()` → admin/tecnologia/gerencia/dirección). RLS en las 3 tablas.
- **Organización por `modulo`** (texto plano: bitacora, flota, inventario, compras, proyectos, tecnologia, general…) en vez de un árbol de suites — encaja con cómo está partido el ERP.
- **Snapshot en resultados:** `qa_test_run_results.caso_titulo`/`modulo` se copian al crear la corrida; `caso_id` es FK con `ON DELETE SET NULL`.
- **Evidencia** en bucket privado `qa` (solo Tecnología), path `run/{runId}/{uuid}`.
- **Integración con defectos:** `qa_test_run_results.error_report_id → app_error_reports`. Desde un resultado `failed` se puede enlazar o crear una entrada en Reportes de errores.

## 3. Modelo de datos (aplicado)

`sql/2026-07-30-ac3-qa-module.sql` + `sql/2026-07-30-ac3-qa-seed.sql`.

- **`qa_test_cases`** — `modulo, titulo, precondiciones, pasos, resultado_esperado, prioridad (alta|media|baja), plataforma (web|app|ambas), activo, orden, creado_por`.
- **`qa_test_runs`** — `titulo, plataforma, version_objetivo, fecha, ejecutado_por, estado (en_progreso|completada|abortada), notas`.
- **`qa_test_run_results`** — `run_id, caso_id, caso_titulo (snapshot), modulo (snapshot), resultado (pendiente|passed|failed|blocked|skipped), notas, evidencia_path, error_report_id`. `unique(run_id, caso_id)`.
- **RPC** `sgc.qa_crear_corrida(p_plataforma, p_version, p_titulo, p_caso_ids uuid[])` → crea la corrida y snapshotea los casos elegidos como resultados `pendiente`.
- **Seed:** 18 casos de smoke test reales por módulo (bitácora, pre-uso, combustible estación/depósito, reporte semanal telehandler, mantenimiento, no-reasignar, ruta multi-parada, conduce con 2 firmas, salida de inventario, requisición, cronograma, monitoreo, chofer-no-ve-Tecnología, nota compartida, historial de versiones).

## 4. UI (sección Tecnología → QA)

1. **Casos** — CRUD por módulo (filtro por módulo/plataforma/prioridad; activar/desactivar).
2. **Nueva corrida** — elegir versión objetivo + plataforma + casos (por módulo o todos) → ejecución tipo checklist: cada caso se marca passed/failed/blocked/skipped, con notas y evidencia (foto).
3. **Resumen de corrida** — % pass, conteo por estado, lista de fallos con su evidencia; botón para enlazar/crear un reporte de error desde un fallo.
4. **Historial** — corridas por versión, con su % pass y fecha.

## 5. Flujo de uso por release

1. Antes de subir una versión, crear una **corrida** con la versión objetivo (p. ej. `web 1.55.0`) y el plan de smoke (todos los casos activos de los módulos tocados).
2. Ejecutar el checklist; los fallos se documentan con evidencia y se enlazan a **Reportes de errores**.
3. El **% pass** y el historial quedan por versión → trazabilidad de qué se probó en cada release.
