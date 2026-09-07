# HANDOFF — SGC

## TL;DR — Ronda BJ (PROMPT-34, 05-07/09/2026) — **SHIPPED web 1.113.0** (commits 66b1580 + ec8c052, push main → Vercel), **4 migraciones APLICADAS a prod + BJ5 smoke por rol OK**
**Las 6 fases hechas.** web 1.112.0 (BJ5/BJ3/BJ4/BJ1/BJ6) + 1.113.0 (BJ2 PDF). **4 migraciones APLICADAS** (`sql/2026-09-05-bj5…`, `bj3…`, `bj4…`, `bj1…`).

**⚠️ Lección BJ5 (recursión RLS):** la 1ª versión de la política metía la red AW1 (`not exists (select from sgc.proyectos)`) DIRECTA en la policy de `sgc.proyectos` → **recursión infinita 42P17** (rompía toda lectura autenticada de proyectos). `proyectos_pickables()` se salva porque es SECURITY DEFINER. Fix: AW1 movida a helper `sgc.usuario_sin_obra_activa_ligada()` (DEFINER). **Regla:** una policy RLS NUNCA debe subconsultar su propia tabla sin blindar el subselect en un DEFINER. La corrección ya está en el archivo `bj5` y aplicada.

**BJ2 (FASE 5) shipped — web 1.113.0 (commit ec8c052, push main):** la conciliación de
combustible acepta la **factura PDF** de TotalEnergies (crédito fiscal electrónico), no solo
Excel/CSV. Extractor por posición (`pdfjs-dist` getTextContent, `parse-pdf-totalenergies.util`)
que reconstruye la tabla agrupada por TARJETA y devuelve el mismo `InformeRow[]` → el matcher
y el import no se tocaron. **Verificado contra la factura real FA26/215223: 33 transacciones,
15 tarjetas, cuadra al peso por total/producto/tarjeta (108,688.16)**; consumo a nombre de
PERSONA marcado (`titular_es_persona`); llave de dedupe `factura#recibo#fecha#hora#idx`; el
código de 4 dígitos (`numero_tarjeta`) es la llave estable para el mapeo. `pdfjs-dist` en chunk
lazy + worker como asset. **Follow-ups**: pantalla de mapeo tarjeta→vehículo/persona (hoy las
tarjetas sin placa caen a `solo_informe`), guardar el PDF en Storage, panel de cuadre por
producto/tarjeta en la UI, columna Alerta persistida (la factura de muestra no trae alertas).
El PDF real está **gitignoreado** (datos fiscales).

**BJ5 smoke por rol (APLICADO, OK):** admin ve 15 (incl. 4 de prueba); ingeniero campo/oficina, jefe ing., chofer, Raykler y capataz ven la **lista** (11, nunca 0) y **0 obras de prueba**; dropdowns por contexto OK (WIDE=10 para todos; SCOPED=1 para el ingeniero de campo = su obra). Sin recursión.

