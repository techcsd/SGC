# PROMPT-19 (IDs AT) — Hallazgos, diagnósticos y entregables

Ronda 18/08/2026. Complementa el workstream de tracking AS1. Todo aditivo/retrocompatible.
Base de datos: cambios de BD **aplicados a prod** (RPCs aditivas + fixes de datos). Web **sin commit/deploy** (pendiente OK de Xaviel).

---

## AT2 — "Ver trayecto en vivo → esta ruta todavía no tiene puntos de GPS" (DIAGNÓSTICO)

**El mensaje es VERÍDICO** para las 2 rutas activas de hoy, no es un bug del front:
- La RPC `ruta_breadcrumb_vivo` ya tiene el *fallback de jornada* (AJ14): si los puntos no traen `ruta_id`,
  usa los del `usuario_id` del conductor desde `iniciada_at`. Funciona: 1.609 de 2.386 puntos sí tienen `ruta_id`.
- Ruta de **Papo** (iniciada hoy 14:04): su última posición es del **11/08** → su app dejó de capturar hace ~6 días.
- Ruta de **Test User 3**: nunca envió una sola posición.
- Mientras tanto **Misael** y **Joan López** SÍ están capturando ahora mismo, pero con `ruta_id NULL`
  (tracking de jornada, no de ruta). Esa data no tenía dónde verse → nace AT1 (recorrido diario).

**Causa raíz:** captura del lado de la **app** (csd-app / PROMPT-20): (a) esos choferes no están enviando
posición en ruta, y (b) cuando capturan, no adjuntan `ruta_id`. El lado web ya hace lo correcto.
**Acción web (hecha):** el recorrido diario (AT1) permite ver el trayecto de un chofer aunque su ruta no tenga
puntos etiquetados. **Pendiente app (PROMPT-20):** que la captura adjunte `ruta_id` y siga viva en segundo plano.

---

## AT6 — Almacenes desactivados y sin obra (DIAGNÓSTICO — NO requiere migración)

Los **8 almacenes inactivos** (`911`, `City Place`, `Inter Plaza`, `Monterezzo`, `Olea`, `Poseidonia`,
`Romo`, `Volare`) son **duplicados legacy de nombre corto** que el saneo **AR3** desactivó. Cada uno ya tiene
su reemplazo canónico **activo y vinculado a su obra**:

| Inactivo (legacy) | Reemplazo activo vinculado a obra |
|---|---|
| 911 | Almacén ROSCH - Edif Adm 911 |
| City Place | Almacén BEST IN PRO - City Place |
| Inter Plaza | Almacén BATCON - Interplaza |
| Monterezzo | Almacén VISTA CANA - Monterezzo |
| Olea | Almacén BLUEWAVE - Olea |
| Poseidonia | Almacén NOVAL - Poseidonia |
| Romo | Almacén ASA - Residencial Romo |
| Volare | Almacén BLUEWAVE - Volares |

- **Ninguno tiene stock** (0 filas en `stock_por_bodega`) → nada quedó varado.
- Los **15 almacenes activos** SÍ están todos vinculados a su `proyecto_id` (+ Bodega Central sin obra, correcto).
- **Conclusión:** no hay mapeo masivo que aplicar. Se dejan desactivados (recomendado). Si quieres, se pueden
  borrar los 8 vacíos para que no confundan — dime y lo hago. El editor AS12 sigue para mantenimiento manual.

---

## AT8 — Cronograma E2E "Riviera Bay TEST" (PREPARADO — bloqueado por conversión .mpp)

- ✅ Proyecto **"Riviera Bay TEST"** creado (`es_prueba=true`, código `TEST-RIVIERA`, id `30549728-…`).
- ⚠️ El importador (`/proyectos/:id/cronograma-import`, parser AS21) acepta **.xlsx / .xls / .csv**, NO el `.mpp`
  binario de MS Project (el propio importador lo indica y guía a exportar). No puedo convertir el `.mpp` sin
  MS Project.
- **Pasos para cerrar (Xaviel):** abre `CRONOGRAMA RIVIERA BAY 2.mpp` en MS Project → *Guardar como / Exportar* a
  Excel (.xlsx) → en SGC entra a **Proyectos › Riviera Bay TEST › Cronograma › Importar** → sube el .xlsx →
  revisa el *preview* → confirma. Luego repite para validar el *re-import* (diff). Con el .xlsx me lo pasas y
  valido actividades/fechas/responsables contra el archivo.

