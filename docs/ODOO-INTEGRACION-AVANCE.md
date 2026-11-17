# Avance — Integración SGC ↔ Odoo (ronda DS, 16-nov-2026)

Documento reanudable: se actualiza al terminar cada ítem. Rama de trabajo: `feature/ds-odoo-ronda-16nov` (worktree `SGC-ds`, desde `origin/main`).
Regla de seguridad (repo público): sin hosts, usuarios, claves, ids de proyecto Supabase ni UUIDs en este archivo.

## Estado por fase

| Fase | Ítems | Estado |
|---|---|---|
| F0 Verificar | DS-01, DS-31 | Parcial: worktree creado, docs de Miranda integrados (cherry-pick `d2ea987d`), grafo actualizado, issues #2–#24 en `docs/ODOO-ISSUES-ESTADO.md` (en curso) |
| F1 Staging conectado | DS-02 ✅ · DS-03 ✅ · DS-04 ✅ (doc) | DS-02 commit `0bf8931e`; DS-03/04 en `docs/ODOO-STAGING-VERIFICACION.md`. Falta cambiar secrets de dev a staging (reportar host actual antes) |
| F2 Homologación | DS-05…DS-08 | Pendiente |
| F3 Traslados A/B | DS-09…DS-12 | Pendiente |
| F4 Sombra/conciliador | DS-13, DS-14 | Pendiente |
| F5 Circuito 2 | DS-15…DS-23 | Pendiente |
| F6 Compras/proveedores | DS-24…DS-26 | Pendiente |
| F7 Fases 3–6 (apagadas) | DS-27…DS-30 | Pendiente |
| F8 Issues no-Odoo | DS-32…DS-47 | Pendiente |
| F9 Cierre | — | Pendiente |

## Hechos

- **DS-02** — `verificarHostEscritura()` en `_shared/odoo-client.ts`: toda escritura exige que el host de `ODOO_URL` esté en `ODOO_HOSTS_ESCRITURA` (sin la variable, no se escribe a ningún host); si el host está en `ODOO_HOSTS_PROD`, exige además `ODOO_PERMITIR_PROD=true`. Lecturas no se afectan. 5 tests nuevos (`odoo-host-guard.test.ts`); suite Deno completa 321/321. Los tests existentes que escriben contra un host simulado ahora inyectan `entorno`.

## Hallazgos de F0

- `origin/main` avanzó durante la ronda (`3cce1ef9` → `d1d17146`); el worktree parte de `d1d17146`.
- `origin/feature/odoo-schema-handoff` (1 commit): los archivos que trae ya están en `main` (`docs/odoo-schema/`, `sql/2026101611252*`); no aporta nada nuevo.
- `.env.local` del checkout principal contiene solo `SGC_INTEGRATION_ODOO_API_KEY` entre las variables `ODOO*`/`SGC_INTEGRATION*`. Faltan URL, base de datos y usuario (ver Bloqueos).
- `.gitignore` cubre `.env.local` (`*.local`), `*.env` y `*api_key*`.
- El servidor de staging responde (Odoo 17.0+e); la lista de bases está deshabilitada, así que el nombre de la base no se puede descubrir.

## Bloqueos (físicos, de Xaviel)

1. Nombre de la **base de datos** de Odoo staging y **usuario/login** de la cuenta dueña de la clave. Añadir a `.env.local` (gitignored): `SGC_INTEGRATION_ODOO_DB=…`, `SGC_INTEGRATION_ODOO_USER=…`, `SGC_INTEGRATION_ODOO_URL=https://…`. La base se ve en la pantalla de login de Odoo o en el selector de bases; si no, pedírsela a Chai.

## Actualización (misma sesión, sin staging)

