# AY15 — Submódulo tipo Jira interno (propuesta v1)

> Para el trabajo de desarrollo de Xaviel/Tecnología. Solo-admin (`es_tecnologia`).
> **⏸ PAUSA:** valida el alcance v1 ANTES de construir. Si apruebas en la misma
> sesión, se construye el board Kanban + CRUD de issues como v1.

## Cómo funciona Jira (resumen del research)

Jira/Azure DevOps organizan el trabajo así:
- **Issues tipados**: `epic` (grande, agrupa), `story`/`task` (trabajo normal), `bug`, `mejora`. Cada uno con título, descripción (markdown), estado, prioridad, asignado, labels, comentarios, adjuntos.
- **Backlog**: lista priorizada de issues sin empezar.
- **Board Kanban**: columnas por estado (Backlog → To Do → In Progress → In Review → Done); las tarjetas se arrastran entre columnas (drag&drop) y eso cambia el estado.
- **Prioridades**: Lowest/Low/Medium/High/Highest (o P0-P4). Se pintan con color/ícono (no todo rojo — regla AY3).
- **Labels/etiquetas**: libres, para filtrar (ej. `web`, `app`, `db`, `urgente`, `deuda-técnica`).
- **Épicas**: agrupan issues por tema grande; una épica tiene su propia barra de progreso (issues cerrados / total).
- **Comentarios + adjuntos + historial de cambios** por issue.
- **Filtros/búsqueda** (Jira usa JQL; para v1 basta filtrar por tipo/estado/prioridad/label/texto).
- **Sprints + burndown**: iteraciones con fecha; gráfico de trabajo restante. → **v2** (no en v1).

## Alcance v1 propuesto (a validar)

**Board Kanban** con 5 columnas: `Backlog · Por hacer · En progreso · En revisión · Hecho`.
Drag&drop entre columnas (cambia el estado). Cada columna muestra el conteo.

**Issue** (modelo):
| Campo | Notas |
|---|---|
| tipo | `tarea` \| `bug` \| `mejora` \| `epica` |
| titulo | requerido |
| descripcion | markdown |
| estado | mapea a las 5 columnas |
| prioridad | `baja` \| `media` \| `alta` \| `urgente` (chips de color, AY3) |
| labels | text[] libre + sugeridos (web/app/db/deuda) |
| asignado_a | usuario (Xaviel por defecto) |
| epica_id | opcional (agrupa bajo una épica) |
| orden | posición dentro de la columna (para el drag&drop) |
| adjuntos | bucket privado `sgc-jira` |
| comentarios | tabla hija con autor+texto+fecha |
| historial | tabla hija de cambios de estado/campos |
| origen_reporte_id | **AW14** — vínculo opcional al reporte de error que lo originó |

**Pantallas v1**:
1. **Board** (Kanban drag&drop) — vista principal.
2. **Detalle del issue** (drawer/página): editar campos, comentar, adjuntar, ver historial.
3. **Crear issue** (desde el board o desde un reporte de error, AW14).
4. **Filtros**: por tipo/estado/prioridad/label + búsqueda de texto.

**Acceso**: solo `es_tecnologia` (admin | tecnología | gerencia | dirección) — igual que la consola "Sistema". RLS restrictiva.

**Modelo de datos (borrador)**:
- `sgc.jira_epicas (id, titulo, descripcion, color, estado, created_by, created_at)`
- `sgc.jira_issues (id, tipo, titulo, descripcion, estado, prioridad, labels text[], asignado_a, epica_id, orden, origen_reporte_id, es_prueba, created_by, created_at, updated_at)`
- `sgc.jira_comentarios (id, issue_id, autor_id, texto, created_at)`
- `sgc.jira_historial (id, issue_id, actor_id, campo, antes, despues, at)`
- Bucket `sgc-jira` (privado) para adjuntos + `sgc.jira_adjuntos`.
- RPCs: `jira_issue_crear/actualizar/mover(estado,orden)/comentar/listar(filtros)`, `jira_crear_desde_reporte(reporte_id)` (AW14).

**Vínculo AW14** ("crear issue desde un reporte de error"): en `/tecnologia/reportes-errores`, un botón "Crear issue" prellena un issue tipo `bug` con el detalle del reporte y guarda `origen_reporte_id`.

## Fuera de v1 (v2+)
Sprints, burndown/velocity, sub-tareas, estimación en puntos, workflows configurables, menciones @, notificaciones por issue, tableros múltiples.

## Estimación
- Backend (tablas + RLS + RPCs + bucket): ~M.
- Web (board drag&drop + detalle + filtros + crear-desde-reporte): ~M-L.
- App (PROMPT-30): solo lectura/consulta en v1 (opcional).

> **Decisión pendiente de Xaviel**: ¿apruebas este alcance v1 tal cual, o ajustas
> columnas/tipos/labels? Al aprobar, se construye en esta ronda o la siguiente.
