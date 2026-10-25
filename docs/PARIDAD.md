# PARIDAD web (SGC, padre) ↔ app (csd-app, hijo) — contratos tanda CI (tiendas)

> El **servidor es compartido** (misma base Supabase para web y app). En la tanda CI, la **mitad de servidor,
> legal y pública** la pone el **padre** (PROMPT-86); la app (hijo, PROMPT-87) **consume** estos contratos.
> Este documento es la lista de contratos que el hijo debe respetar. Fechado 07-oct-2026.

## Regla espejo para el `CLAUDE.md` del hijo (CI13)
Copiar al `CLAUDE.md` de `csd-app`:
> **CI13 — datos y terceros son documento vivo**: toda función que recoja un dato nuevo o use un tercero nuevo
> actualiza `docs/DATOS-Y-TERCEROS.md` (en el **padre**, fuente única) y avisa que la política y los formularios
> de tienda deben revisarse. El consentimiento de IA/ubicación-en-2.º-plano se verifica en el servidor (edges 403).

---

## 1. CI3 — Aceptación de políticas (versionada)
- Parámetros en `sgc.parametros`: `politica_privacidad_version`, `terminos_version` (texto, ej. `2026-10-07`).
- RPC **`sgc.politicas_pendientes()`** → `returns table(documento text, version text)` — documentos cuya versión vigente el usuario **no** ha aceptado. Vacío = nada pendiente.
- RPC **`sgc.aceptar_politica(p_documento text, p_version text, p_plataforma text)`** `returns void` — idempotente (índice único por usuario+documento+versión). `p_documento ∈ ('privacidad','terminos')`. `p_plataforma` ej. `'app-android'`, `'app-ios'`, `'web'`.
- App: tras login, si `politicas_pendientes()` no vacío → pantalla bloqueante (resumen + enlaces a `/politicas/*` + "Acepto"); único escape = cerrar sesión. Enlaces legales en login (pie) y en *Perfil › Acerca de*.

## 2. CI4 — Eliminación de cuenta
- RPC **`sgc.solicitar_eliminacion_cuenta(p_motivo text, p_plataforma text)`** `returns uuid` — usuario autenticado; idempotente (una pendiente por usuario); notifica a admin/tecnología.
- Tabla `sgc.solicitudes_eliminacion_cuenta` (estado `pendiente|procesada|rechazada`).
- App: *Perfil › Privacidad › "Solicitar eliminación de mi cuenta"* (confirmación: qué se borra, qué se conserva, ≤30 días).
- Edge pública **`solicitar-eliminacion`** (verify_jwt=false) para quien ya no tiene acceso (desde la web pública); la app usa el RPC autenticado.

## 3. CI10 — Consentimiento de IA
- Tabla `sgc.consentimientos (usuario_id, tipo ∈ ('ia','ubicacion_fondo'), otorgado bool, plataforma, actualizado_at)`.
- RPC **`sgc.mi_consentimiento(p_tipo text)`** → `returns boolean`.
- RPC **`sgc.set_consentimiento(p_tipo text, p_otorgado boolean, p_plataforma text)`** `returns void`.
- Helper servidor `sgc.tiene_consentimiento(p_usuario uuid, p_tipo text) returns boolean`.
- **Edges** `assistant`, `leer-recibo`, `transcribe-now`: si el usuario no tiene `ia` → **403 `{ error_code: 'sin_consentimiento_ia' }`** con mensaje humano. `transcribe-audio` (fondo): **salta** al usuario sin consentimiento (deja la nota "sin transcribir", no error).
- App: hoja "Asistente con inteligencia artificial" antes del primer uso (nombra Anthropic/Groq/OpenAI); "Ahora no" deja usar lo demás; revocar en *Perfil › Privacidad*. El cliente maneja el `error_code` en su wrapper de edges.

