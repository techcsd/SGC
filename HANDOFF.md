# HANDOFF — SGC

## TL;DR — Ronda BM (PROMPT-40, 09/09/2026) — **7 migraciones APLICADAS a prod + verificadas**, web build verde SIN commit/deploy
Contexto: `C:\developer\improvements\septiembre 2026\imp 01092026\CONTEXTO-ACTUALIZACION-20.md` (§D = decisiones). **Xaviel dio GO a aplicar.**

**APLICADO 09-sep (verificado live):** `bm1` (RPC recreada, grant 20-args presente, 1 fila outbox_atascados→resuelta), `bm2` (buckets declarados, auditor ve 14), `bm3` (**probado en rollback: depósito=INSERTA_OK, persona=INSERTA_OK, estación-sin-tablero=RECHAZADO_OK**), `bm4` (grants authenticated presentes), `bm5` (columnas), `bm5b` (17 artículos: 6 atados + 11 paquetes con factor), `bm5c` (plumbing RPCs — grants preservados por create-or-replace). Server-side ⇒ app y web ya se benefician **sin deploy**.
**Web build verde SIN commit/deploy:** modelos `Articulo.unidad_paquete/factor_paquete` + `unidad_capturada/factor_aplicado` en salida/solicitud/detalle (el `.select('*')` ya trae las columnas).

**FASE 0 (2 min, resuelto):** la echada atascada de la captura (08-sep 14:27) NO era avería — era el **salto de km (1874 > 1000)**, un rechazo legítimo con `errcode 23514` que la app pinta "Problema del sistema". Confirmado en `sgc.app_error_reports` (`context.tipo_op='combustible'`) y 1 fila viva en `outbox_atascados`.

**Hecho (build verde + prebuild verde, SIN aplicar/deploy/commit):**
- **BM1** 🔴 (9ª regla — código de error = contrato). `sql/2026-09-09-bm1-combustible-canal-negocio.sql` (dry-run OK): `registrar_combustible_app` recreada — los 5 rechazos de negocio salen del canal de infra al **canal de datos** que el cliente YA honra: los 4 corregibles (galones/monto/kilometraje) → `sgc.error_campo` (**22023** → "Corregir"), el de autorización → **DR481** (dato + mensaje real). Verificado en prod: error_campo=22023, DR481 válido. **Server-side ⇒ app y web se benefician sin actualizar.** + BM4 grant de la firma de 20 args + telemetría cerrada (outbox_atascados combustible→resuelto).
- **BM3** 🔴 `sql/2026-09-09-bm3-trigger-tablero-variantes.sql`: el trigger `combustible_requiere_tablero` se gatea (`origen<>'deposito_obra' and not titular_es_persona`) → **echada de persona (2 fotos) y depósito en obra (1 foto) ya pueden insertar** (estaban muertas en prod).
- **BM4** 🔴 `sql/2026-09-09-bm4-grants-rpcs-vivas.sql`: grants explícitos a authenticated de 8 sobrecargas vivas sin grant en sql/ (crear_bitacora_app-41, crear_entrega_vehiculo-13, registrar_salida_inventario, recibir_conduce_app, crear_solicitud_app, notificar_modulo-7, incentivo_listado-3, incentivo_set_penalizacion). + auditor nuevo `scripts/audit-rpc-grants.mjs` en prebuild (rompe si un RPC del cliente no tiene NINGÚN grant a authenticated en sql/).
- **BM2** 🔴 `sql/2026-09-09-bm2-buckets-vehiculos-conduces-inventario.sql`: declara `vehiculos`/`conduces`/`inventario` (INSERT+SELECT+UPDATE idempotentes + `file_size_limit` 15MB — prod ya tenía las policies, sql/ no). Auditor `audit-buckets` **invertido**: bucket con upsert NO declarado en sql/ **rompe el build** (probado). Ahora ve 14 (antes 11 ciego a los 2 más usados).
- **Checklist** `docs/CHECKLIST-MIGRACIONES.md`: 9ª regla + 5-bis (bucket no declarado) + 5-ter (grant de sobrecarga viva).

