# HANDOFF — SGC

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
