# Cronograma de Proyectos — Documento de diseño (Y15 / Y16)

> Ronda 28/07/2026 · PROMPT-3 · **FASE 0 (diseño)** — pendiente de aprobación de Xaviel antes de implementar.
> Metodología SGC: nada se implementa sin este documento aprobado. Todo aditivo y retrocompatible.
> Estado: **APROBADO por Xaviel el 28/07/2026 — en implementación.**
>
> **Decisiones confirmadas:** (1) "atrasada" = condición derivada, no estado. (2) Holgura general cuando no hay crítica adelante = sí. (3) Días calendario en v1. (4) Bitácora: enlazar siempre; completar solo si se marca explícito. (5) **Sin `asignado_a` por tarea** — se notifica a los responsables del proyecto. (6) UI = **ruta dedicada `/proyectos/:id/cronograma`**. (7) Fase = contenedor. (8) Avisos: por iniciar 3 días, por vencer 2 días.

---

## 1. Objetivo y alcance

Evolucionar las **Fases** actuales de Proyectos hacia un **Cronograma**: una secuencia de tareas con fechas planificadas y reales, tipos (ordinaria/importante/crítica), notificación de inicio/fin por el usuario, evidencia fotográfica al completar, justificación obligatoria en retrasos, **auto-ajuste del timeline** con historial auditable, avisos in-app + email al ingeniero, e integración con Bitácoras.

### Alcance v1 (lo que SÍ hacemos)
- Secuencia **lineal ordenada** de tareas (por `orden`): cada tarea empieza cuando termina la anterior. **No** grafo de dependencias arbitrarias todavía.
- Fechas **plan vs real**, duración en **días calendario**.
- Tipos ordinaria / importante / crítica (visualmente distintas).
- Ciclo de vida con notificación de inicio/fin, foto obligatoria al completar, justificación obligatoria si es tarde.
- Auto-ajuste: adelantos donan días a la próxima crítica/importante; retrasos empujan las siguientes; historial de recálculos.
- Avisos in-app (patrón `avisos_proyecto`/`notificar`) + email (Resend, reutilizando la infra existente) al ingeniero responsable.
- Integración con Bitácoras (enlace tarea↔bitácora como evidencia).
- Vista Gantt simple + lista en el detalle de proyecto.

### Fuera de alcance v1 (backlog — sección 11)
Grafo de dependencias/ruta crítica real, calendario de días laborables/feriados/lluvia, re-baselines múltiples, reconciliación automática de los sistemas de avance (fases % vs partidas vs cronograma), auto-actualización de partidas desde bitácora. **v1 es una secuencia con fechas y recálculo, no un MS Project.**

---

## 2. Estado actual (investigación) y gaps (Y16)

### Módulo Proyectos hoy
- **`sgc.proyectos`** (22 cols): datos de obra, `responsable_id`, geo, `presupuesto`, `porcentaje_pagado`, estado (planificacion/en_progreso/pausado/completado/cancelado).
- **`sgc.fases_proyecto`** — lista **plana ordenada**: `nombre, descripcion, estado (pendiente/en_progreso/completada), fecha_inicio, fecha_fin, progreso 0-100, orden`. **Sin dependencias, sin duración, sin baseline, sin timeline UI.** Se editan en el drawer de detalle de `Lista`. Avance del proyecto = promedio de `progreso`.
- **`sgc.proyecto_responsables`** (Z2): `usuario_id`, `tipo_responsabilidad` (residente/responsable), `activo` — **el vínculo proyecto↔usuario que usaremos para notificar al ingeniero.** RPC existente `responsables_de_proyecto(p_proyecto_id)` devuelve nombre+email.
- **`sgc.proyecto_empleados`** (equipo de obra) y **`sgc.proyecto_partidas`** (avance físico planeado/ejecutado, manual).
- **`sgc.expediente_obra`** ya reserva un ítem `codigo='cronograma'` ("Cronograma inicial") — hoy solo un archivo/checklist; el Cronograma real lo sustituye conceptualmente.
- Detalle de proyecto = **drawer dentro de `Lista`** (no hay ruta de detalle). "Mi Proyecto" (módulo bitácora) muestra fases en solo-lectura.
- RLS proyectos: admin OR `tiene_modulo('proyectos')` OR `responsable_id=auth.uid()` OR miembro de `proyecto_empleados`. Escritura: admin/proyectos. Roles con módulo `proyectos`: admin, direccion, gerencia, gerente_proyectos, ingeniero_oficina.
- Bitácora ↔ proyecto: **`bitacoras.proyecto_id` NOT NULL** (FK directa). Fotos = `bitacora_archivos`. El patrón `weather_snapshot_id` (FK nullable + param opcional en el RPC + sección de detalle) es la plantilla exacta para enlazar la tarea de cronograma.