**Hallazgos verificados vs prod (premisas del prompt corregidas):**
- `sgc-combustible` **NO está muerto**: BJ2c sube ahí la factura fiscal PDF de conciliación → se **conserva** (no retirar). §D-BM2 resuelto.
- `crear_solicitud_compra_tec`: sql/ tiene un create de **5 args no desplegado** (prod vive en 2 args). Posible migración pendiente/muerta — revisar.

**BM5 (FASE 4) — §D aprobado por Xaviel (factor+cantidad base · parsear+migrar empaques · mover a app-qty-input). Esquema+backfill construidos, dry-run OK:**
- `sql/2026-09-09-bm5-factor-empaque-schema.sql`: `articulos.unidad_paquete`+`factor_paquete` (check>0) + `solicitud_material_items`/`detalle_salidas`.`unidad_capturada`+`factor_aplicado` (NOT NULL default 1, pasa audit-notnull). `cantidad` SIEMPRE en base ⇒ stock/kardex/costeo intactos. Copia fontanería de `talla`.
- `sql/2026-09-09-bm5b-backfill-factor.sql` (⚠️ **lista a revisión**): 17 artículos parseados sin ambigüedad (17/17): CSD-02-001..006 ATADO ×120/80/60, CSD-03-001..011 PAQUETE ×50; siembra unidad `atado`; limpia `nota`. Dry-run verificado.
- **HECHO plumbing RPCs** (`bm5c`, aplicado): registrar_salida_inventario/_app + crear_solicitud_material/_app leen `unidad_capturada`/`factor_aplicado` del jsonb (cantidad en base). aprobar_requisicion (carry-through al despacho) = pendiente (el renglón ya guarda el factor).
- **HECHO UI web (build verde, SIN commit — verificar en browser antes de shippear):** control unidad/atado en **salidas** (`inventario/salidas`) y **requisición** (`bitacora/solicitudes-material`). Cuando `factor_paquete != null`, un `<select>` "por unidad / por <empaque> (×N)" + el stepper captura en esa unidad + helper "= N base". **Invariante de seguridad de stock:** `item.cantidad` SIEMPRE en base; el multiplicar ocurre en 2 métodos (`updateItemCantidad`, `setItemCaptura`) — artículos sin factor se comportan idéntico a antes (factor=1, sin selector) → radio de impacto = solo los 17 backfilled. Payload envía `unidad_capturada`/`factor_aplicado`. Modelos tipados + DecimalPipe.
- **FALTA:** verificación en browser del flujo atado (elegir PINO/TIES, "por atado", enviar salida → stock baja base) antes de commit/push; mover el control a `app-qty-input` (opcional, cierra TODO AU13); UI **app** (selector→`app-qty-input`) = PROMPT-41 FASE 2; carry-through del factor en aprobar_requisicion.
- **8 artículos-empaque existentes** (CSD-03-015/016, ALM-024, COC-011, OFI-016/021, OFI-003/004): fusión al factor = mover stock+refs (como AU18), necesita twin base confirmado → lista en bm5b, NO auto-migrado.

**§D ya decidido (sobre propuesta, reversible):** BM1 canal (error_campo+DR481), odómetro (rechazo corregible con lectura viva; fresh-fetch del cliente = app/PROMPT-41), telemetría (cerrada).

**Pendiente Xaviel:** (1) commit/push web (bump + release-notes) — el frontend NO es necesario para que los fixes server-side funcionen, pero los modelos tipados esperan commit; (2) construir la pasada de UI web (control unidad/atado) con verificación en browser; (3) revisar la fusión de los 8 artículos-empaque existentes; (4) app = PROMPT-41. Nota menor: `crear_solicitud_compra_tec` tiene un create 5-args en sql/ que prod no tiene (2-args) → migración pendiente/muerta a revisar.

---

## TL;DR — Ronda BL (PROMPT-38, 08/09/2026) — build verde, TODO en espera de OK para aplicar/deploy/commit

Contexto: `C:\developer\improvements\septiembre 2026\imp 01092026\CONTEXTO-ACTUALIZACION-19.md` (§E = decisiones).

