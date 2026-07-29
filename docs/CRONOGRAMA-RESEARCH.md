# Cronograma de Proyectos — Investigación MS Project + diseño de dependencias (AA24)

> PROMPT-9 · FASE 4. Deep research de cómo funciona Microsoft Project, qué aplica a una constructora como CSD, qué implementamos en **v1** (dependencias FS/SS/FF + lag) y qué queda como **backlog diseñado** (ruta crítica, baseline, calendario laboral RD, recursos).
>
> Punto de partida: el cronograma actual (Y15/Y16, Gantt Z16) es una **cadena lineal por `orden`** con un único motor de fechas, `sgc.recalcular_cronograma`, y un auto-ajuste que dona días sobrantes a la siguiente tarea crítica (`completar_tarea`). Ver `docs/cronograma-diseno.md`.

---

## 1. Cómo funciona Microsoft Project (modelo conceptual)

MS Project es un programador basado en la **teoría de redes de actividades (CPM/PERT)**. Sus piezas:

### 1.1 Tareas, duración y calendario
- Cada tarea tiene **duración** (en días u horas laborables), **inicio** y **fin**. Las fechas NO se digitan: se **calculan** a partir de la duración, las dependencias y el **calendario laboral** (días/horas hábiles, feriados). Un "día" de duración = un día *laborable*, no calendario.
- **Tareas resumen (WBS)**: agrupan sub-tareas; su duración/fecha se derivan de las hijas.
- **Hitos (milestones)**: duración 0, marcan un punto de control (ej. "Entrega de planos").

### 1.2 Dependencias (el corazón)
Cuatro tipos de relación entre predecesora (P) y sucesora (S):

| Tipo | Nombre | Regla | Uso típico en obra |
|------|--------|-------|--------------------|
| **FS** | Fin→Comienzo (Finish-to-Start) | S empieza cuando P termina | El default. "Fundir zapatas" → "levantar muros" |
| **SS** | Comienzo→Comienzo (Start-to-Start) | S empieza cuando P empieza | "Excavación" y "bombeo de agua" arrancan juntas |
| **FF** | Fin→Fin (Finish-to-Finish) | S termina cuando P termina | "Instalación eléctrica" y "supervisión eléctrica" cierran juntas |
| **SF** | Comienzo→Fin (Start-to-Finish) | S termina cuando P empieza | Raro; relevos de turno. **Casi no se usa.** |

- **Lag / Lead (retraso / adelanto)**: un desfase en días sobre la relación. `FS+2` = S empieza 2 días *después* de que P termine (tiempo de fraguado). `FS-1` (lead) = S puede empezar 1 día *antes* de que P termine (solape). El lead es un lag negativo.
- Una tarea puede tener **varias predecesoras**; su inicio es el **máximo** de todas las restricciones.

### 1.3 Programación automática y ruta crítica (CPM)
- MS Project hace un **forward pass** (calcula inicio/fin más tempranos, ES/EF, desde el inicio del proyecto hacia adelante siguiendo las dependencias) y un **backward pass** (calcula inicio/fin más tardíos, LS/LF, desde la fecha fin hacia atrás).
- **Holgura total (total float/slack)** = LS − ES. Tareas con holgura 0 forman la **ruta crítica**: cualquier atraso ahí atrasa todo el proyecto. **Holgura libre** = cuánto puede atrasarse una tarea sin afectar a su sucesora inmediata.
- **Restricciones de fecha**: ASAP (lo antes posible, default), ALAP, "no empezar antes de", "no terminar después de", "debe empezar el". Compiten con las dependencias.

### 1.4 Baseline (línea base)
- Una **foto congelada** del plan aprobado (fechas/duraciones/costos). El avance real se compara contra la baseline → **variación** (¿vamos adelantados o atrasados vs. lo prometido?). Se pueden guardar hasta 11 baselines.

### 1.5 Recursos y nivelación
- Se asignan **recursos** (personas, maquinaria) a tareas con un % de dedicación. La **nivelación** detecta sobre-asignación (un recurso en 2 tareas simultáneas > 100%) y reprograma para resolver el conflicto.

---

## 2. Qué aplica a una constructora como CSD

| Concepto MS Project | ¿Aplica a CSD hoy? | Nota |
|---|---|---|
| Dependencias FS/SS/FF + lag | **Sí, ya** | En obra las relaciones son estrechas (fundir→curar→levantar). Es lo que Xaviel pidió. **v1.** |
| SF | Marginal | Casi no se usa en construcción. Se documenta; opcional. |
| Recálculo en cadena | **Sí, ya** | Al mover/atrasar una tarea, sus sucesoras se recorren. **v1.** |
| Ruta crítica calculada (CPM) | Sí, valioso | Hoy la criticidad es **declarada** (`tipo` = crítica/importante/ordinaria), no calculada. Backlog: calcularla con holguras. |
| Calendario laboral RD (feriados, domingos) | Sí, muy valioso | Hoy la duración es en días **calendario**. La bitácora ya modela `horas_lluvia`/`sin_actividad`. Backlog. |
| Baseline plan vs real | Sí | Hoy se guardan `fecha_*_plan` y `fecha_*_real`, pero no una baseline congelada formal. Backlog. |
| Hitos (duración 0) | Sí, fácil | Se puede permitir `duracion_dias_plan = 0`. Backlog corto. |
| WBS / tareas resumen | Parcial | Existe `fase_id` como contenedor. No hay roll-up de fechas. Backlog. |
| Recursos + nivelación | Parcial | El "Ranking de Encargados" y `proyecto_responsables`/`proyecto_empleados` tocan recursos, pero no hay nivelación. Backlog largo. |

---

## 3. Qué implementamos AHORA — v1 (dependencias + lag)

