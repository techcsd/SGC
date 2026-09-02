# AU1 — Auditoría de arquitectura: Inventario · Requisiciones · Flota · Proyectos

> **Fecha:** 20-21/08/2026 · Ronda AU · Repo web `dev/SGC` @ 1.88.3
> **Naturaleza:** investigación (solo lectura). **No se ha fusionado ni borrado nada.**
> **Regla de oro:** ningún dato/historial se pierde ni se vuelve inaccesible; toda ruta vieja sigue viva con redirect; deep-links de pushes/correos no rompen (lección AK8).
> **⚠️ Xaviel aprueba la propuesta (Entregable 3) antes de tocar código.** Al ejecutar: un dominio por vez, empezando por el de mayor solapamiento, con smoke por rol.

Todo lo que sigue está verificado contra el código (archivo:línea) y contra el esquema real de la BD (`information_schema`). Las hipótesis del CONTEXTO se marcan **CONFIRMADA / PARCIAL / DESCARTADA**.

---

## ENTREGABLE 1 — Inventario de submódulos

Convención de columnas: **R/W** = si el submódulo solo lee (READ) o también escribe (WRITE). **Badge** = si tiene contador de pendientes y de dónde sale.

### 1.1 — Dominio INVENTARIO (`src/app/pages/inventario/`)

| Submódulo (ruta) | Qué muestra | Tabla(s)/RPC (`sgc.*`) | Permiso (guard) | R/W | Badge |
|---|---|---|---|---|---|
| Artículos `/articulos` | Catálogo con stock/foto/kardex | `articulos`; RPC `ajustar_stock_articulo`, `ultimos_movimientos_articulo` | `inventario.articulos` | R+W | No |
| Categorías `/categorias` | Categorías del inventario | `categorias_inventario` | `inventario.articulos` | R+W | No |
| Activos Fijos `/activos` | Activos fijos | `activos_fijos` | `inventario.articulos` | R+W | No |
| Entradas `/entradas` | Entradas + devoluciones | `entradas_inventario`; RPC `registrar_entrada_inventario`, `registrar_devolucion_obra`, `confirmar_entrada_*` | `inventario.entradas` | R+W | No |
| **Salidas** `/salidas` | Salidas + **aprobación de requisiciones (AT21)** | `salidas_inventario`, `salida_firmas`, `salida_items_libres`; RPC `registrar_salida_inventario`, `aprobar_requisicion`, `crear_conduce_simple`… | `inventario.salidas` | R+W | **Sí** `inventario.salidas` = requisiciones pendientes |
| **Requisiciones** `/requisiciones` | Bandeja global de requisiciones (AS7) | `solicitudes_material`; RPC `aprobar_requisicion`, `rechazar_solicitud_material`, `crear_solicitud_material` | **sin submoduloGuard**; parent `moduloOSubmoduloGuard('inventario', puedeVerTodasRequisiciones)` | R+W | **Sí** `inventario.requisiciones` |
| Movimientos `/movimientos` | Ledger unificado entradas+salidas | **vista** `v_movimientos_inventario` | `inventario.articulos` | **R** | No |
| **Conduces** `/conduces` | Todos los conduces (tabs Activos/Pend./Por confirmar/Histórico) | RPC `conduces_web_listado` (sobre `salidas_inventario`) | `inventario.salidas` | **R** | No (badges por tab) |
| **Confirmaciones de entrega** `/confirmaciones` | Historial de confirmaciones | RPC `confirmaciones_historial`, `mis_confirmaciones` | `inventario.salidas` | **R** | No |
| **Conduces por firmar** `/por-firmar` | Bandeja PERSONAL del despachante | RPC `mis_conduces_por_firmar`, `conduce_firmar_despachante` | **sin guard propio** (inbox personal) → hereda parent `/inventario` ⚠️ **(AU8)** | R+W | **Sí** `conduces.por_firmar` |
| Material no catalogado `/material-no-catalogado` | Items libres nivel ITEM sin vincular (AU4) | `salida_items_libres`; RPC `material_no_catalogado_pendientes`, `vincular_item_libre_articulo`, `declinar_item_libre` | `modulo:'inventario'` (gate server-side) | R+W | **Sí** `inventario.material_no_catalogado` |
| **Conduces por implementar** `/conduces-por-implementar` | Conduces con ≥1 item libre sin vincular (nivel CONDUCE) | RPC `conduces_por_implementar` | `modulo:'inventario'` | **R** | **Sí** `inventario.conduces_por_implementar` |
| Conteos y ajustes `/conteos` | Historial de conteos + chequeo semanal | `conteos_inventario`, `stock_por_bodega`; RPC `registrar_chequeo_semanal` | `inventario.conteos` | R+W | No |
| Apertura de inventario `/apertura` | Fija apertura (piso AP5) | RPC `set_apertura`, `set_apertura_lote`, `apertura_lote_preview` | admin-only (menú + redirect) | R+W | No |
| **Ajuste real** `/ajuste-real` | Fija stock al listado real Excel (AT12) | RPC `ajuste_real_stock`, `ajuste_real_lote` | admin server-side · **HUÉRFANA en menú** | R+W | No |
| Reposición `/reposicion` | Artículos en/bajo mínimo | `stock_por_bodega`, `reposicion_snooze`; RPC `reposicion_almacen`, `posponer_reposicion` | `inventario.articulos` | R+W | No |
| Almacenes `/bodegas` | Listado de almacenes | `bodegas`, `stock_por_bodega`; RPC `ubicaciones_almacen`, `fusionar_almacenes` | `inventario.articulos` | R+W | No |
| Reportes `/reportes` | Reportes entradas/salidas | `entradas_inventario`, `salidas_inventario`, `detalle_*` | `inventario.salidas` | **R** | No |
| Inventario de almacén `/almacen/:id`, `/almacen/obra/:proyectoId` | Existencias + kardex de un almacén | RPC `inventario_almacen`, `kardex_articulo`, **`ajustar_stock_articulo` + `set_apertura` + `ajuste_real_stock`** | sin guard (responsables de obra) | R+W | No |
| Conduce (detalle) `/salidas/:id/conduce` | Detalle/PDF + despacho | `salidas_inventario`; RPC `entregar_conduce`, `anular_conduce`, `conduce_iniciar_ruta`… | `inventario.salidas` | R+W | No |