**⚠️ Lección BL (otra vez): los 2 root-causes 🔴 del prompt son FALSOS en el servidor.**
- **BL1** (cédula↔email desync): **0 desincronizados** de 9; Manolo Duran sincronizado + **inició sesión ayer 07/09 15:52**, sin bloqueo. (Hay 2 "Manolo", ambos con fila de conductor → posible dup.)
- **BL2** (`tiene_modulo`): NO es SECURITY DEFINER **pero** `usuarios_roles`/`roles` tienen RLS con policies SELECT; probado bajo RLS: `tiene_modulo('flota')`=**true**, Manolo ve **9 veh/13 cond**, Wagner ve **11 obras**. El vacío es el `catalog.service` de la app que se traga errores → **PROMPT-39**.
- **BL10** Abraham = usuario real activo → app picker (usuarios_asignables), no dato.
- **BL5** los 54 los subió **Roberly Camacho** (import 31/08); 1 fila manual con `registrado_por` NULL.

**Hecho (build verde, SIN aplicar/deploy/commit):**
- **BL7** 🔴 resumen §6: RPC `resumen_flota_carga_semana` reescrita (migración `sql/2026-09-08-bl7-resumen-rendimiento.sql`, dry-run OK) → rendimiento por echada plausible (10/35/3/50 de flota_config) + estimado cascada T5; **L473027 ya NO sale 68.9, sale `datos insuficientes`**; galones/costo intactos. Edge `resumen-semanal-operaciones` §6: rendimiento+estimado por vehículo, formato es-DO (galones 2 dec, `1.234,56`, RD$).
- **BL3** `formatFechaHumanaConDia` (nueva, sin tocar la compartida de 9 pantallas); repuntadas solo historial-versiones + app-versiones.
- **BL6** seguimiento: leyenda `var(--sgc-surface)` (era blanco quemado) + hexes tokenizados; `fitToMarkers` excluye stale + maxZoom 15 + re-fit al cambiar conjunto; leyenda cerrada por defecto; botón "Ver todos".
- **BL9** badge "otra fecha" en historial (lista + banda) cuando `fecha < created_at::date`.
- **BL5** migración `sql/2026-09-08-bl5-personal-registrado-por-doc-norm.sql` (dry-run OK): trigger rellena `registrado_por`; columna generada `documento_numero_norm` + índice (1 grupo dup detectado = Edward Mota). UI: columna "Registró" + badge Import/Manual; KPIs Importados/Manuales.
- **BL1** edges (SIN deploy): `conductor-login` resuelve por `usuarios.cedula` (1 solo signIn), el 401 ya no es cajón de sastre (fallo de infra → 503/429, no cuenta intentos); `conductor-crear-acceso:163` desbloquea con cédula normalizada.

**Para aplicar (con OK):** 2 migraciones (bl7, bl5) + deploy 3 edges (resumen-semanal-operaciones, conductor-login, conductor-crear-acceso) + commit frontend (bump + release-notes).

**§E pendientes:** BL4 conteo físico (DIFERIDO — ver propuesta abajo); BL5 fusión de dups (Edward Mota, 1 grupo) + índice único + ocultar documento (AV4 §C/§E5); BL9 límite atrás + regenerar informe semanal + columna `capturado_en`; BL7 ¿avisar echada saltada?; BL2 picker vehículos excluir-en-uso; BL1 confirmar resolver-por-cédula.

**BL4 (conteo físico) — HECHO y APLICADO (web 1.123.0).** Migración `sql/2026-09-08-bl4-conteo-fisico.sql` aplicada + smoke E2E (guardar no mueve stock, aplicar cuadra a lo contado, deshacer restaura). Clave: `stock_movimientos_sigma` reescrita para **excluir `tipo='conteo_fisico'`** del término de conteos (así el conteo no es un movimiento; se reconcilia por apertura). Ciclo de vida `borrador→contado→aplicado/cancelado` (constraint), reanudable, conteo ciego opcional, `deshacer`. RPCs `conteo_fisico_abrir/guardar/cerrar/aplicar/deshacer/detalle` (gate `puede_operar_conteo` = admin OR submódulo inventario.conteos operar). Frontend: flujo "Conteo físico (stock real)" en `/inventario/conteos` (ya en el menú), con borrador+ciego+aplicar(motivo)+deshacer. Falta paridad app (PROMPT-39 FASE 6: lote sin-ledger + `ajusteRealStock` sin p_motivo).

