# GESTIÓN DE PRODUCCIÓN DE OBRA — Diseño (v1) — AG16 / PROMPT-7

> **Estado: FASE 0 — documento de diseño para aprobación (⏸ PAUSA).** Nada implementado todavía.
> Ronda 04/08/2026 · IDs AG · Depende de PROMPT-5 (AG12 roles granulares, AG14 notificaciones, AG15 tareas dinámicas — **ya aplicados en `main`**).
> Fuente: descriptivo del **Gerente de Producción de Obra** (SCHEKER & DOMÍNGUEZ), §G de `CONTEXTO-ACTUALIZACION-1.md`.
> Regla madre: **SGC padre, csd-app hijo** · todo aditivo/retrocompatible · reutilizar lo existente, **cero infra paralela** · UI español / código inglés · **TODO lo de campo debe poder hacerse desde la app**.

---

## 0. Hallazgo clave de la auditoría (esto cambia el diseño)

Ya existe una base de "ejecución de obra" real en el repo — **CSD-OPE-01 "Ola 2"** (`sql/2026-07-13-ola2-ejecucion-obra.sql`) + cronograma Y15/AA24 + bitácoras. **La v1 EXTIENDE esto; no crea un módulo nuevo desde cero.** Lo que ya existe:

| Área | Ya existe en el repo | Grado |
|---|---|---|
| Frentes/elementos de obra | `obra_elementos` (tipo, código, eje, bloque) + `obra_vaciados` | ✅ sólido |
| **No conformidades** | `obra_no_conformidades` (descripción, severidad, estado abierta/cerrada, `bloquea_vaciado`, trigger que bloquea el vaciado) | 🟡 mínimo — falta tipo/fotos/responsable/acción correctiva/verificación |
| **Charla de seguridad** | `charlas_seguridad` (tema, notas, asistentes, fotos[], firmas[]) | 🟡 tabla existe, sin UI de campo ni vínculo al plan del día |
| **Checklists de calidad** | `cl_plantillas`/`cl_plantilla_items` + `cl_registros`/`cl_registro_items`/`_firmas`/`_fotos` (CL-01..07 liberación) — **motor de checklist de obra data-driven ya montado** | 🟡 motor existe (enfocado a liberación); generalizar a QA por actividad |
| **Informe semanal** | `informes_semanales` (contenido, avance_pct, creado_por) | 🟡 tabla vacía de lógica — falta auto-compilado + PDF + envío |
| Reporte de pérdidas/daños | `reportes_perdidas` (tipo, descripción, fotos[], bodega) | 🟡 existe, sin UI |
| Cronograma / avance | `cronograma_tareas` (plan vs real, estados binarios), `cronograma_dependencias` (FS/SS/FF), catálogo Z15 | 🟡 avance = conteo binario; **sin % por tarea, sin baseline congelado, sin curva-S** |
| Avance por cantidades | `proyecto_partidas` (cantidad_planeada / cantidad_ejecutada) → `v_proyecto_avance` | 🟡 `cantidad_ejecutada` se teclea a mano, no viene del campo |
| Requisiciones + urgencia | `solicitudes_material` con **`urgencia` (normal/urgente)** + `proyecto_id`, flujo A2 (`aprobar_requisicion` auto-split despacho+compra) | ✅ sólido |
| Stock por obra | `stock_por_bodega` ⋈ `bodegas.proyecto_id`; RPC `existencias_de_obra(proyecto_id)` | ✅ (grano = bodega, no frente) |
| Costo material por obra | RPC `costo_material_obra` (AA23) | ✅ |
| Incidentes de obra | Bitácora tipo `incidente` (incidente_tipo, gravedad, subcontratista, fotos+lightbox) | 🟡 registro sí, investigación/acción correctiva no |
| Notificaciones | `notificar()` (in-app+push), `send_push`, email Resend, `notificaciones_config` (AG14) | ✅ listo |
| Tareas dinámicas | `tareas.linked_tipo/linked_id/linked_params` + `sincronizar_tareas_vinculadas` (AG15) — enum hoy: conduce/ruta/mantenimiento/cronograma | ✅ listo para extender |

**Ausente por completo (greenfield):** subcontratistas + **cubicaciones**; curva-S / avance histórico; **horas hombre por obra** (`asistencia` no tiene dimensión de obra ni horas); calendario de logística / pruebas de campo; motor de PDF real (hoy solo `window.print()` + blob msword — **no hay jsPDF/pdfmake**).