## 4. CI5 — Rastreo por estado del chofer
- RPC **`sgc.mi_config_tracking()`** ahora devuelve, además de `comparte, distancia_m, flush_seg, precision_max_m`, dos columnas **al final** (retrocompatible): **`estado text`** y **`rastrear boolean`** (= `comparte AND estado != 'inactivo'`).
- Servidor: `sgc.registrar_posiciones(jsonb)` **descarta** los puntos si el estado actual del usuario es `inactivo` (los cuenta en `sgc.gps_ingesta_log.desc_inactivo`).
- Parámetro `tracking_auto_inactivo_hora` (null = apagado) + cron que, si tiene valor, pasa a `inactivo` a quien no esté `en_ruta` a esa hora.
- App (hijo, PROMPT-87 F3): solo rastrea si `rastrear = true`; al abrir en Inactivo no arranca hasta elegir un estado de trabajo; aviso previo ("prominent disclosure") antes de pedir ubicación "todo el tiempo"; notificación persistente muestra el estado.

## 5. Enlaces de tienda
- Parámetros `sgc.parametros`: `play_store_url`, `app_store_url` (null hasta que existan).
- La app los lee para su hoja "Hay una versión nueva" / insignias; la web los muestra en `/app-movil`.

## 6. Rol revisor de tiendas
- Rol `revisor_tiendas` (`es_operativo=false`), alcance **OBRA DEMO** (datos ficticios). La app debe tratarlo como un usuario normal de solo lectura; nunca ve datos reales (lo garantiza la RLS del servidor). Credenciales en `docs/TIENDAS-REVISION.md` (hijo).

## 7. CK (PROMPT-90) — ficha chofer privado, retiro dañado, videos
- **`sgc.chofer_privado_detalle(p_usuario_id uuid) returns jsonb`** (DEFINER, gate `is_admin()/es_flota_elevado()`): `{ chofer, vigencias[], usos[], entregas[] (con fotos[]), echadas[] (foto_recibo_path/foto_tablero_path/foto_origen), inspecciones[] }`. Combustible/checklists enlazan por `conductores.id` (no usuario_id). Fotos en bucket `vehiculos`. La app puede reusar este RPC para la ficha del chofer privado.
- **bg4 retiro dañado:** `solicitudes_movimiento.es_danado boolean` (nuevo). `apoyo_transporte_crear(...)` lo guarda; **`apoyo_transporte_agregar_foto(...)`** ahora, en la 1.ª foto de un apoyo `retiro_material + es_danado`, genera un **borrador de retiro bg4** (`crear_retiro_material`, estado `pendiente`, motivo `'otro'`, NO toca cuarentena) y lo enlaza en `solicitudes_movimiento.retiro_material_id`. Idempotente; mejor esfuerzo (si falla no bloquea la foto). La app no cambia su llamada; el borrador se crea solo.
- **CK5 videos:** campos de video en `ayuda_contenido.contenido` (`video_path/poster_path/vtt_path/duracion_s/plataforma`), bucket privado `tutoriales` (lectura authenticated por URL firmada). La app (Soporte y ayuda) lee los mismos campos. **Solo videos de datos demo**: los gated (Inventario/Flota/Transporte) requieren demo-aislar las fuentes DEFINER antes de grabarse seguros.

## 9. Ronda CW (PROMPT-114, 23-oct-2026) — lo que PROMPT-115 (app) necesita saber

**Diagnóstico de fondo (FASE 0, prod solo lectura):** Carlos Encarnacion y Dallin
Vido (ambos `chofer_privado`) tienen fila activa en `sgc.conductores`, pero
**CERO vehículo en cualquier lado** (sin `conductores.vehiculo_id`, sin
`vehiculo_autorizaciones`, sin rutas creadas jamás, **sin ningún conduce en el
servidor — nunca, ni uno**, y sin registro de outbox atascado). Esto descarta la
hipótesis inicial de "conduces de prueba sin filtrar" o "permiso de rol
incoherente": el rol SÍ puede crear conduces/rutas (tiene fila `conductores`
activa), lo que falta es el vehículo. Para PROMPT-115, esto implica:
- Los conduces "fantasma" que Carlos ve en su teléfono **no existen en el
  servidor** → viven solo en el almacenamiento local/outbox de la app, y nunca
  llegaron a avisar que algo falló (si hubieran avisado, habría una fila en
  `sgc.outbox_atascados`, y no la hay). Investigar el lado cliente: caché
  local/IndexedDB con un conduce que el app considera "pendiente de sync" pero
  el servidor no conoce en absoluto (no es un conflicto de servidor que
  resolver — no hay nada del lado servidor que anular para este caso puntual).
