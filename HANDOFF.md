# SGC — Session Handoff

_Last updated: 2026-07-14_

## Actualización 1 (14/07 tarde) — reporte semanal v2 + resumen inventario web — build verde, SQL aplicado a prod

Source of truth: `C:\developer\improvements\imp 14072026\CONTEXTO-ACTUALIZACION-1.md` (§A hojas, §B preguntas oficiales).
Aditivo/retrocompatible. **Nada commiteado ni desplegado.** La parte móvil (PROMPT-4) queda pendiente.

### ✅ Reporte semanal — plantilla OFICIAL v2 (R3 refinado)
- `sql/2026-07-14-reporte-semanal-v2.sql` **aplicado + verificado en prod**:
  desactiva `REPORTE-SEMANAL-V1` (activo=false, **frecuencia intacta** → históricos siguen
  contando/visibles) e inserta `REPORTE-SEMANAL-V2` activa con las **9 preguntas oficiales**
  (cada una su propia sección), **ninguna crítica**. Mismo patrón de versionado que Flota v2.
- El ítem 10 "Algún comentario" **NO** es ítem OK/NO/NA → es el campo `observaciones` de la
  cabecera del wizard (ya existente, opcional).
- **Kilometraje**: se mantiene como dato de cabecera del wizard (coherencia + mant. por km).
- **Nivel de combustible**: era **campo genérico opcional** de cabecera (`checklists_vehiculo.nivel_combustible`,
  sin validación, compartido por todos los tipos) — **NO** fue sembrado como ítem del semanal,
  así que no había nada que quitar; **queda opcional** tal cual (caso "déjalo opcional").
- Un NO en cualquier ítem → veredicto `con_hallazgos` (verificado con la lógica exacta del RPC) →
  `registrar_checklist_vehiculo` inserta aviso `hallazgos` y notifica a Flota (mecanismo existente, sin cambios).
- El form web (`flota/checklists`) agrupa ítems por sección y el dashboard `flota/reporte-semanal`
  muestra los veredictos — ambos genéricos, la v2 se ve bien sin cambios de código.

### ✅ Inventario web — hoja de resumen/review (patrón "hojas" §A, versión web)
- `salidas` y `entradas`: drawer ahora es wizard de 3 hojas dentro de la misma página:
  **form** (categorías destacadas-first en `<optgroup>` + stepper −/+, ya existía) →
  **resumen/review** (lista editable: ajustar cantidad con stepper / quitar renglón, con meta
  almacén/motivo/proveedor/fecha) → **éxito** (✓ + "Registrar otra"/"Cerrar"; salida además
  enlaza "Ver conduce"). Reusa `FormDrawer` + `QtyStepper`; sin nav nueva.
- Aprobación de requisición (A2) NO cambia: sigue en un solo paso (ya tenía su mapeo inline).
- El registro resultante se ve igual que siempre en listados/historial (regla madre); el conduce no se tocó.

### 🔜 Pendiente
- QA manual en navegador (crear reporte semanal v2 con un NO → hallazgo/aviso; salida multi-categoría por el resumen).
- Commit/push + deploy — esperar autorización.
- csd-app (PROMPT-4): patrón "hojas" completo + compartir WhatsApp + reporte semanal v2 móvil.

---

## Mejoras reunión 14/07 (SGC web + SQL) — build verde, SQL aplicado a prod

Source of truth: `C:\developer\improvements\imp 14072026\CONTEXTO.md` (R1–R29 + §4).
**TODAS las migraciones son aditivas/retrocompatibles** (la app móvil sigue llamando
`registrar_checklist_vehiculo`, `crear_entrada_bitacora`, etc. — verificado). **Nada commiteado
ni desplegado aún** (Xavier debe autorizar). La **parte móvil (csd-app) queda pendiente**.

### ✅ Fase 0 — SQL (7 migraciones aplicadas + verificadas en prod)
- `sql/2026-07-14-mejoras-flota.sql` — R1 `vehiculo_asignaciones` + RPC `asignarme_vehiculo`;
  R2 RPC `auto_registrar_conductor`; R4 vista `v_vehiculo_stats`; R5 vista `v_conductor_stats`;
  R6 checklist `bloqueado`→`vehiculos.estado='no_disponible'` + RPC `reactivar_vehiculo`.