<!-- propuesta original (cumplida): -->
**BL4 (conteo físico, propuesta original):** unir las dos mitades existentes — cerrar el conteo con `ajuste_real_lote` (NO toca ledger) **pero** registrando cabecera+items+motivo+auditoría; cabecera `conteos_inventario` con ciclo de vida (estado `borrador→contado→aplicado`, constraint regla 3, tipo `'conteo_fisico'`), snapshot al abrir, borrador reanudable; gate submódulo `inventario.conteos` (operar) para Raykler; dar entrada de menú a `/inventario/ajuste-real` (hoy huérfano). Reutiliza `conteos.ts` + `ajuste-real.ts` + modal AU1·P1. Decisiones §E: conteo ciego sí/no, aprobación y de quién, lote-app en esta ronda.



## TL;DR — Ronda BK (PROMPT-36, 07/09/2026) — **2 migraciones APLICADAS a prod + edge desplegado + smoke OK; frontend SIN commit/deploy**

**APLICADO 07/09 (con OK de Xaviel):**
- ✅ `sql/2026-09-07-bk5-config-knobs.sql` — tolerancias conciliación en `flota_config` (verificadas).
- ✅ `sql/2026-09-07-bk1-notif-panel-core.sql` — `notif_tipo` (28 tipos), `notif_regla.usuario_id`, `notif_permitida`, 7 emisores + `send_push` con rastro. Aplicada; **smoke `scripts/smoke-notif-panel.mjs` = OK** (apagar tipo a usuario → no inbox, rastro registrado, reactiva al quitar regla).
- ✅ Edge `resolve-maps-link` **desplegado** — live-test OK: coords-en-texto, `&query=` (link de la app) y texto con `%` ahora dan 200 (antes 400/422/500). **El fix del chofer es server-side → app y web se benefician sin actualizar.**
- **Compatibilidad verificada:** la UI vieja de `matriz-notificaciones` sigue funcionando (set_notif_regla 3-arg resuelve al 4-arg por default; notif_reglas devuelve cols extra ignoradas). Tolerancias seed = defaults → comportamiento sin cambios hasta el próximo deploy web.

**SHIPPED web 1.116.0** (commit a5d7988, push main → Vercel): frontend de FASE 2/3/4 (Config unificada, picker maps, conciliación leyendo tolerancias).

**SHIPPED web 1.117.0** (push main → Vercel): **FASE 1 frontend (panel de notificaciones).**
- `admin/matriz-notificaciones`: nueva sección "Reglas por rol y por usuario" — apagar/encender un tipo para un rol o para una persona (buscador sobre `directorio_usuarios`), precedencia usuario>rol>global; lista de reglas específicas con toggle. Catálogo desde la tabla (28 tipos). El rastro ya muestra `silenciada`/`fuera_de_matriz`.
- `ajustes-notificaciones` (web): las categorías silenciables salen del catálogo tabla (`notif_tipo` where not es_operativa), fallback a la lista vieja. Incluye chat/notas/etc.
- Servicios: `NotifMatrizService.setRegla(...,usuarioId)`, `usuariosDirectorio()`, `NotifRegla`+usuario; `NotificacionesCentroService.catalogoInformativas()`.

**SHIPPED web 1.118.0 — FASE 5 (BK3 padrón de Desempeño).** Migración `sql/2026-09-07-bk3-incentivo-padron.sql` **APLICADA** (dry-run OK, behavior-preserving: `padron_es_chofer`=8 == `rol_choferes`=8; Misael en padrón `es_chofer=false`). Probado (rollback): flip `es_chofer` de Misael → el motor lo incluye. Tabla `incentivo_participante (usuario_id PK, participa, es_chofer, motivo, audit)`; setter `set_incentivo_participante`; `es_chofer()` = padrón OR rol; `incentivo_participantes()`/`incentivo_candidatos()`/motor/`incentivo_listado`/`incentivo_matriz_email` gatean por el padrón; `set_participa_incentivo` (conductor) redirige al padrón. Frontend: en `/incentivos` → Participantes, botón **"Agregar persona"** (picker sobre usuarios) + badge **Chofer/No chofer** clickeable. **Histórico NO regenerado** (decisión Xaviel). Pendiente menor: guard `/mi-rendimiento` sigue por rol (admite chofer+jefe_flota; Misael entra por jefe_flota; RLS limita a su puntaje) — refinar a `es_chofer()` async si se agrega un padrón sin rol.