---

## 1. Arquitectura y decisiones de diseño

### 1.1 Módulo, no páginas sueltas
Nace el módulo de permisos **`obra`** (Gestión de Producción de Obra) — distinto de `proyectos` (planificación/oficina) y `bitacora` (parte diario). Todo lo de CSD-OPE-01 (hoy gated bajo `proyectos`/`bitacora`) se **re-expresa** bajo `obra` sin romper accesos actuales (los roles que ya ven la pestaña Ejecución conservan acceso vía retrocompatibilidad AG12: tener el módulo padre ⇒ `operar`).

**Submódulos AG12** (`modulo.submodulo` → nivel `ver`/`operar`):
- `obra.plan_dia` — plan del día + charla de seguridad
- `obra.no_conformidades` — NC e incidentes de obra
- `obra.checklists` — checklists de calidad por actividad
- `obra.subcontratistas` — subcontratistas + cubicaciones
- `obra.avance` — % avance real, desviaciones, curva
- `obra.informes` — informe semanal a Gerencia

**Ubicación en la web:** una **pestaña "Producción" nueva en el detalle del proyecto** (`/proyectos/:id`, junto a las existentes Ejecución/Partidas/Estructuras) para lo ligado a UNA obra, **+ una bandeja transversal** `/obra` (No conformidades e informes de TODAS las obras, para el gerente que lleva varias). Reutiliza el shell y el patrón de tabs de `lista.ts`.

### 1.2 Roles nuevos (AG12)
| Rol (código) | Módulos | Nivel en submódulos `obra.*` | Idea |
|---|---|---|---|
| `gerente_produccion` | `obra`, `bitacora`, `proyectos`(ver), `inventario`(ver), `compras.solicitudes`(operar) | **operar** en todos | Protagonista: planifica el día, cierra NC, aprueba cubicaciones, genera informe |
| `capataz` | `obra` | `plan_dia`=operar (ejecuta su brigada), `no_conformidades`=operar (levanta), `checklists`=operar, resto=ver o sin acceso | Campo: ve su plan del día, levanta NC, ejecuta checklists |

Se añaden a `MODULOS_DISPONIBLES` + `SUBMODULOS` en `roles.service.ts`, guards de ruta, nav en `shell.ts`, `array_append('obra')` al rol admin, y policies RLS que leen `puede_ver/operar_submodulo`. Los roles existentes (`gerente_proyectos`, `ingeniero_campo`, `ingeniero_oficina`, `direccion`, `gerencia`) reciben `obra` de forma que **hoy no cambie lo que ven** (heredan `operar` por tener módulo padre, patrón AG12).

### 1.3 Un solo motor de acción correctiva
NC (calidad/orden/EPP/seguridad) e **incidentes/casi-accidentes** comparten una tabla `obra_acciones_correctivas` (responsable, fecha compromiso, estado abierta→hecha→verificada). NC e incidente son "orígenes" distintos del mismo motor. Esto evita dos sistemas de seguimiento.

---

## 2. Diseño por rutina (las 10)

### Rutina 1 — Plan del día + charla de seguridad `obra.plan_dia`
- **Plan del día**: por obra y fecha, el gerente/capataz asigna las tareas del día a **capataces/brigadas**. Fuente de tareas: (a) `cronograma_tareas` en curso/próximas del proyecto, (b) catálogo Z15 `cronograma_tareas_catalogo`, (c) texto libre. Cada asignación crea una **`sgc.tareas`** (reusa Tareas + AG15) con `proyecto_id` y, si sale del cronograma, `linked_tipo='cronograma'` + `linked_id`.
  - **Brigadas**: hoy Tareas solo asigna a `usuarios`. **Decisión v1:** el capataz es un `usuario`; "brigada" = etiqueta de texto en la tarea (`linked_params.brigada`). Modelo de brigadas formal → backlog.
- **Charla de seguridad**: reutiliza **`charlas_seguridad`** (ya existe) — tema, duración (add `duracion_min`), asistentes (int + opcional lista), foto(s), firmas. UI de captura nueva (web + app). Se ancla al plan del día de esa fecha.
- **Web**: vista "Día de obra" por obra (fecha) → charla + tareas asignadas + estado.
- **App** (PROMPT-8): el capataz ve su plan del día y marca avance; registra la charla desde campo.