- Si la app le ofrece a un chofer_privado un botón de "crear conduce" (logística
  de empresa), revisar que sea coherente con el diseño del rol: por diseño, un
  chofer_privado **no debería** ver Conduces (solo Rutas de su propio vehículo),
  salvo que Central le active el interruptor nuevo (ver abajo). Si la app
  siempre muestra el botón sin chequear esto, es un hueco de paridad a cerrar
  ahí (el servidor seguirá rechazando con un mensaje claro si de verdad no
  corresponde).

**Nuevo — interruptor "también conduces y rutas de empresa" (D5):**
`sgc.chofer_privado_permitir_transporte(p_usuario uuid, p_permitir boolean, p_motivo text)`
(gate `is_admin()/es_flota_elevado()`) da o quita el rol `chofer_transportista`
a un chofer privado sin tocar su rol `chofer_privado` (acumulativo). Reversible,
auditado en `sgc.audit_log` (`action='chofer_privado_permitir_transporte'`).
`sgc.listar_choferes_privados()` ahora devuelve también **`tiene_transportista
boolean`** (columna nueva al final) — si la app tiene su propia pantalla de
choferes privados, puede mostrar el mismo estado.

**Mensaje más claro al fallar por falta de vehículo:** `sgc.chofer_crear_ruta`
ahora distingue "elige un vehículo" (tiene opciones, no eligió) de "no tienes
ningún vehículo autorizado todavía — pide a Central" (cero opciones). Mismo
`errcode`/firma, solo cambia el texto — la app no necesita cambiar nada para
beneficiarse, pero si tiene su propio texto fijo para este error, conviene
alinearlo.

**CW4 — rendimiento por vehículo (si la app quiere mostrarlo):**
`sgc.reporte_rendimiento_vehiculos(p_desde date, p_hasta date, p_vehiculo_id uuid)`
(gate `is_admin()/tiene_modulo('flota')`, o `auth.uid() is null` para llamadas
server-to-server) devuelve rendimiento Σkm÷Σgal por vehículo con nivel de
`confianza` — mismo método en los dos lados si la app alguna vez lo necesita.
No hay equivalente hoy en la app; no es prioritario.

**CW5 — paridad del formulario de combustible:** la web ahora manda
`p_numero_recibo` al crear la echada (antes se leía del recibo y se
descartaba). Si la app YA manda `p_numero_recibo` en su `registrar_combustible_app`,
no cambia nada. Si no lo manda, considerar agregarlo (mismo campo, mismo RPC,
ya soportado desde CO15) para que "lo que lee la foto" también se guarde al
crear, no solo al editar después. Campo `producto` en la lectura del recibo
puede venir como texto libre ("gasolina premium", "GLP") — la web ahora lo
normaliza a `diesel|gasolina` (+`subtipo` si aplica) y, si no reconoce el
texto, lo deja como sugerencia en vez de forzar un valor inválido; si la app
tiene un selector de producto cerrado igual, aplicar la misma cautela.

**CW1 — "Conduces huérfanos" (nueva pantalla, solo web/admin):**
`sgc.conduces_huerfanos(p_dias_min int)` (solo lectura, gate
`is_admin()/es_flota_elevado()`) lista conduces atascados en "despachado" sin
confirmación hace N días. Es una herramienta de Central en la web
(`/admin/conduces-huerfanos`); no hay necesidad de nada análogo en la app.