### Gaps funcionales/UX (Y16)
| # | Gap | Prioridad |
|---|-----|-----------|
| G1 | Fases sin duración/dependencias/baseline ni vista de línea de tiempo | **v1 (el cronograma lo resuelve)** |
| G2 | No hay ruta de detalle de proyecto → no se puede hacer deep-link (aviso/email → cronograma de un proyecto) | **v1 (rápida): agregar deep-link** |
| G3 | Dos sistemas de avance paralelos (fase `progreso` promedio vs partidas físico) sin reconciliar | backlog |
| G4 | `proyecto_partidas.cantidad_ejecutada` se actualiza a mano; `bitacora_actividades.cantidad` no la alimenta | backlog |
| G5 | Seguridad a nivel de fila, no de columna: un ingeniero asignado puede leer `presupuesto` vía API directa | backlog (documentado ya en el repo) |
| G6 | KPI/ranking de encargados usa avance por fases; podría incorporar cumplimiento de cronograma | backlog |

---

## 3. Investigación breve — cronogramas de obra

Conceptos estándar y decisión de alcance v1:
- **Gantt**: barras por tarea sobre eje temporal. → **v1 SÍ** (Gantt simple: barra plan + barra/estado real).
- **Dependencias (predecesoras) / grafo**: tarea B empieza al terminar A (finish-to-start), o grafos arbitrarios. → **v1 = solo secuencia lineal por `orden`** (finish-to-start implícito). Grafo arbitrario = backlog.
- **Ruta crítica (CPM)**: la cadena que determina la duración total. → **v1 NO calcula CPM**; en su lugar el usuario **marca** tareas como `critica`/`importante` (criticidad declarada, no calculada). Suficiente para el auto-ajuste que pidió Xaviel.
- **Baseline (plan) vs real**: comparar lo planificado original con lo ejecutado. → **v1 guarda plan y real por tarea** + historial de recálculos (equivale a un baseline vivo auditable). Re-baseline formal = backlog.
- **Holgura (float)**: días que una tarea puede retrasarse sin afectar el fin. → **v1** la modela implícitamente: los días liberados por un adelanto se donan a la próxima crítica/importante o quedan como holgura general.

**Conclusión:** v1 = secuencia lineal + criticidad declarada + plan/real + recálculo + historial. Sin sobre-ingeniería.

---

## 4. Modelo de datos propuesto (aditivo)

Todas las tablas nuevas, en inglés, con `es_prueba` para aislamiento de datos de prueba (patrón del repo) y RLS coherente.