**SHIPPED web 1.119.0 — FASE 6 (BK4 reporte diario 8am).** Migración `sql/2026-09-07-bk4-incentivo-diario.sql` **APLICADA** (dry-run OK). Tabla `incentivo_dia` (aparte de `incentivo_semana`, NO toca pago); `incentivo_generar_dia(fecha)` = actividad cruda ponderada, gate padrón es_chofer, SIN cumplió/cuarentena; `destinatarios_informe_diario()` con param propio `incentivo_diario_roles`; `incentivo_dia_listado(fecha)` para la vista. Edge **`incentivo-diario` desplegado** (HTML, sin PDF, sin escribir incentivo_envio). Cron **`sgc-incentivo-diario` `0 12 * * *` (8am RD) programado** (jobid 35) → `incentivo_cron_diario()` genera el día anterior + invoca la edge. Frontend: /incentivos → **"Actividad diaria"** con selector de fecha (AT11). `incentivo_cron_lunes` NO tenía bug de isoweek (EXTRACT(WEEK)=ISO en PG) → no se tocó. Decisiones §F aplicadas: sin cumplió, param propio, sin PDF.

**SHIPPED web 1.120.0 — Misael chofer + destinatarios diario editables (solicitud Xaviel).** Migración `sql/2026-09-07-bk3bk4-misael-destinatarios.sql` APLICADA: Misael `es_chofer=true` (puntúa desde la semana en curso); destinatarios del diario ahora por **lista de usuarios** (`incentivo_diario_usuarios`) UNION roles (`incentivo_diario_roles`), configurado **solo Eduardo NG** (2725c827). RPCs `incentivo_diario_destinatarios()`/`set_incentivo_diario_destinatario(usuario,incluir)`; UI en /incentivos → Actividad diaria → "Quién recibe el correo diario" (picker agregar/quitar). `destinatarios_informe_diario()` reescrito (usuarios+roles).

**SHIPPED web 1.121.0 — FASE 1 CERRADA (web).** Migración `sql/2026-09-07-bk1b-retirar-notif-config-email-matriz.sql` APLICADA (dry-run OK):
- **`notificaciones_config` RETIRADA**: sus 7 eventos migrados a `notif_tipo` (canal via `canales[]`+`activo`). Los 2 consumidores reimplantados sobre `notif_tipo`: `obra_notif_activo(evento,canal)` y `tg_reporte_usuario_notifica` (soporte). Tabla **dropeada**. Pantalla `admin/notificaciones` + servicio `notificaciones-config.service` **borrados**; ruta redirige a `matriz-notificaciones`; nav actualizado (label "Configuración del sistema" para parámetros).
- **Correo en la matriz**: tipos nuevos `informe_incentivo`/`informe_incentivo_diario`/`resumen_operaciones` (canal email); los 3 resolvedores (`destinatarios_informe_incentivo`/`_diario`/`_resumen_operaciones`) filtran por canal email del tipo + `notif_permitida` (rol/usuario). `set_notif_tipo_canales(tipo,canales,activo)` RPC.
- **UI matriz**: sección "Tipos de aviso" ahora es tabla con Encendido (regla global) + checkboxes de canal (Campana/Push/Correo) por tipo.

**FASE 1 restante (solo app / PROMPT-37):** app `avisos.ts` que lea el catálogo desde la tabla. Los edges `notificar-*` de obra ya respetan la matriz vía `obra_notif_activo` (canales).

---

## Detalle BK (build verde; lo de arriba ya está en prod)

