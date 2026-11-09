# Plan de issues abiertos — noviembre 2026

> Triage de todos los issues abiertos de `techcsd/SGC` que no están cubiertos por
> las Tareas 1-3 del prompt (#51, #57, #78, #86, #54, #65, #81) ni por el resto
> del epic Odoo original (#2-#24, ya en producción). Hecho leyendo el cuerpo
> completo de cada issue (`gh issue view`), no solo el título.

## Ya resueltos en esta ronda (06-nov-2026, sin esperar este documento)

Estos 7 cumplían la barra de "pequeño, claramente especificado, sin decisión
pendiente" y ya están aplicados en dev (migraciones `dj4`-`dj8`, ver
`ESTADO-06-NOV-2026.md` y el reporte final):

| # | Qué era | Qué se hizo |
|---|---|---|
| #70 | 38 FKs sin índice, 7 pares duplicados | 28 índices nuevos + 4 índices/1 constraint duplicados eliminados (verificados uno por uno contra el esquema real) |
| #72 | Retención/purga (parcial) | Cron de purga de `cron.job_run_details` a 30 días; el resto de tablas queda fuera (decisión de negocio) |
| #55 | Cron `vehiculos-sin-echada` viola el CHECK | Agregado `vehiculo_sin_echada` al CHECK de `avisos_flota.tipo` (mismo patrón exacto que #54) |
| #58 (sub-pieza) | 56/60 anulaciones sin motivo | `sgc.anular_conduce` ahora exige mínimo 10 caracteres — el resto de #58 (significado de "incompleto", barrido de despachados viejos) sigue abierto, ver abajo |
| #71 (sub-pieza) | `proveedor_transporte_map` sin RLS | RLS habilitado + política de backend — verificado que `anon`/`authenticated` no tenían grants (no era una fuga activa, pero cierra el hueco) |
| #67 | Chequeo semanal de almacenes no corre | Diagnosticado (ver abajo), NO arreglado — depende de una confirmación operativa |
| #64, #69 | Datos de prueba en KPIs / RPC lentas | Evaluados, dejados fuera — necesitan prod o código fuera del repo |

## Bugs — pendientes, sin decisión de negocio

| # | Qué pide | Esfuerzo | Nota |
|---|---|---|---|
| #66 | Investigar timeouts `/auth/pin`/`/home` (31% de errores) + GPS apagado en choferes | **L** | El propio issue dice "investigar el origen" — causa raíz desconocida, no es un fix de una línea. Relacionado con #77 (asistente de activación de GPS) y con la carga de `pg_timezone_names`/RPCs de arranque lentas (#69). |
| #67 | Chequeo semanal de almacenes no se ejecuta | **S** (una vez resuelta la duda) | **Diagnosticado esta ronda**: la función queda en silencio (0 tareas, sin error) si ningún proyecto tiene un "guarda-almacén" vinculado a un usuario real — no es un bug de código, es una condición de datos. Antes de tocar nada, el propio issue pide confirmar con los guardalmacenes si el proceso sigue vigente. |

## Hallazgos de datos — necesitan decisión u entrevista antes de construir

| # | Qué pide | Esfuerzo | Necesita |
|---|---|---|---|
| #56 | SLA + escalamiento de solicitudes de material (18 pendientes, p90 15 días) | M-L | Entrevista con Compras/Almacén (el propio issue lo pide explícitamente, concentración rara en Monterezzo) |
| #59 | Solicitudes de movimiento vs. conduces — dos puertas al mismo proceso, una casi no se usa (67% cancelada) | L | Decisión: ¿consolidar o retirar el módulo de solicitudes de movimiento? Necesita hablar con Logística primero (`necesita-entrevista`) |
| #60 | Combustible: 49% km pendiente, 35% saneado, importación de estación caída desde 14-sep | M-L | Confirmar con Flota si la importación de estación sigue vigente; ajustar umbral de "anormal" (`necesita-entrevista`) |
| #61 | 65% de avisos de flota son ruido ("reporte_semanal"), tapan los accionables | M | No pide entrevista explícitamente, pero toca 5 crons con trabajo posiblemente solapado — hace falta leer los 5 antes de tocar cualquiera |
| #62 | Adopción: 20/60 usuarios nunca entraron; roles de gestión casi sin actividad | — | No es un issue de código — es un plan de capacitación/proceso. Ver epic #83. |
| #63 | 5 proyectos "en progreso" sin bitácora reciente (hasta 54 días); proyectos de prueba mezclados en reportes | S-M | El filtro de prueba ya existe (`es_prueba`, confirmado en los 20 proyectos reales de dev); falta decidir el umbral de aviso (¿3 días? ¿quién lo recibe?) — ver #76 |
| #68 | Realtime consume 70% del tiempo de consultas de la DB | M | Requiere auditar qué tablas de `supabase_realtime` tienen suscriptor real en el frontend antes de quitar ninguna — alto valor, pero no es "sin riesgo" sin esa auditoría previa. **Recomendado como siguiente prioridad de rendimiento**, después de confirmar con búsqueda en `src/` qué pantallas usan `.channel(...)`/realtime. |
| #71 (resto) | ~40 políticas RLS con `auth.uid()` sin `(select …)`; políticas permisivas múltiples por tabla | L | El propio issue pide "prueba de permisos negativos" por tabla antes de aplicar — volumen grande (40 políticas), no cabe en "pequeño y sin riesgo" de esta ronda |

## Feats — todos piden entrevista antes de construir (plantilla del issue)

Los 10 feats (#73-82) comparten la misma instrucción: *"Antes de construir: conversar con 1-2 usuarios reales del flujo."* Ninguno se implementa en esta ronda por eso, incluso los que no llevan la etiqueta `necesita-entrevista` explícita.

| # | Resuelve | Esfuerzo | Entrevista explícita (etiqueta) |
|---|---|---|---|
| #73 | #56 — aprobar desde la notificación + escalamiento 48h | M | No, pero el texto la pide igual |
| #74 | #58 — QR en el conduce para cerrar entrega | M | No |
| #75 | #60 — OCR de recibo/tablero para combustible | M | No |
| #76 | #63 — parte diario por voz/WhatsApp | M | **Sí** — además pide confirmar primero si el obstáculo real es el formulario largo o la falta de señal (cambia el diseño: offline vs. voz) |
| #77 | #66 — asistente de activación de GPS | S-M | No |
| #79 | #62 — resumen semanal para Dirección/RRHH/Jefes | S | No — es casi un reporte sobre KPIs que ya existen; buen candidato para una próxima ronda rápida si Dirección confirma que lo quiere |
| #80 | #62 — Compa como puerta única | L | No, pero requiere evals (CP5) |
| #82 | #62 — resumen diario de tareas por WhatsApp/correo | S | No |

## Epics (rollups, sin acción propia)

#83 (adopción), #84 (calidad combustible), #85 (cierre de despachos/conduces), #87
(salud de DB) — son agrupadores de los issues de arriba, no se implementan
directamente. #83 explícitamente pide "entrevistas de 20 min a un ingeniero de
campo, un chofer, un guarda-almacén y alguien de Compras" como primer paso —
cubre buena parte de lo que #56/#59/#60/#76 también piden por separado, así que
una sola ronda de entrevistas puede alimentar a varios issues a la vez.

## Orden recomendado

1. **Entrevistas (bloqueante para casi todo lo demás):** una sola ronda cubriendo
   Compras (#56/#57 ya resuelto/#78), Logística (#59), Flota (#60), campo (#63/#76),
   como pide la propia epic #83. Esto desbloquea 7-8 issues de una vez.
2. **#67** — solo falta la confirmación operativa (guardalmacenes), ya diagnosticado.
3. **#68** (Realtime) — auditoría de suscriptores reales en frontend, luego migración; buen retorno de rendimiento sin esperar entrevistas.
4. **#66** — investigación técnica de los timeouts (no depende de entrevista).
5. **#79/#82** — los dos feats más chicos y menos ambiguos (resúmenes sobre KPIs que ya existen); candidatos rápidos una vez Dirección confirme que los quiere.
6. **#71 (resto)** — revisión tabla por tabla de las ~40 políticas, en una ronda dedicada con tiempo para probar permisos negativos.
7. Todo lo demás (#56, #59, #60, #61, #73-78, #80), según lo que arrojen las entrevistas del paso 1.