### 4.1 `sgc.cronograma_tareas`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | default gen_random_uuid() |
| `proyecto_id` | uuid NOT NULL → proyectos(id) cascade | |
| `fase_id` | uuid NULL → fases_proyecto(id) | **Fase = contenedor opcional** (agrupador). Convivencia sin romper Fases. |
| `nombre` | text NOT NULL | |
| `descripcion` | text | |
| `tipo` | text NOT NULL default 'ordinaria' | CHECK in (`ordinaria`,`importante`,`critica`) |
| `orden` | int NOT NULL | secuencia dentro del proyecto |
| `duracion_dias_plan` | int NOT NULL | días calendario, ≥1 |
| `fecha_inicio_plan` | date | calculada por el motor (encadenada) o fijada manual la primera |
| `fecha_fin_plan` | date | = inicio_plan + duracion - 1 |
| `fecha_inicio_real` | date | seteada al `iniciar_tarea` |
| `fecha_fin_real` | date | seteada al `completar_tarea` |
| `estado` | text NOT NULL default 'pendiente' | CHECK in (`pendiente`,`en_curso`,`completada`). "atrasada" = condición derivada (§5) |
| `justificacion_retraso` | text | obligatoria para completar tarde o al marcar atrasada |
| `foto_evidencia_path` | text | obligatoria al completar (storage privado) |
| `asignado_a` | uuid NULL → usuarios(id) | opcional; si null, notifica a los responsables del proyecto ⚠️ |
| `completada_por` | uuid → usuarios(id) | quién completó |
| `iniciada_por` | uuid → usuarios(id) | quién inició |
| `es_prueba` | boolean NOT NULL default false | aislamiento de datos de prueba |
| `created_at` / `updated_at` | timestamptz | |

Índices: `(proyecto_id, orden)`, `(estado)`, `(fecha_fin_plan)` para el sweep.

### 4.2 `sgc.cronograma_recalculos` (historial auditable)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `proyecto_id` | uuid NOT NULL → proyectos(id) | |
| `tarea_origen_id` | uuid → cronograma_tareas(id) | la que liberó/consumió días |
| `tarea_destino_id` | uuid NULL → cronograma_tareas(id) | la que recibió los días (null = holgura general) |
| `dias_movidos` | int | + = donados/ganados, − = empuje por retraso |
| `motivo` | text | CHECK in (`adelanto_dona_critica`,`holgura_general`,`retraso_empuje`) |
| `detalle` | jsonb | snapshot opcional (fechas antes/después) |
| `created_at` | timestamptz | |
| `creado_por` | uuid | auth.uid() del que disparó |

### 4.3 `sgc.cronograma_tarea_bitacoras` (enlace evidencia)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tarea_id` | uuid NOT NULL → cronograma_tareas(id) cascade | |
| `bitacora_id` | uuid NOT NULL → bitacoras(id) cascade | |
| `created_at` | timestamptz | |
| unique `(tarea_id, bitacora_id)` | | evita duplicados |

### 4.4 Enlace desde Bitácoras (patrón `weather_snapshot_id`)
- **Opción recomendada:** tabla puente `cronograma_tarea_bitacoras` (M:N, más flexible: una bitácora puede tocar varias tareas y viceversa). Se llena desde el form de bitácora (selector opcional) y desde el detalle de la tarea.
- Alternativa mínima: columna nullable `bitacoras.cronograma_tarea_id`. → **Se descarta a favor de la tabla puente** (evita alterar el RPC gigante `crear_entrada_bitacora`; el enlace se crea en un segundo paso idempotente `enlazar_bitacora_tarea`).

### 4.5 Avisos — **reutilizar `sgc.avisos_proyecto`** (no crear tabla nueva)
`avisos_proyecto` ya existe (R25) con `tipo, proyecto_id, mensaje, severidad, estado, dedup_key, atendido_*` y su RPC `atender_aviso_proyecto`. Aditivo:
- Ampliar el CHECK de `tipo` para incluir `cronograma_por_iniciar`, `cronograma_por_vencer`, `cronograma_atrasada`.
- Agregar columna nullable `tarea_id uuid → cronograma_tareas(id)` para deep-link.
- El bell per-usuario sigue por `sgc.notificar(...)` (tabla `notificaciones`).

---

## 5. Estados y transiciones

```
pendiente ──iniciar_tarea──▶ en_curso ──completar_tarea──▶ completada
   │                            │
   └──────────── (hoy > fecha_fin_plan y no completada) ⇒ CONDICIÓN "atrasada" ─────────┘
```