- **BJ5 (FASE 1) 🔴 lista de obras (5ª vez, arreglada la RAÍZ):** la RLS `"proyectos: select"` no concordaba con `proyectos_pickables()` — le faltaban módulos amplios (inventario/compras/direccion), el submódulo `proyectos.obras`, `es_capataz_de_proyecto` y la red **AW1**. Migración `bj5` reescribe la política (aditiva, no quita a nadie) → **una política, 21 pantallas de listado**. El botón "+ Nuevo proyecto" ya derivaba de `puede_gestionar_proyectos()`. Matriz ampliada con **pantallas de listado** en `docs/OBRAS-SELECTOR-MATRIZ.md`.
- **BJ3 (FASE 2) 🔴 conduce web encendido:** el flag `conduce_wizard_web_habilitado` nunca existió como fila **y** la RLS de `parametros` no dejaba leerlo al chofer/almacén → wizard apagado por RLS. Migración `bj3` crea la fila (=true) + RPC `conduce_wizard_web_habilitado()` DEFINER. Gate de la ruta pasa a `puede_crear_conduce()` (guard `puedeCrearConduceGuard` + `extraAllow` chofer en el parent). Selectores **chofer+vehículo** nuevos → dispara la auto-ruta **BH3** desde la web (auto-despacho del chofer). **Foto obligatoria** para conduce a obra (revertible por flag). Wrapper muerto `crearConduceSimple()` borrado (RPC sigue viva). **AV5 CERRADO** + fila en `PARIDAD.md`.
- **BJ4 (FASE 3) despacho parcial:** migración `bj4` corrige el bug de estado en `aprobar_requisicion` (nada despachado ⇒ `por_despachar`, parte ⇒ `parcial`, calculado por AVANCE real, no por los p_items) + `parcial` entra en `requisiciones_por_despachar()` + `despacho_marcar` recalcula estado (cierra el lazo) + **estado por línea** (`solicitud_material_items.estado` pendiente|despachada|cancelada + motivo) + RPC `requisicion_cancelar_item` ("Quitar" línea con motivo, UI en el panel de avance). Cantidades editables/quitar-renglón en la aprobación **ya existían** (RequisicionItemsMapper con QtyStepper); "Cerrar requisición" con preview de avance **ya existía**.
- **BJ1 (FASE 4) compresión de imágenes:** **compresor único con perfiles** (`comprimir-imagen.util.ts`: evidencia 1600/0.75 · documento 2000/0.8 · avatar/sticker 512/0.8; firmas intactas) + wired en **24 métodos de subida** (22 servicios). Migración `bj1` pone **límite de tamaño a 11 buckets**. Firmas/voz/personal-obra(Blob) **skipped** a propósito.
- **BJ6 (FASE 6) duplicar artículo:** botón "Duplicar" (fila) → drawer de creación prellenado, sin heredar id/código/imagen/apodos; `requiere_talla` visible; aviso suave por nombre duplicado. **Unificado el generador de código**: la web `create()` pasa a `crear_articulo_app` (CSD-…) — se acabó el `ART-####` del cliente (dos generadores). `generateNextCode()` borrado.
- **Regla 6 (nueva, automatizada):** auditor `scripts/audit-flags-exports-muertos.mjs` en prebuild — falla si un **flag `_habilitado/…`** se lee sin fila en `sgc.parametros`, o si aparece un **dead-export nuevo** (ratchet vs `.dead-exports-baseline.json`, 58 legacy). Probado que rompe a propósito. Documentada en `docs/CHECKLIST-MIGRACIONES.md §6.5`.

**⚠️ FALTAN DOS ARCHIVOS del prompt:** `CONTEXTO-ACTUALIZACION-17.md` (la investigación §F) y `referencia-factura-totalenergies-BJ2.pdf` **no estaban en el repo ni en el árbol** — el prompt es autosuficiente (file:line + propuestas inline), así que se ejecutó con las propuestas §F. **FASE 5 (BJ2) BLOQUEADA:** el extractor de PDF necesita el PDF real para mapear la tabla de TotalEnergies. Poner el PDF en la carpeta → se hace.

**PENDIENTE XAVIEL (GO):** (1) aplicar las 4 migraciones `2026-09-05-bj*`; (2) smoke por rol de BJ5 (ingeniero campo/oficina, jefe ingenieros, capataz, chofer, Raykler, admin ven la lista + un dropdown de cada contexto); (3) probar BJ3 end-to-end (chofer crea conduce → genera ruta); (4) probar BJ4 (aprobar con líneas en cero ⇒ `por_despachar`; despacho parcial ⇒ `parcial`; quitar línea + cerrar); (5) commit/push + deploy (bump + release-notes). **Decisiones §F abiertas** (ver más abajo): foto obligatoria conduce, motivo obligatorio al cerrar requisición, números/WebP de compresión, llave de dedupe del PDF, qué hacer con los `ART-*` existentes.

---