### Rutina 2 + 9 — No conformidades e incidentes `obra.no_conformidades`
**Extender `obra_no_conformidades`** (aditivo, el trigger de bloqueo de vaciado sigue igual):
- add `tipo text` CHECK (`calidad|orden_limpieza|epp|seguridad`), `ubicacion text` (frente/eje/bloque libre), `responsable_id uuid`, `fotos text[]`, `fecha_deteccion date`, `verificada_por uuid`, `verificada_en timestamptz`, `estado` amplía a `abierta|en_correccion|verificada|cerrada` (compat: `cerrada` sigue válido).
- Nueva **`obra_acciones_correctivas`** (`origen_tipo` nc|incidente, `origen_id`, `descripcion`, `responsable_id`, `fecha_compromiso`, `estado` abierta|hecha|verificada, `evidencia_fotos[]`).
- **Incidentes/casi-accidentes de obra**: nueva `obra_incidentes` (`proyecto_id`, `tipo` casi_accidente|incidente|accidente, `descripcion`, `gravedad`, `lesionados`, `fotos[]`, `investigacion text`, `fecha`) → alimenta el mismo motor de acciones correctivas. (El tipo `incidente` de bitácora se mantiene para el parte diario; el incidente de obra formal con investigación vive aquí. Documentar el puente: un incidente de bitácora puede "escalar" a `obra_incidentes`.)
- **RPCs**: `levantar_nc`, `asignar_accion_correctiva`, `marcar_accion_hecha`, `verificar_cerrar_nc`, `registrar_incidente_obra` (idempotentes, patrón SECURITY DEFINER de la casa).
- **Ciclo**: abierta → acción correctiva (responsable+fecha) → hecha → verificada/cerrada.
- **Web**: bandeja por obra (abiertas / vencidas / cerradas) + detalle con timeline + KPIs (abiertas por obra, tiempo medio de cierre). Fotos con lightbox (reusa patrón bitácora/accidentes).
- **Notif (AG14)**: al asignar acción correctiva → `notificar()` al responsable; recordatorio al vencer (patrón avisos + `send_push`); nuevo evento en `notificaciones_config`.
- **App**: levantar NC con foto/ubicación en 30s; ver mis acciones correctivas asignadas.

### Rutina 3 — Recursos y pedidos urgentes `obra.plan_dia`/inventario
- **NO módulo nuevo**: reutiliza `solicitudes_material` (ya tiene `urgencia` + `proyecto_id` + flujo A2). Se añade acceso directo "Pedido urgente" desde la vista de obra (pre-llena `proyecto_id`, `urgencia='urgente'`).
- **Stock por obra/frente**: vista que agrupa `stock_por_bodega ⋈ bodegas.proyecto_id` (todas las bodegas de la obra) + `existencias_de_obra(proyecto_id)`. Grano = bodega (no hay frente físico de stock; se documenta como límite v1).
- **Seguimiento**: el pedido urgente ya aparece en la bandeja de Compras/Almacén (interconexión existente). Se añade badge de "urgentes por obra" en la vista de producción.

### Rutina 4 — Checklists de calidad de obra `obra.checklists`
- **Reutiliza el motor `cl_plantillas`/`cl_registros`** (ya es data-driven para obra) **generalizándolo**: hoy está sesgado a "liberación CL-01..07 con ciclo de firmas". Se añaden plantillas de QA por actividad (replanteo, niveles, encofrado, acero, hormigonado…) como filas nuevas de `cl_plantillas` con una `categoria='calidad'` (add columna si falta) — **sin tocar las CL de liberación**.
- **Alternativa considerada y descartada**: clonar el motor de `checklist_plantillas` de Flota → descartado porque `cl_*` ya es de obra y no arrastra FKs a vehículos.
- **Plantillas editables**: CRUD de plantillas de calidad (admin/gerente) — el motor ya tiene `cl_plantilla_items` (sección, etiqueta, orden); se añade edición desde UI.
- **Ejecución**: un `cl_registro` de tipo calidad, con respuestas `cumple` + comentario + fotos. **Un hallazgo "no cumple" ofrece levantar una NC** (Rutina 2) pre-llenada. Firmas opcionales (no obligar el ciclo de liberación para QA simple).
- **App**: ejecutar checklist de calidad en el frente, con fotos, offline-first.