- **estado** ∈ {`pendiente`, `en_curso`, `completada`}. ⚠️ **Decisión:** "atrasada" NO es un cuarto estado sino una **condición derivada** = `estado != 'completada' AND current_date > fecha_fin_plan`. Motivo: evita transiciones dobles (una tarea puede estar `en_curso` y atrasada a la vez); el sweep marca la condición y exige justificación. Si prefieres un estado explícito `atrasada`, se puede — pero complica el ciclo. **(Confirmar.)**
- **iniciar_tarea**: pendiente → en_curso. Setea `fecha_inicio_real = today`, `iniciada_por`. Idempotente (si ya en_curso/completada, no-op).
- **completar_tarea**: en_curso → completada (o directamente desde pendiente si aplica). Exige `foto_evidencia_path`. Si la tarea está atrasada (today > fecha_fin_plan) exige `justificacion_retraso`. Setea `fecha_fin_real=today`, `completada_por`. **Ejecuta el recálculo en la MISMA transacción.** Idempotente.
- **justificar_retraso**: registra `justificacion_retraso` sin completar (para cumplir la regla "explicar por qué" apenas se detecta el atraso).

---

## 6. Reglas de auto-ajuste (formalizadas)

Las tareas de un proyecto se encadenan por `orden`. El "cronograma planificado" se recalcula siempre desde las tareas ya completadas + duraciones + orden. Días **calendario**.

### 6.1 Encadenado base (`recalcular_cronograma(proyecto_id)`)
1. Ancla inicial = `fecha_inicio_plan` de la primera tarea (fijada al crear el cronograma) o la fecha real si ya inició.
2. Para cada tarea en `orden`:
   - Si completada: sus fechas reales son fijas; la siguiente ancla = `fecha_fin_real + 1 día`.
   - Si no completada: `fecha_inicio_plan = ancla`; `fecha_fin_plan = ancla + duracion_dias_plan - 1`; ancla siguiente = `fecha_fin_plan + 1`.
3. Idempotente: correrlo N veces da el mismo resultado (usado por triggers y sweep).

### 6.2 Adelanto (completar antes)
Al `completar_tarea` con `fecha_fin_real < fecha_fin_plan`:
- `surplus = fecha_fin_plan - fecha_fin_real` (días > 0).
- Buscar la **próxima** tarea pendiente con `orden` mayor y `tipo ∈ {importante, critica}`.
  - Si existe → `duracion_dias_plan += surplus` (la crítica **gana** ese tiempo como colchón). Registrar recálculo `motivo='adelanto_dona_critica'` (origen=completada, destino=crítica, dias_movidos=+surplus).
  - Si NO existe crítica/importante adelante → los días quedan como **holgura general**: simplemente al reencadenar, las siguientes empiezan antes y el proyecto puede terminar antes. Registrar `motivo='holgura_general'` (destino=null). ⚠️ **(Asunción a validar: holgura general = sí.)**
- Reencadenar (§6.1) todas las pendientes siguientes.

Ejemplo Xaviel: ordinaria de 2 días termina en 1 → surplus=1 → la próxima crítica pasa de N a N+1 días.

### 6.3 Retraso (completar tarde o vencimiento)
- Al completar con `fecha_fin_real > fecha_fin_plan`, o cuando el sweep detecta `today > fecha_fin_plan` en tarea no completada:
  - `delay = fecha_fin_real - fecha_fin_plan` (o proyección con `today`).
  - Reencadenar (§6.1): las tareas siguientes se **empujan** hacia adelante por el efecto del encadenado. Registrar `motivo='retraso_empuje'` (origen=tarea tardía, destino=null, dias_movidos=−delay agregado).
  - Exigir `justificacion_retraso` (bloquea `completar_tarea` si falta y la tarea está atrasada).

### 6.4 Recálculos encadenados
Todo pasa por `recalcular_cronograma` (una sola función idempotente), invocada dentro de `completar_tarea`/`iniciar_tarea` y por el sweep. Cada corrida que cambie fechas por donación/empuje escribe fila(s) en `cronograma_recalculos`. Los adelantos/retrasos sucesivos se acumulan de forma determinista.