**Veredictos de las hipótesis (Inventario):**
- **Salidas / Conduces / Movimientos → CONFIRMADA (con matiz).** No existen tablas `conduces` ni `movimientos_inventario`. Una salida y un conduce son **la misma fila de `salidas_inventario`**; el conduce añade capa de transporte/entrega (chofer, ruta, firmas). Movimientos es la **vista** `v_movimientos_inventario` (solo lectura). Conduces es otra **lectura** (RPC `conduces_web_listado`) de `salidas_inventario`. → Tres vistas del mismo libro; solo Salidas escribe.
- **Confirmaciones de entrega → DESCARTADA como entidad.** Es un **estado** (`estado in ('entregado','entregado_incompleto')`) de la misma fila `salidas_inventario`; el submódulo solo lee historial. Conduces ya tiene tab "Por confirmar".
- **Conteos / Ajustes / Reposición / Ajuste real / Apertura → CONFIRMADA (riesgo de integridad real).** **Tres semánticas distintas** fijan/mueven la MISMA existencia: `ajustar_stock_articulo` (genera movimiento/escalón), `set_apertura` (rebase sin movimiento, AP5), `ajuste_real_stock` (fija sin movimiento ni escalón, AT12). La página `almacen-inventario` **expone las tres a la vez por artículo** (`almacen-inventario.ts:152/237/264`). `ajustar_stock_articulo` además está duplicado en Artículos. Reposición NO fija stock (solo lee + genera solicitud de compra). **Este es el punto más delicado del sistema.**
- **Conduces por implementar → CONFIRMADA y ACTIVO.** Es la contraparte "por conduce" de Material no catalogado ("por item"). Vivo, con badge.
- **Artículos vs Categorías → DESCARTADA.** Submódulos independientes (tablas distintas), comparten el permiso `inventario.articulos`.
- **Ruta muerta detectada:** `/inventario/ajuste-real` (AT12) **no tiene entrada en el menú** (`shell.ts`); solo se alcanza por URL. Su capacidad ya está inline en `almacen-inventario`.

