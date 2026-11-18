# Avance F8 lotes 8a / 8b / 8c (ronda DS, 16-nov-2026)

Alcance: #56, #57 (resto), #58, #59, #73, #74 (DS-33/34/35) · #60, #61, #75, #84 (DS-36/37) · #62, #79, #80, #82, #83 (DS-38/39).
Todo aplicado SOLO a dev (ledger) y probado con transacciones `ROLLBACK` contra dev. Prod no se tocó. Los flags de comportamiento
que dependían de entrevista quedan **apagados** con el valor del issue como default (editables en Administración › Parámetros).

Migraciones (todas aditivas, en `sql/`, en el ledger de dev):
`2026-11-16-ds33-parametros-ui-y-sla-solicitudes.sql`, `ds34-conduces-por-cerrar.sql`, `ds35-solicitud-movimiento-legado.sql`,
`ds36-flota-avisos-clases-y-salud-combustible.sql`, `ds38-39-adopcion-y-resumen-tareas.sql`.
Edge nueva: `conduce-qr` (dev, v1, `verify_jwt=true`, secret `CONDUCE_QR_SECRET` solo en dev, valor desde `.env.local`).
Edges redesplegadas en dev por herramientas nuevas del conector: `mcp`, `assistant`.

## DS-33 · #56, #73 (SLA y escalamiento de solicitudes de material)
- Ya estaba hecho: orden por columna «más antiguas primero» (`src/app/pages/bitacora/solicitudes-material/solicitudes-material.ts:209-212`),
  aviso de vencidas por fecha de necesidad (`sql/2026-10-01-ce10-es-miembro-obra.sql`, `requisiciones_vencidas_avisar`, cron `sgc-requisiciones-vencidas`).
  No cubren «sin respuesta del aprobador», que es lo que pide #56.
- Construido: params `sla_solicitud_material_activo` (**false**), `_horas` (48), `_roles` (`jefe_almacen,admin`), `_aviso_dias` (7);
  `solicitudes_material.escalada_at`; `sgc.solicitudes_material_escalar()` + cron horario `sgc-solicitudes-material-escalar`
  (aviso con enlace a `/inventario/requisiciones`, una sola vez por solicitud, respeta `es_prueba`);
  RPC `solicitudes_material_pendientes_reporte()` (las pendientes, más antiguas primero) y `solicitudes_material_kpi()`
  (pendientes, mayores de N días, más antigua); pantalla `Inventario › Pendientes de cierre` (`/inventario/pendientes-cierre`).
  Prueba en dev (rollback, flag encendido): escaló todas las pendientes de dev y avisó a roles + solicitante.