### Rutina 5 — Subcontratistas + cubicaciones `obra.subcontratistas` (greenfield)
- **`obra_subcontratistas`** (`nombre`, `rnc`, `especialidad`, `contacto`, `activo`, opcional `proveedor_id` si ya existe como proveedor). No se mete en `proveedores` (son suplidores de material). Puente: `proyecto_empleados.externo_tipo='subcontratista'` puede promoverse a un `obra_subcontratistas`.
- **`obra_subcontratista_frentes`** — asignación de frentes/elementos + avance.
- **Cubicaciones** `obra_cubicaciones` (`subcontratista_id`, `proyecto_id`, `periodo`, `monto`, `avance_pct`, `detalle jsonb`/items, `estado` borrador→revision→aprobada→rechazada, `aprobada_por`, fotos/soportes) con **historial de aprobación** (`obra_cubicacion_eventos`). Reusa patrón de aprobación de requisiciones/OC.
- **Web**: registro + frentes + flujo de aprobación de cubicaciones, visible en el detalle del proyecto.
- **App**: medir avance de subcontratista en campo; cargar cubicación con soportes.

### Rutina 6 — Avance real vs cronograma `obra.avance` (mata el Excel)
- **% avance real por tarea**: `cronograma_tareas` hoy es binario. Se añade `avance_pct numeric` (0-100) por tarea, reportable desde campo (la tarea sigue teniendo estados; el % es granular). Rollup por fase y por obra.
- **Baseline congelado**: hoy `recalcular_cronograma` reescribe las fechas plan → no hay baseline. Se añade **snapshot de línea base** (`cronograma_baseline` — fechas plan congeladas al aprobar el cronograma) para comparar plan-original vs real.
- **Curva-S simple**: tabla `obra_avance_snapshots` (proyecto_id, fecha, avance_plan_pct, avance_real_pct) poblada por un sweep diario (pg_cron, reusa patrón `evaluar_avisos_cronograma`) → gráfica plan vs real en el detalle del proyecto. **Sin earned value completo** (backlog).
- **Desviaciones**: lista de tareas atrasadas (ya derivable) + delta plan/real visible.
- **App**: el capataz reporta % de avance de su tarea del día.

### Rutina 7 — Costos `obra.avance` (v1 acotado)
- **Consumo de materiales por obra**: ya está — RPC `costo_material_obra` (AA23) + `v_movimientos_inventario`. Se expone en la vista de producción (no se recalcula).
- **Rendimientos**: material consumido ÷ cantidad ejecutada (de `proyecto_partidas`). Cálculo de lectura, sin tabla nueva.
- **Horas hombre**: **`asistencia` no tiene obra ni horas.** Decisión v1: **backlog** (requiere `proyecto_id`+horas en asistencia o parte de mano de obra). Alternativa mínima v1: campo manual "horas hombre del día" en el plan del día (dato agregado, sin desglose por empleado). — **CONFIRMAR alcance con Xaviel.**
- **Validación de requisiciones**: retoma AA23 ⏸ — marcar requisiciones fuera de presupuesto/partida. v1: alerta de lectura (requisición vs partida). Motor de aprobación pesado → backlog.
- **Pérdidas/desperdicios**: UI para `reportes_perdidas` (ya existe la tabla).

### Rutina 8 — Logística `obra.avance` (v1 acotado)
- **Entradas programadas**: vista/calendario de `entradas_inventario` + OC con fecha esperada por obra (reusa datos existentes; se añade `fecha_programada` a OC/entrada si falta). Equipos pesados = entradas de tipo equipo.
- **Pruebas de campo**: nueva `obra_pruebas_campo` (`proyecto_id`, `tipo` slump/probeta/compactacion/otro, `fecha`, `resultado`, `fotos[]`, `notas`). Ligera.
- v1 puede entregar solo la vista de entradas programadas + pruebas de campo; calendario rico → backlog.