- **DS-05 (parcial):** migración `sql/2026-11-16-ds5-bodegas-codigo-odoo.sql` (`bodegas.codigo_odoo`, `codigo_odoo_raw`, único por instancia, protegido por `odoo_v1_proteger_campos`). Aplicada en **dev** y en el ledger dev. Falta el data-fix con el mapa de Miranda: depende de verificar cada código contra `stock.warehouse` de staging.
- **DS-06 (parcial):** migración `sql/2026-11-16-ds6-cuentas-analiticas.sql` (índice único por instancia, tabla hija `proyecto_odoo_analiticas` con RLS solo admin, `proyectos.odoo_analytic_confirmado`, RPC `odoo_analitica_confirmar`). Aplicada en dev. Faltan: data-fix de los 10 proyectos (requiere staging), regla de evidencia de las 4 dudosas, `analytic_distribution` en `compras.crear`, pantalla «Homologación» y test.
- **DS-10 (parcial):** migración `sql/2026-11-16-ds10-salidas-odoo-picking.sql` (`odoo_picking_salida_id/entrada_id`, `odoo_sync_*`, únicos por instancia). Aplicada en dev. `odoo_sync_intentos` queda fuera de la lista protegida a propósito (su default 0 rompería inserts de usuarios normales). Faltan RPC de despacho con write-through, evento B y pantalla.
- **DS-08:** búsqueda en disco (Desktop, Downloads, Documents, `C:\developer`), stash y todo el historial/ramas remotas: **no existe código** `odoo-traslados*` ni `resolverAutorOdoo`; solo los docs de Miranda lo mencionan. Hay que reconstruirlo desde el plan (pendiente).
- El worktree `SGC-ds` tiene una copia local de `.env.local` (gitignored) para que los scripts lean los tokens.

## Segunda actualización (staging conectado)

- **Staging conectado:** base y usuario resueltos; autenticación OK (uid de la cuenta técnica, sin imprimir valores). Secrets de **dev** apuntan ahora a staging (`ODOO_URL/DB/USER/API_KEY` + `ODOO_HOSTS_ESCRITURA`). Prod no se tocó. Las pantallas de lectura de dev (Stock en Odoo, OC, Proveedores) ahora muestran datos de staging (copia de prod).
- **Instancia nueva en dev:** la identidad de una instancia es inmutable (trigger), así que se registró «Odoo staging (dev)», se copió su compañía, se re-apuntaron los vínculos de 14 tablas y la instancia anterior quedó deshabilitada. `permitir_salida/entrada` siguen en false.
- **DS-05 ✅ (dev):** data-fix `scripts/data-fixes/2026-11-16-ds-homologacion-dev.mjs` (idempotente; dry-run por defecto): 15 bodegas con `codigo_odoo` + warehouse/location verificados contra `stock.warehouse` de staging. `TRB` (Torre Bolívar) no tiene bodega SGC. 8 almacenes de Odoo quedan «no gestionados».
- **DS-06 parcial (dev):** 10 cuentas «seguras» confirmadas (id **y** nombre coinciden); dudosas por evidencia de uso en líneas de compra de staging: CSD-102 → cuenta 21 (10 líneas; la 28 no existe), CSD-103 → 17 (111 líneas; la 26 no existe), PROY-0002 → 29 principal (93) + 37 adicional (1), todas `confirmado=false`; PROY-0005 no existe en dev (la 44 tiene 2 líneas): sin enlace. **Falta:** `analytic_distribution` en `compras.crear`, selector de cuenta en «crear OC», pantalla «Homologación».
- **DS-07 ❌ pendiente:** catálogo (solo 1 de 940 productos tiene `default_code`).
- **DS-08 ✅:** `_shared/odoo-traslados.ts` reconstruido (crear/validar/cancelar/devolver/listar/obtener, `resolverAutorOdoo`, chatter en texto plano, disponibilidad) + 15 tests. **Contrato real contra staging verde** (`scripts/odoo-contrato-traslados-staging.ts`).
- **Hallazgo crítico:** el Odoo de CSD **permite stock negativo** (staging validó un traslado de 9.999.999). Por eso `validarTraslado` consulta lo disponible (cantidad − reservado) antes de validar cuando el origen es una ubicación interna. El movimiento de prueba se revirtió.
- **Política del cliente Odoo ampliada** (revisión de código): lectura de `stock.move`, `stock.picking.type`, `stock.warehouse`, `res.users`, `hr.employee`; escritura de `stock.picking` (create/write/action_confirm/action_assign/button_validate/action_cancel/message_post) y `stock.move.write`. Sin unlink.
- **DS-09 ✅ (dev):** migración `2026-11-16-ds9-…`: NULL = lo enviado en `conduce_confirmar_receptor`, `entregar_conduce` y `recibir_conduce_app`; data-fix de incompletos falsos (dev: 7/7 corregidos, 0 faltantes reales). Falta la prueba SQL transaccional con ROLLBACK. **Prod: migración + data-fix listos, NO aplicados.**
- **DS-10/DS-11 ✅ (dev):** `_shared/odoo-salidas.ts` (+12 tests) y el worker `odoo-sync` publican eventos `salida_inventario` como traslado A/B; migración `2026-11-16-ds11-…` (marcar sync sin bucle, evento B al entregar la parada, «Reintentar»). Desplegado en dev. Contrato real del ciclo despachado → entregado incompleto → anulado verde contra staging (`scripts/odoo-contrato-salida-staging.ts`). **Apagado:** no hay fila en `odoo_publicacion_politica` ni `permitir_salida`.
  - **Diferencia con el plan:** se publica por **outbox asíncrono** (con reintento y estados incierto/error), no con write-through síncrono Odoo-primero en el RPC de despacho. El bloqueo por falta de stock ocurre al publicar, no antes de guardar el conduce.
