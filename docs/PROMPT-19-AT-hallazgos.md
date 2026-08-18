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

## AT8 — Cronograma E2E "Riviera Bay TEST" (✅ DESBLOQUEADO Y VALIDADO — 18/08/2026)

### Causa raíz del bloqueo (NO era el parser)
1. **El `.mpp` de Riviera Bay está prácticamente vacío.** Lo leí con MPXJ.Net (dotnet) — es un MPP14 real
   (Project 2010+) pero contiene **solo 3 registros**: la raíz del proyecto + 2 encabezados
   (`NOVAL - RIVIERA BAY`, `EDIFICIO A `). **Cero actividades**, sin fechas (todo default 2025-05-01), sin
   responsables ni avance. La carpeta `…/RB; NOVAL-RIVIERA BAY-CANA ROCK/00-CRONOGRAMA` también está vacía.
   → No hay cronograma real de Riviera Bay que importar; el archivo nunca se llenó en MS Project.
2. **El importador web rechaza `.mpp` por diseño** (`cronograma-import.ts:112`), y es correcto: MPXJ es
   Java/.NET, no corre en el navegador ni en un edge de Deno. La exportación manual a Excel (o un convertidor
   local) es el camino previsto.

### Validación E2E real (con datos reales de Monterezzo, permitido por el prompt)
- Corrí el **parser de producción** (`parseHoja`/`parseFecha`/`parseNum`, réplica verbatim) contra
  `CRONOFRAMA MONTEREZZO TORRE 2.xlsx` (141 KB, real): **35 actividades**, mapeo de columnas correcto
  (`#, ACTIVIDADES, RESPONSABLE, VOLUMETRIA, FECHA INICIO/FIN, DIAS DE EJECUCION, AVANCE REAL %, RENDIMIENTO`),
  grupo `ENTREPISO #` detectado, fechas `M/D/YYYY`→ISO, cobertura **35/35** en inicio/fin/responsable/avance/días.
- **Import en vivo** vía el RPC de producción `sgc.cronograma_importar` (impersonando admin) dentro de
  **Riviera Bay TEST** (`es_prueba`): **35 filas creadas** en `sgc.cronograma_tareas` (fase `TORRE 1 EP1`),
  verificadas 1:1 contra el archivo (nombre, responsable, volumetría, fechas planificadas sin recalcular,
  rendimiento, grupo, `import_origen='xlsx'`). Las actividades con `días=0` quedan en 1 por
  `greatest(1, dias)` (coerción documentada del RPC). **El importador funciona de punta a punta.**
  → Visible en **Proyectos › Riviera Bay TEST › Cronograma** (Gantt). Es data de prueba; se puede
  reimportar (idempotente, `p_reemplazar=true`) o borrar.

### Convertidor `.mpp` → `.xlsx` (entregable para futuros .mpp poblados)
Para cuando un `.mpp` SÍ tenga actividades y no haya MS Project a mano, dejé un convertidor local probado
(round-trip verificado: mpp → JSON → xlsx en el formato esperado → el parser de producción lo lee):
- `scratchpad/mppread/` — proyecto dotnet (`MPXJ.Net`) que lee MPP8/9/12/14 → `tasks.json`.
- `scratchpad/mpp-to-xlsx.cjs` — arma el `.xlsx` con los encabezados exactos del importador (tareas summary → filas de grupo).
- **Uso:** `mppread.exe archivo.mpp tasks.json` → `node mpp-to-xlsx.cjs tasks.json salida.xlsx "TORRE X"` → subir en el importador.
- Scripts de validación/import: `scratchpad/parse-cronograma.cjs`, `scratchpad/import-live.mjs`.

**Pendiente Xaviel:** si quieres el cronograma *real* de Riviera Bay, hay que crearlo/poblarlo primero (en MS
Project o directo en Excel con esos encabezados); el `.mpp` actual no tiene actividades. El flujo de import ya
está probado y listo.

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