### Rutina 10 — Informe semanal de obra a Gerencia `obra.informes`
- **Reutiliza `informes_semanales`** (ya existe) — se le añade estructura: `periodo_inicio/fin`, `secciones jsonb` (auto-compiladas), `campos_manuales jsonb`, `estado` borrador→enviado, `pdf_path`.
- **Auto-compilado** (RPC `compilar_informe_semanal(proyecto_id, semana)`): junta del sistema — fotos de bitácoras de la semana, % avance (Rutina 6), NC abiertas/cerradas, incidentes, pedidos urgentes/pendientes, problemas críticos (avisos), necesidades. + secciones manuales del gerente.
- **PDF**: **no hay motor de PDF.** Decisión v1: **HTML imprimible + `window.print()`** (patrón existente de conduces/documentos) — cero dependencias nuevas. Si se quiere PDF server real (adjuntable al email) → evaluar `pdfmake`/edge (backlog, **CONFIRMAR con Xaviel**).
- **Envío a Gerencia**: al marcar "enviado" → `notificar()` in-app + push + **email Resend** (canal AG14 operativo) a los usuarios con módulo `direccion`/`gerencia`. Nuevo evento en `notificaciones_config`.
- **Historial** de informes por obra.

---

## 3. Alcance v1 vs Backlog

### ✅ v1 (este PROMPT-7)
1. Módulo `obra` + submódulos AG12 + roles `gerente_produccion`/`capataz` + pestaña Producción + bandeja `/obra`.
2. **No conformidades completas** (tipo/fotos/responsable/acción correctiva/verificación) + **incidentes de obra** + motor de acciones correctivas + notif. **(FASE 1)**
3. **Plan del día** (asignación desde cronograma/catálogo/Tareas) + **charla de seguridad** (UI sobre `charlas_seguridad`). **(FASE 2)**
4. **Checklists de calidad** por actividad (generalizar `cl_*`) + hallazgo→NC. **(FASE 2)**
5. **Subcontratistas + cubicaciones con aprobación**. **(FASE 3)**
6. **% avance real por tarea/fase** + baseline + **curva-S simple** + desviaciones. **(FASE 4)**
7. **Costos v1**: consumo material por obra (existente), rendimientos, pérdidas UI, validación requisición (alerta). **(FASE 4)**
8. **Logística v1**: entradas programadas + pruebas de campo. **(FASE 4)**
9. **Informe semanal auto-compilado** + PDF (print) + envío/notif a Gerencia + historial. **(FASE 5)**
10. Pedido urgente desde obra + stock por obra (reusa requisiciones). **(FASE 2/3)**

### 🔭 Backlog (fuera de v1 — documentado)
- Modelo formal de **brigadas** (hoy = etiqueta/usuario capataz).
- **Horas hombre por empleado por obra** (requiere rediseño de asistencia con dimensión obra) — v1 solo dato agregado manual opcional.
- **Earned Value Management** completo (CPI/SPI) — v1 solo curva-S plan vs real.
- **Motor de PDF server** (adjunto real al email) — v1 usa `window.print()`.
- **Calendario logístico rico** (drag/timeline) — v1 lista de entradas programadas.
- **Validación de requisición con aprobación/bloqueo por presupuesto** (AA23 pesado) — v1 solo alerta.
- Frente de trabajo como entidad física de stock (hoy grano = bodega).

---

## 4. Matriz App vs Web (regla: TODO lo de campo desde la app)

| Función | App (campo) | Web (gestión) |
|---|---|---|
| Plan del día: ver/marcar tareas | ✅ crear/ver/avanzar | ✅ crear/asignar/ver |
| Charla de seguridad (registrar) | ✅ (foto+firmas+asistentes) | ✅ |
| Levantar No Conformidad | ✅ (foto+ubicación) | ✅ |
| Acción correctiva: asignar / verificar | ✅ asignar; ✅ ver mías | ✅ asignar/verificar/cerrar |
| Incidente/casi-accidente | ✅ registrar+investigar | ✅ |
| Checklist de calidad (ejecutar) | ✅ offline-first | ✅ ejecutar + editar plantillas |
| Pedido urgente | ✅ | ✅ |
| Stock por obra | ✅ ver | ✅ ver |
| Subcontratistas / cubicaciones | ✅ medir avance / cargar cubicación | ✅ registro + aprobar |
| % avance real de mi tarea | ✅ reportar | ✅ ver/ajustar + curva |
| Pruebas de campo | ✅ registrar | ✅ ver |
| Informe semanal | ⭕ ver (generación en web) | ✅ generar/enviar |

Escritura de campo = **offline-first** (patrón hojas + outbox de csd-app).

---

## 5. Reutilización (dónde se apoya cada cosa — cero infra paralela)