**Tests SQL reproducibles (FASE 2):** (a) adelanto → crítica gana días; (b) retraso → empuja siguientes; (c) sin crítica adelante → holgura; (d) recálculos encadenados; (e) idempotencia (correr 2×).

---

## 7. RPCs — contrato (FASE 1) y para la app (PROMPT-4)

Todos SECURITY DEFINER, `search_path=sgc,public`, con verificación de permiso: **admin OR `tiene_modulo('proyectos')` OR responsable del proyecto** (vía `proyecto_responsables` activo). Idempotentes para outbox (reintentos no duplican).

| RPC | Params | Efecto | Idempotencia |
|---|---|---|---|
| `crear_tarea_cronograma` | `p_id uuid` (client-gen, opcional), proyecto_id, fase_id, nombre, descripcion, tipo, orden, duracion_dias_plan, fecha_inicio_plan(opc), asignado_a(opc), es_prueba | inserta tarea; reencadena | `on conflict (id) do nothing` |
| `iniciar_tarea` | p_tarea_id | pendiente→en_curso, fecha_inicio_real | no-op si ya iniciada |
| `completar_tarea` | p_tarea_id, p_foto_path (req), p_justificacion (req si tarde) | →completada, fecha_fin_real, **recálculo en misma tx** | no-op si ya completada |
| `justificar_retraso` | p_tarea_id, p_justificacion | set justificacion_retraso | idempotente (set) |
| `recalcular_cronograma` | p_proyecto_id | reencadena todo + historial | pura/idempotente |
| `enlazar_bitacora_tarea` | p_tarea_id, p_bitacora_id, p_completar (bool opc) | inserta enlace; opcional dispara completar | `on conflict (tarea_id,bitacora_id) do nothing` |
| `listar_cronograma` | p_proyecto_id | devuelve tareas + recálculos (lectura) | — |

**Contrato para PROMPT-4 (app):** la app llama estos mismos RPCs vía outbox. `p_id` client-generado + guardas de estado garantizan que un reintento no duplica transiciones ni recálculos. La foto se sube al bucket privado (patrón photo-slot) y se pasa `p_foto_path`. Sin infra paralela.

---

## 8. Notificaciones (matriz)

Reutiliza: `avisos_proyecto` (in-app, dedup, estados) + `sgc.notificar(usuario,...)` (bell) + email Resend (edge function).

| Evento | Cuándo | Destinatario | Canal | dedup_key |
|---|---|---|---|---|
| Por iniciar | `X` días antes de `fecha_inicio_plan` (config, def. 3) | responsables del proyecto (+ `asignado_a` si existe) | in-app + email | `crono:{tarea_id}:por_iniciar` |
| Por vencer | `Y` días antes de `fecha_fin_plan` (config, def. 2) | responsables (+ asignado) | in-app + email | `crono:{tarea_id}:por_vencer` |
| Atrasada | día siguiente a `fecha_fin_plan` sin completar | responsables (+ asignado) | in-app + email; persiste hasta justificar/completar | `crono:{tarea_id}:atrasada` |

- **Sweep** `evaluar_avisos_cronograma()` (pg_cron diario 06:00, Template A del repo), modelado sobre `evaluar_avisos_vencimiento`: `insert ... on conflict (dedup_key) do update`, transición en sitio, **auto-resolución** (`resuelto_auto`) cuando la tarea inicia/completa o deja de aplicar. Dentro del sweep: `perform sgc.notificar(<responsable>, 'warning', titulo, mensaje, '/proyectos/<id>/cronograma?tarea=<tarea_id>')` para el bell, e invoca la edge de email.
- **Email:** clonar `notificar-flota` → **`notificar-cronograma`** (Resend ya integrado; `get_resend_api_key()` en Vault; `NOTIFICATIONS_FROM_EMAIL`). Destinatarios = `responsables_de_proyecto(proyecto_id)` (RPC existente → nombre+email). Plantilla ES simple: *"La tarea «X» del proyecto «Y» inicia en N días / vence en N días / está atrasada."* Registro de envíos auditable (tabla `cronograma_emails` o columna en el aviso — ⚠️ decisión menor, propongo columna `email_enviado_at` en el aviso).
- **Proveedor de email:** ✅ **Resend** (ya en uso en SGC, key en Vault). **No hay decisión de proveedor pendiente** — se reutiliza. Solo verificar que `NOTIFICATIONS_FROM_EMAIL` apunte al dominio verificado `sgcconstructorasd.com`.
- Front: canal `rt-cronograma` en `RealtimeNotificacionesService` + conteo en `NotificacionesService.refresh()` gateado a `hasModulo('proyectos')` (badge en el nav).