### 1.2 — Dominio FLOTA (`src/app/pages/flota/`) — 21 submódulos

| Submódulo (ruta) | Qué muestra | Tabla(s)/RPC | Guard | R/W | Badge |
|---|---|---|---|---|---|
| Vehículos `/vehiculos` | Flota + stats | `vehiculos`, `v_vehiculo_stats`; RPC `asignarme_vehiculo` | `flota.vehiculos` | R+W | No |
| Perfil vehículo `/vehiculos/:id` | Ficha: llaves, placas PP, mantenim. | `vehiculos`, `vehiculo_placas_pp`, RPC `llaves_de`… | `flota.vehiculos` | R+W | No |
| **Inspección vehículo** `/reporte-semanal` | Dashboard cumplimiento checklist semanal | vista `v_reporte_semanal_cumplimiento` + `avisos_flota` | `flota.vehiculos` | **R** | Sí `flota.reporte-semanal` |
| Mantenimientos `/mantenimientos` | Historial + próximos | `mantenimientos`; RPC `completar_mantenimiento` | `flota.mantenimientos` | R+W | Sí |
| **Conductores** `/conductores` | Lista/CRUD conductores | `conductores`, `v_conductor_documentos/stats`; RPC `auto_registrar_conductor` | `flotaElevado` | R+W | No |
| **Estado de conductores** `/conductores-estado` | Dashboard licencias/vencimientos | vista `v_conductor_stats` (getEstadoConductores) | `flotaElevado` | **R** | No |
| Perfil conductor `/conductores/:id` | Ficha stats/multas/rutas | `v_conductor_stats`, `stats_conductor_periodo`, `conductor_multas` | `flotaElevado` | R+W | No |
| Accidentes `/accidentes` | Accidentes/daños/multas | `vehiculo_accidentes`, `vehiculo_danos`, `conductor_multas` | `flotaElevado` | R+W | No |
| **Combustible** `/combustible` | Registro echadas + precios | `registros_combustible`; RPC `registrar_combustible_app`, `set_precio_combustible` | `flota.combustible` | R+W | Sí `flota.combustible` |
| **Registro de echadas** `/combustible-log` | Log/auditoría de echadas | RPC `log_combustible`, `registros_combustible` | `flotaElevado` | **R** | No |
| Dashboards combustible `/combustible-dashboard` | Gráficas de consumo | `registros_combustible` + `avisos_flota` | `flota.combustible` | **R** | No |
| **Conciliación combustible** `/conciliacion-combustible` | Cruce echadas vs proveedor | `conciliaciones_combustible`, `conciliacion_combustible_detalle` | `flotaElevado` | R+W | Sí `flota.conciliacion` |
| **Rutas** `/rutas` | Gestión de rutas + paradas | `rutas`, `ruta_paradas`, `ruta_fotos`; RPC `ruta_detalle_transporte`, `set_ruta_paradas` | `flota.rutas` | R+W | No |
| **Seguimiento** `/seguimiento` | **Mapa vivo** posiciones + estado + rutas (realtime) | RPC `ultimas_posiciones`, `choferes_estado`, `rutas_activas_y_hoy`, `ruta_trayecto`; realtime `chofer_ultima_posicion` | `flotaElevado` | **R** | No |
| **Rutas activas** `/rutas-activas` | **Lista** (sin mapa): estado + activa + histórico | RPC `choferes_estado`, `rutas_activas_y_hoy`, `rutas_historial` | `flotaElevado` | **R** | No |
| **Recorrido diario** `/recorrido-diario` | **Timeline/mapa** del día de UN chofer | RPC `recorridos_disponibles`, `recorrido_diario_de` | `flotaElevado` | **R** | No |
| **Checklists** `/checklists` | CRUD checklists (pre-uso + semanal) | `checklists_vehiculo`, `checklist_plantillas`; RPC `registrar_checklist_vehiculo` | `flota.vehiculos` | R+W | Sí `flota.checklists` |
| **Panel del día** `/panel-dia` | Resumen operativo del día | `checklists_vehiculo` + `conductores` + `avisos_flota` | `flotaElevado` | **R** | No |
| Avisos `/avisos` | Bandeja de avisos de flota | `avisos_flota`; RPC `atender_aviso_flota`, `evaluar_avisos_vencimiento` | `flota.vehiculos` | R+W | Sí `flota.avisos` |
| **Vehículos en uso** `/responsabilidad` | Custodia/acta: quién tiene cada vehículo | `vehiculo_entregas`; RPC `vehiculos_asignados`, `crear_entrega_vehiculo` | `flotaElevado` | R+W | No |
| Reportes `/reportes` | Reportes agregados | `vehiculos`, `mantenimientos`, `registros_combustible` | `flotaElevado` | **R** | No |