- `sql/2026-07-14-mejoras-reporte-semanal.sql` — R3 `checklist_plantillas.frecuencia` +
  plantilla seed `REPORTE-SEMANAL-V1` (5 ítems, **TODO negocio: preguntas exactas**) +
  vista `v_reporte_semanal_cumplimiento` (12 semanas ISO × vehículo); + tipo aviso `reporte_semanal`.
- `sql/2026-07-14-mejoras-inventario.sql` — R16 `categorias_inventario.orden/destacada`
  (Clavos/Madera/**Acero y Metales** destacadas 1-3; movidos 4 clavos + varillitas);
  R18 `sgc.homologar_texto()` + triggers en bodegas/categorias/articulos/partidas.
- `sql/2026-07-14-mejoras-bitacora.sql` — R21 `bitacoras.llovio/lluvia_detalle`;
  R22 `hubo_migracion/migracion_obreros`; R24 `bitacora_actividades.cantidad` +
  `sgc.proyecto_partidas`; RPC `crear_entrada_bitacora` extendido (29 args, 4 nuevos con default).
- `sql/2026-07-14-mejoras-proyectos.sql` — R25 `proyectos.porcentaje_pagado` +
  vista `v_proyecto_avance` + `sgc.avisos_proyecto` + RPCs `evaluar_avisos_proyecto`/`atender_aviso_proyecto`.
- `sql/2026-07-14-mejoras-app-versiones.sql` — R15 `sgc.app_versiones` + RPC público `version_publicada()`.
- `sql/2026-07-14-mejoras-roles-seed.sql` — R27 roles **Chofer/Transportista** (flota) +
  **Guarda-Almacén** (inventario). NO se crearon módulos nuevos.

### ✅ Fase 1 — Flota web
- `flota/vehiculos/:id` perfil (stats `v_vehiculo_stats` + vencimientos + asignaciones + historial) — R4.
- `flota/conductores/:id` perfil (licencia + stats + historial) — R5.
- Gestión de asignaciones multi-persona en el perfil del vehículo — R1.
- `flota/reporte-semanal` (cumplimiento + faltantes + avisos idempotentes + historial) — R3.
- Avisos: "Reactivar vehículo" (R6) + "Crear cita" que precarga mantenimiento (R9).
- Links "Ver perfil" en listas; `no_disponible` en modelo/badges; nav actualizado.

### ✅ Fase 2 — Inventario + Conduces
- R16/R17 salidas/entradas: `<optgroup>` por categoría (destacadas primero) + `app-qty-stepper` (−/+).
- Página `inventario/categorias` (CRUD: nombre/orden/destacada/activo) + nav.
- R18 hint "Se guardará como:" en almacenes/categorías (util `homologarTexto`); server homologa via trigger.
- **R19 PDF de conduces ARREGLADO**: root cause = bloque `@media print` global en `styles.scss:541`
  que ocultaba todo salvo `[id$='-report-print']`; el conduce no tenía ese id → salía en blanco.
  Fix: `id="conduce-report-print"` en el root del conduce + reglas de paginación de tabla.

### ✅ Fase 3 — Proyectos + Bitácora
- Componente `app-proyecto-partidas` embebido en el detalle de proyecto (CRUD + avance físico) — R24.
- Métrica "Pagado vs Trabajado" + alerta roja `pago_excede` en el detalle; `evaluar_avisos_proyecto()`
  al cargar la lista; edición de % pagado sólo Dirección/Admin — R25.
- Bitácora `nueva`: preguntas "¿Está lloviendo o llovió?" y "¿Hubo problemas de migración?" primero;
  cantidad por actividad (stepper); incidente_descripcion requerido — R21/R22/R23/R24.
- Bitácora `historial`: muestra clima (NO como incidente), migración+obreros, cantidades, descripción.

### ✅ Fase 4 — Dashboard / versiones / guías
- R15 página `admin/app-versiones` (crear/publicar/mínima/eliminar) + servicio + nav.
- R26 dashboard por rol: **ya satisfecho** por el gating `canSee(modulo)` existente (sin refactor).
- R29 "Guías rápidas" visuales en Dudas (pre-uso, combustible, conduces, bitácora, inventario).
- R28 historial de todo: cubierto por perfiles/reporte-semanal/avisos/partidas/combustible/bitácora.

### 🔜 Pendiente
- **QA manual en navegador** (flujo real logueado) de cada punto — no verificado end-to-end aquí.
- **Commit/push + deploy Vercel** — esperar autorización de Xavier.
- **csd-app (móvil)**: R7 rutas+combustible, R10 biometría, R11/R20 empty states, R12 paridad
  (gestión de almacenes), R13 cancelar bitácora, R14 reportes con imágenes, + espejos de lo nuevo.
- **TODO negocio (§5)**: preguntas exactas del reporte semanal; datos mínimos auto-registro conductor;
  quién carga partidas; fuente real de % pagado (hoy manual en `proyectos.porcentaje_pagado`).
- Roles nuevos: Xavier revisa/borra en Admin>Roles los que no use (no asignados a nadie aún).

---


## Current focus (2026-07-14): Flota v2 + CL-01..07 desplegados a prod

Ambos mergeados a `main` y desplegados (autorización de Xavier "hazlo todo").
Además se aplicó el endurecimiento del cuadre (RLS a compras/direccion/admin) y
las correcciones de la auditoría (ver historial de commits). Detalle abajo.

## Flota v2 — Pre-uso + Combustible (13/07/2026)

Source of truth: `C:\Users\xavie\Desktop\X Dev\Constructora SD\developer csd\fp ideas\13072026\x solution\CONTEXTO.md`.
Web (this repo) done; **mobile side pending in the csd-app repo**. All DB changes are
**additive & retro-compatible** (mobile still calls `registrar_checklist_vehiculo`,
`crear_mantenimiento_app`, `crear_entrega_vehiculo`, `mis_pendientes_transporte`).

### ✅ Done (build passing; SQL applied & verified on prod DB; nothing committed yet)
- **SQL** `sql/2026-07-13-flota-v2.sql` (+ `...-flota-checklists-seed-v2.sql`), applied:
  - New cols: `vehiculos.{vencimiento_matricula,vencimiento_seguro,km_ultimo_mantenimiento,intervalo_mantenimiento_km}`,
    `conductores.tipo_vehiculo_autorizado`, `registros_combustible.{galones,monto,precio_por_galon,km_anterior,km_recorridos,rendimiento_km_gal,costo_por_km,foto_recibo_path,foto_tablero_path,alerta_consumo,client_uuid}`,
    `checklists_vehiculo.{nivel_combustible,resultado,km_faltan_mantenimiento,alerta_mantenimiento}`,
    `checklist_plantilla_items.{numero,aplica_a}`. **Made `registros_combustible.litros` NULLABLE** (v2 uses galones).
  - New tables `sgc.avisos_flota` (bandeja + RLS + realtime) and `sgc.flota_config`
    (umbrales: consumo 20%, pre-cita 500km, licencia 30d).
  - RPC `registrar_combustible_app` (SECURITY DEFINER, idempotente por `client_uuid`,
    calcula derivados + alerta consumo + aviso + notifica). RPC `atender_aviso_flota`. Helper `notificar_modulo`.
  - **Extended `registrar_checklist_vehiculo`**: dropped 13-arg sig, single 14-arg with
    `p_nivel_combustible default null` → old mobile 13-named-arg calls still resolve.
    Computes tri-estado `resultado`, `alerta_mantenimiento`, rejects on licencia/matrícula/seguro vencidos, inserts avisos + notifica.
  - Seed v2: one active plantilla `PRE-USO-V2` (33 ítems: LSC 10 + Seguridad 19 + Herramienta Pesado 4, críticos por Excel); v1 plantillas desactivadas.
- **Web**: Combustible v2 page (galones/monto + 2 fotos + live calc + detalle);
  `flota/combustible-dashboard` (por vehículo + flotilla); Checklists v2 (tri-estado,
  nivel, secciones filtradas por clase, reporte de inspección imprimible con 7 fotos);
  `flota/panel-dia`; `flota/avisos` (gestión + genera vencimientos idempotente/día);
  Vehículos/Conductores forms con campos nuevos + badges de vencimiento/mantenimiento.
  Nav (shell) + flota badge ahora cuenta `avisos_flota` pendientes. Dudas actualizado.
- **Edge function** `notificar-flota` deployed (Resend, `usuarios_con_modulo('flota')`),
  invocada (no bloqueante) desde combustible (consumo) y checklists (bloqueo/hallazgos/pre-cita/vencido).
- **Verificado (rolled-back SQL tests)**: derivados de combustible, consumo anormal→aviso,
  checklist bloqueado→aviso, bloqueo por matrícula vencida, y **retrocompatibilidad del RPC 13-arg**.

### 🔜 Pendiente
- **QA manual en navegador** (flujo real logueado): registrar combustible con/sin histórico
  y con rendimiento bajo; checklist con crítico en NO; pre-cita por km; panel del día; flotilla; atender avisos; imprimir reporte.
- **Mobile (csd-app)**: pre-uso v2 (nivel, 7 fotos, secciones, veredicto, PDF jsPDF+share) y combustible v2 (3 datos + 2 fotos) usando los RPCs ya listos.
- Confirmar con negocio: ítems críticos oficiales, caja herramienta pesada (P1–P4 placeholder), correos del BLOQUEADO, frecuencia de inspección.
- (Nota histórica: decía "no commit hasta autorización" — Xavier autorizó el 14/07 con "hazlo todo".)

---

## Ola 3 — Checklists de Liberación (CL-01..07)

Branch **`feat/ola3-cl-liberacion`** (web + mobile, both pushed for preview).
Migration `sql/2026-07-13-ola3-cl-liberacion.sql` is **already applied to prod**
(additive/retro-compatible; smoke-tested). App code is on the feature branch
awaiting QA before merge/deploy.

### ✅ Done — CL-01..07 (build verde en ambos repos; lógica de compliance probada)
- **Migración (aplicada a prod):** ítems reales de los 7 CL sembrados
  (11/9/7/8/11/7/7); nombres CL-05/06/07 corregidos (CL-06 = Encofrado horizontal
  Golliat, CL-07 = Armado horizontal); bucket privado **`obra`** (+3 policies);
  trigger **`trg_cl_firma`** (CL → `firmado` al firmar residente+responsable+cliente);
  **`trg_nc_bloquea_vaciado`** reforzado (liberar/vaciar exige un CL `firmado`);
  RPC **`registrar_cl_app`** (captura offline del móvil, idempotente por p_id).
- **Web** (`src/shared/…`): `app-cl-liberacion` (componente + servicio + modelo)
  embebido en el detalle de proyecto **antes de Vaciados**; llenar checklist por
  secciones (Sí/No + observación), plano + fotos (correcto/incorrecto), y ciclo de
  firmas con nuevo primitivo **`app-signature-pad`** (canvas). Sube al bucket `obra`
  con URLs firmadas. `npm run build` verde.
- **Móvil** (`dev2/csd-app`, **v1.3.0** / versionCode 13): página
  `/bitacora/liberacion` + tile en el hub de Bitácora; asistente offline (obra →
  CL → ítems → plano/fotos → firmas → confirmar) por el outbox `cl_liberacion` →
  `registrar_cl_app`. Servicio registrado en `app.config.ts`. Build verde.
- **Smoke test DB (rollback):** (1) CL nuevo=borrador, (2) 2 firmas=borrador,
  (3) 3 obligatorias=firmado, (4) liberar sin CL → BLOQUEADO, (5) liberar con CL
  firmado → OK. Sin datos de prueba filtrados a prod.

### ⏳ Pendiente de Xavier (antes de cerrar el ciclo)
- **QA en preview**: web `sgc-git-feat-ola3-cl-liberacion-xaviel-csd.vercel.app`,
  móvil PWA `csd-app-git-feat-ola3-cl-liberacion-xaviel-csd.vercel.app`.
- Al aprobar: **merge a `main` (ambos) + deploy** y **rebuild/reinstall APK v1.3.0**
  (`node scripts/release-apk.mjs`, device 6dbf1af4).
- Falta aún (Ola 3): UI de informe semanal / charlas / reporte de pérdidas;
  cubicaciones/RFI; exports PDF/Excel; notificaciones WhatsApp.

---

## Reunión 07/07/2026 — Parte A (A1–A9)

Big multi-phase build from the 07/07/2026 meeting. Source of truth:
`C:\Users\xavie\Desktop\X Dev\Constructora SD\SGC meet improvements\07072026 meet.md`
(+ `...- Claude Code prompt.md`, CSD-OPE-01 docx, kit xlsx, org pptx).
Branch: **`feat/meet-07072026`**. Prod DB is **shared with the CSD mobile app** —
everything must stay retro-compatible (mobile RPCs: `crear_solicitud_app`,
`crear_entrega_vehiculo`, `registrar_*_app`, `recibir_conduce_app`, `registrar_conteo_app`).

### Locked decisions (Xavier, 2026-07-12)
1. **Requisición** = repurpose `sgc.solicitudes_material`; on approval auto-split
   (in-stock → despacho/conduce, shortfall + non-catalog → auto `solicitudes_compra`).
   No new table. `solicitudes_compra` = purchase side owned by Compras.
2. **Approver** stays permission-based (`inventario`/`compras` module holders).
3. **Antifraud alerts** (A4) silent to obra; panel in Dirección; notify roles
   Dirección General + Gerencia + Administrador.
4. Execute autonomously phase-by-phase, commit+verify each, checkpoint at forks.

### ✅ Done — A1 + A2 (commit `1e5efc1`, build passing, migration live on prod)
- **A1 renames (UI-only, DB/routes/embeds untouched):** "Bodega"→"Almacén"
  across Inventario/conduces/salidas/entradas/reportes/dashboard/dudas/auditoría/nav;
  "Solicitud de material"→"Requisición" (engineer page, nav, badges, Dirección, auditoría).
- **A2 unified flow:** `sql/2026-07-12-requisiciones-flujo.sql` applied →
  - RPC `sgc.aprobar_requisicion(p_solicitud_id, p_bodega_id, p_fecha, p_responsable, p_observaciones, p_items)`
    `SECURITY DEFINER`, returns `{salida_id, solicitud_compra_id, despachado_total, faltante_total}`.
    Splits: dispatchable = `min(req, stock@bodega)` → `registrar_salida_inventario`; rest → auto `solicitudes_compra` (pendiente) linked via `origen_requisicion_id`.
  - New cols: `solicitudes_material.{solicitud_compra_id,bodega_id}`, `solicitudes_compra.origen_requisicion_id`.
  - Old `aprobar_solicitud_material` kept (deprecated). Estados stay in app-known set.
  - Approval UI (`inventario/salidas`): approver **maps each free-text requisición line to a catalog article** (auto-matched by name/code); unmapped → purchase. Shows split summary toast.
  - Realtime added for `solicitudes_material/compra` + `salidas_inventario` (live badges).
  - **Fork flagged:** removed "Solicitar compra" from the engineer's Bitácora nav
    (route still exists). Non-catalog needs now flow through the requisición as
    free-text → auto-compra. Confirm with Xavier if he wants it back.

### 🔜 Needs Xavier QA before extending (A3/A4 hook into aprobar_requisicion)
End-to-end click-through (his manual QA workflow):
1. Engineer → Bitácora → Requisición → nueva requisición (free-text items).
2. Almacén → Inventario → Salidas → "Requisiciones pendientes" → Aprobar →
   pick almacén, confirm article mapping → "Aprobar y despachar".
3. Verify: a conduce (salida) exists for the in-stock part **and** a new
   Solicitud de compra appears in Compras → Órdenes for the shortfall.

### ✅ Done — A6 + A7 (commit `9205f69`, build passing, migrations live on prod)
- **A6 Flota checklists:** `sql/2026-07-12-flota-checklists.sql` (+ `-seed.sql`) →
  `checklist_plantillas`/`_items`, `checklists_vehiculo` (+`_respuestas`/`_fotos`),
  RLS + grants; RPC `registrar_checklist_vehiculo` (SECURITY DEFINER, idempotent by
  client UUID → CSD-App-ready) + `atender_checklist_vehiculo`. Seeded 3 templates
  (Pre-Uso Liviano 8, Inspección Seguridad 19, Pre-Uso Camión 12) by categoría
  liviano/camión/equipo. Critical NO → realtime toast to Flota + `flota` badge until atended.
  Page `/flota/checklists` (fill OK/NO/NA, per-tipo template auto-suggest, history, atender), route+nav.
- **A7 Tecnología module:** permission `tecnologia` (roles.service + admin array_append),
  parent route ungated (guide for all) + gated children, nav+icon, dashboard card.
  Tables: `tec_herramientas` (seeded Drive/Claude/Fireflies/Meet), `tec_matriz`,
  `tec_equipos` + `tec_equipo_historial` (dedicated tech inventory → empleado + history;
  architect choice: NOT activos_fijos, to keep asset-accounting register clean).
  Compras tec: `solicitudes_compra.proyecto_id` nullable + `categoria`; RPC
  `crear_solicitud_compra_tec` → flows to Compras/Gerencia. 5 pages (guia/homologacion/matriz/inventario/compras).
- Dudas FAQ updated (Tecnología, flota checklists, requisición flow). Dashboard card added.

### ✅ Done — A3.2 Equipo de Obra (commit `997e9b2`, build passing, migration live)
- `sql/2026-07-12-equipo-obra.sql`: `proyecto_empleados` empleado_id nullable +
  externo_nombre/tipo, desde/hasta, activo, notas + CHECK (empleado OR externo).
- Model `ROLES_OBRA` (authoritative CSD-OPE-01 §5 catalog) + `ROLES_GERENCIA_OBRA`
  (2 mgmt roles, informational) + `rolObraLabel()`. Service `addMiembro`.
- UI: Proyectos > detalle → "Equipo de Obra" (rol catalog, empleado/externo toggle, vigencia).
- **Deferred (note):** (a) mgmt roles gerente_produccion/ing_supervisor_general have a
  catalog but no company-level assignment UI yet; (b) "only assigned Residente/Responsable
  can requisition" validation NOT enforced in the shared RPC (do it when extending A2/A4).
  Guarda-Almacén role value `guarda_almacen` is queryable for A5.

### ✅ Done — A8 Expediente de inicio de obra (commit `a1cf7b2`, build passing, migration live)
- `sql/2026-07-12-expediente-obra.sql`: `expediente_obra` (checklist por doc/proyecto,
  estado pendiente/cargado/validado/no_aplica), RLS (proyectos/legal/admin) + grants,
  RPC `sembrar_expediente_obra` (11 docs §6.1.1, idempotent), view
  `v_expediente_obra_resumen` (security_invoker) for KPI.
- Component `<app-expediente-obra>` in Proyectos detail (init, per-doc estado/responsable/
  file upload to `sgc-documentos`, completeness bar). Dirección KPI "expediente incompleto".
- No montos exposed (section under proyectos module; obra roles lack it).

### ✅ Done — A3.1 + A4 + A5 (commits `295bfce`, `11532eb`; build passing; migrations live; A9 audited)
- **A3.1** cuadre + kit: `kit_inicio_plantilla` (seeded from Excel: 86 items), `cuadre_obra`,
  `cuadre_items` (per-phase est), `cuadre_consumo` (ledger). `copiar_kit_a_cuadre`.
  `aprobar_requisicion` records consumo vs active phase. `<app-cuadre-obra>` in Proyectos detail.
- **A4** silent antifraud: `parametros` (80/100 thresholds) + Admin>Parámetros; `alertas_cuadre` +
  `evaluar_alerta_cuadre`; Dirección panel + badge + realtime; Gerencia granted `direccion`.
  Verified end-to-end (90%→advertencia, 120%→alerta, dedup). RLS: obra roles see NOTHING.
- **A5** chequeo semanal: `registrar_chequeo_semanal` (diff→alerts), conteos `tipo`,
  Inventario>Conteos "Nuevo chequeo semanal", pg_cron `chequeo-semanal-almacenes` (Mon 06:00)
  → task to each obra's Guarda-Almacén.
- **A9** audit: all 16 new tables RLS on; sensitive (cuadre/consumo/alertas/parametros) gated to
  proyectos/compras/direccion/admin — never bitacora; grants + RPC EXECUTE verified; no montos exposed.

### ✅ Post-review round (merged to main + prod) — 3 adversarial review passes + fixes
- Alert engine hardened: only cuadre-tracked articles alert; "sin estimado en fase" → advertencia
  (no flood); consumo ledger records DISPATCHED qty (no double-count). Re-verified in DB.
- New role **Encargado de Tecnología** (module was admin-only); flota **'equipo'** checklist template seeded.
- Web: Dirección badge refresh + realtime UPDATE on alerts; conteos `tipo` (chequeo badge) + numeric fix;
  expediente % counts no_aplica; requisición split-result numeric defaults; Compras shows origin ("Desde requisición"/"Tecnología").
- **New: Inventario > Reposición** — artículos en/bajo stock mínimo por almacén (obra-safe, sin montos) = the A3.1 reposición signal.
- Dudas expanded (antifraud panel, cuadre/kit, Parámetros, Reposición); CLAUDE.md módulos list updated.
### ✅ Recommendations round (all 5 built + deployed to prod) — `sql/2026-07-13-recomendaciones.sql`
1. **Requisición↔Equipo enforcement** — `sgc.requisicion_permitida` + parámetro `requisicion_validar_equipo`
   (default **FALSE** = no behavior change). Set to `true` in Admin>Parámetros once equipos are configured;
   then only the assigned Ing. Residente/Responsable (or Almacén/Admin) requisitions; projects w/o equipo not blocked.
2. **fase_activa auto-advance** — `cuadre_obra.fase_auto` + `fase_por_avance()` + trigger on `fases_proyecto`;
   cuadre editor has an "auto" toggle (manual change disables it).
3. **`cerrada` estado** — CHECK expanded + trigger auto-closes a requisición when its salida is confirmed
   entregado (and no pending purchase). Web + app labels updated.
4. **Reposición uses kit-minimum** — `sgc.reposicion_almacen` (SECURITY DEFINER, obra-safe) overlays the
   cuadre kit-min on `articulos.stock_minimo`; Reposición page uses it; cuadre add-item exposes "es_min_stock".
5. **Roadmap CL-01..07 schema** — `obra_elementos` / `obra_vaciados` (N° de vaciado) / `obra_no_conformidades`
   (NC-abierta-bloquea-vaciado) tables + RLS/grants. Schema only (no UI yet).

### ✅ Pre-piloto round (deployed to prod) — dashboard por rol + almacén por obra + enforcement
- **Dashboard varía por rol**: cada KPI/gráfico gateado por módulo (`canSee()`); montos de contrato
  solo Dirección/Admin (`canVerMontos`). El ingeniero de obra ya no ve inventario/compras/otras áreas.
  + **Ranking de encargados** compacto en el dashboard (proyectos/dirección; sin montos).
- **Almacén por obra**: `bodegas.proyecto_id` + `es_principal` (migración `sql/2026-07-13-almacen-obra.sql`);
  UI en Almacenes para enlazar un almacén a una obra o marcarlo principal global.
- **Requisición↔Equipo ENCENDIDO** (`requisicion_validar_equipo='true'`). Grace activa: como
  `proyecto_empleados` está vacío, nadie se bloquea hasta que se asignen Residentes/Responsables.
  ⚠️ Al asignar un Ing. Residente a una obra, SOLO ese usuario (empleado con `usuario_id` enlazado)
  podrá requisar esa obra. Para el piloto: dejar el equipo vacío o asignar al ingeniero real.
  Se apaga al instante en Admin → Parámetros si estorba.

### 🟢 LISTO PARA PILOTO (mañana): ingenieros (requisición) + transportistas (checklists pre-uso) vía PWA.
- Web prod: sgcconstructorasd.com · PWA móvil prod: app.sgcconstructorasd.com (ya desplegada).
- APK nativo: NO se pudo compilar aquí (sin Android SDK/adb en este entorno). La PWA cubre el piloto.

### ✅ Ronda flota/proyectos (deployed prod) — pilot enhancements
- **Rutas**: distancia/tiempo automáticos por mapa (origen por GPS "usar mi ubicación" o punto + destino) vía `context/routing.service.ts` (OSRM keyless, swappable a Google con key). `rutas.origen_lat/lng`.
- **Fotos** en vehículos y mantenimientos (bucket `vehiculos`, `fotos text[]`). Multi-chofer por vehículo (se quitó la exclusión).
- **Proyectos — estrellas** (`v_proyecto_readiness`): equipo + cuadre + expediente + almacén de obra; sin las 4 no pasa a "En progreso".
- **Almacén por obra** (`bodegas.proyecto_id/es_principal`) + **catálogo de 86 artículos** sembrado del kit (para entradas rápidas).
- **Dashboard por rol** (cada quien ve solo sus áreas; montos solo Dirección/Admin) + Ranking de encargados en el dashboard.
- **Móvil v1.2.0** (repo csd-app): reportar mantenimiento con fotos + "Cómo llegar" en rutas; renames + checklist pre-uso. **APK firmado construido, instalado al dispositivo (`adb install -r`, smoke-test OK) y publicado** al bucket app-releases (la página CSD App muestra v1.2.0). PWA prod al día.
- RPC nueva compartida: `crear_mantenimiento_app` (captura offline de mantenimiento).

### 🟢 PILOTO LISTO.
- **Rutas usan Google Directions** vía edge function `routing-directions` (key = secreto de Supabase `GOOGLE_MAPS_API_KEY`, NO en repo/frontend; evita CORS). Fallback a OSRM si falla. Verificado (SD→Santiago 151.2km/126min). ⚠️ La key se compartió por chat: conviene restringirla en Google Cloud (solo Directions API + referrer/IP) o rotarla.
- **Validación de equipo en requisiciones: OFF** (`requisicion_validar_equipo=false`) para el piloto — nadie se bloquea al pedir. Encender en Admin>Parámetros cuando el organigrama esté cargado.

### ✅ Ola 1 + Ola 2 (deployed prod)
- **Centro de notificaciones** (campana header, `sgc.notificaciones` + `notificar()` + trigger que avisa al solicitante al cambiar estado de su requisición; realtime).
- **Kit↔artículos**: `kit_inicio_plantilla.articulo_id` mapeado a los 86 artículos; `copiar_kit_a_cuadre` lo copia → reposición + antifraude ven el kit.
- **Reportar problema/mejora** en la app móvil (offline, RPC `crear_reporte_app`) — para feedback del piloto. Móvil **v1.2.1** (instalado al device + publicado).
- **CSD-OPE-01 (Ola 2)**: **Registro de Vaciado + No Conformidades** con la regla "NC abierta bloquea vaciado" (trigger) — UI en Proyectos > detalle. Esquema completo de CL-01..07 (cl_plantillas/registros/firmas/fotos), informes_semanales, reportes_perdidas, charlas_seguridad (RLS+grants, sin UI aún).
- **Rutas**: Google Directions vía edge function (key = secreto); OSRM fallback.
- Fix NG8102. RLS/grants auditados en las 13 tablas nuevas.

### ⏳ Ola 3 (siguiente entrega — no construido; esquema listo)
- **CL-01..07 liberación completa**: llenar checklist + ciclo de firmas Maestro→Residente→Responsable→Cliente/MIVHED + plano mapeado + fotos + captura offline en la app. (Compliance — merece build dedicado y probado.)
- **Informe semanal, Charlas de seguridad, Reporte de pérdidas/daños** UIs (tablas listas).
- **Cubicaciones, minuta de cliente, RFI/Órdenes de Trabajo/Solicitudes de Servicio**.
- **Exportar PDF/Excel** (requisiciones, cuadre, alertas, conduces ya imprime).
- **Push nativas (FCM)** — requiere proyecto/credenciales Firebase de Xavier.
- **Manual/dictado con IA** — requiere una API key de IA (Claude).
- **Restringir/rotar la Google API key** en Google Cloud (consola de Xavier).
- Pendiente polish menor: preview "despacha X / compra Y" al aprobar requisición.

### PARTE A (A1–A9) + review + recomendaciones + pre-piloto + flota/proyectos + Ola1/Ola2 — todo en prod.
- **Not pushed/merged yet** — branch `feat/meet-07072026` is local, ~15 commits. Migrations
  ALREADY applied to prod DB (additive, mobile-safe). Merge to `main` → Vercel prod deploy when ready.
- **Parte B** — CSD mobile app (`C:\Users\xavie\Desktop\X Dev\dev2\csd-app`): UI renames
  (Requisición/Almacén), requisición state display, pre-use vehicle checklists (offline outbox,
  RPC `registrar_checklist_vehiculo` already exists + idempotent). NEVER add cuadre/límites/alertas/montos.
- **A4** — silent antifraud engine: hook consumption vs cuadre-por-fase INTO
  `aprobar_requisicion`; alerts table (weather_alerts realtime+RLS pattern) → Dirección panel;
  configurable threshold (needs a new `sgc.parametros` table — none exists). Default 80% warn / 100% alert.
  **NEVER expose montos/cuadres/límites/alerts to obra roles or the mobile app.**
- **A5** — Chequeo semanal de almacén (build on `conteos_inventario`); recurring weekly
  task via pg_cron (pattern: `sql/2026-07-07-weather-cron.sql`) assigned to Guarda-Almacén;
  differences feed A4.
- **A8** — Expediente de inicio de obra (checklist de docs con estado/responsable/adjunto;
  links kit A3.1 + equipo A3.2; **regla dura: obra NUNCA ve montos de contrato**).
  Design roadmap-compatible schemas for CL-01–CL-07, registro de vaciado, NC, etc. (don't build).
- **A9** — full end-to-end verification + RLS/grants audit on every new table +
  verify ingeniero role sees no límites/cuadres/alertas/montos.
- **Parte B** — CSD mobile app (`C:\Users\xavie\Desktop\X Dev\dev2\csd-app`): UI renames
  (Requisición/Almacén), requisición state display, pre-use vehicle checklists (offline outbox).

### Also pending (per feedback memory)
- Update **Dudas FAQ + Soporte** for the rename + new requisición flow (not yet done).

### Tooling
- DB introspection/migrations: `node <scratchpad>/sql.mjs "<SQL>"` or `--file x.sql`
  (Management API, SUPABASE_ACCESS_TOKEN, project ref `jeeqhgccqefbqilntcpu`).
- Build check: `npm run build`.
