# COBERTURA-NOTAS — rondas BS/BT (PROMPT-54/56, 17/09/2026)

Matriz de cobertura de la tanda BS. Las filas 1-35 (tandas previas) viven en
`C:\developer\improvements\septiembre 2026\imp 14092026\` (fuera del repo); aquí se
registran las filas **36-39 = esta tanda (BS1-BS4)** con Estado + ruta de pantalla,
y la **verificación de la ronda BR** que el prompt pidió tildar. Reglas A/B
(Xaviel, 15-sep): nada espera decisión — DEFAULT aplicado y reportado.

## Ronda BR — verificación en prod (por objeto)

| # | Apunte | Estado | Dónde |
|---|--------|--------|-------|
| BR1 | Combustible acepta-y-avisa (regla 15) | ✅ en prod | `registrar_combustible_app` (app); web `flota/combustible-log` chips KM ALERTA/SIN ASIGNACIÓN |
| BR2/BR3 | responsable_id + user-picker + puedeTransferir sin chofer | ✅ en prod | `salidas_inventario.responsable_id`; `inventario/requisiciones` (Aprobar), `shared/ui/user-picker` |
| BR4 | Rechazar recepción | ✅ en prod | `rechazar_recepcion`; `inventario/entradas` detalle (botón Rechazar) |
| BR5 | Comprar en ferretería desde requisición | ✅ en prod | `inventario/conduce-externo/nuevo?requisicion=` |
| BR6 | **Avisar a Logística** (botón de la app) | ✅ **aplicado** (commit `fcc2b24`) | RPC `sgc.combustible_avisar_revision(text,uuid)` → `notificar_modulo('flota','combustible_revisar',…)` |
| BR7 | Idioma del usuario (canónico) | ✅ en prod | `usuarios.idioma` + RPC `mi_idioma_set` (commit `fcc2b24`) |
| BO3 | Import proveedores fila-a-fila | ✅ en prod | `importar_proveedores`; `compras/proveedores` |
| BO8 | Requisiciones vencidas + calendario mensual | ✅ en prod | cron `sgc-requisiciones-vencidas`; `inventario/requisiciones` (vista Mes) |
| BO10 | Cartillas de acero v1 | ✅ en prod | tabla `cartillas`, bucket `sgc-cartillas`; `bitacora/cartillas` |
| — | Crons `sgc-vehiculos-sin-echada` / `sgc-requisiciones-vencidas` | ✅ en prod | `cron.job` |
| — | El Flaco (Encargado de Patio) | ✅ en prod | `usuarios` id `2fb18263…` |

## Ronda BS — esta tanda (filas 36-39)

| # | Nota | Estado (web) | Ruta de pantalla / objeto | Notas |
|---|------|--------|---------------------------|-------|
| 36 | **BS1** — el almacén de despacho ofrece TODOS los que el rol lee, Central primero | ✅ CONSTRUIDO (build+guards verdes) | `inventario/requisiciones` (select "Almacén de despacho"); alineado `inventario/salidas` (origen) y `conduce-externo-form` | Regla 16 corolario. Coberturas n/N por opción (carga perezosa). RLS de `bodegas` ya permitía leer todas (`referencia autenticados`) → sin cambio de RLS. DEFAULT preselección: Central si cubre ≥1 renglón, si no la de la obra. |
| 37 | **BS2** — nada de lenguaje de desarrollador al usuario; causa de la cuenta de Raykler | ✅ CONSTRUIDO + causa diagnosticada | `shared/ui/error-state`, `friendly-error.util.presentarError`, `flota/vehiculos`, `flota/checklists`, `flota/responsabilidad`; guard `scripts/verify-dev-strings.mjs` | **Causa Raykler:** la RLS YA le concede Flota (módulo `flota` por 3 roles; `es_flota_elevado`). El "Tabla no configurada / Ejecuta el SQL en Supabase" era un banner que mapeaba cualquier `permission denied` a lenguaje de dev → eliminado. DEFAULT (guard=RLS): no se abrió RLS. Detalle técnico solo `esDesarrollador()`; todo error se reporta a `report_app_error`. |
| 38 | **BS3** — módulo Configuración (web), general para todos | ✅ CONSTRUIDO (migración validada, sin aplicar) | ruta `/configuracion` (authGuard, sin moduleGuard); `pages/configuracion`; shell engranaje; redirects `/perfil`→#cuenta, `/ajustes/notificaciones`→#notificaciones | Secciones: Cuenta (embebe Perfil), Idioma, Apariencia (claro/oscuro/sistema + densidad + tamaño), Notificaciones (embebe Ajustes), Inicio (módulo de arranque real), Sesión (edge `auth-signout-others`), Privacidad (choferes), Acerca. Migración `bs3-usuario-preferencias` (aditiva a la tabla existente BE6). RPCs `mis_preferencias`/`set_mi_preferencia` smoke OK (idioma canónico). |
| 39 | **BS4** — idioma fuera del PIN, en Configuración; diálogo de primer ingreso (web) | ✅ CONSTRUIDO (migración validada, sin aplicar) | `shared/i18n` (service+pipe), `shared/ui/language-selector`, `shared/ui/language-onboarding` (modal en shell); guard `scripts/verify-i18n.mjs` | i18n portado del hijo (csd-app) — 1ª vez que el hijo es referencia de infra (ver PARIDAD.md). Alcance v1 con `t()`: Configuración completa + error-state + language-selector; `en.json` (20+ claves), `ht.json` vacío. Diálogo de primer ingreso: bloqueante, preselección por navegador, sella `idioma_elegido_at`. Notificaciones i18n v1: `notif_tipo.titulo_i18n` + `notificar_modulo` localiza el título por destinatario (smoke OK: "Fuel entry to review"). App = PROMPT-55. |

## Ronda BS — espejo en la APP móvil (PROMPT-55, 17/09/2026)

`mis_preferencias()` / `set_mi_preferencia('idioma'|'tema',…)` / columna `idioma_elegido_at`
verificados **vivos en prod** (probe service_role). La app los consume **detrás de
comprobación de capacidad** (degrada a `mi_idioma_set`/`mi_tema`+local si faltaran).

| # | Espejo en la app | Estado (app) | Pantalla donde se ve |
|---|------------------|--------------|----------------------|
| 36 | **BS1** — picker de almacén de origen: TODAS las bodegas, **Central primero** (🏢) + preseleccionada | ✅ 2.25.0 (build+3 guards verdes) | `transporte/generar-conduce` paso "Almacén de origen" (modo libre y despacho `?requisicion=`). `Bodega` gana `es_central/es_principal/proyecto_id`; sin filtro por `proyecto_id` (ya ofrecía todas). DEFAULT app: Central preseleccionada (origen de despacho canónico); n/N por opción diferido (una sola Central real). |
| 37 | **BS2** — sin lenguaje de developer: `humanizeError`/`presentarError` + guard | ✅ 2.25.0 | Red central en `ToastService` (humaniza tono `error` app-wide) + 6 bandas de error migradas + `pendientes`/`outbox-detalle` (🩺 SQLSTATE crudo solo `esDesarrollador()`). `shared/util/friendly-error.util.ts` (puerto del web). `scripts/verify-dev-strings.mjs` en prebuild (baseline VACÍO). Category-1 (jerga hardcodeada) ya estaba limpia. |
| 38 | **BS3** — Perfil ⚙ alineado: Idioma + **Apariencia (claro/oscuro/sistema)** + Notificaciones + Acerca | ✅ 2.25.0 | `pages/perfil` — Apariencia = selector segmentado (☀️/🌙/📱) vía `set_mi_preferencia('tema',…)` detrás de capacidad; `ThemeService` tri-estado (resuelve 'sistema' con `prefers-color-scheme`, re-resuelve en vivo, cachea el RESUELTO para el anti-parpadeo). Notif = "Preferencias de avisos" (ya existía); Acerca = versión instalada/publicada/mínima (ya existía). |
| 39 | **BS4** 🔴 — idioma FUERA del PIN/Login; diálogo de primer ingreso | ✅ 2.25.0 (pre-release, bloqueante) | Quitado `app-language-selector` de `pin-unlock` y `login`; queda solo en Perfil › Idioma. `shared/ui/language-onboarding` (modal bloqueante en el shell, una sola vez, preselección = idioma del dispositivo). `IdiomaOnboardingService`: local flag → `mis_preferencias().idioma_elegido_at` (capacidad) → preguntar; confirma con `setIdioma` + sella `set_mi_preferencia`, reintento de sello pendiente offline. `I18nService.deviceLang()` + orden servidor→local→dispositivo→es. |

**Ninguna fila espera decisión.** (App pendiente solo del OK de Xaviel para commit + release, por regla madre.)

## Ronda BT — esta tanda (PROMPT-56, filas 40-48) — web **1.138.0** (build+guards verdes, SIN aplicar/commit)

Reglas A/B: nada espera decisión — DEFAULT aplicado y reportado. Migraciones **validadas**
(`begin/rollback` en prod) **sin aplicar** (gate de Xaviel). Nace la **17ª regla** (i18n por pantalla).

| # | Nota | Estado (web) | Dónde se ve / objeto |
|---|------|--------------|----------------------|
| 40 | Re-pegadas las 4 notas BS (almacén único · "ejecuta el SQL" · Configuración web · idioma fuera del PIN) | ✅ ya en prod desde 1.136.0/1.137.0 y app 2.25.0 | ver filas 36-39 |
| 41 | **BT2** 🔴 — "cambié a inglés y sigo viendo español" | ✅ 1.138.0 (mecanismo + selector honesto; sweep de pantallas = rollout incremental medido) | `scripts/i18n-coverage.mjs` + `docs/I18N-COVERAGE.md` (en **4 %** del alcance) + `src/app/core/i18n/alcance.json`; selector `en` **beta 4 %** / `ht` **próximamente** (`shared/ui/language-selector`, `language-onboarding`); launcher ya con `t()`. **17ª regla** en checklist. → app PROMPT-57 F1 (mismo script/umbral) |
| 42 | **BT3** — la foto de perfil no aparece | ✅ 1.138.0 | Columna/bucket ya unificados (`usuarios.avatar_path` + bucket **público** `sgc-avatars`); `perfil` cae a la inicial con `(error)` (antes imagen rota). Contrato en `PARIDAD.md § avatar`. → app PROMPT-57 F2 |
| 43 | **BT4** — conduce externo: borrador sin enviar | → **app** PROMPT-57 F0.b | (captura offline con fotos = app; corolario regla 17) |
| 44 | **BT5** 🔴 — tomar foto en conduce externo cierra la app | → **app** PROMPT-57 F0.c | (PWA iOS memoria / Android reinicio; compresión + destruir mapa) |
| 45 | **BT6** — alarmas semanales silenciables solo para admin/gerencia/elegidos | ✅ 1.138.0 (migración validada) | `notif_tipo.silenciable_por/_roles` + `puede_silenciar_notif` + `notif_permitida`/`destinatarios_notificacion` gate + `mis_notif_operativas`/`mis_preferencias().notif`; **Admin › Matriz** "Pueden silenciarla" (roles chips + user-picker → `set_notif_tipo_silenciable`); **Configuración › Notificaciones** switch/"Siempre activa"; emisor `recordatorio_reporte_semanal` respeta el silencio. DEFAULT sembrado admin/gerencia/direccion. → app PROMPT-57 F4 |
| 46 | **BT7** 🔴 — transferir/crear conduce externo revienta con FK y le muestra el SQL al chofer | ✅ 1.138.0 (migración validada + causa) | **Causa:** FK `transporta_proveedor_id` apuntaba a `proveedores_transporte` (VACÍA); los transportistas viven en `proveedores` con `tipos={transportista}` (regla 12: FK nunca re-apuntada → 0 conduces externos con proveedor jamás). **Fix:** re-apunta 3 FK a `proveedores` + `crear_conduce_externo` valida (22023 negocio, no 23503). `clasificarError`/`humanizeError` en `conduce-externo-form` + `conduce` detalle; `verify-dev-strings` cubre "violates foreign key"/"insert or update on table". → app PROMPT-57 F0.a |
| 47 | **BT1** — importar echadas de TotalEnergies + datos de Odoo | ✅ 1.138.0 (migración validada + smoke) | **Flota › Conciliación:** botón "Registrar N faltantes" → `importar_echadas_conciliacion` (importada/km_pendiente/idempotente; chip **IMPORTADA**/**KM PENDIENTE** en `combustible-log`). **Admin › Importar datos** (`/admin/importar`): asistente 4 pasos Excel/CSV→entidad (proveedores/vehículos/artículos v1) con auto-mapeo Odoo + preview + **deshacer 24 h** (`importaciones`/`importaciones_mapeo`/`deshacer_importacion`). `docs/IMPORTAR-DATOS.md`. Vehículo por tarjeta = `combustible_tarjeta_map` (existente). → app: solo aviso km_pendiente |
| 48 | **BT8** — al aprobar requisición, poder dejar en cero lo no despachado | ✅ 1.138.0 (solo cliente, sin migración) | `inventario/requisiciones`: 0 = pendiente (el servidor `aprobar_requisicion` YA salta los 0); error solo si TODOS son 0 o hay negativos; chip "Pendiente" + atenuado; X = quitar con confirmación (`requisicion-items-mapper`). → app PROMPT-57 F3 |

**Pendientes físicos de Xaviel:** OK a las migraciones **BT7 / BT1 / BT6** · OK al commit **1.138.0** · Raykler:
llenar `combustible_tarjeta_map` (tarjeta→vehículo) una vez y probar la conciliación con la factura real ·
elegir en la Matriz qué usuarios pueden silenciar las alarmas (DEFAULT ya sembrado: admin, gerencia, dirección).

## App PROMPT-57 (movil 2.26.0) — ✅ PUBLICADA + MÍNIMA (build+verify verdes; commits fe4c921, 0d17ba9, c74c8d8)

> **Actualización "haz todo":** con OK de Xaviel se cerró TODO lo owed y se **publicó 2.26.0 + mínima forzada**
> (`version_publicada()` → pub/min 2.26.0). i18n ampliado a **toda la app** (2 770 claves en en.json,
> 2 614/2 614 `| t` cubiertas, cobertura por-pantalla 4 %→75 %; inglés = beta·75 %, Kreyòl próximamente;
> falta cablear generar-conduce). Borradores+fotos completos (combustible, retiro-nuevo, entrada, recibir,
> checklist, cartilla). BT7 re-pick "Elegir otro proveedor" en la tarjeta atascada. Único owed: `appRestoredResult`
> Android (requiere device). Device-QA en el teléfono de Xaviel pendiente.


Contratos del padre **verificados VIVOS en prod** (introspección Management API): `crear_conduce_externo`
valida `transporta_proveedor_id`→`error_campo` 22023; `mis_preferencias().notif[].silenciable`
(`mis_notif_operativas`/`puede_silenciar_notif`/`notif_permitida`); `actualizar_mi_avatar`; `set_mi_preferencia`.
La app los consume **directo** (aún tras comprobación de capacidad).

| # | App (PROMPT-57) | Estado (movil) | Pantalla / objeto |
|---|-----------------|----------------|-------------------|
| 41 | **BT2** — inglés cubre toda la app | 🔧 2.26.0 (infra + gate + 3 pantallas) | `scripts/i18n-coverage.mjs` (mismo contrato que el web) + `i18n-whitelist.json` + `core/i18n/alcance.json`; `verify-i18n` **falla** si una pantalla del alcance regresa; `coverage.json` honesto (**en 4 %**). Selector/onboarding: `en` **beta · cubre 4 %**, `ht` **próximamente** (<90 %); aviso una-vez si había `ht` guardado → cae a `es`. Cableadas 100 %: **home/launcher, Transporte (hub+tiles), Perfil**. Resto = rollout incremental (gate lo mantiene honesto). |
| 42 | **BT3** — foto de perfil | 🔧 2.26.0 | `miAvatarUrl` usa `getPublicUrl` (bucket público `sgc-avatars`); `perfil` con `(error)`→inicial; **`mi-detalle` ahora pinta la foto** (antes siempre la inicial "X"). |
| 43 | **BT4** — borrador sin enviar en conduce externo | 🔧 2.26.0 | `conduce-externo` autoguarda formulario **+ fotos** (`BorradorService`+`AutosaveService`) y banner "Tienes un borrador sin enviar — Continuar / Descartar". **Auditoría** de las 16 capturas con fotos en `docs/BORRADORES-FOTOS-AUDIT.md` (owed: combustible, retiro-nuevo, y foto-draft en cartilla/checklist/entrada/recibir). |
| 44 | **BT5** 🔴 — tomar foto cierra la app | 🔧 2.26.0 | conduce-externo **NO usa Leaflet** (el picker es de texto) → no hay mapa que destruir; la cámara ya comprime (1600/0.7). Fix real = borrador+foto persistida (BT4) + higiene de object-URLs (revoke al reemplazar/emitir/descartar) + telemetría de memoria (`performance.memory`/`deviceMemory` en cada reporte). `appRestoredResult` (Android) = owed documentado. |
| 45 | **BT6** — alarmas semanales silenciables | 🔧 2.26.0 | Perfil › Notificaciones (`avisos`): consume `mis_preferencias().notif[].silenciable`; switch si el usuario puede silenciar (yo/Gerencia/elegidos), "Siempre activa" si no. `set_notif_pref` como hoy. |
| 46 | **BT7** 🔴 — transferir/crear conduce externo | 🔧 2.26.0 | Servidor ya devuelve 22023 amable. App: **valida el proveedor antes de encolar** (refresca catálogo; si el id ya no existe → lo envía como TEXTO por su nombre, sin perder el conduce) + diccionario `transporta_proveedor_id`→"el proveedor de transporte" en Pendientes. Re-pick desde la tarjeta atascada = owed (el reintento ya funciona si el proveedor existe). |
| 48 | **BT8** — cero = pendiente al despachar | 🔧 2.26.0 | `generar-conduce ?requisicion=`: `qty-input` gana `allowZero` (0 sin revertir en despacho); chip **Pendiente** en renglones a 0; error solo si TODOS son 0; X = quitar con confirmación. El servidor ya salta los 0; la app filtra `cantidad>0` al enviar. |

**Pendiente físico de Xaviel (app):** OK al commit + release **2.26.0** + publicar/mínima; device-QA (iPhone PWA + Android):
6 fotos seguidas en conduce externo sin cierre, borrador tras cierre forzado, recorrido English, foto de perfil.
*(Este bloque queda en el repo SGC sin commitear — patrón habitual; commitéalo en la próxima sesión del padre.)*

---

## Fila 49 — BU1: Entorno de desarrollo (PROMPT-58) — ✅ SHIPPED 1.140.0

**Estado:** entregado end-to-end (F0–F8). Web **1.140.0** en prod (`main` `6119661`, Vercel READY, `sgcconstructorasd.com`, versión registrada). Backend BU1 aplicado a **prod** (ledger + backfill 623 migr/37 edges, migración de crons por entorno + `config_entorno`, 14 edges redeployadas con `_shared` pass-through, 0 refs de prod en crons/funciones). Entorno **dev** completo: `sgc-dev` (`fzfrnrvndzrjwyvdpkgg`) con esquema clonado (diff=0), 37 edges, secrets/Vault, 29 crons, seed 17k filas + 52 usuarios en Auth; rama `dev` en Vercel. **Regla 18** viva (scripts `--env`, ledger gatea prod, guards en prebuild + Action `pr-main`).

**Guía completa:** [`docs/ENTORNOS.md`](./docs/ENTORNOS.md).

**Pendiente físico de Xaviel:** (1) proteger `main` — `bash scratchpad/bu1-proteger-main.sh` (aquí no hay `gh`); (2) Vercel: `dev.sgcconstructorasd.com` → rama `dev` + env vars Preview=dev; DNS `CNAME dev`; (3) GitHub secrets `SUPABASE_ACCESS_TOKEN`+`SUPABASE_PROJECT_REF_DEV` para la Action; (4) Google Maps referrer dev. (5) App 2.26.0 estrena el flujo por dev (PROMPT-59).

### Mitad APP (PROMPT-59, BU1 hijo) — ✅ construida (código + build + APK dev), release gateado

**Estado:** entorno dev completo en el repo `csd-app` (rama `feature/bu1-entorno-dev`). **Verificado:** `npm run build` verde con `SGC_ENV=dev` y `prod`; guards verdes (nuevo `verify-sin-ref-hardcodeado` + tokens + i18n + dev-strings); **APK dev firmado OK** (`app-dev-release.apk`, `com.constructorasd.csdapp.dev`, `2.26.1-dev`, mismo cert de prod `3c5316d8…`) y **v2.26.1 registrada en el `app_versiones` de dev**; **regla 18 probada** (`release-apk --env prod` consulta dev). F0: `ng serve` ya no habla con prod (environment.ts generado/gitignored + pantalla "Sin proyecto configurado" + `npm run env:dev`). F1: `environment.dev.ts`/`prod` + `build-env.mjs` + config `dev` en angular.json + **PWA dev** (manifest "CSD App DEV", título `[DEV]`, favicon/iconos naranja) + **cinta DEV** en shell/login + "Acerca de" muestra entorno + servicios por entorno (Dexie `csd-dev`, `report_app_error.context.entorno`, prefijo `dev:` en Preferences, `version.json` por entorno). F2: **flavor Android `dev`** (instala junto a prod, icono con banda DEV) + `capacitor.config` por `SGC_ENV` + `build-apk/release-apk --env` (obligatorio) + **regla 18** en el release + google-services flavor-aware (dev compila sin push). F3: `apply-migration` retirado (SQL del hijo → `sql-para-sgc/`, los aplica el padre) + `verificar-rescate` y demás con `resolverEnv` + `scripts/lib/{entorno,build-env}` copiados del padre + `docs/ENTORNOS.md` del hijo + regla 18 en `CLAUDE.md` + `.github/` (PR template, workflow `pr-main`, protección de `main` JSON).

**Guía del hijo:** `csd-app/docs/ENTORNOS.md`.

**Pendiente físico de Xaviel (hijo):** (a) DNS `CNAME app-dev` + Vercel proyecto app: rama `dev` Preview + dominio `app-dev.sgcconstructorasd.com` + env vars Preview; (b) **Firebase**: app Android `com.constructorasd.csdapp.dev` → `android/app/src/dev/google-services.json` (hasta entonces APK dev sin push, ya avisado en "Acerca de"); (c) instalar PWA dev + APK `.dev` en su teléfono para el device-QA; (d) proteger `main` de `techcsd/csd-app` (`gh api -X PUT … --input .github/branch-protection-main.json`); (e) **OK a cada paso de F4** (merge a `dev`, luego release a prod). Nota: el repo ya está en **2.26.1 publicada** (no 2.26.0); el estreno por dev arranca desde ahí.

---

## Filas 50–63 — Ronda BV (PROMPT-60) — 🟡 EN DEV (web 1.141.0, rama `feature/bv-ronda`)

**Regla 18:** todo aplicado y verificado en **dev** (`fzfrnrvndzrjwyvdpkgg`); **nada en prod** hasta que Xaviel escriba "probado en dev, OK". Cada ítem verificado con smoke (tx rolled-back / limpiado por UUID) — ver el commit citado.

- **Fila 50 — BV1** (echada retroactiva con permiso) — ✅ dev · `8ce98f9`. Guard en `registrar_combustible_app` (futura rechazada; pasada solo con permiso vigente / flota-elevado / admin), tabla `combustible_permisos_retro` + otorgar/revocar/listar, panel en Registro de echadas.
- **Fila 51 — BV2** (vehículo nombre·placa + alias) — ✅ dev · `f3d6fda`/`904e3d0`. `vehiculos.alias` + `vehiculo_display()`, resumen semanal usa el display.
- **Fila 52 — BV3** (pendientes por almacén) — ✅ dev · `11407e9`. `bodega_pendientes()` (entradas por confirmar + salidas sin recibir) + sección en la página del almacén.
- **Fila 53 — BV4** (material que llega cubre la requisición) — ✅ dev · `59615ac`. `requisicion_cubierta_por` + motor `vincular_movimiento_requisiciones` + pendiente coverage-aware + hook al recibir + `requisicion_cobertura`/`desvincular_cobertura` + sección "Cubierto por material llegado a la obra".
- **Fila 54 — BV5** — ⚠️ **SIN ESPECIFICACIÓN en el handoff.** El mapa de fases (reconstruido tras compactar) no describe BV5; no se construyó por no inventar requisito. **Falta que Xaviel pegue el texto de BV5.**
- **Fila 55 — BV6** (conduce externo → inventario) — ✅ dev · `b22026e`. Entrada entrante nace pendiente y sube stock al confirmar recepción; salida baja al emitir y marca recibida (dispara BV4); anular limpia la entrada pendiente; fix `origen_tipo 'otros'→'otro'`. Web: selector de material en el form.
- **Fila 56 — BV7** (asignar chofer a un conduce) — ✅ dev · `11407e9`. `asignar_chofer_conduce()` (dispara auto-ruta) + picker inline en Conduces.
- **Fila 57 — BV8** (materiales a cargo del ingeniero) — ✅ dev · `9749aea`. `materiales_a_cargo()` derivada + sección "Materiales a mi cargo" en Requisiciones del ingeniero.
- **Fila 58 — BV9** (fase de la requisición) — ✅ dev · `9e334b1`. `requisicion_fase()` + columna computada + tabs con conteo.
- **Fila 59 — BV10** (orden por necesidad) — ✅ dev · `9e334b1`. Orden por defecto = fecha de necesidad (persistido).
- **Fila 60 — BV11** (editar fecha de necesidad) — ✅ dev · `9e334b1`. `requisicion_set_fecha_necesidad()` + editor inline + historial + aviso al aprobador.
- **Fila 61 — BV12** (parser factura julio) — ✅ dev · F1. `parse-pdf-totalenergies` tolera formatos de fecha + diagnóstico + auto-reporte a Tecnología. ⚠️ El PDF real de julio no está en prod; endurecido por hipótesis (se auto-reporta al próximo intento).
- **Fila 62 — BV13** (auto-vínculo tarjeta→vehículo) — ✅ dev · `f342989`. `sugerir_vehiculo_tarjeta()` + preselección con %/vía + "aceptar automáticos".
- **Fila 63 — BV14** (recalcular abre a flota) — ✅ dev · F1. `recalcular_estados_combustible` gate `is_admin`→`es_flota_elevado` + lint `perform`-gate.

**Residual menor (no bloquea la prueba en dev):** campo *Alias* en Editar vehículo, vehiculo-picker nombre·placa, lado ingeniero de las tabs de fase, correo diario ordenado por necesidad, paridad app. Backfill BV4 por articulo_id = no-op en dev (seed sin overlap); queda como script prod-gated.

## App PROMPT-61 (móvil 2.27.0) — 🔧 EN DEV (rama `feature/bv-ronda`, build+guards verdes)

Espejo en la app de la ronda BV. Consume los contratos del padre (todos vivos en dev)
**detrás de comprobación de capacidad** (degradan solos si un contrato aún no está
desplegado). `npm run build` (SGC_ENV=dev) verde; guards verdes (i18n **en 96 %**).
**Falta correr el APK dev + publicar + merge a `dev`** (owed físico de Xaviel) — ver
`csd-app/HANDOFF.md`. **Mínima se queda en 2.26.1** (DEFAULT; sin crash que la justifique).

**SQL `mis_permisos_retro()`:** ✅ **aplicada en dev** (copiada a `SGC/sql/2026-09-22-bv1b-mis-permisos-retro.sql`,
en el ledger `sgc.migraciones_aplicadas` de dev). **Falta prod:**
`node scripts/apply-migration.mjs sql/2026-09-22-bv1b-mis-permisos-retro.sql --env prod` (pasa el ledger).
Sin ella el campo Fecha retroactiva de la app no aparece (degrada limpio).

| Fila | App (PROMPT-61) | Estado (móvil) | Pantalla / objeto |
|---|---|---|---|
| 50 | **BV1** — echada de fecha pasada con permiso | 🔧 2.27.0 dev | `combustible`: campo Fecha solo si `mis_permisos_retro()` vigente (rango `desde…hoy`), envía `p_fecha`; chip RETROACTIVA; deep-link `combustible_permiso_retro` |
| 51 | **BV2** — vehículo nombre·placa | 🔧 2.27.0 dev | `vehiculos.alias` en selects directos + `vehiculoIdentidad` alias-aware + `vehiculo-card [alias]` + picker (RPCs sin alias caen a marca·modelo·placa) |
| 52 | **BV3** — pendientes del almacén | 🔧 2.27.0 dev | `almacen-inventario`: "Pendientes de este almacén" (`bodega_pendientes`) — entradas por confirmar / salidas sin recibir + deep-link a *Por recibir* |
| 53 | **BV4** — material que cubre la requisición | 🔧 2.27.0 dev (lado requis.) | `requisicion_cobertura` en el detalle + *¿Revisar? No* → `desvincular_cobertura`. **Residual:** chip "Cubre REQ (n/m)" en conduce-detalle |
| 54 | **BV5** — la echada a medias se retoma | 🔧 2.27.0 dev | Home *"Pendiente de terminar"* (EnProceso incl. combustible/conduce_externo) + `appRestoredResult` central en `CameraService` (device-QA Android pendiente) |
| 55 | **BV6** — conduce externo → inventario | 🔧 2.27.0 dev | toggle "Con materiales del inventario" + almacén origen (Central primero) + picker de stock → `crear_conduce_externo(p_items)`. **Residual:** chip AFECTA INVENTARIO en recepción |
| 56 | **BV7** — asignar chofer desde la lista | 🔧 2.27.0 dev | *Conduces pendientes*: "Asignar chofer" inline (elevado) → `asignar_chofer_conduce`. **Residual:** lista dedicada "por despachar sin chofer" + multi-select |
| 57 | **BV8** — materiales a cargo del ingeniero | 🔧 2.27.0 dev | Perfil › "A mi cargo" (`/perfil/a-mi-cargo`, `materiales_a_cargo()`, solo lectura, offline) |
| 58-60 | **BV9/BV10/BV11** — fase + orden por necesidad + editar fecha | 🔧 2.27.0 dev | *Mis requisiciones* + *Bandeja*: tabs por fase (`faseRequisicion` cliente/server), orden por fecha de necesidad, 1ª línea "en N días/vencida"; detalle: fecha destacada + editar (outbox `requisicion_fecha` → `requisicion_set_fecha_necesidad`) |