*Todos los badges de Flota salen de una sola tabla `avisos_flota` agrupada por `tipo` (`notificaciones.service.ts:127-148`).*

**Veredictos de las hipótesis (Flota):**
- **Seguimiento / Rutas activas / Recorrido diario / Panel del día → PARCIAL: 3 vistas + 1 intruso.** Las tres primeras comparten el MISMO `SeguimientoService` y las MISMAS RPC de posiciones/rutas + el mismo canal realtime. Difieren en presentación: **Seguimiento = mapa vivo**, **Rutas activas = lista sin mapa (+histórico)**, **Recorrido diario = timeline de un chofer-fecha**. **Panel del día NO pertenece al grupo** (lee checklists+conductores+avisos, no GPS). → candidatas a **unificar en una sola vista con pestañas Mapa/Lista/Histórico**; Panel del día se queda aparte.
- **Combustible / Registro de echadas / Conciliación → CONFIRMADA (orbitan la misma `registros_combustible`).** Combustible = alta (WRITE); Registro de echadas = log read-only; Dashboards = gráficas read-only; Conciliación = cruce vs proveedor. → **Registro de echadas y Dashboards podrían ser pestañas de Combustible**; Conciliación puede quedar por su peso propio.
- **Conductores / Estado de conductores → CONFIRMADA.** Misma entidad; Estado es dashboard read-only de `v_conductor_stats`. → **Estado = pestaña de Conductores.**
- **Checklists / Inspección vehículo → MATIZADA.** El pre-uso NO está muerto en código (sigue siendo el caso por defecto de Checklists); "Inspección vehículo" es un dashboard read-only del subconjunto semanal. Ambos sobre `checklists_vehiculo`. Nota: AK15 "mató" el pre-uso a nivel de proceso pero el código lo sigue ofreciendo — **decisión de Xaviel: ¿retirar la creación de pre-uso o dejarla?**
- **Vehículos / Vehículos en uso → DESCARTADA.** "En uso" añade capa propia de custodia (`vehiculo_entregas` + acta) que Vehículos no toca. No es un filtro. Se queda.
- **Avisos / Accidentes → DESCARTADA.** Tablas distintas (`avisos_flota` vs `vehiculo_accidentes/danos/multas`). Dominios separados.
- **Rutas / Rutas activas → DESCARTADA (como entidades).** Rutas = CRUD sobre `rutas`; Rutas activas = monitoreo read-only (no toca la tabla `rutas`). Pero *Rutas activas* sí es redundante con *Seguimiento* (ver arriba).

