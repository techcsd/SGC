# SGC — Session Handoff

_Last updated: 2026-07-22_

## Actualización 5 · PROMPT-13-SGC (U2/U7/U10/U11-web/U14) (22/07/2026) — ✅ EN PRODUCCIÓN (web 1.22.0), commit+push+deploy, versión publicada

Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-5.md` (ronda 6, QA app v1.23.1). Aditivo/retrocompatible, build verde. **3 migraciones aplicadas a prod (Management API), idempotentes.** Commit **`adced89`** en `main`, push → **deploy Vercel READY (production)**. Versión **1.22.0** registrada en `sgc.app_versiones` (título + 4 cambios + link al commit).

### Done — por fase
- **FASE 1 · U2/U7** (seeds de textos cortos y llanos): columna aditiva **`checklist_plantilla_items.ayuda`** (detalle largo; la etiqueta queda corta). **PRE-USO-V4** (5 de seguridad críticas) y **REPORTE-SEMANAL-V3** (ninguna crítica) activas; V3/V2 anteriores desactivadas (históricos intactos, respuestas guardan snapshot de `etiqueta`). Etiquetas aprobadas por Xaviel (ej. "Matrícula y seguro al día · copias dentro del carro", "Frenos: que respondan bien", "Gomas en buen estado · repuesto listo"). Web/app las consumen sin cambios de código (`getPlantillas` filtra `activo=true`, trae `ayuda` vía `*`). **1 sola plantilla activa por frecuencia** verificado.
- **FASE 2 · U10** (piso absoluto de consumo): `registrar_combustible_app` evalúa en cascada **esperado → promedio propio → piso absoluto** (`flota_config.rendimiento_minimo_km_gal`, default **10**). Si `km_recorridos>0` y `rendimiento < piso` → **alerta SIEMPRE**, aun sin historial ni esperado. Persiste **`registros_combustible.motivo_alerta`**; el detalle web ("Análisis automático"), el banner de preview en vivo (`calc()`) y el toast muestran el motivo. **Caso real probado**: 100 km / 11.59 gal = 8.63 km/gal < 10 → **ANORMAL** (antes "normal"); documentado en la migración.
- **FASE 3 · U14** (texto): aviso de mantenimiento vencido homologado a **"pasado con X km"** — server (`registrar_checklist_vehiculo`, única función que genera el aviso `mantenimiento_vencido`) + web (`vehiculo-detalle` banner y stat-card, `checklists.html`, `mantenimientos.html`).
- **FASE 3 · U11-web** (perfil del vehículo): **banner de mantenimiento** 🔴 atrasado ("pasado con X km") / 🟠 próximo (umbral pre-cita); **último nivel de combustible** (stat-card, del checklist más reciente vía `ultimoNivelCombustible()`); sección **Multas del vehículo** (nuevo `FlotaIncidenciasService.multasPorVehiculo`, filtra por `vehiculo_id`; RLS respetada).

### Migraciones en prod (`sql/2026-07-22-*.sql`, aplicadas + verificadas)
`u2u7-seeds-v4-v3-textos-cortos` · `u10-piso-consumo` · `u14-texto-mantenimiento`.

### Pending — PROMPT-14-CSD-APP (app móvil, repo `C:\Users\xavie\Desktop\X Dev\dev2\csd-app`)
Es el grueso de la ronda 6. Contratos ya listos desde este lado:
- **Plantillas**: la app lee la plantilla activa por frecuencia → ya recibe PRE-USO-V4 / REPORTE-SEMANAL-V3 (etiquetas cortas) sin cambios; la columna `ayuda` está disponible si quieren mostrar el detalle largo.
- **Combustible**: el RPC devuelve `referencia_alerta ∈ {esperado, propio, piso}` + `motivo_alerta` (texto listo para pintar); piso gobernado por `flota_config.rendimiento_minimo_km_gal`.
- **U14 en app**: homologar "pasado con X km" en `checklist.html:173`, `preuso.html:180`, PDF `preuso-report.service.ts:311`.
- **Perfil vehículo (app)**: espejar alerta de mantenimiento + último nivel + multas del vehículo.
- Resto de la ronda 6 (app): U1/U8 reconciliación optimista con outbox (capa compartida), U2-app (sub-paginar pre-uso), U3 scroll por paso, U4 vista de resultado, U5 addrow rota, U6 combustible más pasos + KmInput, U9 autosave/preview/vehículo en multa, U12 asignarme (marcar ya asignados), U13 ubicación legible, U15 mantenimiento KmInput+fotos, U16 wizards "sin deslizar".

### Pending — Xavier only (QA manual, no headless por RLS/JWT)
- Pre-uso y reporte semanal muestran las **etiquetas cortas** nuevas (web y app).
- Registrar una echada tipo el caso real (100 km / ~11.6 gal) → **badge Anormal** con motivo "piso absoluto".
- Perfil de un vehículo con `kilometraje ≥ próximo mantenimiento` → banner rojo "pasado con X km" + último nivel + multas.

### Gotcha nuevo
- **`ayuda` en items del checklist**: `getPlantillas` usa `select('*, items:checklist_plantilla_items(*))` → el nuevo campo llega solo; el modelo TS lo ignora por el cast `as unknown as`. Mostrarlo es opcional (no hubo cambio de código en web).

### Verify on resume
```
git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" log --oneline -1   # adced89 Actualización 5 (v1.22.0)
node scratchpad/apply-sql.mjs --query "select version,url from sgc.app_versiones where plataforma='web' and version='1.22.0';"
node scratchpad/apply-sql.mjs --query "select frecuencia, count(*) filter (where activo) from sgc.checklist_plantillas where frecuencia in ('preuso','semanal') group by 1;"  -- 1 c/u (V4/V3)
node scratchpad/apply-sql.mjs --query "select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal';"  -- 10
```

---

## Paridad app T19 (22/07/2026) — ✅ web 1.21.0, commit+push+deploy, versión registrada
Follow-up de paridad web del T19 que ya salió en la app móvil (csd-app v1.23.0). Commit **`63e18bf`** en `main` (push → deploy Vercel). `npm run build` verde. Versión **1.21.0** registrada en `sgc.app_versiones` (2 cambios + link al commit). Migración compartida `2026-07-22-t19-equipos-obra-operatividad.sql` ya estaba aplicada en prod (RPC `equipos_de_obra`, columna `incidente_equipo_operativo_comentario`, param en `crear_entrada_bitacora`/`crear_bitacora_app`) — se aplicó desde csd-app y quedó espejada aquí (commit `e1b1da0`).
- **Form de incidente de equipo** (`bitacora/nueva`): nuevo campo **comentario de operatividad** — opcional si "Sí", **obligatorio** si quedó fuera de servicio (validador condicional en `incidente_equipo_operativo.valueChanges`); se manda a `crear_entrada_bitacora` (`p_incidente_equipo_operativo_comentario`).
- **Selector de equipos de la obra**: el nombre del equipo (incidente de equipo + equipos alquilados del parte, `<datalist>`) se autocompleta con `equipos_de_obra(proyecto_id)` (RPC security-definer), cargado al elegir obra; fallback al listado global `getEquiposSugeridos`. Evita nombres inconsistentes.
- **Detalle** (`bitacora/historial` drawer): muestra el comentario de operatividad (el `SELECT_QUERY` usa `*`, no requirió cambio).
- Modelo `Bitacora`/`BitacoraFormData` + `BitacoraService.getEquiposDeObra` añadidos.
- **PENDIENTE — QA manual (web, no headless por RLS/JWT) — CHECKLIST:**
  - [ ] `bitacora/nueva` → tipo **Incidente** → subtipo **Incidente de equipo**: aparece el campo comentario de operatividad.
  - [ ] "¿Queda operativo? = No" → el comentario es **obligatorio** (el submit se bloquea y marca el error "Requerido: el equipo quedó fuera de servicio"); "= Sí" → opcional.
  - [ ] **Autocompletado de equipos por obra**: al elegir la obra, el input "Equipo afectado" sugiere (datalist) los equipos ya vistos en esa obra; también el input de equipos alquilados del parte diario.
  - [ ] **Detalle** (`bitacora/historial` → abrir un incidente de equipo con comentario): se muestra "Comentario de operatividad".
  - [ ] **Interconexión app↔web**: un incidente de equipo enviado desde la app (v1.23.0) con comentario aparece en el detalle web con equipo + comentario.
  - Con esto la paridad app↔web de T19 queda cerrada.

## Actualización 4 · PROMPT-11 (T1–T18) (22/07/2026) — ✅ EN PRODUCCIÓN (web 1.20.0), commit+push+deploy, versión publicada

Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-4.md` (T1–T19) + `apuntes de reunion.md` (ronda 5). Todo aditivo/retrocompatible, build verde por fase. **8 migraciones aplicadas a prod (Management API), idempotentes.** Commit **`202e150`** en `main`, pusheado → deploy Vercel. Versión **1.20.0** registrada en `sgc.app_versiones` (título + 13 cambios + link al commit).

### TL;DR
T1–T18 (web/BD) completos y desplegados. T2 "datos de prueba" con enforcement RLS + UI admin en 10 entidades. Falta solo PROMPT-12 (app móvil, otro repo) y un fleco menor de UI en sub-tablas de detalle.

### Done — por requerimiento
- **T6** catálogos bitácora tolerantes + secciones de sucesos (incidente/accidente/equipo) administrables.
- **T7** reporte semanal: vista dual (chofer solo lo suyo) + scoping server-side en `v_reporte_semanal_cumplimiento` (WHERE `es_flota_elevado() OR chofer=auth.uid()`); `generarAvisos()` solo elevados.
- **T10** popover del filtro de fechas con flip a la derecha + `max-width`.
- **T13a** `registrar_salida_inventario`(+app): nombre desde `articulos` (LEFT JOIN stock), mensaje friendly y **lista completa** de faltantes.
- **T13b/T14/T8** componente compartido **`app-articulo-picker`** (`src/shared/ui/articulo-picker/`) en Salidas, Requisición y OC; en OC setea `articulo_id` → reconciliación funciona.
- **T15** `confirmar_recepcion_salida`: entrada automática en el almacén de la obra (origen `recepcion_obra`); aviso "obra sin almacén" al requisar.
- **T4** catálogo `estaciones_combustible` (Total Energies default) + selector; pantalla **`/flota/conciliacion-combustible`** (import Excel/CSV, matching por placa+fecha±2d, guardado `conciliaciones_combustible`+detalle, notificación aviso `conciliacion`, dashboard). RPC `guardar_conciliacion_combustible`.
- **T5** alerta de consumo en cascada (esperado→propio→flota) en `registrar_combustible_app`; umbral `flota_config.umbral_consumo_pct`; **T18** badge Normal/Anormal por fila.
- **T12** registrar accidente desde web (Flota › Accidentes, reusa `crearAccidente`). **T9** catálogo `motivos_multa` + desplegable en el drawer de multa.
- **T16** banner de vehículos cerca/vencidos de mantenimiento (por km) + crear prellenado. **T17** estado de conductores rediseñado. **T11** panel-día paginado. **T1** mapeo de avisos a submódulo completo (`reporte_semanal`, `conciliacion`) + badgeKeys.
- **T2 datos de prueba**: `es_prueba` en 13 tablas + **política RLS restrictiva de SELECT** (`es_prueba: oculta a no-admin`, oculta a no-admin en TODO el sistema) + RPCs `marcar_dato_prueba`/`eliminar_dato_prueba` (admin) + `DatosPruebaService`. UI admin (toggle + badge PRUEBA + marcar/eliminar) en Vehículos, Combustible, Checklists, Rutas, Mantenimientos, Accidentes, Entradas, Salidas, Conductores, historial de Bitácora.

### Migraciones en prod (`sql/2026-07-22-*.sql`, todas aplicadas + verificadas)
`t13a-salida-faltantes` · `t7-reporte-semanal-scoping` · `t15-recepcion-entrada-obra` · `t4-estaciones-conciliacion` · `t5-alerta-consumo-cascada` · `t2-datos-prueba` · `t2b-enforcement-rls` · `t9-motivos-multa`.

### Pending — Claude puede hacer
1. **PROMPT-12 (app móvil, repo `C:\Users\xavie\Desktop\X Dev\dev2\csd-app`)**: T19 (selector de equipos-de-obra en incidente de equipo — exponer/consumir `equipos_de_obra(p_proyecto_id)`; comentario al responder operatividad, obligatorio si queda fuera de servicio; arreglar resumen del paso 7 con labels pegados en TODOS los wizards nuevos) + estación de combustible con Total Energies default + verificación de paridad inversa.
2. **Fleco T2**: botón marcar/eliminar (admin) en las sub-tablas de `vehiculo_entregas` / `conductor_multas` / `vehiculo_danos` dentro de las vistas de detalle (conductor-detalle, vehiculo-detalle, responsabilidad). Ya ocultas a no-admin por RLS; solo falta el botón. Usar `DatosPruebaService` (tablas `vehiculo_entregas`/`conductor_multas`/`vehiculo_danos`).

### Pending — Xavier only
- **QA manual** en prod (los RPCs `_app` y RLS usan auth.uid/JWT → no verificables headless): picker de artículos en Salidas/Requisición/OC; conciliación con un informe real de Total Energies; alerta de consumo con un vehículo con `rendimiento_esperado_km_gal` (caso 8.63 km/gal dispara); chofer no ve el dashboard global del reporte semanal; datos de prueba (marcar → desaparece para no-admin → eliminar).
- **Formato del informe de Total Energies**: el importador es tolerante a columnas (detecta fecha/placa-tarjeta/galones/monto por encabezado); si el real trae encabezados raros, pásame un ejemplo para afinar.

### Gotchas descubiertos
- **`registrar_version` no es llamable desde la Management API** (corre como `postgres`, `auth.uid()` null → "No autorizado"). Se publica desde el deploy (postbuild con `service_role`) o al abrir la app como admin. Para publicar a mano por API: en el mismo query hacer `select set_config('request.jwt.claims','{"role":"service_role"}',false);` antes del `select sgc.registrar_version(...)` (la RPC acepta `auth.role()='service_role'`). Ver `scratchpad/registrar-version.mjs`.
- **`registrar_version` on-conflict NO sobrescribe `url`** (`coalesce(existing, excluded)`): si la fila ya existía con un link viejo, corrige con UPDATE directo (Management API bypassa RLS como postgres).
- **`version.ts` se autogenera en cada build desde `git HEAD`**: si editas `release-notes.json` DESPUÉS del build local, `version.ts` queda con el commit/nota anterior. No importa: Vercel lo regenera en el deploy. No editar `version.ts` a mano.
- **Aplicar SQL a prod**: `node scratchpad/apply-sql.mjs <archivo.sql>` o `--query "..."` (usa `SUPABASE_ACCESS_TOKEN` + Management API del proyecto `jeeqhgccqefbqilntcpu`). El endpoint devuelve solo el resultado del ÚLTIMO statement cuando mandas varios.
- **T7**: la vista `v_reporte_semanal_cumplimiento` es `security_invoker` pero la RLS de `vehiculos` NO scopea al chofer → había que filtrar en la propia vista (no basta la RLS de la tabla).
- **Enforcement de es_prueba**: política **`as restrictive for select`** (se AND-ea con las permisivas existentes sin reescribirlas) es la forma segura y transversal de ocultar a no-admin. Los RPCs `security definer` la omiten (caso borde documentado).

### Verify on resume
```
git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" log --oneline -1   # 202e150 Actualización 4
node scratchpad/apply-sql.mjs --query "select version,url from sgc.app_versiones where plataforma='web' and version='1.20.0';"
node scratchpad/apply-sql.mjs --query "select count(*) from pg_policies where schemaname='sgc' and policyname='es_prueba: oculta a no-admin';"  -- =13
```

---

## Actualización 3 · PROMPT-9 (21/07/2026) — Flota (SGC web + BD): rutas, reporte semanal, vencimientos, accidentes/daños/multas, perfil vehículo/conductor, dashboard conductores — ✅ CÓDIGO LISTO, migraciones en prod, build OK, SIN commit/push

Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-3.md` (S16-S18, S20-S25, S32). Aditivo/retrocompatible. Build verde. **4 migraciones aplicadas a prod (Management API), idempotentes.** Frontend **sin commit/push**. R14/P7 intactos.

### Migraciones en prod (`sql/2026-07-21-act3-p9-*.sql`)
- `-s16-rutas.sql`: versiona `mis_rutas_hoy()` (filtra por conductor vinculado a auth.uid); trigger `trg_ruta_notificar_conductor` (notifica al chofer al asignar/cambiar conductor, deep-link `/flota/rutas?item=`). RLS de rutas ya era R14-coherente (no se tocó).
- `-s17s18-reporte-semanal.sql`: abrevia las 9 etiquetas de REPORTE-SEMANAL-V2 (in-place) + ítem 1 ampliado con "copias físicas dentro del vehículo".
- `-s20s21-vehiculos.sql`: `vehiculos.rendimiento_esperado_km_gal` (S20); `reevaluar_vencimiento_vehiculo(id)` + trigger `trg_reevaluar_vencimiento` (al instante) + `aplicar_vencimientos_vehiculos()` (barrido) + **pg_cron diario 06:00** (`sgc-aplicar-vencimientos`); documento vencido → `estado='no_disponible'` + aviso `docvenc:mat|seg:{id}` (dedup), y de vuelta a `activo` al renovar; **`crear_entrega_vehiculo`** ahora permite DEVOLUCIÓN pero bloquea RECEPCIÓN de vehículo no disponible. Barrido inicial dejó 1 vehículo (L542136, seguro vencido) no disponible.
- `-s22s24-accidentes-multas.sql`: tablas `vehiculo_accidentes` (acta AMET), `vehiculo_danos`, `conductor_multas` + RLS R14 + RPCs `registrar_accidente_app`/`registrar_dano_app`/`registrar_multa_app` (idempotentes por id, para PROMPT-10). Docs al bucket `flota-documentos`.

### Frontend web (sin commit)
- **S20**: campo rendimiento esperado en el form de vehículo; perfil + dashboard de combustible muestran esperado vs real (badge ⚠ si real < esperado).
- **S21**: banner "No disponible · documento vencido" en el perfil (el badge no_disponible ya existía).
- **FASE 4**: perfil de vehículo con secciones **Accidentes (acta AMET)** y **Daños** + drawers de registro (elevados); submódulo nuevo **`/flota/accidentes`** (lista → detalle con acta); perfil de conductor con **Multas** (registrar + marcar pagada) y **Accidentes**.
- **S25**: nueva pantalla **`/flota/conductores-estado`** (dashboard licencias: KPIs vigentes/por vencer/vencidas + tabla por vencimiento + click al perfil).
- **S32**: `conductor-detalle` completado — pre-usos vs reportes semanales (split por plantilla), rutas, conduces, entregas/recepciones, accidentes, multas, con drill-down.
- **S16**: rutas web abre el detalle con `?item=`. Nav (shell) con "Estado de conductores" y "Accidentes" (gated flotaElevado). `flota.routes.ts` con las 2 rutas nuevas.
- Servicio nuevo `flota-incidencias.service.ts` + modelo `flota-incidencias.model.ts`.

### Para PROMPT-10 (csd-app / móvil) — contratos nuevos
- **`mis_rutas_hoy()`** (sin args, usa auth.uid): rutas de HOY del chofer. Al asignarle una, le llega notificación (tabla `notificaciones`, ruta `/flota/rutas?item=`).
- **RPCs offline** (idempotentes por `p_id` cliente): `registrar_accidente_app(p_id,p_vehiculo_id,p_fecha,p_fase,p_descripcion,p_lesionados,p_tercero,p_conductor_id,p_gps,p_reporte_amet_path,p_capturado_en)`; `registrar_dano_app(p_id,p_vehiculo_id,p_zona,p_descripcion,p_foto_path,p_origen,p_accidente_id,p_capturado_en)`; `registrar_multa_app(p_id,p_conductor_id,p_fecha,p_motivo,p_monto,p_vehiculo_id,p_accidente_id,p_documento_path,p_estado,p_capturado_en)`. Docs/fotos al bucket `flota-documentos`.
- **Reporte semanal**: plantilla `REPORTE-SEMANAL-V2` con etiquetas cortas (lee de BD).
- **crear_entrega_vehiculo**: la app puede DEVOLVER un vehículo no disponible; la RECEPCIÓN nueva de uno `no_disponible`/inactivo se rechaza ("Vehículo no disponible…").
- **rendimiento_esperado_km_gal** en vehículos (mostrar comparación en la app si aplica).
- Estado de conductores: vista `v_conductor_stats` (nombre, licencia_vencimiento, estado_licencia, …).

### Pendiente de Xaviel / QA manual
- **Commit/push + deploy** (no lo hice). Bump de versión cuando decidas.
- **QA manual** sugerido (los RPCs `_app` y crear_entrega usan auth.uid → no verificables headless): registrar accidente con acta AMET / daño / multa desde la web; intentar recibir un vehículo no disponible (debe rechazar) y devolverlo (debe permitir); dashboard de conductores; deep-link de ruta asignada.
- Verificado en vivo (transacción/rollback): trigger de notificación de ruta (1 notif con deep-link), ciclo vencimiento no_disponible↔activo + avisos, barrido inicial. Idempotencia y cron (1 job) confirmados.

---

## Actualización 3 · PROMPT-7 (21/07/2026) — Bitácora/incidentes/liberación (SGC web + BD) — ✅ CÓDIGO LISTO, migraciones en prod, build OK, SIN commit/push

Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-3.md` (S2, S4, S6, S7, S10, S12, S13, S14-web). Todo aditivo/retrocompatible. Build verde. **Migraciones aplicadas a prod (Management API) — 5 archivos, idempotentes y re-aplicadas sin error.** Frontend **sin commit/push** (esperando tu OK). Decisiones validadas contigo: CL rename **sin sufijo** (Simmons/Golliat fuera); mín. fotos **activado ya** (parte≥2, incidente≥1).

### Migraciones en prod (`sql/2026-07-21-act3-*.sql`)
- `-s2-catalogos-orden-ranking.sql`: `bitacora_catalogos.orden` + seeds (estructuras/actividades en orden real); tabla `bitacora_catalogo_usos` (contador por obra); RPC `catalogo_ordenado(p_proyecto_id)` (top-3 usadas primero + resto por proceso, flag `destacado`).
- `-s4s7-bitacora-cols.sql`: `bitacora_actividades.bloque`; `bitacora_equipos_alquilados.{para_retirar,danado,dano_detalle}`; helpers `notificar_rol(rol,…)` y `notificar_flota_elevado(…)` (SECURITY DEFINER, espejo de notificar_modulo).
- `-s12s13-incidentes.sql`: CHECK `incidente_tipo` ampliado a `incidente|accidente|incidente_equipo`; cols `incidente_equipo_{nombre,alquilado,operativo}` + `incidente_suceso`; catálogo de sucesos (tipos `suceso_incidente|suceso_accidente|suceso_equipo`, CHECK de `bitacora_catalogos.tipo` ampliado + seeds).
- `-rpc-bitacora.sql`: re-crea `crear_bitacora_app` (app) y `crear_entrada_bitacora` (web) — **DROP firma exacta + CREATE** para no dejar overloads. Añade: bloque por actividad, mín. fotos (solo app: parte≥2/incidente≥1, constantes `c_min_fotos_*`), flags de equipo + notificación dirigida, incidente de equipo + suceso, upsert de ranking de usos (agregado por valor para no chocar ON CONFLICT). 4 params nuevos al final, todos DEFAULT → llamadas actuales por nombre siguen resolviendo (verificado: 1 overload cada uno, 36/35 args).
- `-s10-cl-nombres.sql`: renombra `cl_plantillas.nombre` CL-04..07 → "Armado de muros y columnas / Encofrado de muros y columnas / Encofrado de vigas y losas / Armado de vigas y losas". `codigo` intacto; ítems no usaban "elementos verticales/horizontales".

### Frontend web (sin commit)
- **Catálogos** (`bitacora-catalogos.service.ts`, admin): ordena por `orden`; `getCatalogosOrdenados(proyecto)` (RPC), `getSucesos()`, `updateOrden`; admin con flechas ↑/↓ (normaliza orden 1..n).
- **Bitácora nueva** (`nueva.*` + `bitacora.model.ts` + `bitacora.service.ts`): ranking por obra al elegir proyecto; incidente condicional por subtipo (accidente/equipo/incidente) + selector de suceso del catálogo + "Otro"; equipos con checkboxes Para retirar/Dañado (+detalle); mín. 2 fotos en parte (constantes `MIN_FOTOS_*`); bloque por actividad = bloque de cabecera.
- **Historial** (`historial.*`): detalle agrupa actividades por bloque; badges "Para retirar"/"Dañado" en equipos; muestra suceso + campos de incidente de equipo; deep-link `?item=` abre el detalle.
- **Liberación S14** (`cl-liberacion.*` + service + `proyectos/lista`): revisión read-only primero; el pad/form de firma solo aparece tras pulsar **"Firmar como {rol}"** (señal `mostrarFirma`); `solicitarFirma` manda el rol en el deep-link (`&firmaRol=`) y al abrir se pre-selecciona + banner.

### Para PROMPT-8 (csd-app / móvil) — contratos nuevos
- **`sgc.catalogo_ordenado(p_proyecto_id uuid)`** → filas `{tipo, valor, activo, orden, usos, ultimo_uso, destacado}`; usar para pintar "más usadas" (destacado=true) primero. `p_proyecto_id` null = solo orden de proceso.
- **`crear_bitacora_app`** params nuevos (todos opcionales): en `p_actividades[]` añade `bloque`; en `p_equipos_alquilados[]` añade `para_retirar`, `danado`, `dano_detalle`; nuevos escalares `p_incidente_equipo_nombre`, `p_incidente_equipo_alquilado` (bool), `p_incidente_equipo_operativo` (bool), `p_incidente_suceso`. **Ojo mín. fotos ACTIVO**: parte_diario rechaza <2 fotos, incidente <1 (mensaje P0001 legible) — la app móvil DEBE exigir 2 fotos en el parte antes de enviar.
- **`incidente_tipo`** ahora acepta `'incidente_equipo'`. Sucesos: `bitacora_catalogos` tipos `suceso_incidente|suceso_accidente|suceso_equipo`. "Otro" = texto libre en `incidente_suceso` (el RPC lo registra en otros_valores si no está en el catálogo).
- **Notificación de retiro**: al enviar un equipo `para_retirar=true`, el RPC notifica al rol `chofer_transportista` + flota elevados con ruta `/bitacora/historial?item={id}` (la app puede mapear su propia vista de avisos).

### Pendiente de Xaviel / notas
- **Commit/push + deploy** del frontend (no lo hice). Bump de versión sugerido cuando decidas.
- **Retrocompat / cambio de comportamiento**: la app móvil ACTUAL (sin PROMPT-8) que suba un parte con <2 fotos ahora recibirá "Agrega al menos 2 fotos del trabajo realizado" (lo aprobaste). Constantes fáciles de bajar a 0 en `-rpc-bitacora.sql` si necesitas una ventana de transición.
- **QA manual** sugerido: (1) admin catálogos reordenar ↑/↓; (2) parte con actividades en 1 bloque → detalle agrupado; rechazo con <2 fotos; (3) equipo "para retirar" → campana del transportista con deep-link; (4) incidente de equipo con suceso del catálogo y "Otro"; (5) solicitar firma de un CL → abrir desde la notificación → ver revisión y "Firmar como {rol}" al final; (6) nombres CL nuevos en el selector.
- Test funcional en transacción (rollback) verificó: bloque×actividad, flags de equipo, ranking usos, y 11 notificaciones con deep-link. `catalogo_ordenado` y el path incidente_equipo probados en vivo.

---

## Actualización 1 (18/07/2026) — UI, Mi proyecto, imágenes, tipos vehículo, login conductores, flota estado/permisos — ✅ CÓDIGO LISTO + migraciones/edge en prod, build OK, SIN commit/push

Source: `C:\developer\improvements\imp 17072026\CONTEXTO-ACTUALIZACION-1.md` (P1–P6). Todo aditivo. Build verde. **No se hizo commit/push del frontend.** Migraciones y edge functions **sí** aplicadas/desplegadas a prod (permitido por el acuerdo). Web bump propuesto → **1.14.0** (pendiente de tu OK para commitear).

### Por punto
- **P2 (bug en vivo)**: "Mi proyecto" ignoraba al responsable y a usuarios sin ficha. RPC `sgc.mis_proyectos(p_usuario)` (SECURITY DEFINER, jsonb con fases embebidas) = responsable_id OR miembro de equipo; `mi-proyecto.ts` la consume (`ProyectosService.misProyectos`). Además se **amplió la RLS `proyectos: select`** para incluir `responsable_id = auth.uid()` (el responsable ya puede abrir el detalle). Verificado: responsable (PROY-0001) y miembro de equipo (QA-TEST) ✓.
- **P6 (flota estado/activo/permisos)**: helper `sgc.es_flota_elevado()` (admin, direccion, gerencia, jefe_flota — **confirmado por Xaviel**). RLS `vehiculos`: SELECT `activo OR es_flota_elevado()` (inactivos ocultos a normales); INSERT/UPDATE solo elevados; DELETE admin-only. Front: badge **"Desactivado"** (reconcilia activo vs estado) en `flota/reportes` y listado; inactivos al final; botones crear/editar/toggle gated a `UserService.esFlotaElevado`. KPIs intactos. Verificado por RLS con JWT simulado (normal no ve/edita inactivos; admin sí) ✓.
- **P4 (tipos de vehículo)**: `VEHICULO_TIPOS` + `motocicleta, automovil, suv` (labels RD); `claseVehiculo()` → esos + pickup + otro = Liviano. Reclasificación **confirmada y aplicada** en prod: Malibu/Lexus→automovil, Suburban/Jimmy→suv, Svartpilen→motocicleta (Hyundai "Cantus" queda otro). ⚠ Hasta desplegar el frontend, esos 5 vehículos muestran el tipo en minúscula cruda en la web viva (cosmético).
- **P5 (login conductor cédula+PIN)**: edge `conductor-crear-acceso` (service role, gated admin/flota): crea/rota acceso con email sintético `c-{cedula}@conductores.constructorasd.local`, rol `chofer_transportista`, enlaza `conductores.usuario_id`. Edge `conductor-login` (**pública, verify_jwt=false** en config.toml) mapea cédula→email→signInWithPassword con **bloqueo temporal** (5 intentos → 15 min, tabla `sgc.conductor_login_intentos`, solo service_role). Front: modo "Soy conductor" en `auth` (cédula+PIN, 6 dígitos), y botón "Generar acceso/Restablecer PIN" en el listado de conductores (gated admin/flota, modal). Verificado en prod: gate ✓, login público ✓, bloqueo ✓, happy-path (login correcto→sesión, PIN malo→401) ✓.
- **P1 (UI)**: tabla de Usuarios responsiva — acciones en menú **"⋯"** (popover fixed, no se recorta), chips de rol con límite 2 + "+N" (tooltip). Tablas con **thead sticky + zebra**; flota/reportes km alineado a la derecha. Login validado con screenshot + a11y básica (labels/tabs/validación).
- **P3 (imágenes)**: componente `app-img` (`shared/components/img`) — reserva espacio (ratio/height), shimmer placeholder, **fade-in**, `loading=lazy` + `decoding=async`, fallback. Aplicado a foto de card de vehículos y thumbnails de documentos. **Disponible para adoptar** en el resto (checklists, responsabilidad, historial, viewer).

### Migraciones en prod (aplicadas y verificadas) + edge deploys
`sql/2026-07-17-act1-mis-proyectos.sql` · `-act1-flota-visibilidad-permisos.sql` · `-act1-reclasificar-vehiculos-otro.sql` · `-act1-conductor-acceso.sql`. Edge desplegadas: `conductor-crear-acceso`, `conductor-login` (+ `supabase/config.toml` con verify_jwt=false para login).

### Para PROMPT-4 (csd-app / móvil) — lo que debe consumir
- **Mi proyecto**: usar RPC `sgc.mis_proyectos(null)` (usa auth.uid()) en vez de solo proyecto_empleados.
- **Login conductor**: llamar a la edge `conductor-login` con `{cedula, pin}`; en éxito hace `setSession(access_token, refresh_token)`. Manejar 401 (incorrecto) y 429 (`retryInSeconds`). El acceso lo genera la web (admin/flota).
- **Tipos de vehículo**: añadir `motocicleta/automovil/suv` al selector y a la lógica clase Liviano/Pesado (afecta checklist).
- **Flota visibilidad**: los vehículos `activo=false` no deben mostrarse a usuarios normales (RLS ya lo aplica); badge "Desactivado" para elevados.
- **app-img**: replicar el patrón placeholder+fade-in en la app.

### Pendiente de Xaviel / notas
- Revisar y **commit/push** del frontend (no lo hice). Deploy pone al día los labels de tipos (ver ⚠ P4) y activa el login de conductor + botones.
- **Smoke test manual** recomendado (no automatizable headless sin sesión admin): en la web, generar acceso a un conductor real → cerrar sesión → entrar como conductor con cédula+PIN → restablecer PIN. Los caminos server (edge/lockout/RLS) ya están verificados; falta solo el clic-a-clic UI con admin logueado.
- §Pendientes del CONTEXTO ya resueltos: P6 roles elevados (admin+dirección+gerencia+jefe_flota), P5 PIN 6 dígitos + bloqueo, P1 menú "⋯", P4 reclasificación. Lista final de tipos: quedó fácil de extender en `VEHICULO_TIPOS`.

---

## Ronda 17/07/2026 — Conductores & Vehículos (web) — ✅ EN PRODUCCIÓN (1.13.0)

Source: `C:\developer\improvements\imp 17072026\CONTEXTO.md` (C1–C7, V1–V2) + `apuntes de reunion.md`. Web bump → **1.13.0** (`package.json` + `release-notes.json` web[1.13.0] + `version.ts` regenerado). **No se hizo commit/push ni deploy** (esperando a Xaviel). M1 (crash cámara Android) es de la app móvil (csd-app) — NO se tocó aquí.

### Qué se hizo (por requerimiento)
- **C2 (bug en vivo)**: desvincular conductor rompía con `invalid input syntax for type uuid: "null"`. Un `<option [value]="null">` en select con `formControlName` guarda el **string** `"null"`. Fix: util nuevo `src/shared/utils/uuid.util.ts` (`cleanUuid`, `sanitizeUuidFields`) aplicado en `conductores.ts`/`conductores.service.ts` (usuario_id + vehiculo_id) **y** — mismo patrón latente — en `rutas.service.ts` (conductor_id, vehiculo_id, destino_proyecto_id), `combustible.service.ts` (conductor_id, vehiculo_id) y `checklists.ts` (conductor_id). Verificado a nivel DB (update usuario_id=null OK).
- **C1 (categorías RD)**: catálogo en BD `sgc.licencia_categorias` (01–06, seed idempotente). `conductores.licencia_tipo` migrado **A→01 B→02 C→03 D→04 E→05 F→06** (prod tenía B(4)→02, C(5)→03). Front consume el catálogo (`getCategoriasLicencia()` con fallback local `LICENCIA_CATEGORIAS_FALLBACK`). Default del alta = `'02'`. `LicenciaTipo` pasó de union A-F a `string`.
- **C3 (nota/tags)**: columnas aditivas `conductores.nota text`, `tags text[]` (nullable) + índice GIN. Form con nota + tags (chips, sugerencias, homologación 1ª mayúscula). Chips en listado y perfil.
- **C4 (docs en el alta)**: el drawer de crear/editar conductor adjunta cédula y **licencia (varias)** opcionales; se suben tras crear con `DocumentosFlotaService.upload` (Promise.allSettled, no bloquea, avisa fallos por toast).
- **C5 (preview + varias fotos)**: `documentos-flota` ahora resuelve **thumbnails** (signed URL) y lista **TODOS** los docs por slot destacado (licencia frente/dorso), con "+ Agregar otra", ver y eliminar cada uno. También thumbnail en "otros". El perfil (conductor y vehículo) ya embebe el componente → se ven ahí.
- **C6 (licencia por vencer)**: badge "Por vencer"/"Vencida" + banner ámbar en el **perfil** del conductor. Umbral subido a **90 días** (`FlotaConfigService.umbralLicenciaDias` default 30→90; configurable en `flota_config.umbral_licencia_dias`).
- **C7 (docs faltantes)**: vista `sgc.v_conductor_documentos` (security_invoker) devuelve por conductor `tiene_cedula/tiene_licencia/total`. Listado muestra badge "⚠ Documentos incompletos" + filtro toggle. Si la vista no responde, no marca nada (sin falsos avisos).
- **V1 (VIN)**: `vehiculos.vin text` + índice único parcial case-insensitive (`uq_vehiculos_vin`, permite múltiples NULL). En form (mayúsculas, ≤17), listado (card), perfil y Excel.
- **V2 (matrícula/seguro)**: `vehiculos.numero_matricula`, `numero_seguro`, `aseguradora` (aditivas). En form, perfil y Excel. Fotos siguen por `documentos` (slots matricula/seguro); fechas de vencimiento ya existían.

### Migraciones aplicadas a prod (Management API, verificadas) — todas aditivas/idempotentes
`sql/2026-07-17-licencia-categorias.sql` · `-conductores-nota-tags.sql` · `-conductor-documentos-resumen.sql` · `-vehiculos-vin-matricula-seguro.sql`. QA-TEST end-to-end ejecutado y limpiado (0 filas QA-TEST restantes).

### Para PROMPT-2 (csd-app / móvil) — lo que debe consumir
- **Catálogo licencia**: tabla `sgc.licencia_categorias` (codigo, nombre, clase, orden, activo). La app debe cambiar su input de licencia de A-F a este catálogo (select 01–06). `conductores.licencia_tipo` ahora es el `codigo` (ej. `'02'`).
- **Conductor**: nuevos campos `nota text`, `tags text[]` — mostrar/editar (chips) en el perfil/alta móvil.
- **Docs**: reutilizar `sgc.documentos` + bucket `flota-documentos`. Móvil debe permitir **varias fotos** por slot destacado (licencia frente/dorso) y preview, igual que web; y ofrecer subir cédula/licencia en el alta.
- **Licencia por vencer**: umbral 90 días (leer `flota_config.umbral_licencia_dias`); badge en listado/perfil móvil.
- **Docs incompletos**: vista `sgc.v_conductor_documentos` para el badge en el listado móvil (o consultar `documentos` por conductor).
- **Vehículo**: nuevos campos `vin`, `numero_matricula`, `numero_seguro`, `aseguradora` — pedir en alta y mostrar en perfil móvil. VIN único case-insensitive.
- **C2**: la app también debe normalizar `"null"` de sus selects/pickers a null real antes de escribir uuid opcionales.
- **M1 (crash Android cámara pre-uso)**: sigue pendiente en csd-app (ver CONTEXTO §C M1).

### Pendiente de Xaviel
- Revisar y hacer **commit/push** (no lo hice). Al mergear a `main`, el deploy registra la versión 1.13.0 (Y1) — requiere las env vars de Vercel ya documentadas abajo.
- §E del CONTEXTO ya resuelto en lo que bloqueaba: mapeo C1 **confirmado** (A→01…F→06); V2 = número de matrícula + número de póliza + compañía. Quedan como decisiones futuras no bloqueantes: tags cerrados vs libres (hoy libres+sugerencias), alerta de vencimiento para cédula/otros.

---

## Actualización 7 (historial de versiones + auditoría + brechas web) — ✅ EN PRODUCCIÓN

Source: `C:\developer\improvements\imp 14072026\CONTEXTO-ACTUALIZACION-7.md` + `CUMPLIMIENTO.md` (PROMPT-16, web).
`main` @ deploy Vercel **READY** en sgcconstructorasd.com. Build OK. Cierra Y1, Y2 y las brechas web (B4/B6/B7) de la auditoría 85/90. Web bump → **1.11.0**.

### Y1 — Historial de versiones confiable y uniforme (REGLA permanente)
- **código manda**: NO se agregó `notas_estructuradas`; `app_versiones` ya tenía `titulo` + `cambios jsonb` ({t,d}) y la UI ya pinta chips para ambas plataformas + fallback a texto plano. Se reutilizan.
- RPC `registrar_version(p_plataforma, p_version, p_notas, p_titulo, p_cambios)` — dropeada la firma de 3 args → 1 overload (retrocompat); idempotente que **solo rellena vacíos, nunca sobrescribe** notas editadas por admin.
- Automatización: `release-notes.json` (fuente de notas) → hook `prebuild` `gen-version.mjs` (emite `APP_VERSION`+título+cambios a `version.ts`) → paso `postbuild` `registrar-version-web.mjs` (registra la versión web en el deploy vía RPC; **skip limpio si faltan envs**). `autoRegistrarVersionWeb()` (shell) es la red de seguridad, ahora con notas estructuradas.
- **Backfill** aplicado: 4 entradas móvil en texto corrido (1.7.0/1.7.1/1.7.2/1.8.0) → estructura; 0 entradas sin formato.
- **Renumeración web**: Act4=1.8.0, **Act5=1.9.0**, **Act6=1.10.0**, **Act7=1.11.0** — las 3 registradas en BD con notas estructuradas (aparecen en el timeline). REGLA documentada en `CLAUDE.md`.
- **PENDIENTE (acción de Xaviel en Vercel)**: para que el registro web sea 100% en el deploy, definir en Vercel → Environment Variables: `SUPABASE_URL` = `https://jeeqhgccqefbqilntcpu.supabase.co` y `SUPABASE_SERVICE_ROLE_KEY` (build-time). No lo pude hacer yo: el MCP de Vercel no expone gestión de env vars y la CLI no está instalada. Mientras tanto, el auto-registro al arrancar lo cubre.

### Y2 — Dashboard de auditoría rediseñado (solo presentación)
- Causa raíz: `auditoria.scss` no definía `kpi-grid/kpi-card/kpi-value/direccion-charts/chart-card` (viven por-dashboard, no global) → "Acciones605" pegado y barras a ancho completo. Se añadieron esos estilos (copiados de `direccion`) + KPI cards en grid de 4, dona junto al ranking (2 col), "Ver más" en listas drill-down. Sin tocar lógica/filtros/drill-down. **Verificado con screenshot Playwright** (se ve de la misma familia que los demás dashboards).

### Brechas web del CUMPLIMIENTO
- **B4 (U3)**: RPC `usuarios_vinculables()` (SECURITY DEFINER, gated flota/rrhh/admin) trae cédula/teléfono desde `empleados` (por `usuario_id` o `email`); el form de conductor los autollena al enlazar (editables, sin pisar lo escrito).
- **B6 (QA-057)**: `destacada=false` en categorías inactivas (Clavos/Madera/Acero); solo quedan destacadas las oficiales activas.
- **B7**: `QA-FINDINGS.md` alineado (QA-057 resuelto).

### Migraciones en prod (Act.7, aditivas)
`sql/2026-07-16-act7-versiones-y-categorias.sql` (RPC + B6) · `-act7-usuarios-vinculables.sql` (B4) · `-act7-backfill-versiones-movil.sql` (backfill).

### Pendientes / notas
- **Vercel env vars** (arriba) — única acción manual para automatizar el registro web en el deploy.
- Brechas **B1/B2/B3/B5** son de la app móvil (csd-app, PROMPT-17) — otro repo, no tocadas aquí.
- Screenshot before/after: el "before" ya no era capturable (el fix estaba desplegado); se validó el "after".

---

## Actualización 6 (documentos + paridad web/móvil) — ✅ EN PRODUCCIÓN

Source: `C:\developer\improvements\imp 14072026\CONTEXTO-ACTUALIZACION-6.md` (PROMPT-13, web).
`main` @ `299694b` · dos deploys Vercel **READY** en sgcconstructorasd.com (`769d7c5` = X1–X4; `299694b` = paridad). Build OK. Migración aplicada a prod.

### X1 — Documentos de conductores y vehículos
- Migración `sql/2026-07-16-act6-documentos.sql`: tabla `sgc.documentos` (**`entidad_id uuid`**, no bigint — los ids son uuid) + índice `(entidad, entidad_id)` + RLS `flota`/`admin` + bucket privado `flota-documentos` con 3 storage policies. Todo aditivo/idempotente.
- Componente reutilizable **`app-documentos-flota`** (`src/shared/components/documentos-flota/`): subir/ver/descargar/eliminar con signed URLs; rollback del archivo si falla el insert (sin huérfanos).
- Perfil de conductor: slots **Cédula/Licencia** destacados con indicador "falta documento" + N otros. Perfil de vehículo: **Seguro/Matrícula** + otros.
- "Ver documento" desde los avisos de vencimiento (licencia/seguro/matrícula) → navega al perfil con `?doc=` y auto-abre el visor.

### X2 — GPS de entrega/recepción (solo display; NO necesitó migración)
`vehiculo_entregas.gps_lat/lng` ya existían y `crear_entrega_vehiculo` ya los persistía — "el GPS nunca se perdió, solo no se mostraba". Nuevo **`app-mini-mapa`** (`src/shared/components/mini-mapa/`, Leaflet read-only) en Flota > Responsabilidad con coords + hora + "Ver en mapa"; "Sin ubicación registrada" si no hay GPS.

### X3 — Fotos por ítem del checklist
El detalle del checklist resuelve las fotos con slot `item_N` (N = orden de la respuesta) y las muestra junto a su hallazgo + en galería "Fotos por ítem".

### X4 + paridad web/móvil (regla dura de Xaviel: nada creable solo desde el móvil)
La web es el padre de la móvil. Cerrados todos los gaps "solo-móvil":
- **Salidas/Entradas**: foto de evidencia opcional subible desde la web (comprimida, bucket `inventario`, set `foto_path` tras el RPC) + botón 📷 en la lista.
- **Checklist**: 7 fotos fijas + foto por ítem + firma (`app-signature-pad`) capturables desde la web (`p_fotos`/`p_firma_path`).
- **Entrega/recepción de vehículo** (nuevo `registrar-entrega` en Flota > Responsabilidad): `crear_entrega_vehiculo` — vehículo, tipo, km, combustible, **6 fotos guiadas obligatorias** (frente/atrás/lados/tablero/combustible), daños con foto, firma y **GPS del navegador**. El usuario queda como conductor.
- **Cierre de conduce** (en la página de conduce, estado despachado): `entregar_conduce` — receptor, cantidades recibidas, foto y firma (evidencia al bucket `conduces`).
- **Fotos en reportes de Soporte**: `crear_reporte_app` + bucket `reportes`.
- Util nueva `src/shared/utils/comprimir-imagen.util.ts` (redimensiona 1600px/JPEG 0.8).

### Arreglo de mapas
ResizeObserver + invalidateSize en `mini-mapa` y `location-picker` → cura los tiles grises/desalineados en drawers y filas expandibles (rutas, bodegas, proyectos, responsabilidad).

### Migración en prod (Act.6)
`sql/2026-07-16-act6-documentos.sql` (X1). X2/X3/X4/paridad no requirieron BD (columnas, RPCs y buckets ya existían).

### Dudas
Nuevas FAQ: documentos de flota, GPS de entrega, fotos de checklist/entrada/salida desde web, registrar entrega de vehículo y cerrar conduce desde web.

### Pendientes / notas
- **GPS y `foto_path` sin datos aún**: las entregas y salidas actuales tienen esos campos NULL (dependían de que la móvil los mandara). La web ya los muestra/permite; se poblarán con el uso.
- El **conductor** de una entrega registrada por web = el usuario que la crea (lo exige `crear_entrega_vehiculo`); las 6 fotos guiadas son obligatorias (validadas por el servidor).
- **Móvil (csd-app)**: PROMPT-14 pendiente — verificar paridad inversa (que la móvil mande GPS siempre que haya permiso, foto opcional en salida) en su repo.

---

## Actualización 5 (QA total) — ✅ EN PRODUCCIÓN

Source: `C:\developer\improvements\imp 14072026\CONTEXTO-ACTUALIZACION-5.md` (PROMPT-11, web).
BD = producción; todo QA con prefijo QA-TEST y limpieza. Reporte completo en **`QA-FINDINGS.md`**.
`main` @ `9487734` · deploy Vercel **READY** en sgcconstructorasd.com. Build OK.

### QA (discovery → corrección → E2E → limpieza)
- **Discovery**: auditoría estática + BD **read-only** (5 revisores en paralelo) cruzando reglas de CONTEXTO 1–4 → 0 críticos, 9 altos, ~24 medios, ~16 bajos, ~14 propuestas.
- **Corrección**: 9 altos + ~37 medios/bajos **resueltos** + fix de seguridad RLS `tareas: update` (WITH CHECK). Migración `sql/2026-07-16-qa5-fixes-db.sql` (QA-001 combustible estado, QA-010 recepción ≤ enviado, QA-028 talla al faltante, QA-074 RLS).
- **E2E Playwright** (dev-dep, no en build prod; harness en `qa/e2e/`, `playwright.config.ts`): gating de 9 roles (login + sin fugas) + salud de render de 65 páginas + verificación de fixes. Todo PASS. Reejecutar: crear `qa/qa-users.local.json` → `npx playwright test`.
- **Limpieza**: 9 usuarios QA-TEST creados para E2E y **eliminados** (0 residuos, verificado en usuarios/auth/vehículos/almacenes/artículos/proyectos).

### Propuestas aprobadas — implementadas (QA-070…080 + QA-032)
TI: costo/garantía/fecha + origen desde compra + equipos en ficha de empleado + datalist de puestos · Tareas: editar/reasignar (gestores) · RRHH: ausencia aprobada→asistencia (RPC idempotente) + KPI ausencias pendientes · Legal: enlace externo en expediente + comentario del revisor en columna propia · Compras: reconciliación recibido vs ordenado por ítem · Documentos: descargar Word (.doc) · menores WCAG/UX.
Migración `sql/2026-07-16-qa5-propuestas.sql` (tec_equipos +4 col, expedientes_legales.enlace, RPC registrar_asistencia_por_ausencia).

### Export a Excel (nuevo, transversal)
Util compartida `src/shared/utils/exportar-excel.util.ts` (xlsx, import dinámico) + botón "⬇️ Excel" (exporta lo filtrado; multi-hoja en reportes) en ~16 vistas: inventario (movimientos/conduces/salidas/entradas/artículos), flota (reportes/combustible/mantenimientos/vehículos), proyectos, auditoría, compras (órdenes/reportes/proveedores), rrhh (empleados/asistencia/ausencias), legal (expedientes/contratos), tareas (gestión/historial), tecnología. Bitácora ya lo tenía.

### Migraciones en prod (Act.5, aditivas/retrocompatibles, verificadas en vivo)
`sql/2026-07-16-qa5-fixes-db.sql` · `sql/2026-07-16-qa5-propuestas.sql`

### Pendientes / notas
- Menor QA-057: marcar una categoría **activa** como `destacada` (es dato, no código) si se desea el orden "destacadas primero".
- Proyectos Excel: gasto real / % pagado se cargan solo al abrir el detalle (no en el listado) → no van en el export de la lista.
- Opcional: E2E de happy-paths con escritura QA-TEST (editar tarea, Word, reconciliación) + limpieza.
- Móvil (csd-app) tiene una sesión paralela; nada de esta ronda aplica ahí.

---

## Actualización 4 (W1–W7) — ✅ COMMITEADO en rama; SQL en prod

Source: `C:\developer\improvements\imp 14072026\CONTEXTO-ACTUALIZACION-4.md` (PROMPT-9, web).
Rama: **`feat/actualizacion4-bitacora-auditoria-versiones`**. `npm run build` OK. SQL aplicado a prod
(3 migraciones). W3 (paridad app) = PROMPT-10, repo csd-app (no tocado aquí).

### Hecho
- **W1 fotos:** modelo ya soporta N; cap 10→40 (`parametros.bitacora_max_fotos`), galería multi + detalle muestra todas.
- **W2 equipos alquilados:** `bitacora_equipos_alquilados` + flag `bitacoras.hubo_equipos_alquilados`;
  RPC `crear_entrada_bitacora` extendido (params default; **overload viejo de 29 args eliminado**);
  UI en bitácora nueva (con sugerencias), detalle, Excel y dashboard (KPI + 2 barras). Equipos → `otros_valores`.
- **W6 auditoría:** RPC `auditoria_resumen` + panel analítico (tabs Panel/Filas, KPIs, 5 charts, drill-down).
- **W7 versiones auto:** `package.json` 1.8.0 + `scripts/gen-version.mjs` (hook prebuild/prestart → `src/environments/version.ts`);
  `registrar_version` idempotente; auto-registro web al arrancar (shell, **solo admins**); historial muestra versiones con solo `notas`.
- **W4 (regla de oro):** 8 datos ocultos surfaced (comentarios de aprobador/revisor, notas mant./combustible, nota artículo, color vehículo, hasta/notas miembro). Inventario completo + 4 (B) para decisión de negocio.
- **W5 skeletons:** +18 archivos / 20 puntos de carga.

### Migraciones en prod
`sql/2026-07-15-act4-bitacora-equipos-versiones.sql` · `-act4-auditoria-resumen.sql` · `-act4-review-fixes.sql`

### Revisión de código (workflow high) — 5 defectos, todos corregidos (en `-act4-review-fixes.sql` + auditoria.ts + shell.ts)
[1] registrar_version gated a is_admin (era SECURITY DEFINER abierto a cualquier autenticado) · [2] drill-down limpia filtros hermanos · [3] volver a Panel refresca agregados · [4] KPI módulos usa conteo real (no capado a 20) · [5] Filas carga perezosa.

### Pendientes
- **Merge a main + deploy** (según OK de Xavier).
- **W4 (B) decisiones de negocio:** firma de checklist en web, `articulos.subgrupo` como agrupador, enlace externo de expediente, fotos de mantenimiento en web.
- **W3 + lado móvil de W1/W2** = PROMPT-10 (csd-app).
- La versión web 1.8.0 se auto-registra cuando un **admin** abra el deploy.

---

## Actualización 3 (V1–V14) — ✅ COMMITEADO en rama, SIN merge/push/deploy

Source of truth: `C:\developer\improvements\imp 14072026\CONTEXTO-ACTUALIZACION-3.md` (+ PROMPT-7).
Rama: **`feat/actualizacion3-versionado-catalogo`** (commit `d44ecec`). `npm run build` OK.
**SQL YA aplicado a prod** (BD) y **edge function `notificar-version` desplegada**. Falta: merge a
main + deploy Vercel (pendiente OK de Xavier). Móvil (V2/V3-app/V5) = PROMPT-8 en csd-app.

### Hecho
- **V1/V2 (versiones):** causa raíz — web/BD **sí** persistía y `version_publicada()` **sí**
  reflejaba (verificado en prod: 1.4.0 publicada, 1.2.1 mínima). El síntoma "no cambia en csd app"
  es del **consumo móvil** (comparaba versiones como string). Endurecido BD: `app_versiones.version_code`
  + `sgc.semver_code()` + trigger; `version_publicada()` elige por **semver real** y devuelve
  `apk_url`/`version_code`/`version_minima_code`. Web ordena por semver.
- **V3/V4:** subida de APK (bucket `app-releases`, política escritura admin) con barra de progreso
  (XHR); al Publicar → `notificar_todos()` in-app + edge `notificar-version` (correo BCC, no bloqueante).
- **V14 catálogo:** 8 categorías oficiales (180 artículos), `requiere_talla`/`nota`/`subgrupo`/`orden`
  en `articulos`. 12 matches reasignados (histórico intacto), **77 → "(Revisión)" desactivada**.
  Talla obligatoria en salida/requisición (viaja en jsonb del detalle; RPCs sin cambiar firma).
  08 Otros → `otros_valores`. Admin de artículos con talla/nota.
- **V7:** `<app-skeleton>` en 44 páginas más. **V8:** conteo "todo conforme" (param opcional retrocompat).
  **V9:** filtro por obra en `bodegas`. **V10:** ya cumplía (pool completo, sin guard, conteo por vehículo).
  **V13:** requisición reingeniería → catálogo por categoría + resumen editable + Otros + talla.
- FAQ de Dudas actualizado.

### Migraciones aplicadas a prod (verificadas)
`sql/2026-07-15-version-semver-code.sql` · `-app-releases-upload-notify.sql` ·
`-catalogo-oficial-materiales.sql` · `-talla-en-movimientos.sql` · `-conteo-todo-conforme.sql` ·
`-act3-review-fixes.sql` (correcciones de la revisión).

### Revisión de código (workflow high-effort) — 9 defectos, todos atendidos (commit cb77936)
[1] gate is_admin en notificar-version · [2] talla arrastrada a aprobación/conduce · [3] version_publicada
por semver del string (no version_code) · [4] rollback = despublicar (por diseño) · [5] drop overload
4-arg de registrar_conteo_app · [6] correo en lotes de 45 · [7] notificar_todos ruta null · [8] botón
descargar usa apk_url real · [9] cache-control 60s en subida de APK.

### Pendientes / notas
- **Merge a main + deploy Vercel** — esperando OK de Xavier.
- **77 artículos en "(Revisión)"**: varios son el MISMO artículo con nombre distinto (no se
  fusionaron para no corromper stock) — homologar a mano. Basura/test a borrar: "TEST Artículo…",
  "aguacate/no se". Ver Inventario > Artículos, filtro categoría "(Revisión)".
- **Correo de versión**: depende de Resend key en Vault (ya usada por notificar-flota); si falta, skip.
- QA en navegador: publicar versión con APK (progreso + notificación), catálogo 8 cats + tallas EPP,
  requisición con resumen, filtro almacén por obra, conteo "todo conforme".
- Móvil (V2/V3/V5 firma/keystore/rolling update) = PROMPT-8 (csd-app).

---

## Actualización 2 (QA + mejoras U1–U25) — ✅ MERGED a main + DESPLEGADO a prod

Source of truth: `C:\developer\improvements\imp 14072026\CONTEXTO-ACTUALIZACION-2.md` (+ `-1` §B).
Merged (`3c897e8`) a `main` y desplegado a **sgcconstructorasd.com** (Vercel dpl READY, ~40s,
alias de prod OK, HTTP 200). SQL aplicado/verificado en prod. Todo aditivo/retrocompatible.
Móvil (U24 = PROMPT-6) pendiente en csd-app.

### Rematado en esta sesión (lo que faltaba tras los commits F0–F5)
- **U8 reporte semanal** (causa raíz: el dashboard solo cuenta plantillas `frecuencia='semanal'`
  y el chofer llenaba pre-uso auto-sugerido). Fix UI: botones separados **«Nuevo pre-uso»** y
  **«Reporte semanal»** en `flota/checklists`; el `<select>` de plantilla ahora agrupa por
  frecuencia (optgroup + badge); título del drawer según frecuencia; `flota/reporte-semanal` trae
  CTA **«Llenar reporte semanal»** (→ `checklists?frecuencia=semanal`, preselecciona la plantilla) +
  nota que explica la diferencia con el pre-uso. `ChecklistPlantilla.frecuencia` expuesto al front.
- **U9 barrido de fechas**: `conductores` (ISO cruda de licencia + teléfono formateado en el
  listado), `weather-card` (`.slice(5)` → `formatDiaCorto`), `shell.tiempoRelativo` → util,
  admin `usuarios`/`reportes` y `soporte` (pipes con mes en inglés `MMM` → util es-DO). Nuevos
  helpers en `fecha.util.ts`: `formatFechaMedia`, `formatDiaCorto`. (Los `| date:'dd/MM/yyyy'`
  restantes ya son legibles; se dejaron.)
- **U6 foto en selectores**: nuevo componente reutilizable `shared/components/vehiculo-picker`
  (combobox con thumbnail, CVA para formularios + modo `[value]` suelto). Reemplaza los `<select>`
  de vehículo en `checklists`, `combustible` (filtro + form) y `rutas`.
- **U16 movimientos por almacén**: `inventario/movimientos` acepta `?bodega=`; fila de `bodegas`
  con acción **«Ver movimientos»** filtrada. (Conduce ya se genera desde cada salida; las entradas
  no generan conduce — decisión de diseño: el conduce es documento de despacho.)
- **U17 foto en compras tecnológico**: `solicitud_compra_items.foto_path` (aditivo) + RPC
  `crear_solicitud_compra_tec` extendida (lee `foto_path`, firma text/jsonb intacta) + foto por
  renglón en el form + drawer de detalle con thumbnails (bucket `inventario`, path `compra-tec/`).
- **U25 «Otro/s» cableado + avisos** (antes: `registrar_otro_valor` no se llamaba desde ningún
  flujo y no había avisos): trigger `trg_otro_restriccion` en `bitacora_restricciones` (registra el
  texto libre de restricción OTRO como `bitacora.restriccion`, cubre web+móvil); tabla dedup
  `otros_avisos` + función idempotente `evaluar_avisos_otros()` que crea notificaciones «crear
  opción oficial» a admin/tecnología/dirección al superar el umbral (3 en 30 días, config en
  `flota_config`); la página `admin/otros-valores` la invoca al cargar. **Verificado en prod con
  test rolled-back** (3 variantes → 1 grupo, umbral t, 4 notificaciones).

### Migraciones aplicadas a prod (todas verificadas)
- `sql/2026-07-15-actualizacion2-fase1.sql` (U10 PRE-USO-V3 10 tópicos, U22 geo bodegas, U5
  normalizar_telefono, U16 v_movimientos_inventario, U25 tabla+fn+vista+config).
- `sql/2026-07-15-actualizacion2-fase4.sql` (U11 CLIMA fuera de restricciones).
- `sql/2026-07-15-actualizacion2-fase5.sql` (U17 tec_equipos.foto_path **+** solicitud_compra_items.foto_path + RPC compras-tec).
- `sql/2026-07-15-actualizacion2-otros-wiring.sql` (U25 trigger + otros_avisos + evaluar_avisos_otros).

### Pendientes / notas
- **U25 «revisar opciones» (opciones predeterminadas sin uso)**: NO implementado — requiere un
  catálogo central de opciones por contexto que hoy no existe (las opciones viven en modelos del
  front). La parte primaria (valor repetido → aviso) sí está. Follow-up: registrar el catálogo de
  opciones por contexto para detectar las no usadas.
- **U10 críticos**: PRE-USO-V3 marca críticas las 5 de seguridad vial (1-5) por decisión previa;
  confirmar con el jefe cuáles bloquean.
- **U24 paridad móvil** (csd-app): fuera de este repo (PROMPT-6) — **siguiente entrega**.
- QA manual en navegador (prod ya vivo): probar reporte semanal (botón + CTA + conteo con
  plantilla de 10 tópicos), selector de vehículo con foto, movimientos por almacén, foto en
  compras-tec, y que los avisos de "Otro" lleguen a admin/tec/dirección.

---

## Historial de versiones (timeline admin) — ✅ en prod
Nueva feature transversal (web + móvil), **solo admin**. Fuente única: `sgc.app_versiones`
extendida (`sql/2026-07-14-app-versiones-timeline.sql`, aplicado): `plataforma` ('web'|'movil'),
`fecha`, `titulo`, `cambios jsonb`, unique (plataforma,version); `version_publicada()` ahora filtra
`plataforma='movil'` (el gate de rollout sigue siendo solo de la app). Seed histórico curado desde
git/HANDOFFs (7 versiones web + 9 móvil, incl. **1.4.0 móvil preparada, sin publicar**).
- **Web**: página `admin/historial-versiones` (tabs Web/App móvil, timeline con versión+fecha+cambios),
  ruta en `admin.routes.ts`, entrada en el nav del shell. `AppVersionesService.getHistorial()`;
  `getAll()`/`create()` de la gestión de rollout ahora se limitan a `plataforma='movil'`.
- La 1.4.0 móvil queda lista para publicar desde `admin/app-versiones` cuando quieras (R15).
Build verde. Móvil espeja esto (ver HANDOFF de csd-app).
- **v2 del timeline** (research de changelogs "Keep a Changelog"): `cambios` ahora es `[{t,d}]`
  con etiqueta de color (Nuevo/Mejora/Arreglo/Seguridad); filtro por tipo; resaltado "Actual".
  Columna `url` nueva: **web** → enlace al deploy Vercel de esa versión (poblado v1.4–v1.7, SSO
  del owner; viejas sin enlace, aplicar hacia adelante); **móvil** → `apk_url` a cada APK del bucket
  (los 10 existen). Timeline y gestión traen botón Descargar/Abrir por versión + "Descargar última
  versión" arriba de `admin/app-versiones`. Fechas reales de git (dev comprimido 06-30→07-14).
  Migraciones: `sql/2026-07-14-app-versiones-timeline{,-fix,-v2}.sql` (todas aplicadas).



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