- Pendiente: botones Aprobar/Rechazar dentro de la notificación push (#73, requiere acciones de notificación y paridad en csd-app, PROMPT-149);
  KPI «pendientes > 7 días» en el Dashboard (la RPC `solicitudes_material_kpi` ya existe, falta pintarla); la entrevista con Compras/Almacén
  (por qué Monterezzo concentra pendientes) es un paso humano.

## DS-34 · #58, #74 (conduces por cerrar + QR)
- Ya estaba hecho: motivo de anulación ≥ 10 caracteres (`sql/2026-11-06-dj7-anular-conduce-motivo-obligatorio.sql`);
  «incompleto» con NULL = enviado (DS-09, `sql/2026-11-16-ds9-incompletos-null-es-lo-enviado.sql`, lote F3); lista admin de huérfanos
  (`sql/2026-10-23-cw1-conduces-huerfanos.sql`, solo admin y solo sin recepción).
- Construido: RPC `conduces_por_cerrar(p_dias_min)` (admin o módulo inventario; sin auto-cierre) en la pantalla Pendientes de cierre;
  `conduces_por_cerrar_avisar()` + cron diario, **apagado** (`conduce_aviso_activo=false`; `conduce_aviso_dias=7`, `conduce_recordatorio_horas=24`,
  `conduce_aviso_roles`), una marca por etapa (`recordatorio_cierre_at`, `aviso_por_cerrar_at`).
- QR: `supabase/functions/_shared/conduce-qr.ts` (token `id.exp.HMAC-SHA256`, comparación en tiempo constante) + 5 tests Deno;
  edge `conduce-qr` (`emitir`: solo quien ve el conduce por RLS; `resolver`: firma+vencimiento, devuelve id y estado);
  servicio `conduce-qr.service.ts`; el QR sale en el encabezado imprimible del conduce (`conduce.html`, flag `conduce_qr_activo`, **apagado**,
  `conduce_qr_vigencia_dias=30`); landing `/conduce-qr/:token` → `/conduce-recibir/:id` (misma pantalla Conduce con recibir/firmar/cerrar,
  sin el gate del módulo Inventario; la RLS y `conduce_confirmar_receptor` siguen decidiendo).
- Pendiente: «escanearlo inicia el viaje del chofer» y escáner dentro de la app (paridad csd-app, DS-49); prueba en vivo de la edge con una sesión
  real (solo se verificó el token con tests unitarios; el despliegue y el secret están en dev); limpiar los 28 viejos con el almacén (paso humano).

## DS-35 · #59 (solicitudes de movimiento)
- Construido: no se retira nada. Flags `solicitud_movimiento_oculta` y `solicitud_movimiento_aviso_legado` (ambos **false**), leídos por la UI vía
  `sgc.parametros_ui()` (lista cerrada de claves) y `UiFlagsService`. Oculta: sale del menú (`shell.ts`, Ingeniería › Apoyo de transporte) y
  `movimientoLegadoGuard` redirige `/transporte/apoyo` a `/inventario/conduces`. Aviso: banner dentro de Apoyo de transporte. Reversible: apagar el flag.
- Pendiente: medir por qué se cancelan 2 de cada 3 (necesita entrevista a Logística).

## DS-36 · #61 (avisos de flota)
- Lectura de los 5 crons (hecha antes de tocar): solo `sgc-reporte-semanal-dia` inserta en `avisos_flota` (`sql/2026-07-30-ac12-ac5-gomas-dia-reporte.sql:117`);
  `sgc-preaviso-reporte-semanal-sabado`, `sgc-recordatorio-reporte-semanal-dia/-noche` notifican al chofer (`recordatorio_reporte_semanal`) y
  `sgc-resumen-operaciones-lunes` es el correo semanal. No se solapan: **no se consolidó ningún cron**.
- Construido: param `avisos_flota_informativos` (`reporte_semanal`); trigger `tg_autoresolver_aviso_reporte_semanal` (al registrar el checklist semanal,
  los avisos `reporte_semanal` pendientes de ese vehículo pasan a atendido; param `avisos_flota_autoresolver_reporte`); RPC `avisos_flota_resumen()`;
  la lista de Avisos oculta los informativos por defecto y muestra una sola línea resumen con «Verlos/Ocultarlos»; «Marcar todos» ahora atiende
  por ids lo visible. El badge del menú ya separaba `reporte_semanal` en `flota.reporte-semanal` (`notificaciones.service.ts:loadAvisosFlota`).
- Pendiente: nada de código. Los pendientes viejos existentes (en prod) se limpian con «Marcar todos» tras ver el resumen (acción de Flota).

## DS-37 · #60, #75, #84 (combustible)
- Ya estaba hecho: OCR de recibo/tablero/bomba sobre el lector IA existente (`combustible.service.ts:150-153` `leerRecibo`, edge `leer-recibo`, CF4/DI5);
  umbral de «anormal» editable (`umbral_anormal_pct`/`umbral_consumo_pct`, catálogo `parametros-catalogo.ts`); aviso de km pendiente (`sql/2026-09-17-bt1-importaciones.sql`).
- Construido: RPC `flota_salud_combustible()` (km pendiente %, última echada importada, días sin importar, `importacion_caida` con param
  `combustible_importacion_dias_alerta`=21, registros 30 d).
- No se pudo verificar: si la importación de estación sigue viva EN PROD (caída desde 14-sep) — esa lectura es de prod; la RPC la contesta con un
  SELECT (solo lectura) cuando Xaviel lo autorice o desde la UI tras el release. #84 es una épica: sus hijos (#55, #60, #61, #64, #75) quedan cubiertos
  por lo anterior y por DS-41 (lote 8d).
- Pendiente: pantalla con la salud de combustible (la RPC existe, falta pintarla en Flota › Combustible); la decisión de Flota sobre la estación.

## DS-38 · #62, #83 (adopción)
- Construido: RPC `adopcion_por_rol()` (admin/dirección; excluye `es_prueba`; ventana `adopcion_dias_activo`=14) y `adopcion_usuarios_inactivos()` (solo admin);
  pantalla `/admin/adopcion` (Administración, menú Sistema › Adopción por rol). Fuente: `auth.users.last_sign_in_at` y `usuarios.ultima_actividad_web/app` (W12).
- Pendiente: «entradas con OC» en el tablero (depende de DS-24, F6); plan de capacitación por rol y entrevistas de #83 son pasos humanos.

## DS-39 · #79, #80, #82
- #79 ya estaba hecho: resumen semanal de operaciones por correo a roles administrables (`supabase/functions/resumen-semanal-operaciones/index.ts`,
  cron `sgc-resumen-operaciones-lunes`, BE1/DB5) y `leer_reporte_semanal_operaciones` en el conector. No se rehízo.
- #82 construido: `sgc.tareas_resumen_diario()` + cron `sgc-tareas-resumen-diario` (8:15 RD): aviso en app + push con tareas de hoy y vencidas, con enlace a `/tareas`;
  **apagado** (`tareas_resumen_diario_activo=false`, `_min`=1). Prueba en dev con rollback: avisó a 5 usuarios con tareas.
  Pendiente: canal WhatsApp/correo del resumen diario y «asignar tareas por voz» (el issue los pide; requieren entrevista y el canal wa-seguimiento).
- #80 construido: 3 herramientas de lectura del conector/Compa (`solicitudes_material_atascadas`, `conduces_por_cerrar`, `adopcion_por_rol`) en
  `supabase/functions/_shared/herramientas.ts`, filas en `PERMISOS-TOOLS.md`, 3 casos nuevos en `assistant/evals/casos.json` (CP5). Evals corridos en dev:
  3/3 OK (`qa/compa-evals-dev.json` se reescribió). `scripts/cobertura-conector.mjs`: 25/25. Las `proponer_*` existentes no se tocaron.
  Pendiente: «registra una echada» por conversación (propuesta `proponer_*` nueva para echadas; no existe y requiere diseño de confirmación).

## Verificación
`npx ng build` OK; `npm test` 367 OK; `deno test supabase/functions` 383 OK; guards de prebuild revisados sin fallos propios
(`verify-i18n` y `audit-rpc-grants` fallan por claves/RPC de otros lotes: DS-24). Claves `en`/`ht` añadidas (29 cada una).