### 1.3 — Dominio PROYECTOS + hermanos OBRA / BITÁCORA

| Submódulo (ruta) | Qué muestra | Tabla(s)/RPC | Permiso | R/W |
|---|---|---|---|---|
| **Proyectos** Lista/Detalle `/proyectos` | Cartera + detalle (gasto real, avance, docs, responsables, almacén) | `proyectos`, `proyecto_partidas`; RPC `getAvanceById` | `proyectos.obras` | R+W |
| Ranking KPI `/proyectos/kpi` | Ranking de encargados | RPC KPI | `proyectos.ranking` | R |
| Historial `/proyectos/historial` | Obras cerradas | `proyectos` | `proyectos.obras` | R |
| Clima `/proyectos/clima` | Reportes de clima | tablas clima | `proyectos.obras` | R |
| Personal `/proyectos/personal` | Personal de obra, carnet, import | tablas personal | `proyectos.personal` | R+W |
| Cronograma `/proyectos/:id/cronograma` | Gantt | **`cronograma_tareas`**, `cronograma_tarea_bitacoras`; RPC `listar_cronograma`, `crear/iniciar/completar_tarea`, `recalcular_cronograma`, `enlazar_bitacora_tarea` | `proyectos.cronograma` | R+W |
| Costos `/proyectos/:id/costos` | Costo material real | RPC `costo_material_obra` | `proyectos.obras` | R |
| Compras `/proyectos/:id/compras` | OC + ferretería de la obra | `ordenes_compra` | `proyectos.obras` | R |
| **Producción de Obra** Plan del día `/obra/plan-dia` | Tareas del día + charlas | RPC `plan_del_dia`, `registrar_charla_seguridad` | `obra.plan_dia` | R+W |
| — No conformidades `/obra/no-conformidades` | NC, incidentes, acciones | `obra_no_conformidades`, `obra_acciones_correctivas`, `obra_incidentes` | `obra.no_conformidades` | R+W |
| — Checklists calidad `/obra/checklists` | Plantillas + registros | `cl_plantillas`, `cl_registros` | `obra.checklists` | R+W |
| — Subcontratistas `/obra/subcontratistas` | Subcontratistas, frentes, cubicaciones | `obra_subcontratistas`, `obra_cubicaciones` | `obra.subcontratistas` | R+W |
| — **Avance y costos** `/obra/avance` | Avance obra, mano de obra, pérdidas | RPC `calcular_avance_obra`, `obra_avance_snapshots`, **`cronograma_tareas`**, `reportar_avance_tarea`, `costo_material_obra`, `obra_mano_obra` | `obra.avance` | R+W |
| — Informe semanal `/obra/informes` | Informe compilado | RPC `compilar_informe_semanal`, `informes_semanales`, `enviar_informe_semanal` | `obra.informes` | R+W |
| **Bitácora** Nueva `/bitacora/nueva` | Crear entrada | RPC `crear_entrada_bitacora`, `bitacoras`, `bitacora_archivos` | módulo `bitacora` | R+W |
| — Historial `/bitacora/historial` | Mis bitácoras | `bitacoras` | `bitacora` | R |
| — Dashboard `/bitacora/dashboard` | Dashboard bitácoras | — | `bitacora` | R |
| — Mi proyecto `/bitacora/mi-proyecto` | Proyecto asignado | `proyectos` | `bitacora` | R |
| — **Requisición** `/bitacora/solicitudes-material` | Mis requisiciones + **crear** | RPC `crear_solicitud_material`, `solicitudes_material` | `bitacora` | R+W |
| — Solicitudes de compra `/bitacora/solicitudes-compra` | Solicitudes de compra | `solicitudes_compra`; RPC `crear_solicitud_compra` | `bitacora` | R+W |
| — Entregas `/bitacora/entregas` | Confirmar entregas (conduce) | `salidas_inventario`; reusa `inventario/conduce` | `bitacora` (RLS por obra) | R+W |