---

## 9. Integración con Bitácoras

- En el form "Nueva bitácora", en Sección 1 (tras `proyecto_id`), **selector opcional** "Esta bitácora avanza/completa la tarea… del cronograma" — filtrado por la obra elegida (reusa el hook `proyecto_id.valueChanges`).
- Al guardar la bitácora, tras crearla, se llama `enlazar_bitacora_tarea(p_tarea_id, p_bitacora_id, p_completar)`. Si el usuario marca "completa la tarea" y adjuntó foto, puede disparar `completar_tarea` usando una foto de la bitácora como evidencia. ⚠️ **(Confirmar: ¿la bitácora puede completar la tarea directamente, o solo enlazarla como evidencia y el completar se hace en el cronograma?** Propongo: enlazar siempre; completar solo si el usuario lo marca explícitamente.)
- El detalle de la tarea muestra sus bitácoras enlazadas (con deep-link `/bitacora/historial?item=<id>`); el detalle/historial de bitácora muestra un chip "🔗 Tarea de cronograma".

---

## 10. UI web (FASE 3)

- **Ruta nueva** `/(proyectos)/:id/cronograma` (resuelve G2: deep-link desde avisos/emails). Alternativamente pestaña dentro del drawer de `Lista`; **propongo ruta dedicada** para permitir deep-link y no engordar más `lista.ts` (~880 líneas).
- **Vista timeline (Gantt simple):** barras por tarea sobre eje de fechas; color por `tipo` (crítica/importante destacadas) y estado; barra plan vs marca real; hoy como línea vertical. SVG/CSS propio (sin librería externa, regla del repo).
- **Vista lista:** tabla con orden, nombre, tipo, fechas plan/real, estado, acciones.
- **Acciones** (según permisos): CRUD de tareas, **Iniciar**, **Completar** (con captura de foto — patrón photo-slot), **Justificar retraso**.
- **Historial de recálculos** visible (auditoría): quién liberó/recibió días y cuándo.
- Mejoras rápidas Y16 aprobadas (G2 deep-link; resto backlog).

---

## 11. Y16 — mejoras priorizadas

**Rápidas (esta ronda, si apruebas):**
- G1 — el Cronograma en sí.
- G2 — ruta de detalle de proyecto + deep-link a cronograma/tarea.

**Backlog documentado (no en esta ronda):**
- G3 — reconciliar los sistemas de avance (fases % / partidas / cronograma) en un solo indicador.
- G4 — auto-actualizar `proyecto_partidas.cantidad_ejecutada` desde `bitacora_actividades.cantidad`.
- G5 — seguridad a nivel de columna para `presupuesto`.
- G6 — incorporar cumplimiento de cronograma al KPI/ranking de encargados.
- Dependencias/DAG + ruta crítica calculada (CPM).
- Calendario de días laborables/feriados; integrar `horas_lluvia`/días adversos de bitácora al recálculo.
- Re-baseline formal (snapshots del plan).

---

## 12. Permisos / RLS

- `cronograma_tareas`, `cronograma_recalculos`, `cronograma_tarea_bitacoras`: **SELECT** = mismo scope que `proyectos` (admin OR `tiene_modulo('proyectos')` OR responsable/miembro del proyecto). **INSERT/UPDATE/DELETE** = admin OR `tiene_modulo('proyectos')` OR responsable del proyecto (`proyecto_responsables` activo). Escrituras reales solo vía RPC SECURITY DEFINER (que revalida).
- `es_prueba`: política "oculta a no-admin" (patrón del repo) para aislar datos de prueba.
- Grants de tabla + secuencias explícitos (gotcha recurrente).