---

## AT11 — ⭐ REGLA MADRE: toda data enviada debe poder visualizarse (auditoría inicial)

Regla adoptada como **definición de hecho permanente**: ningún formulario/envío está terminado sin una vista.

**Corregido esta ronda:**
- Tracking de jornada (posiciones con `ruta_id NULL`) → **antes invisible**, ahora se ve en **Recorrido diario** (AT1).

**Candidatos detectados con vista OK (verificados):**
- Notas de voz / audio (`audio_notas`) → se ven en Bitácora › Historial y en Checklists (transcripción + audio). ✅

**Pendientes de revisar a fondo (siguiente ronda, propuesta):**
- Respuestas de **checklists antiguos** de vehículo previos a la vista de detalle actual (confirmar que todos
  los `checklist_vehiculo_respuestas` históricos son navegables).
- Evidencias/observaciones de algunos **reportes semanales** viejos.
- Cualquier RPC `registrar_*/crear_*` nueva DEBE nacer con su vista — checklist de PR: "¿dónde se ve esta data?".

---

## AT16 — Stickers (DISEÑO listo, implementación diferida por decisión de pack)

Marcado ⚠️ en el prompt: **Xaviel debe definir el pack predeterminado**. Diseño v1 propuesto (para construir
en cuanto confirmes el pack):

- **Tablas:** `sgc.sticker_packs(id, nombre, es_sistema, creado_por, created_at)` +
  `sgc.stickers(id, pack_id, usuario_id null, storage_path/asset_path, orden, created_at)`.
  - Pack del sistema "Básico": stickers = **assets empaquetados** (`src/assets/stickers/*.webp`) → referencia por
    `asset_path` (no ocupan storage). Xaviel provee las imágenes (o confirmamos un set genérico).
  - Stickers propios: subida a bucket **`sgc-stickers`** (RLS: primer segmento = `usuario_id`), referencia por `storage_path`.
- **Mensaje sticker:** reutiliza `sgc.mensajes` con `tipo='sticker'` + `archivo_path`; render sin burbuja, tamaño fijo.
- **RPCs:** `stickers_disponibles()` (pack sistema + míos), `crear_sticker(path)`, envío vía `enviarMensaje` con tipo.
- **UI:** tab "Stickers" en el composer (junto a adjuntar), recientes, envío 1-tap. Contrato compartido con la app.
- **Alcance v1:** packs del sistema + subir imagen propia como sticker. Edición avanzada (recorte/fondo) fuera.

**Pendiente Xaviel:** ¿pack genérico que armo yo, o me pasas las imágenes de la empresa?

---

## AT3 — Mapa lento (hallazgos + mejoras aplicadas)

- El loader de Google Maps (`GoogleMapsLoader`) ya carga el script **una sola vez**, `async`, con `loading=async`
  y `callback` — correcto. Las páginas de mapa hacen **lazy-load** del componente (rutas `loadComponent`).
- **Mejora aplicada (AT4):** `getPosiciones` ya NO lee toda la tabla `chofer_ultima_posicion` con embeds; usa la
  RPC `ultimas_posiciones` que devuelve un set **acotado (solo sharers)** — menos filas, menos markers, menos
  payload inicial. Xaviel: hoy son ~6 markers.
- **Siguiente optimización si crece la flota (propuesta):** `MarkerClusterer` (no está instalado) y diferir el
  `fitBounds` a un solo cálculo. Con la flota actual el costo es mínimo; se instrumenta cuando haya >30 markers vivos.

---

## Resumen de cambios de BD (aplicados a prod)

- `2026-08-18-at1-at4-recorrido-diario-seguimiento.sql` — tabla `recorrido_diario`, funciones
  `ultimas_posiciones`, `recorrido_diario_de`, `recorridos_disponibles`, `consolidar_recorrido_diario`,
  `consolidar_recorridos_del_dia`, `_recorrido_tramos`; cron `sgc-consolidar-recorridos` (3:50am);
  purga de no-sharers en `chofer_ultima_posicion` (AT4).
- Fix AT12: reset de PIN + limpieza de bloqueo de **MANOLO DURAN** (verificado login OK).
- AT8: proyecto "Riviera Bay TEST" creado.