Contexto real: `C:\developer\improvements\septiembre 2026\imp 01092026\CONTEXTO-ACTUALIZACION-18.md` (§F = decisiones). Se hizo **FASE 0, 2, 3 y 4-parcial**. Faltan **FASE 1 (panel notif), 5 (padrón), 6 (reporte diario)** — grandes, tocan pago/notif, requieren §F.

**⚠️ Lección BK: el CONTEXTO-18 sobreestimó los problemas — verificar cada premisa contra prod antes de construir.** 5 premisas resultaron inexactas: (1) las 26 claves NO estaban huérfanas (ya sembradas en `flota_config`+`parametros`; el hueco real = `admin/parametros` leía UNA tabla); (2) el cron `recordatorio-reporte-semanal-dia` NO está duplicado (upsert por nombre) y su 22×/domingo es **intencional** (AL6, sólo alarma a los pendientes); (3) el form de `incentivo_config` **ya existe y funciona** (`incentivos.ts:458`, muestra versión); (4) `incentivo_set_config` **ya existe** en prod; (5) Misael **sí** está en `conductores` (el bloqueo real es el gate por rol `chofer_transportista`, no el padrón).

**FASE 0 (diagnóstico):** `FCM_SERVICE_ACCOUNT_JSON` **SÍ está configurado** — `notif_entregas` = 421 push `enviada`, 0 `omitida/fcm_apagado`, último hoy. El push entrega; cualquier "no me llegó" es por-usuario (device token / matriz), no un apagón global.

**FASE 2 (BK2 maps) — hecho, build verde, edge SIN desplegar:**
- `supabase/functions/resolve-maps-link/index.ts`: extrae la 1ª URL de un texto (el bug del chofer "Nombre\nURL"), acepta links sin esquema, `try/catch` en `decodeURIComponent` (el 500 por `%`), patrones `&query=` (el que la app genera), `?daddr=`, `geo:`, plus-codes→Places, y `note:"Tomé el link del mensaje"`. **12 casos probados** (`scratchpad/test-maps.mjs`, todos pasan).
- Web `location-picker.ts`: al recibir `suggest_query` prellena el buscador y busca (paridad con `lugar-picker` de la app). **App (`location-picker` de crear-ruta) = PROMPT-37.**

**FASE 3 (BK5a config) — hecho, build verde, SIN migración (no hacía falta):** `admin/parametros` reescrita como **"Configuración del sistema"** unificada: muestra `parametros` **y** `flota_config` juntas, agrupadas por área, con tipo + validación + input correcto por clave (catálogo nuevo `src/shared/config/parametros-catalogo.ts`). `flota` se guarda por `set_flota_config`, `parametros` por update directo. Cumple §D(a)+(g). Título arreglado.

**FASE 4 (BK5) — parcial, build verde, migración `sql/2026-09-07-bk5-config-knobs.sql` SIN aplicar:**
- **Tolerancias de conciliación** (`DIAS/GAL/MONTO`) → `flota_config` (público-legible) + leídas en `conciliacion-combustible.ts` vía `FlotaConfigService` + en el catálogo (editables en la Config unificada). Migración siembra las 3.
- **`docs/CRONS.md`** — inventario de los 26 crons con hora RD + la nota de que el "duplicado" no lo es.
- **Deferidos (documentados):** `kpi_config` (necesita su propio form para no nacer como tabla/RPC sin llamador — regla 6.5); **knob único de mínimo de fotos** (toca 2 overloads de `crear_bitacora_app` + RPC web + clientes app / PROMPT-37, path caliente de data de obra).

**RLS clave descubierta:** `flota_config` SELECT = `true` (todos); `parametros` SELECT = `is_admin() OR tiene_modulo('direccion')`. ⇒ cualquier config leída client-side por no-admins (KPI, min-fotos) debe ir en tabla público-legible o RPC DEFINER, **nunca** en `parametros`.