---

## 8. CS (PROMPT-106, 19-oct-2026) — lo que el hijo puede reusar

Esta tanda fue **100% web** (Dev notes/grupos/imágenes son del repo padre; csd-app
usa un editor de notas más simple, contenteditable, sin TipTap — no se tocó).
Lo que SÍ es reusable por la app si hace falta:
- **`sgc.mis_sesiones()` / `sgc.cerrar_mi_sesion(p_id)`** (SECURITY DEFINER,
  sin service role): si la app alguna vez quiere una pantalla de "sesiones
  activas" (hoy no la tiene), son los mismos RPCs, sin cambios.
- **`sgc.notas.grupo_id`** (nuevo, nullable, `on delete set null`): aditivo —
  cualquier select/insert existente de la app sobre `notas` sigue funcionando
  igual sin tocarlo.
- **El conector de Claude (CS5) y "Mi calendario de Google" (CS10) son
  exclusivos de la web** — no aplican a la app (MCP es un servidor remoto, no
  algo que la app consuma; Fireflies/Calendar siguen siendo del lado servidor).

---

## 9. CX (PROMPT-116, 24-oct-2026) — lo que el hijo puede reusar / debe saber

Ronda 100% web/servidor; la contraparte de app es **PROMPT-117** (CX3.5 —
vista rápida de una requisición por despachar, sin iniciar el despacho). Lo
que SÍ cruza o es reusable:

- **CX3.4 — `articulo_despacho_id` en `solicitud_material_items`**: ya existía
  desde CJ7, pero la web no lo mostraba (el renglón libre se veía como texto
  libre para siempre aunque el artículo ya se hubiera vinculado al aprobar).
  El SELECT de `SolicitudesMaterialService` ahora embebe
  `articulo:articulos!solicitud_material_items_articulo_id_fkey(nombre)` y
  `articulo_despacho:articulos!solicitud_material_items_articulo_despacho_id_fkey(nombre)`
  — si la app lee esta misma tabla/vista para mostrar renglones de
  requisición, aplica el mismo embed (dos FKs a `articulos`, hay que
  desambiguar con `!fkey` o PostgREST rechaza el embed).
- **CX3.3 — `cleanUuid`/`sanitizeUuidFields`** (`shared/utils/uuid.util.ts`,
  ya existía desde CK6, no es nuevo): si la app tiene selects nativos con un
  sentinel "ninguno" que mande el string literal `"null"` a un parámetro
  uuid del servidor, el mismo patrón aplica (normalizar antes de enviar).
- **Lightbox con galería** (`shared/ui/lightbox`, antes de un solo `src`,
  ahora acepta `images[]` + `startIndex` con flechas/contador): es
  exclusivamente web (Angular); la app tiene su propio visor nativo, sin
  cambio necesario de su lado.
- **El conector de Claude (CX1/CX2) sigue siendo exclusivo de la web** — 9
  herramientas nuevas, todas `canales: ['mcp']` (ni siquiera Compa esta
  ronda). No hay nada que la app deba consumir aquí.
- **CX3.5 (web, confirmado)**: la bandeja de Requisiciones ya deja ver todos
  los renglones (artículo, cantidad, notas) con solo abrir el detalle — no
  hace falta "iniciar" ningún despacho para verlos. La app sí necesitaba esto
  (PROMPT-117): la pantalla de Despachos solo mostraba
  «REQ-… · obra · N renglón(es)» y exigía tocar "Despachar" para ver el
  contenido.

---

## 10. CY (PROMPT — continúa PROMPT-116, 25-oct-2026)

100% conector de Claude (fases 3-5 de la nota de Xaviel) — nada que la app
consuma. Las 18 herramientas nuevas son exclusivamente `canales: ['mcp']`
(servidor remoto que Claude Desktop usa, no algo que csd-app invoque). Detalle
en `supabase/functions/assistant/PERMISOS-TOOLS.md` §"CY".