---

## 13. Plan de implementación (tras aprobación)

- **FASE 1 — BD:** 3 tablas + ALTER `avisos_proyecto` + ALTER bitácora-enlace; RPCs; RLS/grants; migración de convivencia (fase = contenedor). Migraciones fechadas en `sql/`.
- **FASE 2 — Lógica auto-ajuste + sweep:** `recalcular_cronograma` + historial; `evaluar_avisos_cronograma` + pg_cron; tests SQL reproducibles.
- **FASE 3 — UI web:** ruta + Gantt simple + lista + acciones + captura de foto + historial; integración bitácora.
- **FASE 4 — Notificaciones:** avisos in-app + realtime + badge; edge `notificar-cronograma` + plantilla ES + registro de envíos.
- **FASE 5 — Contrato app:** verificar RPCs llamables por roles de app + idempotencia outbox; documentar el contrato aquí ("como quedó").
- **Verificación:** escenario completo en proyecto `es_prueba` (crear cronograma con ordinarias + 1 crítica → completar una ordinaria antes → la crítica gana los días + historial → dejar vencer una → aviso+email+justificación → completar con foto → bitácora enlazada).

---

## 14. Decisiones pendientes (⚠️ requieren tu OK antes de FASE 1)

1. **"atrasada" como condición derivada** (no cuarto estado). — recomendado. ¿OK?
2. **Holgura general** cuando no hay crítica/importante adelante (los días adelantan el fin del proyecto). — asunción de Xaviel = sí. ¿Confirmas?
3. **Días calendario** (no laborables) en v1. ¿OK, o necesitas excluir domingos/feriados desde ya?
4. **Bitácora → completar tarea:** ¿la bitácora puede completar la tarea, o solo enlazarla como evidencia? — propongo enlazar siempre; completar solo si se marca explícito.
5. **`asignado_a` por tarea** (opcional) además de los responsables del proyecto. ¿Lo quieres, o basta con notificar a los responsables del proyecto?
6. **Ubicación de la UI:** ruta dedicada `/proyectos/:id/cronograma` (recomendado) vs pestaña en el drawer actual. ¿Preferencia?
7. **Fase = contenedor** de tareas (agrupador), manteniendo Fases actuales intactas. ¿OK?
8. Umbrales de aviso por defecto: **por iniciar 3 días**, **por vencer 2 días**. ¿Ajustar?

Nada se implementa hasta tu aprobación de este documento (metodología SGC).

---

## 15. COMO QUEDÓ (implementado 28/07/2026)

Migraciones aplicadas a prod y verificadas por impersonación (todo en transacciones con rollback; sin datos de prueba persistidos):
- `sql/2026-07-28-y15-cronograma-schema.sql` — tablas `cronograma_tareas`, `cronograma_recalculos`, `cronograma_tarea_bitacoras`; ALTER `avisos_proyecto` (tipos cronograma + estado `resuelto_auto` + `resuelto_at/nota` + `email_enviado_at` + índice dedup); helpers `puede_gestionar_cronograma()` / `puede_ver_cronograma()`; RLS + grants; `es_prueba`.
- `sql/2026-07-28-y15-cronograma-rpcs.sql` — RPCs + auto-ajuste + sweep + pg_cron `sgc-cronograma-avisos` (06:15 diario).
- `sql/2026-07-28-y15-cronograma-storage.sql` — bucket privado `sgc-cronograma` (foto de evidencia).