**Frontera Proyectos ↔ Obra ↔ Bitácora — solapamientos reales (verificados):**
- **`cronograma_tareas` se escribe desde DOS módulos:** `proyectos/cronograma` (crear/completar/recalcular) **y** `obra/avance` (`reportar_avance_tarea`, `capturar_baseline_cronograma`). → **el avance de obra vive en dos sitios.**
- **Doble fuente de "% avance":** `proyectos/lista` (`getAvanceById` → pagado/trabajado, `proyecto_partidas`) vs `obra/avance` (`calcular_avance_obra` + `obra_avance_snapshots`).
- **`bitacoras` + `cronograma_tarea_bitacoras`:** se crean en `bitacora/nueva`, se enlazan desde `proyectos/cronograma`, y se **consumen** en `obra/informes` (compilación). Storage `sgc-bitacora` compartido bitácora↔informes.
- **`ordenes_compra`** leídas en `proyectos/:id/compras` y en `obra/avance`.

---

## ENTREGABLE 2 — Mapa de procesos punta a punta

### Proceso A — Requisición → aprobación → salida/conduce → entrega → confirmación → stock

| Paso | Dónde vive (archivo) | Ruta / actor | Tabla/RPC | ⚠️ Caminos alternos (riesgo) |
|---|---|---|---|---|
| **1. Nace** | `bitacora/solicitudes-material.ts:334` | `/bitacora/solicitudes-material` (label "Requisición") — ingeniero de campo | RPC `crear_solicitud_material` → `solicitudes_material` | También se **entra** por botón "Requisiciones" del detalle de proyecto (`proyectos/lista.html:43`) que navega a `/inventario/requisiciones?obra=:id`, y desde la app. |
| **2. Aprueba** | `inventario/salidas.ts:728` **Y** `inventario/requisiciones.ts:311` | `/inventario/salidas` **y** `/inventario/requisiciones` | RPC `aprobar_requisicion` (auto-divide: salida por stock + `solicitud_compra` por faltante) | ⚠️ **La lógica de aprobación está reimplementada en DOS componentes** que llaman al mismo RPC. Dos puertas para el mismo acto. |
| **3. Salida/Conduce** | `salidas.service.ts` | `/inventario/salidas`, `/salidas/:id/conduce` | `registrar_salida_inventario`, `crear_conduce_simple` → `salidas_inventario` | Una salida ES un conduce (misma fila). |
| **4. Entrega** | `salidas.service.ts:198` | Conduce detalle / app | `entregar_conduce` | — |
| **5. Confirmación** | `salidas.service.ts:603` | Obra destino (bitácora/entregas o app) | `confirmar_recepcion_salida` (+ matriz AK4/AT17) | — |
| **6. Stock** | trigger/RPC server-side | — | `stock_por_bodega` | ⚠️ Ver Proceso C: el stock también se toca por apertura/ajuste real/conteo. |
| **Badge** | `notificaciones.service.ts:92,219` | shell | count `solicitudes_material` pendiente | ⚠️ **mismo count expuesto bajo DOS claves** (`inventario.requisiciones` y `inventario.salidas`). |

**Diagnóstico:** un mismo `solicitudes_material` se **crea** en Bitácora, se **lista** en Inventario/Requisiciones y se **aprueba en dos sitios**. Nomenclatura inconsistente (tabla dice `solicitud_material`, UI dice "Requisición"). El RPC deprecado `aprobar_solicitud_material` coexiste con el vigente `aprobar_requisicion`.

### Proceso B — Vehículo → uso → echada → mantenimiento → reporte semanal → incentivo

