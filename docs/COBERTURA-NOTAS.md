# COBERTURA DE NOTAS — carpeta `imp 16102026` (16-oct 2026) — tanda CP (+ backfill de CO)

> **Regla:** cada párrafo que Xaviel pega aparece aquí una vez por tanda, con su ID, dónde vive, y su estado real.
>
> **Deuda cerrada esta sesión (CP10):** la tanda **CO** (`imp 14102026`, filas 211-228) nunca se agregó a la matriz del repo — el `HANDOFF.md` decía "nada commiteado" cuando en realidad CO ya estaba completo en prod (1.189.0) y hasta sus sucesores (1.190.0 recepción de OC, 1.190.1 reabrir OC) ya habían salido. Esta tabla cierra esa deuda con el estado **real**, verificado contra el repo y, donde aplicaba, contra prod directamente (ledger + RLS + datos).
>
> **Tanda CP** (16-oct): 8 párrafos nuevos (CP1-CP8) + 3 hallazgos (CP9-CP11) → filas 229-239. Mocks en `mock-cp\` (lienzo **"SGC + CSD App — Reuniones, Personal y Compa (CP)"**, OK dado 16-oct). Contexto `CONTEXTO-ACTUALIZACION-49.md`; prompts `PROMPT-100-SGC.md` / `PROMPT-101-CSD-APP.md`.

## CO (filas 211-228) — backfill, estado real al 16-oct

| # | Nota (literal, resumida) | ID | Dónde vive | Estado real (16-oct) |
|---|---|---|---|---|
| 211 | "la PWA está frizada en 2.45 y no sube; averiguar 2.44/2.45" | **CO1** | CONTEXTO-48 §A · PROMPT-98 F0/F4 | 🟡 Servidor (versión mínima por plataforma) ✅ prod 1.189.0. Arreglo del lado cliente (PWA auto-repara, `registerImmediately`, prefetch recortado) está en **app 2.51.0, en dev, sin publicar** — ver CP4/CP10. Android 2.44/2.45 (7 equipos) sigue sin arreglo remoto posible; WhatsApp pendiente (👤 Xaviel, desde el 08-oct). |
| 212 | "mostrar las updates news a pantalla completa al volver a entrar" | **CO2** | CONTEXTO-48 §B · PROMPT-98 F7 | ✅ Web en prod (overlay "Novedades", "arreglado para ti", 1.189.0). App: mismo contrato, dentro de 2.51.0 sin publicar. |
| 213 | "una echada de combustible se repitió 4 veces" | **CO3** | CONTEXTO-48 §C · PROMPT-98 F0-F1 | ✅ Causa (doble toque, bandera tardía) arreglada en servidor (anti-dup 120s, `registrar_combustible_app`) y en prod. **Data-fix de limpieza APLICADO en prod** (verificado hoy: las 4 filas de Manolo Durán ya están `invalidada=true`). Arreglo del lado cliente app (bandera en 1.ª línea) va en 2.51.0 sin publicar. |
| 214 | "Raykler no puede aprobar sus propias requisiciones" | **CO4** | CONTEXTO-48 §E · PROMPT-98 F2 | ✅ En prod. Permiso `requisicion_autoaprobar` **confirmado otorgado a Raykler Peña en prod** (verificado hoy). |
| 215 | "3 conduces salieron iguales" | **CO5** | CONTEXTO-48 §C · PROMPT-98 F0-F1 | ✅ Causa arreglada en servidor. **Data-fix de limpieza APLICADO en prod** (verificado hoy: los 2 conduces sobrantes ya están `anulado=true`, stock repuesto). |
| 216 | "Consultas de Compa: hacer lo que la gente pide" | **CO6** | CONTEXTO-48 §F · PROMPT-98 F8 | 🟡 Se agregó `web_search` (Anthropic) al asistente, en prod. Los tools específicos pedidos (`listar_requisiciones`, `leer_reporte_semanal_operaciones`) **no están confirmados en el código** — se re-revisan en FASE 4 de esta ronda (CP3/CP9 toca el mismo edge). |
| 217 | "Outbox atascado + Reportes de errores: arreglar y marcar" | **CO7** | CONTEXTO-48 §G · PROMPT-98 F5 | 🟡 Pantallas de Tecnología mejoradas (ver/resolver) en prod. El triage uno-por-uno de los grupos reales de prod (causa:archivo:línea por grupo) no quedó documentado como cerrado — pendiente de confirmar en una próxima sesión de Tecnología. |
| 218 | "Compras tecnológicas: adjuntar cotización PDF + mejor flujo" | **CO8** | CONTEXTO-48 §H · PROMPT-98 F12 | ✅ Web completo en prod (flujo borrador→aprobación→comprada, adjuntos, aprobador=Eduardo Ng — **confirmado hoy en prod**: parámetro `compras_tec_aprobador` = Eduardo NG). App: solo pantalla del aprobador — **no confirmada construida** (contrato en PARIDAD.md, PROMPT-99 pendiente). |
| 219 | "Apoyo de transporte: ver quién canceló y cambiar estado" | **CO9** | CONTEXTO-48 §I · PROMPT-98 F3 | ✅ En prod. |
| 220 | "iPhone: la cinta de notificaciones apagadas no hace nada" | **CO10** | CONTEXTO-48 §J · PROMPT-98 F6 | 🟡 Servidor Web Push real (VAPID, tabla, edge) ✅ en prod. Cliente (service worker + permiso navegador + cinta inteligente) **no se tocó esta ronda** — pendiente, es trabajo de app. |
| 221 | "Expedientes legales: faltan estilos" | **CO11** | CONTEXTO-48 §K · PROMPT-98 F9 | ✅ En prod (piel CB, pestañas, guard CL1 extendido). |
| 222 | "Plantillas de documentos: fácil sin explicación" | **CO12** | CONTEXTO-48 §L · PROMPT-98 F10 | ✅ En prod (listado con miniaturas, editor TipTap). |
| 223 | "Contratos ↔ Generar documento, vista previa, y la app" | **CO13** | CONTEXTO-48 §M · PROMPT-98 F11 | 🟡 Web completo en prod (`documento_generado_id`, 3 caminos, vista previa). **App: Legal y Documentos no están confirmados construidos** — `csd-app/src/app/pages/` no tenía estas carpetas al cierre de CO; verificar en próxima sesión de app. |
| 224 | "Editar plantilla: hoy es HTML crudo" | **CO14** | CONTEXTO-48 §L · PROMPT-98 F10 | ✅ En prod (editor TipTap con fichas de datos; HTML solo en "Avanzado"). |
| 225 | *(hallazgo)* El nº de recibo de combustible nunca se guarda desde la app | **CO15** | CONTEXTO-48 §D · PROMPT-98 F1 | ✅ En prod (`registrar_combustible_app` 23 args con `p_numero_recibo`). |
| 226 | *(hallazgo)* El doble toque crea duplicados en muchos formularios | **CO16** | CONTEXTO-48 §C.6 · PROMPT-98 F1 | 🟡 Guard `verify-envio-unico.mjs` creado (prebuild). El barrido completo de los 44 sitios con el patrón en la app es trabajo de `csd-app` — verificar cobertura real en la próxima sesión de app. |
| 227 | *(hallazgo)* La PWA de iPhone no tiene Web Push | **CO17** | CONTEXTO-48 §J · PROMPT-98 F6 | 🟡 Mismo estado que CO10 — servidor listo, cliente pendiente (app). |
| 228 | *(hallazgo)* Plantillas: el aviso de arriba y el formulario de subida se contradicen | **CO18** | CONTEXTO-48 §L.3 · PROMPT-98 F10 | ✅ En prod (un solo mensaje, detecta `{{campo}}` y «____»). |

**Importante — estado real de versiones (corrige al `HANDOFF.md` anterior, que decía "nada en dev/prod"):** `main` = `9c45dbe` → **web 1.190.1 en prod** (CO completo 1.189.0 + 1.190.0 recepción de OC sin catalogar + 1.190.1 reabrir OC recibida sin recepción real — estos 2 últimos son fixes posteriores a CO, fuera de esta ronda). `dev` = igual a `main`. **App: 2.51.0 en `dev`, sin publicar a prod** (prod sigue 2.50.0) — es el bloqueador real de CO1/CP4.

## CP (filas 229-239) — tanda nueva, 16-oct — ✅ **TODO EN PROD** (web 1.191.0, 16-oct)

| # | Nota (literal) | ID | Dónde vive | Estado |
|---|---|---|---|---|
| 229 | *"Lets improve the way "personal de obra" module look, it is missing some styles, and have some ui/ux issues."* | **CP1** | CONTEXTO-49 §A · mock `Main` · **PROMPT-100 F6** | ✅ En prod. Verificado visualmente con Playwright contra dev antes de promover. |
| 230 | *"lets add on "Compa" a way to share a conversation with a user, and me as an admin must be able to see the conversations of the users with compa."* | **CP2** | CONTEXTO-49 §B · mocks `Compa-compartir`/`Compa-admin` · **PROMPT-100 F5** | ✅ En prod. Compartir, "Compartidas conmigo", aviso fijo, Admin › Conversaciones de Compa — todo probado contra dev antes de promover. |
| 231 | *"Hector reports that compa has issues with the real tools that he has... that's a missing tool or reasoning from compa."* | **CP3** | CONTEXTO-49 §C · **PROMPT-100 F4** | ✅ En prod (edge `assistant` v26 + secreto `ASSISTANT_MODEL=claude-sonnet-5`). El caso real de Hector (listar_almacenes) ya no falla — 12/12 evals, verificado también con una llamada real en prod. |
| 232 | *"lets find out why the users when i upload a new version of the app cant update the app."* | **CP4** | CONTEXTO-49 §D · **PROMPT-100 F8 / PROMPT-101 F1** | 🟡 Parte web (diagnóstico + botón "Copiar WhatsApp") ✅ en prod. El arreglo real para Android 2.44/2.45 es físico (instalar encima) — 👤 Xaviel, sigue pendiente. |
| 233 | *"why we doesn't have a stagging? or the dev environment do the same thing?"* | **CP5** | CONTEXTO-49 §E · **PROMPT-100 F7** | ✅ En prod (`docs/STAGING.md`, `scripts/release-check.mjs`, cinta "Staging (dev)"). |
| 234 | *"in the app inside the "por despachar" module, these rows need to show the date to."* | **CP6** | CONTEXTO-49 §F · mock `Por-despachar-app` · **PROMPT-100 F3 / PROMPT-101 F2** | 🟡 Backend ✅ en prod. Tarjeta de la app sigue pendiente (PROMPT-101 F2, repo csd-app). |
| 235 | *"supabase report these issues [Security Definer View x2], let fix them."* | **CP7** | CONTEXTO-49 §G · **PROMPT-100 F2** | ✅ En prod. Las 2 vistas corregidas; verificado que admin/flota ven igual y un usuario sin acceso ahora ve 0 filas (antes veía todo). |
| 236 | *"Lets implement the "reuniones" module, and the notes that the users takes from that meets, lets see too how we can link the fireflies notes with the system."* | **CP8** | CONTEXTO-49 §H · mocks `Reuniones-lista`/`Reunion-ficha`/`Reunion-app` · **PROMPT-100 F9 / PROMPT-101 F5** | ✅ En prod (módulo completo: agenda, participantes, notas, acuerdos→tareas, actas, 3 tools de Compa). Probado de punta a punta con Playwright contra dev antes de promover. Fireflies/Calendar reales siguen pendientes de que Xaviel haga el setup físico (`docs/REUNIONES.md`). |
| 237 | *(hallazgo)* Compa corre con modelo pequeño, un archivo por turno, anuncia acciones que no hace, y ensucia Consultas con faltas falsas | **CP9** | CONTEXTO-49 §C · PROMPT-100 F4 | ✅ En prod — ver CP3. |
| 238 | *(hallazgo)* La ronda CO quedó a medias: app 2.51.0 sin publicar, docs desactualizados, data-fixes sin confirmar aplicados | **CP10** | CONTEXTO-49 §I · PROMPT-100 F0 | ✅ Resuelto — los 3 data-fixes de CO ya estaban aplicados (verificado), docs corregidos. La publicación de la app 2.51.0 es de `csd-app` (otro repo), no de esta ronda. |
| 239 | *(hallazgo)* 3 huecos de permisos que dejó CO (aprobador de compras, PDF firmado de contratos, Legal sin límite por obra) | **CP11** | CONTEXTO-49 §I · PROMPT-100 F1 | ✅ En prod. RLS de `solicitudes_compra` corregida (verificada con el usuario real de Eduardo Ng). Política `sgc-legal` ya estaba aplicada. Legal sin límite por obra: documentado como decisión en PARIDAD.md, 👤 confirmar con Sonia. |

**Pendientes físicos de Xaviel (tanda CP, los únicos que quedan — nada de código):**
1. WhatsApp a los 7 Android en 2.45 (pendiente desde el 08-oct) + reinstalar tu Samsung + Eduardo en persona — ya hay un botón "Copiar mensaje de WhatsApp" en `Admin › Versiones de la app` para esto.
2. Fireflies: crear `minutas@constructorasd.com`, asiento en el equipo Pro de la empresa, API key, webhook+secreto, pasar a Felipe al equipo.
3. Google Admin: permiso `calendar.events` a la cuenta de servicio (delegación de dominio).
4. Confirmar con Sonia si Legal debe limitarse por obra (hoy ve todas, es RLS sin límite — decisión documentada en PARIDAD.md, no aplicada aún como restricción).
5. App `csd-app`: publicar 2.51.0 a prod, y construir la tarjeta de "Por despachar" con fecha (CP6, PROMPT-101 F2) — trabajo de otro repo/sesión.

## CQ (filas 240-246) — tanda nueva, 16/17-oct — ✅ **TODO EN PROD** (web 1.193.0, 17-oct)

| # | Nota (literal) | ID | Dónde vive | Estado |
|---|---|---|---|---|
| 240 | *"lets improve the 'Compras tecnologicas' module... the cotization maded for it must be uploadable to the system."* | **CQ1** | CONTEXTO-50 §A · mock `Main` · **PROMPT-102 F3** | ✅ En prod. Página completa + edge `leer-cotizacion` desplegada y verificada en prod. Xaviel probó en dev antes de promover. |
| 241 | *"im still using the 'notepad' of Microsoft, to write my notes... no me acostumbro a ese dev notes."* | **CQ2** | CONTEXTO-50 §B · mock `Dev-notes` · **PROMPT-102 F5** | ✅ En prod. Pantalla completa, editor TipTap con formato real, Ctrl+N, autoguardado, "Mandar a ronda", 26 tests verdes. |
| 242 | *"lets improve too, the 'auditoria' module... in that module we have a error too, in the 'acciones de admin'."* | **CQ3** | CONTEXTO-50 §C · mock `Auditoria` · **PROMPT-102 F1, F4** | ✅ En prod. Bug real de "Acciones de admin" arreglado (ver CQ5); Auditoría rediseñada a 3 pestañas, verificado por objeto en prod (auditoria_frases con 138 filas, índices, columna `origen`). |
| 243 | *"ese mapeo que pasa al subir la plantilla de importar vehiculo, deberia de mapearse solo... arrastrar y dejar caer un archivo..."* | **CQ4** (a-g) | CONTEXTO-50 §D · mocks `Importar`/`Importar-resultado` · **PROMPT-102 F2** | ✅ En prod. Las 7 piezas (a-g), verificadas por objeto en prod (columnas nuevas de `vehiculos`/`conductores` confirmadas). |
| 244 | *(hallazgo)* El error de "Acciones de admin" ya se había arreglado una vez (CD2, 30-sep) en otra función y se repitió | **CQ5** | CONTEXTO-50 §C · PROMPT-102 F1.3-F1.4 | ✅ En prod. Barrido real completo: de 32 funciones plpgsql `returns table` en `sgc`/`public`, SOLO `audit_log_listado` tenía el defecto — arreglada y verificada en prod (`nombre::text` confirmado). Guard nuevo `verify-returns-table-casts.mjs` en `prebuild`. |
| 245 | *(hallazgo)* Dos sesiones de Claude Code trabajaron a la vez en la misma carpeta | **CQ6** | CONTEXTO-50 §E · PROMPT-102 F0.3 | ✅ `.claude/CLAUDE.md` gana sección "Sesiones en paralelo" (un worktree por sesión). Esta misma ronda se trabajó en worktree propio (`../SGC-cq`) siguiendo la regla nueva. |
| 246 | *(hallazgo)* Pendientes de CP: prueba del APK en el teléfono, y `cp8c` (foto de pizarra) sin aplicar en el padre | **CQ7** | CONTEXTO-50 §0, §E · PROMPT-102 F0.4 | ✅ `cp8c` en prod + vista mínima agregada en la web (antes el padre no mostraba la foto en ningún lado). La prueba del teléfono (Samsung) sigue siendo física, 👤 Xaviel. |

**Pendientes físicos de Xaviel (tanda CQ, los únicos que quedan — nada de código):**
1. 1-2 cotizaciones reales (PDF y foto) para probar `leer-cotizacion` con datos de verdad en producción.
2. Hacer la prueba del APK 2.54/2.55 en el Samsung (pendiente de CP/CQ7, no se puede automatizar).
