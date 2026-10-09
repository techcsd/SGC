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