| Paso | Dónde vive | Tabla/RPC | Notas |
|---|---|---|---|
| **Vehículo asignado / en uso** | `/flota/responsabilidad` | `vehiculo_entregas`, `vehiculo_asignaciones` | acta de custodia |
| **Uso (ruta ejecutada)** | `/flota/rutas` + app | `rutas`, `chofer_ultima_posicion` | tracking realtime |
| **Echada** | `/flota/combustible` + app | `registros_combustible` | valida por odómetro |
| **Mantenimiento** | `/flota/mantenimientos` | `mantenimientos` | por km/tiempo |
| **Reporte / Inspección semanal** | `/flota/reporte-semanal` + Checklists | `checklists_vehiculo`, `v_reporte_semanal_cumplimiento` | cumplimiento |
| **Incentivo** | `/incentivos` + `/mi-rendimiento` | RPC incentivo (AT1-AT4) | cron lunes; ⚠️ **sensible a duplicados de conductor (AU18)** |

**Diagnóstico:** el incentivo depende de que cada ruta/echada/checklist se atribuya a **un único usuario**. Un conductor duplicado (AU18) reparte su actividad y le niega el pago. Este proceso está razonablemente encadenado; el riesgo es de **datos** (duplicados), no de módulos.

### Procesos "sin dueño" detectados (se resuelven por WhatsApp / a mano)
- **Segmentación geográfica de obras** (provincia/municipio/sector) → hoy texto libre; ningún módulo la modela (→ AU4).
- **Diccionario de nombres no oficiales de artículos** ("apodos") → la gente los manda por WhatsApp y el catálogo no los registra (→ AU12).
- **Detección/fusión de usuarios duplicados** → no hay herramienta (→ AU18).

---

## ENTREGABLE 3 — Propuesta de consolidación priorizada

Formato: **FUSIONAR** (submódulo → pestaña/filtro de otro) · **ELIMINAR** (muerto/sustituido) · **RENOMBRAR** · **QUEDA**. Prioridad = mayor solapamiento + riesgo de integridad primero.

### 🔴 P1 — INVENTARIO: unificar los mecanismos que tocan stock (riesgo de integridad)
- **QUEDA pero se ordena:** las tres semánticas (`ajustar_stock_articulo` / `set_apertura` / `ajuste_real_stock`) son legítimamente distintas, pero **no deben ofrecerse las tres a la vez sin fricción**. Propuesta: **un solo punto de entrada "Ajustar existencia"** por artículo/almacén que obligue a elegir el motivo (Movimiento · Apertura · Ajuste real) y registre auditoría uniforme; retirar la duplicación de `ajustar_stock_articulo` en Artículos (dejarla solo en la vista de almacén). **Impacto:** almacenistas/admin. **Costo:** medio.
- **FUSIONAR:** `/inventario/ajuste-real` (huérfana) → como opción dentro de "Ajustar existencia". Mantener redirect.
- **Riesgo si no se hace:** dos caminos para fijar el mismo stock = dos verdades (el problema madre de AU1).

### 🟠 P2 — INVENTARIO/REQUISICIONES: un solo hogar para la requisición
- **RENOMBRAR** tabla/servicio a nomenclatura única "Requisición" (o documentar el alias) y **eliminar** el RPC deprecado `aprobar_solicitud_material`.
- **FUSIONAR:** un único hogar canónico `/inventario/requisiciones` (crear + listar + aprobar/rechazar). `/inventario/salidas` deja de reimplementar la aprobación (que "Aprobar requisición" redirija a la bandeja). Bitácora "Requisición", botón del proyecto y deep-link `?req=` son **accesos** al mismo hogar.
- **Badge:** exponer el count bajo UNA clave.
- **Impacto:** Raykler, ingenieros, almacenistas. **Costo:** medio.