## TL;DR — Ronda BH (PROMPT-30, 02/09/2026) — web verde 1.108.0, **7 migraciones APLICADAS a prod**, SIN commit/push/deploy web
Las 8 notas BH (7 fases). **BH1** requisiciones: front espeja el guard (autor ve **Cancelar**, no Rechazar) + "Ocultar canceladas" por defecto; migración `bh1` separa `puede_gestionar_requisicion` (aprobar/rechazar/**cerrar** = tercero) de `puede_disponer_de_mi_requisicion` (cancelar = autor/admin) — **APLICADA** (cierra el hueco de que el autor cerrara la suya). **BH7** compras: badge "Desde requisición" ahora es enlace **REQ-XXXXXX** navegable + enlace inverso con `?solicitud=` + migración `bh7` recupera `articulo_id`/`unidad` en `solicitud_compra_items` (la OC nace ligada al catálogo) + **motivo obligatorio** al rechazar compra — **APLICADA**. **BH8** "Solicitar Compra" ahora vive en **Compras** (`/compras/solicitar`, gate `compras.solicitudes`) + entrada en Ingeniería; migración `bh8` amplía `crear_solicitud_compra` (origen_requisicion_id, categoria, auth explícita, drop overload) — **APLICADA**. **BH4** 3ª pestaña "Acceso por cédula" en admin/usuarios (reusa edge `acceso-cedula` con **alta directa**) + migración `bh4` `usuarios.cedula` unique parcial + **8 backfilled** + email opcional en el modelo + helper `identidadLabel` (nunca se ve el email sintético) — **APLICADA**. Roles: **capataz + chofer_transportista** (decisión Xaviel). **BH6** Wagner: diagnóstico = data correcta (1 sola fila, bien asignada) → los defectos eran el **hueco de privacidad** (`mis_tareas_app` daba TODAS las tareas a quien tuviera el módulo → cerrado) + `coalesce` de `asignar_tarea_obra` (silenciaba mal-asignación → falla explícito) + selector `usuarios_asignables()` que desambigua (rol+correo+dup); migración `bh6` — **APLICADA**. **BH3** el conduce crea su ruta: `conduce_asegurar_ruta(salida_id)` idempotente (crea-o-reutiliza ruta del día, origen/destino por coalesce, parada con renglones) + `rutas.derivada_de_conduce` + **la ruta derivada NO puntúa el incentivo** (decisión Xaviel, incentivo_generar_semana excluye) + hook en `aceptar_transferencia_conduce` + web salidas.service llama la RPC; migraciones `bh3`×2 — **APLICADAS**. Muere AM5. **BH2** árbol Ingeniería: decisión **traslado puro con mock-first** (app → PROMPT-31); deuda documental cerrada (PARIDAD.md, AV6, AU1 §P4, checklist regla 3.5).

**PENDIENTE XAVIEL (GO):** (1) **desplegar edge `acceso-cedula`** (BH4 alta directa — escrita, sin deploy); (2) commit/push + deploy web Vercel (bump de versión + release-notes); (3) smoke por rol (regla 4 del checklist): cancelar como autor una REQ fresca, rechazo negado en UI, alta capataz por cédula → login app, tarea a Wagner. **Decisiones §F aún abiertas:** BH2 huecos app (Dashboard bitácora, Mi proyecto) + BH5 tema oscuro app + BH8 paridad app = **PROMPT-31**; obra `saasasa` (borrar o es_prueba); silenciar grupo watchdog (301 ocurr., ~48% del panel); el `+Nueva OC` que salta la solicitud (¿se prohíbe/marca?). **Telemetría outbox NO ha disparado** (`outbox_atascados` vacía pese a "1 con problema" en la app) — lado app PROMPT-31.

---

## TL;DR
**Ronda BE (PROMPT-25, 31 ago 2026) — web verde 1.105.0 SIN commit/push. Edges DESPLEGADOS. Migraciones de datos APLICADAS a prod. Cron del lunes NO programado (espera GO).**
Compa pasa de responder a REPORTAR. **FASE 1:** registro de "consultas no atendidas" (tabla + panel Tecnología `/tecnologia/consultas-compa`, gate es_tecnologia) + se mató el error genérico "Intenta reformular" → causa+salida + `reportar_gap`. **FASE 2:** 3 tools nuevas por rol — `actividad_de_usuario` (supervisión ve cualquier chofer, chofer solo lo suyo), `rutas_del_dia` (logística/jefe/admin=todas), `disponibilidad_de_articulo` (apodos AU12, RLS por bodega; **modulos:null** porque capacidades_asistente no escanea `obra`) + chips BA3 por rol (+persona `jefe`). **FASE 3+4:** 7 reportes semanales, cada uno TOOL de Compa + sección del correo/PDF; edge `resumen-semanal-operaciones` (lunes 7AM = `0 11 * * 1`, HELD); página `/tecnologia/resumen-operaciones` con preview de los 7 + Reenviar + historial. **Todos los números verificados contra su módulo (exactos).** Diagnóstico "puntales": no era apodo (resuelve score 1.0) — era fan-out sobre 16 bodegas > MAX_TOOL_LOOPS=8 → respuesta vacía → fallback genérico. Ya resuelto con `disponibilidad_de_articulo` (1 sola llamada).
**PENDIENTE XAVIEL (GO):** (1) aplicar `sql/2026-08-31-be1-resumen-operaciones-cron.sql` (solo falta el `cron.schedule`; las funciones ya están) para arrancar el correo automático de los lunes; (2) probar Compa en browser (las 3 preguntas por rol) + botón "Reenviar"; (3) commit/push + deploy web Vercel. Destinatarios confirmados: admin,direccion,gerencia,logistica,jefe_flota. Cuarentena BB8 = contada aparte. Panel backlog = solo Tecnología.

---
### Ronda AX (PROMPT-11, 25 ago 2026) **Compa ya está ENCENDIDO en prod** (secrets `ANTHROPIC_API_KEY` + `ASSISTANT_MODEL=claude-sonnet-5` puestos vía Management API; 503 fuera; probado end-to-end con permisos por rol). Hecho además: AX8 (UI de Compa legible en tema claro), AX7 (input de cantidad ya no borra al vaciar), AX3 (dropdown de obras en OC), y **AX1 aplicado a prod** (el ingeniero de campo responsable ya ve y firma su conduce — migración RLS). Falta: AX6 "Otros" en bitácora (feature), y AX4/AX2/AX5/AX10 que dependen de decisiones de Xaviel. **Xaviel:** poner el budget alert US$50/mes en console.anthropic.com.

Ronda AW (19–24 ago 2026) cerrada y **shipped a `main`** hasta **v1.95.0** (Vercel deploya solo). Se validó/limpió el combustible (AW3), se arregló el cronograma vacío (AW1), y se construyó **Compa** — el asistente de IA (AW4) con **v1 lectura + v2 acciones con confirmación**.

## Ronda AX (25 ago 2026) — detalle
- **AX9 Compa ON (prod):** secrets vía `POST /v1/projects/jeeqhgccqefbqilntcpu/secrets` (Mgmt API, key nunca impresa). Modelo Sonnet 5 (`claude-sonnet-5`, alias verificado vs `/v1/models`). Probado con sesiones minteadas por admin `generate_link`→`verify` (sin tocar passwords): 4 chips, agregados, permisos admin≠chofer (vedados → "no tengo acceso", sin fuga), auditoría llena, es_prueba OK. ~US$0.005–0.012/pregunta. Rate limit 60/h ya existía.
- **AX8 (web):** `asistente.scss` — reemplazados hex oscuros quemados por tokens `--sgc-*` → legible en claro, sigue tema oscuro.
- **AX7 (web):** `shared/ui/qty-stepper` — vacío-editable + normaliza en blur + select en focus. Cubre todos los inputs de cantidad.
- **AX3 (web):** `compras/ordenes` — dropdown de obras vacío por RLS; cambiado `getAll()`→`getDirectorio()` (RPC SECURITY DEFINER) + empty-state. Lista todas las obras activas (one-liner a `misProyectos()` si se quiere scoped).
- **AX1 (RLS APLICADA prod):** `sql/2026-08-25_AX1_conduce_read_confirm_responsable.sql` — 4 policies SELECT (salidas_inventario/detalle_salidas/salida_firmas/salida_items_libres) + rama en `confirmar_recepcion_salida`, usando `es_responsable_de_proyecto`. El ingeniero responsable ve+firma su conduce (antes RLS/RPC solo miraban proyecto_empleados; ingenieros son proyecto_responsables). Verificado con Wagner. Arregla web y app.
- **AX5 (APLICADA prod + edge v5):** correo del incentivo con la matriz detallada del módulo (Reporte/Inspección/Combustible/Rutas/Conduces/Total/Estado+⚠N) + fallback texto. Fix de población: el motor derivaba por actividad → colaban no-choferes (Eduardo NG, Test User 3, Misael, hasta Xaviel). Gate por rol `chofer_transportista` en `incentivo_generar_semana` + `incentivo_listado` (`sql/2026-08-25_AX5_...`) + RPC `incentivo_matriz_email` (`...AX5b...`). NO disparé envío real (evita spam); datos = 4 choferes, mismo orden que pantalla. **7 filas intrusas históricas quedan ocultas — varias con decisión/posible pago: reportadas para que Xaviel decida si revierte.** ⚠N = incidencias (rutas sin métrica / echadas dup).
- **AX6 (web hecho, build verde):** "Otros" en bitácora — textarea por bloque; guarda `{estructura:'OTROS', actividad:<texto>}` (sin enum en la tabla) → visible en reportes (AT11). App = PROMPT-12.
- **AX2 (APLICADA prod + edge, verificado):** acceso Capataz por cédula. `personal_obra.usuario_id` + capataz.modulos=['bitacora'] + edge genérica `acceso-cedula` (tipo conductor|capataz, email `cap-<cedula>@personal…`, rol capataz) + botón "Crear acceso" en la ficha (`personal-expediente`, solo cargo CAP) + AX2b (capataz VE/FIRMA conduces de su obra, mirror AX1). Verificado: capataz de prueba creado → login cédula+PIN HTTP 200. **App login UI = PROMPT-12.**
- **AX4 (APLICADA prod, DEFAULT APAGADA, verificado):** penalización por estancamiento = renglón negativo del motor AT1. Función aislada `_incentivo_penalizacion` (idempotente) + hook en `incentivo_generar_semana` + RPC `incentivo_set_penalizacion` + config en `pesos._penal_*` (**pts_dia=0 = apagada, sin efecto en pago** hasta que Xaviel ponga números) + panel "Penalización por estancamiento" en Incentivos. Verificado off=no-op y on=computa (JOAN 32→29, EDWARD 1→−3 tope). NO premia cambios de estado. Aviso push preventivo = app (PROMPT-12).
- **Ronda AX WEB = COMPLETA (8/8).** Hallazgo AX5: **Eduardo NG es ingeniero_campo** → por eso salía en la matriz de choferes.

## Estado de versiones (todo en prod / main)
- **1.93.0** (`763150e`) — AW1/AW2/AW3 combustible + cronograma + groundwork IA.
- **1.94.0** (`5e6e66a`) — Compa v1 (solo lectura).
- **1.95.0** (`b2d44a6`) — Compa v2 (acciones con confirmación) + rename Tato→**Compa**.
- Migraciones AW aplicadas a prod (6): `sql/2026-08-24-aw3-*` (4), `-aw1-*` (1), `-aw4-asistente.sql` (1). Edge function `assistant` desplegada.

## Done this session
- **AW3 combustible (server-side):** tope de galones por capacidad de tanque (topes por clase configurables en `flota_config` + override `vehiculos.capacidad_tanque_gal`, margen 1.15) + banda de precio + confirmación de valores inusuales (`registrar_combustible_app` +`p_confirmado`). Causa raíz del 34,118 gal = **decimal perdido** (34.118). Cols de traza `invalidada/saneada/valor_original`. RPCs `sanear_echada`, `echadas_sospechosas`. Baseline/incentivo excluyen invalidadas.
- **AW3 limpieza (aprobada por Xavier):** corregí la echada del Canter (34118→34.118, ahora 16.97 km/gal óptimo), invalidé 2 del KIA (119/88 km/gal imposibles). Queda **1 borderline (37.38 km/gal KIA)** en el panel de Saneamiento por si Xavier la excluye.
- **AW2:** anomalía con dirección (bajo→mantenimiento, alto→`revisar_lectura` al que registró + supervisores). Promedios sanos (excluyen invalidadas/outliers) en web. Panel de Saneamiento (admin) + dashboard (costo/km, precio-vs-banda).
- **AW1 cronograma:** `listar_cronograma` ocultaba tareas `es_prueba` a no-admin → los proyectos de prueba salían vacíos. Fix: en proyecto de prueba, sus tareas se ven. Regla "vacío ≠ error" aplicada en la vista.
- **AW4 Compa (asistente IA):** edge function `supabase/functions/assistant/index.ts` (Claude Messages API + tool use, ejecuta tools con el JWT del usuario → hereda permisos). **v1**: 12 tools de lectura filtradas por módulos. **v2**: `proponer_tarea/requisicion/conduce` → borrador → tarjeta de confirmación → ejecuta el **mismo RPC** del flujo normal (`asignar_tarea_obra`, `crear_solicitud_material`, `crear_conduce_simple`) con sus validaciones (stock, elegibilidad AV1). Web: página `/asistente` (`src/app/pages/asistente/*`), servicio, ruta sin gate, menú+icono. Tablas `assistant_conversaciones/mensajes/acciones` (RLS own+admin, auditoría). Rate limit 60/h, prompt caching.
- **Doc:** `C:\developer\improvements\agosto 2026\imp 19082026\ASISTENTE-IA-GROUNDWORK.md` (4 inventarios).

## Pending — Claude puede hacer (próxima ronda)
1. **Compa v3 — app móvil (csd-app):** el mismo asistente en `C:\Users\xavie\Desktop\X Dev\dev2\csd-app` (misma edge function `assistant`), con notas de voz como entrada (AH13). Es PROMPT-10 territory.
2. **Más write tools:** hoy Compa prepara tarea/requisición/conduce. Agregar solicitud de movimiento (`crear_solicitud_movimiento`) y solicitud de compra.
3. **`generar_reporte_pdf`:** generalizar la edge `generar-informe-obra` (hoy solo informe de obra, email-only) a multi-reporte que devuelva el PDF — es el candidato del groundwork.
4. **RPC `resumen_combustible` saneada** (galones/gasto/rendimiento excluyendo prueba+invalidadas) como tool — hoy el dashboard lo calcula en el cliente.
5. Excluir (o no) la echada borderline **37.38 km/gal del KIA** — decisión de Xavier vía panel de Saneamiento.

## Pending — Xavier only
1. **Budget alert de Compa:** en console.anthropic.com → Billing/Limits → tope mensual **US$50** + aviso al 80%. (Único pendiente para el piloto; Claude no tiene acceso a esa cuenta.)
2. (Hecho por Claude) Secrets `ANTHROPIC_API_KEY` + `ASSISTANT_MODEL=claude-sonnet-5` ya puestos en prod vía Mgmt API. `ANTHROPIC_API_KEY.env` sigue ignorado/sin trackear; se puede mover fuera del repo (la fuente de verdad ya es el secret).
3. **Decisiones para AX4/AX2/AX5** (ver Ronda AX arriba) para desbloquear esas fases.
4. (Ya hecho) Vercel deploya web automático al push de `main`.

## Gotchas descubiertos
- **Management API ≠ admin:** al correr SQL vía la Management API (`POST https://api.supabase.com/v1/projects/jeeqhgccqefbqilntcpu/database/query` con `SUPABASE_ACCESS_TOKEN`), `auth.uid()` es null y `sgc.is_admin()` = **false**. Los RPCs con guard `is_admin` fallan; para data-fixes usa **SQL directo** (rol de servicio, salta el guard).
- **Cambiar el tipo de retorno de una función** (ej. `clasificar_rendimiento` +columna `direccion`) exige `DROP FUNCTION` antes de `CREATE` (error 42P13). Los RPCs que la llaman por nombre no bloquean el drop (se recompilan).
- **`crear_conduce_simple` es un wrapper**: delega en `crear_conduce_transportista`. La forma de los ítems del conduce es `{articulo_id, cantidad}`; la de requisición es `{articulo_id, descripcion, cantidad, unidad, talla}`.
- **Edge functions:** `SUPABASE_URL`/`SUPABASE_ANON_KEY` están inyectadas por defecto. Para que las tools hereden permisos, crear el client con `{ global: { headers: { Authorization: authHeader } } }` (NO service role).
- **Supabase CLI** no está instalado global; usar `npx supabase@latest ...`. Docker no corre pero `functions deploy` no lo necesita.
- **Versionado (regla Y1):** cada bump necesita entrada en `release-notes.json` bajo `web.<version>` o el `prebuild` **falla**. El script Python que la inserta preserva UTF-8 con `ensure_ascii=False`.

## Verify on resume
```bash
cd "C:/Users/xavie/Desktop/X Dev/dev/SGC"
git log --oneline -3            # debe mostrar hasta b2d44a6 (1.95.0)
grep '"version"' package.json   # 1.95.0
# ¿está la key de Compa puesta? (si Compa da 503, falta ANTHROPIC_API_KEY)
npx supabase@latest secrets list --project-ref jeeqhgccqefbqilntcpu 2>/dev/null | grep -i anthropic || echo "FALTA ANTHROPIC_API_KEY"
```