- Suite Deno: 348 tests verdes.

## Tercera actualización — estado por ítem (47 ítems DS-01…DS-47)

**Hechos (15):** DS-01, 02, 03, 04 (doc), 05, 06, 08, 09, 10, 11, 12, 14 (sintético), 15, 23, 31 (doc de estado; publicar el cierre en GitHub es de Xaviel).
**Parciales (2):** DS-07 (33 propuestas generadas en dev; falta la aprobación humana y cubrir categorías/unidades), DS-13 (módulo conciliador + 8 tests + runbook; faltan edge/cron diario, sondeo de 5 min, alerta cron de tránsito >72 h y pantalla).
**Sin empezar (30):** DS-16…22 (circuito 2), DS-24, 25, 26, DS-27…30 (fases 3–6), DS-32…47 (issues no-Odoo).

- **DS-06 completo en dev:** la OC imputa cada línea a `analytic_distribution={cuenta:100}` (contrato verde en staging); con >1 cuenta manda `ordenes_compra.odoo_analytic_elegida` (falta el selector en la pantalla «crear OC»); en prod solo cuentas confirmadas; pantalla **Tecnología › Homologación con Odoo** (cuentas, almacenes y propuestas de catálogo).
- **DS-07:** `scripts/odoo-homologar-catalogo.mjs` (0 por código, 0 por nombre exacto, 33 por similitud ≥ 0,6, 150 sin contraparte de 183 artículos); aprobación por pantalla vía `odoo_propuesta_decidir`. Hay propuestas incorrectas a propósito visibles (p. ej. 1½"×4' ↔ 1½"×8'): por eso nada vincula sin aprobar.
- **DS-12:** detalle del conduce muestra el estado de sync y «Reintentar» (Tecnología/admin); `/tecnologia/odoo-sync` ya existía.
- **DS-14:** `scripts/odoo-soak-staging.ts` (12 conduces, parciales, anulaciones, timeouts, sin stock, reprocesos): 0 deriva, 0 inciertos, todo revertido. Encontró un bug real (borrador huérfano al fallar por stock) ya corregido.
- **DS-15:** OC real en staging: crear/idempotencia/cancelar OK; `button_cancel` devuelve None (fault «cannot marshal None») y se trata releyendo el estado; `ODOO_ESCRITURA_HABILITADA=true` solo en **dev** (apunta a staging).
- **Deploy en dev:** `odoo-api`, `odoo-sync`. Migraciones en dev: ds5, ds6, ds6b, ds7, ds9, ds10, ds11 (ledger dev). **Ninguna en prod.**
- Pendiente de F3 no cubierto: acciones `traslados.*` del gateway, write-through síncrono, solicitud de ajuste por faltante (ADR 5), prueba SQL transaccional de DS-09, notas de versión (Y1), `docs/DATOS-Y-TERCEROS.md` (CI13: nombre/correo en el chatter y ahora cuentas/productos de Odoo).

---
## Estado final de la ronda DS (16-nov-2026): 36 hechos · 11 parciales · 0 sin empezar (de 47)

Detalle por lote con archivo:línea en `docs/avance-lotes/` (F5, F6F7, F8abc, F8de). Mapeo del circuito 2 en `docs/ODOO-CIRCUITO2.md`. Todo en dev; nada en prod; toda publicación a Odoo apagada por política.

**Hechos (36):** DS-01…06, 08…15, 18, 19, 21, 22, 23, 24, 25, 26, 27, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 43, 44 (DS-16 y DS-18/19/21/22 en backend; su UI de estado por pantalla falta, ver parciales).

**Parciales (11) y qué falta exacto:**
- DS-07: aprobación humana de 33 propuestas de catálogo; categorías y unidades.
- DS-17: solicitud de ajuste por faltante con aprobación (ADR 5) en el flujo de requisición; devolución tránsito→origen al rechazar.
- DS-20: explicación visible de coincidencia ambigua/unidades incompatibles.
- DS-28: el worker no ejecuta aún en Odoo el ajuste/devolución desde tránsito; adjuntar PDF firmado al picking; pantalla de ajustes; contrato del adjunto contra staging.
- DS-29: aplicar apertura en Odoo; bloquear escrituras directas a `stock_por_bodega` con fuente Odoo; pantalla de corte.
- DS-37: pintar salud de combustible en pantalla; confirmar con SELECT en prod si la importación de estación sigue viva.
- DS-41: #76 parte diario por voz (depende de entrevista); 4 vistas de detalle sin filtro `es_prueba` (decisión de producto); depurar datos de prueba en prod (script + OK).
- DS-42: instrumentar `/auth/pin` y `/home` (trabajo de la app, PROMPT-149).
- DS-45: la app debe leer `sgc.zonas_horarias`; unificar RPC de arranque.
- DS-46: #71 lote 1 hecho (10 tablas, 42 políticas); quedan 184 políticas en 125 tablas.
- DS-47: #77 es de la app y depende de entrevista (el #72 está hecho).

**Pendientes transversales:** UI de estado/«Reintentar» en entradas, retiros, conteos y externos; KPI de solicitudes atascadas en el Dashboard; botones Aprobar/Rechazar en push; probar QR en vivo con sesión real; selector de cuenta analítica al crear OC con varias; acciones `traslados.*` del gateway.

**NO verificado:** dos semanas reales de sombra; usuario dedicado de integración (Chai); confirmación de Contabilidad; confirmación de Operaciones de las 4 obras; qué tablas de Realtime usa csd-app; cualquier cifra de prod (salvo las del análisis del 01-nov).

---
## Actualización tras la ola W2 (16-nov-2026): 41 hechos · 6 parciales · 0 sin empezar
Detalle: `docs/avance-lotes/W2-ui.md`, `W2-backend.md`, `W2-rls-gw.md`; arranque de app en `docs/ARRANQUE-APP-DS45.md`. Todo en dev; nada en prod; Odoo apagado por política.
**Cerrados en W2:** DS-17, DS-19, DS-20, DS-29, DS-37, DS-46 (todas las políticas RLS migradas a `(select …)` con smoke de permisos y reversa por lote; quedan 0), gateway `traslados.*`, UI de estado/«Reintentar», selector de cuenta en crear OC (solo `compras/ordenes`), KPI de atascadas, entradas con OC.
**Parciales (6):**
- DS-07: 12 propuestas de catálogo dudosas pendientes de decisión de Xaviel; 17 propuestas de categorías/unidades por aprobar en pantalla.
- DS-28: backend hecho; falta que el cliente suba el PDF firmado del conduce al bucket `conduces` y llame `salida_pdf_firmado_registrar` (hoy se imprime con `window.print()`).
- DS-41: #76 (voz) depende de entrevista; 4 vistas sin filtro `es_prueba` por decisión de producto; depurar prod con script + OK.
- DS-42: instrumentar `/auth/pin` y `/home` (app, PROMPT-149).
- DS-45: la app debe llamar `mi_arranque()` y leer `zonas_horarias`.
- DS-47: #77 (app, entrevista).
**Otros pendientes:** selector de cuenta en `ordenes-odoo` y aprobación de solicitud de compra; apertura DS-29 sin botón a propósito; deploy de `odoo-api` hecho en dev; migraciones RLS/`mi_arranque`/`ds07b`/`w2*` solo dev.