### 🟠 P3 — FLOTA: colapsar las vistas redundantes de monitoreo y de echadas
- **FUSIONAR (monitoreo):** `Seguimiento` + `Rutas activas` + `Recorrido diario` → **una vista "Seguimiento" con pestañas Mapa vivo / Lista / Recorrido por chofer**. Comparten servicio y RPC. `Panel del día` **QUEDA** aparte (no es GPS). Redirect de las rutas viejas. **Ahorra 2 items de menú y una fuente de confusión.**
- **FUSIONAR (echadas):** `Registro de echadas` + `Dashboards de combustible` → **pestañas dentro de Combustible**. `Conciliación` QUEDA (peso propio). 
- **FUSIONAR (conductores):** `Estado de conductores` → **pestaña de Conductores**.
- **DECISIÓN Xaviel:** ¿se retira la creación de **pre-uso** en Checklists (AK15 lo "mató" a nivel proceso pero el código lo sigue ofreciendo)? 
- **QUEDAN:** Vehículos / Vehículos en uso, Avisos / Accidentes, Rutas (CRUD) — no son redundantes.
- **Impacto:** flota elevada (admin/gerencia/jefe flota). **Costo:** medio-alto (unificar 3 vistas de monitoreo).

### 🟢 P4 — PROYECTOS / OBRA / BITÁCORA → módulo "Ingeniería" (DECIDIDO BH2, 02/09/2026)
> **✅ Árbol de capacidades APROBADO (BH2).** La web ya tiene los 13 hijos bajo el grupo "Ingeniería" del sidebar (`shell.ts`). En la **app**, Xaviel eligió **traslado puro** de los tiles de uso diario al hub `/ingenieria` — pero **con mock validado primero** (lección BD1: el home agrupado de BC5 se revirtió en 24 h). El mock + traslado + los 2 huecos de capacidad (**Dashboard de bitácora**, **Mi proyecto**) se ejecutan en **PROMPT-31 (csd-app)**. Detalle y árbol en `docs/AV5-AV6-paridad-conduces-e-ingenieria.md` §AV6 CERRADO y en la fila BH2 de `PARIDAD.md`. La fusión `cronograma_tareas` (doble avance) sigue como mejora abierta, independiente del menú.

Árbol propuesto (histórico — validado en BH2):
```
Ingeniería  (módulo, espejo de la app AT6)
├── Ejecución (Producción de Obra)
│   ├── Plan del día · Avance   ← FUSIONA obra/avance con proyectos/cronograma (misma cronograma_tareas → elimina el doble avance)
│   ├── Bitácora (nueva/historial/dashboard)   ← absorbe el módulo bitacora
│   ├── Checklists de calidad · No conformidades
│   └── Subcontratistas / Cubicaciones
├── Informes (informes_semanales)
Proyectos  (queda como CARTERA/gestión)
├── Lista/Detalle · Cronograma · Ranking · Personal · Clima · Costos · Compras
```
- **Clave de integridad:** hoy `cronograma_tareas` se escribe desde `proyectos/cronograma` **y** `obra/avance`; unificarlas elimina el doble avance.
- **Consecuencias a resolver de una vez** (lección AK8): rutas viejas con **redirect**; **permisos** — quien tenía módulo `bitacora` conserva el submódulo (no dejar gente afuera, enlaza AS4/AT15); **badges** — el de Bitácora suma al de Ingeniería; **deep-links** de pushes/correos; **layout por scope** (AK2/AJ4). Aplicar el MISMO árbol en web y app (paridad AT6).
- **Impacto:** ingenieros, capataces, gerencia. **Costo:** alto.

### Resumen de acciones
| Acción | Cuántos submódulos afecta | Prioridad |
|---|---|---|
| Unificar mecanismos de stock (P1) | 3 RPC + 2 vistas | 🔴 |
| Un hogar para requisición (P2) | 4 puntos → 1 hogar + accesos | 🟠 |
| Colapsar monitoreo + echadas + conductores (P3) | 6 → 3 | 🟠 |
| Módulo Ingeniería (P4) | 3 módulos → 1 árbol | 🟢 decidido BH2 (app: mock-first en PROMPT-31) |

**Nada de lo anterior borra datos:** todas son fusiones de UI (pestañas/filtros) + redirects. Las tablas y su historial quedan intactos.