| Nuevo | Reutiliza |
|---|---|
| No conformidades | **extiende** `obra_no_conformidades` (no crea tabla NC nueva) |
| Charla de seguridad | **`charlas_seguridad`** existente |
| Checklists de calidad | motor **`cl_plantillas`/`cl_registros`** existente |
| Plan del día | módulo **Tareas** + **AG15** linked tasks + catálogo **Z15** |
| Pedido urgente | **`solicitudes_material`** (`urgencia`) + flujo **A2** |
| Stock por obra | `stock_por_bodega`/`bodegas` + RPC `existencias_de_obra` |
| Avance | **`cronograma_tareas`** + `proyecto_partidas` + `v_proyecto_avance` |
| Costos | RPC **`costo_material_obra`** (AA23) + `v_movimientos_inventario` |
| Informe semanal | **`informes_semanales`** + fotos `sgc-bitacora` + pipeline **`window.print()`** |
| Notificaciones | **`notificar()`** + `send_push` + email Resend + `notificaciones_config` (AG14) |
| Roles/permisos | **AG12** (`roles.permisos` jsonb, `puede_ver/operar_submodulo`) |
| Fotos | buckets `sgc-bitacora` / `sgc-cronograma` + `SignedUrlCache` |

---

## 6. Contratos previstos para la app (PROMPT-8) — se cierran al implementar

RPCs SECURITY DEFINER idempotentes (patrón de la casa: `p_id` cliente-UUID, `p_*` params, retorno del id):
- `plan_del_dia(p_proyecto_id, p_fecha)` → charla + tareas del día.
- `registrar_charla_seguridad(p_id, p_proyecto_id, p_fecha, p_tema, p_duracion_min, p_asistentes, p_fotos, p_firmas)`.
- `levantar_nc(p_id, p_proyecto_id, p_tipo, p_descripcion, p_severidad, p_ubicacion, p_elemento_id, p_responsable_id, p_fotos, p_bloquea_vaciado)`.
- `asignar_accion_correctiva(p_id, p_origen_tipo, p_origen_id, p_descripcion, p_responsable_id, p_fecha_compromiso)`.
- `marcar_accion_hecha(p_accion_id, p_evidencia_fotos)` · `verificar_cerrar_nc(p_nc_id, p_nota)`.
- `registrar_incidente_obra(p_id, p_proyecto_id, p_tipo, p_descripcion, p_gravedad, p_lesionados, p_fotos, p_investigacion)`.
- `ejecutar_checklist_calidad(p_id, p_plantilla_id, p_proyecto_id, p_elemento_id, p_respuestas, p_fotos, p_observaciones)` (sobre `cl_registros`).
- `reportar_avance_tarea(p_tarea_id, p_avance_pct)` · `registrar_prueba_campo(p_id, ...)`.
- `crear_cubicacion(p_id, ...)` · `revisar_cubicacion(p_id, p_estado, p_nota)`.
- `compilar_informe_semanal(p_proyecto_id, p_periodo_inicio, p_periodo_fin)` · `enviar_informe_semanal(p_informe_id)`.
- Vistas de lectura app: `mis_tareas_app` (ya extendida AG15), `mis_nc_asignadas`, `stock_de_obra`.

Todo lo que la app cree (charla, NC, checklist, incidente, cubicación, avance, prueba) debe poder crearse también en la web (regla web-padre).

### 6.1 Contratos DEFINITIVOS para la app (PROMPT-8) — RPCs implementados y probados
Todos SECURITY DEFINER, `p_id` cliente-UUID (idempotentes), esquema `sgc`. Fotos → bucket `obra` (checklist/NC/incidente/charla) o `sgc-bitacora`.

**Plan del día / calidad-seguridad (FASE 1-2):**
- `plan_del_dia(p_proyecto_id uuid, p_fecha date) → jsonb {charla, tareas[]}`
- `registrar_charla_seguridad(p_id, p_proyecto_id, p_fecha, p_tema, p_duracion_min, p_notas, p_asistentes, p_fotos text[], p_firmas text[]) → uuid`
- `levantar_nc(p_id, p_proyecto_id, p_tipo, p_titulo, p_descripcion, p_severidad, p_ubicacion, p_elemento_id, p_vaciado_id, p_responsable_id, p_fotos text[], p_bloquea_vaciado) → uuid`
- `asignar_accion_correctiva(p_id, p_proyecto_id, p_origen_tipo, p_origen_id, p_descripcion, p_responsable_id, p_fecha_compromiso) → uuid`
- `marcar_accion_hecha(p_accion_id, p_evidencia_fotos text[])` · `verificar_cerrar_nc(p_nc_id, p_nota)`
- `registrar_incidente_obra(p_id, p_proyecto_id, p_tipo, p_descripcion, p_gravedad, p_lesionados, p_ubicacion, p_investigacion, p_fotos text[], p_elemento_id, p_bitacora_id, p_fecha) → uuid` · `cerrar_incidente_obra(p_id)`
- `ejecutar_checklist_calidad(p_id, p_plantilla_id, p_proyecto_id, p_elemento_id, p_respuestas jsonb, p_fotos jsonb, p_observaciones) → uuid` (respuestas: `[{etiqueta,seccion,cumple bool|null,comentario,orden}]`)