### Contrato de RPCs (para PROMPT-4 — la app llama esto vía outbox, sin infra paralela)
| RPC | Firma | Idempotencia |
|---|---|---|
| `crear_tarea_cronograma` | `(p_proyecto_id uuid, p_nombre text, p_tipo text='ordinaria', p_duracion_dias_plan int=1, p_orden int=null, p_fase_id uuid=null, p_descripcion text=null, p_fecha_inicio_plan date=null, p_es_prueba bool=false, p_id uuid=null)` → uuid | `p_id` client-gen → no duplica |
| `iniciar_tarea` | `(p_tarea_id uuid, p_fecha_inicio date=null)` → void | no-op si ya iniciada/completada |
| `completar_tarea` | `(p_tarea_id uuid, p_foto_path text, p_justificacion text=null, p_fecha_fin date=null)` → void | no-op si ya completada; 1 solo recálculo |
| `justificar_retraso` | `(p_tarea_id uuid, p_justificacion text)` → void | set |
| `recalcular_cronograma` | `(p_proyecto_id uuid)` → void | pura/idempotente |
| `enlazar_bitacora_tarea` | `(p_tarea_id uuid, p_bitacora_id uuid, p_completar bool=false, p_foto_path text=null)` → void | `on conflict do nothing` |
| `listar_cronograma` | `(p_proyecto_id uuid)` → jsonb `{tareas,recalculos}` | lectura |

Reglas verificadas: adelanto (ordinaria 2d→1d) donó +1d a la crítica siguiente (`adelanto_dona_critica`); retraso 3d registró `retraso_empuje -3` y empujó la siguiente; foto obligatoria y justificación-si-tarde bloquean con error; idempotencia (crear/iniciar/completar repetidos no duplican, 1 solo recálculo); sweep genera `cronograma_atrasada` + bell al responsable con deep-link; RRHH sin módulo → `42501`.

### UI (web)
- Ruta `/(proyectos)/:id/cronograma` (`pages/proyectos/cronograma/`): Timeline (Gantt simple SVG/CSS, color por tipo, plan vs real, línea de hoy) + Lista (CRUD, Iniciar/Completar con foto, Editar/Eliminar, indicador Atrasada, justificación) + historial de recálculos. Entrada desde el drawer de detalle de proyecto (botón "📅 Cronograma" junto a Fases).
- Servicio `CronogramaService`, modelo `cronograma.model.ts`.

### Notificaciones
- Bell: `sgc.notificar()` a cada responsable del proyecto (fluye por la campana/realtime existente). Avisos en `avisos_proyecto` (dedup estable, auto-resolución).
- Email: edge `notificar-cronograma` (Resend, secreto compartido `cronograma_sync_secret` en Vault + `CRONOGRAMA_SYNC_SECRET` en la función, `--no-verify-jwt`); el sweep la invoca por `net.http_post`. Verificado: secreto válido + proyecto sin responsables → skip (sin email); secreto inválido → 401.

### Integración Bitácoras
- Selector opcional "Tarea del cronograma" en el form de nueva bitácora (aparece si el proyecto tiene tareas activas) → al guardar, `enlazar_bitacora_tarea` (enlace como evidencia).

### Follow-ups completados (web 1.33.0, 28/07/2026)
- ✅ Completar la tarea DESDE la bitácora: checkbox "Marcar la tarea como completada"; usa la primera foto de la bitácora como evidencia (best-effort, no bloquea el guardado).
- ✅ Detalle de la tarea lista sus bitácoras enlazadas (botón 🔗, deep-link a `/bitacora/historial?item=`); chip "🔗 Tarea" en el historial de bitácora (embed inverso `cronograma_tarea_bitacoras`).
- ✅ Badge en el nav de Proyectos = alertas de clima + avisos de cronograma pendientes.
- ✅ `NOTIFICATIONS_FROM_EMAIL = notificaciones@sgcconstructorasd.com` — dominio verificado en Resend (comprobado por probe a `delivered@resend.dev` → 200).

### Backlog Y16 restante (no en esta ronda — sección 11)
- Reconciliación de avances (fases % / partidas / cronograma) en un indicador.
- Auto-actualizar `proyecto_partidas.cantidad_ejecutada` desde `bitacora_actividades`.
- Seguridad a nivel de columna para `presupuesto`.
- Dependencias/DAG + ruta crítica (CPM); calendario de días laborables/feriados; re-baseline.