### 3.1 Modelo de datos
Tabla aditiva `sgc.cronograma_dependencias`:
- `predecesora_id`, `sucesora_id` (FK a `cronograma_tareas`, cascade).
- `tipo` ∈ (`FS`, `SS`, `FF`) — **`SF` documentado pero fuera de v1** (raro; complica el pase).
- `lag_dias int` (default 0; negativo = lead/adelanto).
- `unique(predecesora_id, sucesora_id)`; ambas tareas del **mismo proyecto** (validado).

### 3.2 Regla de cálculo por tipo (la sucesora S, con duración `dS`)
Para cada dependencia se calcula el **inicio mínimo** que impone la predecesora P, y el inicio real de S = **máximo** sobre todas sus predecesoras (y, si no tiene, el ancla del proyecto):

| Tipo | Inicio impuesto a S |
|------|----------------------|
| **FS** | `P.fin + 1 + lag` |
| **SS** | `P.inicio + lag` |
| **FF** | `(P.fin + lag) − (dS − 1)` → S termina cuando P (más lag), así que empieza `dS−1` días antes de ese fin |
| SF (backlog) | S termina en `P.inicio + lag` |

### 3.3 Recálculo topológico + convivencia con el auto-ajuste Y15
El motor `recalcular_cronograma` pasa de un **bucle lineal por `orden`** a un **pase topológico sobre el DAG de dependencias**:

1. **Orden topológico** de las tareas (Kahn). Si hay ciclo → error (se valida al crear la dependencia, pero el pase también se protege).
2. Para cada tarea en orden topológico:
   - Si está **completada** → sus fechas reales son la base (igual que hoy), y actúa como ancla fija para sus sucesoras.
   - Si NO tiene predecesoras → arranca en el **ancla del proyecto** (igual que hoy: primera tarea / `proyectos.fecha_inicio` / hoy). Esto preserva el comportamiento actual para proyectos **sin dependencias** (100% de los existentes) → **cero regresión**.
   - Si tiene predecesoras → `inicio = max(restricción de cada predecesora)` según la tabla 3.2; `fin = inicio + duracion − 1`.
3. **Convivencia con Y15 (días sobrantes → siguiente crítica).** Regla explícita, en este orden:
   - **Primero mandan las dependencias.** El pase topológico fija las fechas respetando FS/SS/FF+lag.
   - **Luego** opera la regla de días sobrantes de `completar_tarea`: cuando una tarea termina antes de su fin planificado, el excedente se **dona a la duración** de la siguiente tarea *crítica/importante* (por `orden`), y el pase topológico vuelve a correr sobre las fechas ya restringidas por dependencias. Es decir, Y15 sigue regalando "duración" a la crítica, pero las **fechas resultantes** ya no se calculan por `orden` sino por el grafo. Si una tarea tiene predecesoras, su inicio lo mandan ellas, no el ancla corrida de Y15 — y eso es lo correcto.
   - Todo recálculo se registra en `cronograma_recalculos` (motivos existentes: `adelanto_dona_critica`, `holgura_general`, `retraso_empuje`).
4. **Sin ciclos, mismo proyecto**: validado en el RPC de crear dependencia (`crear_dependencia_tarea`) con detección de ciclo (¿la predecesora es alcanzable desde la sucesora?).

### 3.4 UI
- Al crear/editar tarea: sección **"Predecesoras"** — selector de tarea del proyecto + tipo (FS/SS/FF) + lag en días. Se pueden agregar varias.
- El **Gantt (Z16)** dibuja **una flecha por dependencia real** (no ya la adyacencia por `orden`), con el tipo y el lag en el tooltip. El color/estilo distingue FS/SS/FF.
- La app (PROMPT-10) consume y muestra las dependencias en **solo lectura**.

### 3.5 Contrato para la app (solo lectura v1)
`listar_cronograma(proyecto_id)` devuelve, además de `tareas` y `recalculos`, un array `dependencias`:
```json
{ "id": "...", "predecesora_id": "...", "sucesora_id": "...", "tipo": "FS", "lag_dias": 2 }
```
La app dibuja las flechas/indicadores; no edita dependencias en v1.

---

## 4. Backlog diseñado (NO implementar en esta ronda)

1. **Ruta crítica calculada (CPM):** forward/backward pass completo → holgura total y libre por tarea; marcar la ruta crítica real en el Gantt (en vez de la criticidad declarada por `tipo`). El pase topológico de v1 es la base: agregarle el backward pass.
2. **Baseline formal:** tabla `cronograma_baselines` (snapshot de fechas/duraciones al aprobar el plan) + vista de variación plan-baseline vs real.
3. **Calendario laboral RD:** tabla de feriados dominicanos + días no laborables (domingos), y que la duración cuente días **hábiles**. Integrar con `horas_lluvia`/`sin_actividad` de la bitácora para descontar días perdidos automáticamente.
4. **Hitos** (duración 0) y **tareas resumen** con roll-up de fechas por `fase_id`.
5. **Recursos + nivelación:** asignar encargados/maquinaria a tareas (reusando `proyecto_responsables`/flota) y detectar sobre-asignación.
6. **Restricciones de fecha** ("no antes de", "debe empezar el") que compitan con las dependencias.
7. **SF (Start-to-Finish)** si algún flujo real lo requiere.

---

## 5. Resumen de la decisión

- **v1 (esta ronda):** dependencias FS/SS/FF + lag, validación anti-ciclo y mismo-proyecto, recálculo topológico que **respeta primero las dependencias y luego** el auto-ajuste Y15 (sin romperlo, sin regresión para proyectos sin dependencias), flechas reales en el Gantt, contrato de solo-lectura para la app.
- **Backlog:** CPM/ruta crítica, baseline, calendario laboral RD, hitos/WBS, recursos/nivelación, SF.