**FASE 1 (BK1 panel notif) — BACKEND CORE hecho, validado (begin/rollback OK), SIN aplicar.** Decisiones de Xaviel: **una tabla de reglas unificada** (usuario>rol>global) + **retirar `notificaciones_config`**. Migración `sql/2026-09-07-bk1-notif-panel-core.sql`:
- `sgc.notif_tipo` (tabla catálogo) sembrada con los 13 + los ~16 que se emitían sin poder apagarse (mensaje, soporte, nota_compartida, las 2 alarmas dominicales, echada_duplicada, etc.); `notif_tipos_catalogo()` pasa a wrapper sobre la tabla (misma firma).
- `notif_regla` + `usuario_id` (nullable) + índice único `ux_notif_regla_scope` (tipo,rol,usuario) + `notif_regla_audit`.
- **`sgc.notif_permitida(usuario,tipo)`** (precedencia usuario>rol>global vía `notif_regla_habilitado` + silencio propio) — el predicado ÚNICO.
- **Los 7 emisores lo consultan** (era el fix): `notificar`, `notificar_modulo` (5+7arg), `notificar_rol`, `notificar_flota_elevado`, `notificar_todos`, `trg_app_version_push` — el INBOX ahora respeta la regla, no sólo el push.
- `send_push` usa `notif_permitida` y **registra `silenciada`/`fuera_de_matriz`** en `notif_entregas` antes de descartar (el panel ya puede responder "¿por qué no le llegó?").
- `notificar_flota_elevado` deja de tener roles hardcodeados → parámetro `aviso_flota_elevado_roles`.
- `notif_reglas()`/`set_notif_regla()` extendidos a nivel usuario (+ auditoría). Se dropea la vieja `set_notif_regla(text,text,boolean)` (usaba el índice retirado).
- Smoke listo: `scripts/smoke-notif-panel.mjs` (corre TRAS aplicar).

**FASE 1 — FALTA (chunk siguiente, todo frontend/edges):** (1) pantalla `admin/matriz-notificaciones` ampliada a tipos×global/rol/**usuario** con buscador de usuario + motivo + auditoría + rastro (copiar patrón `admin/roles`) y quitar el `null` clavado (`matriz-notificaciones.ts:104`, `:88`); (2) web `ajustes-notificaciones.ts` y app `avisos.ts` leen el catálogo de la tabla (hoy hardcodeado, ya divergido); (3) **retirar `notificaciones_config`** + pantalla `admin/notificaciones` (migrar sus 7 eventos al catálogo); (4) el correo entra a la matriz (9 edges `notificar-*`/incentivo/resumen, al menos por tipo+rol) + UI para los CSV de destinatarios.

**§F pendientes para FASES 5/6** (del CONTEXTO-18): forma del panel notif (propuesta: una tabla de reglas con precedencia usuario>rol>global + correo en la matriz); `notificaciones_config` absorber/retirar; ¿los ~16 tipos sin catalogar entran todos? (prop: sí); `es_chofer` sólo declara para incentivo (prop: sí); regenerar histórico de Misael (toca pago); paridad app de participantes/BF3; `cumplio` diario (prop: quitar); destinatarios diario (prop: parámetro propio); ¿diario con PDF? (prop: no); `umbral_licencia_dias` 30 vs 90 (BD=30 gana hoy).

**Para aplicar (con OK):** 1 migración (`bk5-config-knobs`), desplegar edge `resolve-maps-link`, y al shippear: bump `package.json` + entrada en `release-notes.json`.

---

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
lazy + worker como asset. El PDF real está **gitignoreado** (datos fiscales).
**BJ2b — mapeo cerrado (web 1.114.0, commit ac3f8ad):** tabla `combustible_tarjeta_map` +
RPCs listar/set (DEFINER, gate `es_flota_elevado`) **APLICADA + smoke por rol** (Raykler mapea;
chofer negado); panel «Tarjetas del PDF» en la vista previa asigna vehículo por tarjeta (se
aprende una vez) → las de persona ya no caen a `solo_informe`.
**BJ2c — follow-ups CERRADOS (web 1.115.0, commit 80f3b82, migración APLICADA + smoke):**
se guarda la factura PDF original (bucket privado `sgc-combustible`, `conciliaciones_combustible.pdf_path`);
se persiste la columna **Alerta** (FR/H/J/X/Y/Z) por transacción; el `vehiculo_id` resuelto por el
mapeo queda pegado a cada transacción; panel de **cuadre por producto** en la vista previa.
**BJ2 queda 100% cerrado.**

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