**Subcontratistas/cubicaciones (FASE 3):**
- `crear_cubicacion(p_id, p_subcontratista_id, p_proyecto_id, p_periodo_inicio, p_periodo_fin, p_descripcion, p_monto, p_avance_pct, p_detalle jsonb, p_soportes text[]) → uuid`
- `enviar_cubicacion(p_id)` · `revisar_cubicacion(p_id, p_estado 'aprobada'|'rechazada', p_nota)`
- Subcontratistas y frentes: escritura directa por RLS (`obra_subcontratistas`, `obra_subcontratista_frentes`).

**Avance/costos/logística (FASE 4):**
- `reportar_avance_tarea(p_tarea_id, p_avance_pct)` · `capturar_baseline_cronograma(p_proyecto_id) → int` · `calcular_avance_obra(p_proyecto_id) → (avance_plan_pct, avance_real_pct)`
- `registrar_mano_obra(p_id, p_proyecto_id, p_fecha, p_actividad, p_cantidad_trabajadores, p_horas, p_notas) → uuid`
- `registrar_prueba_campo(p_id, p_proyecto_id, p_tipo, p_fecha, p_resultado, p_notas, p_fotos text[]) → uuid`
- `costo_material_obra(p_proyecto_id, p_desde, p_hasta) → jsonb` (requiere módulo obra/proyectos/inventario/direccion)

**Informe (FASE 5):**
- `compilar_informe_semanal(p_proyecto_id, p_periodo_inicio, p_periodo_fin) → uuid` · `guardar_informe_manual(p_id, p_campos jsonb, p_contenido)` · `enviar_informe_semanal(p_id)` · `informes_de_obra(p_proyecto_id) → setof`

**Vistas de lectura app sugeridas (a exponer en PROMPT-8):** `mis_nc_asignadas` (NC/acciones donde el usuario es responsable), `mis_tareas_app` (ya existe, AG15). El resto se lee por RLS con `.eq('proyecto_id', ...)`.

---

## 7. Plan de fases (implementación tras aprobación)

- **FASE 1** ✅ **HECHA (06/08/2026)** — No conformidades e incidentes + acciones correctivas + notif + bandeja web + KPIs. Migración `sql/2026-08-06-ag16-fase1-obra-nc-incidentes.sql` aplicada y probada (flujo completo levantar→acción→hecha→verificar/cerrar + incidente). Módulo `obra` + roles `gerente_produccion`/`capataz` creados. Web: `/obra/no-conformidades` (bandeja + KPIs + timeline). Cron `sgc-obra-avisos` 06:20.
- **FASE 2** ✅ **HECHA (06/08/2026)** — Plan del día (`/obra/plan-dia`: charla de seguridad sobre `charlas_seguridad` + asignación de tareas por brigada reusando Tareas+AG15) + checklists de calidad (`/obra/checklists`: motor `cl_*` generalizado con `categoria='calidad'`, 5 plantillas QA seed, ejecución + hallazgo→NC + editor de plantillas). Migración `sql/2026-08-06-ag16-fase2-plan-dia-checklists.sql` aplicada y probada. **Pendiente de FASE 2 movido a FASE 3/4**: pedido urgente + stock por obra (se integran en la vista de recursos).
- **FASE 3** ✅ **HECHA (06/08/2026)** — Subcontratistas + frentes con avance + cubicaciones con flujo de aprobación (borrador→en_revision→aprobada/rechazada) + historial de eventos + notif. Migración `sql/2026-08-06-ag16-fase3-subcontratistas-cubicaciones.sql` aplicada y probada. Web: `/obra/subcontratistas` (2 tabs).
- **FASE 4** ✅ **HECHA (06/08/2026)** — `cronograma_tareas.avance_pct` + `reportar_avance_tarea` + baseline (`cronograma_baseline`/`capturar_baseline_cronograma`) + curva-S (`obra_avance_snapshots` + `calcular_avance_obra` + sweep `evaluar_avance_obra` cron 06:30). Costos: `costo_material_obra` (ahora también con módulo `obra`) + **horas hombre = `obra_mano_obra` (trabajadores×horas, columna generada), NO se tocó RRHH** + pérdidas (`reportes_perdidas` read). Logística: `ordenes_compra.fecha_programada` + `obra_pruebas_campo`. Migración `sql/2026-08-06-ag16-fase4-avance-costos-logistica.sql` aplicada y probada. Web `/obra/avance` (3 tabs, curva-S SVG).
- **FASE 5** ✅ **HECHA (06/08/2026)** — `informes_semanales` extendida + `compilar_informe_semanal` (auto-compila avance/NC/incidentes/pedidos/horas/pruebas/**fotos de bitácora**) + `guardar_informe_manual` + `enviar_informe_semanal` (in-app+push a Gerencia + email best-effort) + `informes_de_obra`. Migración `sql/2026-08-06-ag16-fase5-informe-semanal.sql` aplicada y probada. Web `/obra/informes` (generar/editar/enviar + preview imprimible + historial). **Edge function `supabase/functions/generar-informe-obra` (pdf-lib + Resend con PDF adjunto) escrita — ⚠️ PENDIENTE DE DESPLIEGUE** (no hay CLI en el entorno; desplegar con `supabase functions deploy generar-informe-obra --no-verify-jwt`). El envío in-app/push funciona ya; el email con PDF arranca al desplegar el edge.

**Nota decisión #4:** se usó `pdf-lib` (no `pdfmake`) en el edge — más robusto en Deno (fuentes StandardFonts embebidas, sin VFS frágil). El resultado (PDF server adjuntable al email) es el mismo.
- **Verificación** — build verde; migraciones aditivas; módulos existentes intactos; humo de una semana simulada (plan → NC levantada y cerrada → checklist → cubicación aprobada → % avance → informe PDF); roles gerente/capataz según matriz.

Módulo `obra` + roles se crean al inicio de FASE 1 (checklist ROLES.md: MODULOS_DISPONIBLES → SUBMODULOS → guards → shell → `array_append` admin → RLS mirror).

---

## 8. Decisiones — RESUELTAS por Xaviel (06/08/2026) ✅

1. **Módulo `obra` propio** (submódulos AG12) — **APROBADO**. Arranca FASE 1.
2. **Roles `gerente_produccion` + `capataz`** con la matriz de §1.2 — **APROBADO**.
3. **Horas hombre → PARTE DE MANO DE OBRA EN EL MÓDULO OBRA** (ajuste 06/08 PM): NO se toca RRHH/asistencia. Se captura un parte de mano de obra por obra/día desde el módulo Obra (nueva tabla `obra_mano_obra`: proyecto_id, fecha, brigada/actividad opcional, cantidad_trabajadores, horas, → horas-hombre = trabajadores×horas), independiente de la asistencia de nómina. Entra en FASE 4. (Reemplaza la idea previa de rediseñar `asistencia`.)
4. **PDF del informe → MOTOR PDF SERVER.** Se genera un PDF real (pdfmake en edge function) **adjuntable al email** a Gerencia. (Reemplaza el `window.print()` propuesto para el informe; el resto de impresiones siguen con print.)
5. **Incidente de obra → tabla `obra_incidentes` propia** con investigación + acciones correctivas + puente para escalar un incidente de bitácora. Bitácora sigue igual para el parte diario.
6. **Cubicaciones** (pendiente de matiz en FASE 3): v1 = monto + % avance + aprobación + `detalle jsonb` de items. Desglose por partida fino → se evalúa en FASE 3.
7. **Charla de seguridad** (matiz en FASE 2): v1 conteo + foto + firmas; lista nominal desde `proyecto_empleados` como mejora dentro de la misma fase.

**Decisiones que quedan por afinar dentro de su fase (no bloquean):** #6 desglose de cubicación (FASE 3), #7 lista nominal de asistentes (FASE 2).

---

**✅ APROBADO 06/08/2026 — FASE 1 en curso.** Este archivo se actualiza a lo realmente implementado + contratos definitivos para PROMPT-8.
