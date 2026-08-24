# AV4 — Ficha del personal de obra + import periódico — ✅ CONSTRUIDO (web 1.92.0)

> **Estado 24/08:** Xaviel dio OK a los defaults → **construido y aplicado a prod.** Migración `sql/2026-08-24-av4-personal-ficha-import-ciclo.sql`. Prueba de aceptación julio→agosto (JWT admin simulado, obra de prueba) **PASÓ**: alta, actualización, baja confirmada e inactivación selectiva (una baja no confirmada quedó activa); datos de prueba limpiados. Lo que sigue abajo es el diseño de referencia.


> Ronda AV · 24/08/2026 · Extiende AR1 (Registro de Personal de obra) y AT5 (importador de listados).
> **Novedad clave:** ya hay DOS listados reales del mismo formato en un mes (Sonia 16-jul = 28 personas; Alpha 14-ago = 34 personas) → **los listados son periódicos**. El import de AT5 no es un cargue único: es un **ciclo** (cada listado actualiza el anterior).

---

## A. Análisis del segundo Excel real (`LISTADO DE PERSONAL ALPHA 14082026.xlsx`)

Verificado con `xlsx`:
- **4 hojas:** `LISTADO ` (con espacio final) + `DOCUMENTOS VARILLEROS` + `DOCUMENTOS CSD` + `DOCUMENTOS  CARPINTEROS` (doble espacio).
- **Encabezado** en B8:B10 → `PROYECTO = TORRE ALPHA`, `UBICACIÓN = GUSTAVO MEJIA RICAR…`, `ENC. OBRA = MANUEL ARGEL GUILAMO`.
- **Headers** en fila 13: `NOMBRE · OCUPACION · # DE DOCUMENTO · NACIONALIDAD · TECNICO · OBSERVACION` (todos con espacios colgando).
- **34 personas** (fila 14+). Dos ingenieros en plantilla: **Manuel Argel Guilamo** (ENC. OBRA) y **Jonatha Roman** → alimenta AV3 (FASE 3, ya implementada: varios ingenieros + principal).
- **Suciedad confirmada (igual que AT5):** `DOMINICANO `/`DOM `/`DOM`/`HTI` mezclados y con espacios; cédulas `000-0000000-0` para dominicanos y pasaportes/ID heterogéneos para haitianos.
- **33 imágenes de documentos** en las 3 hojas de documentos vs **34 personas** → **no se emparejan solas** (ni la cuenta coincide). Confirmado: el emparejamiento foto↔persona es manual o vía captura en obra con la app.

Los **dos ejes** que AT5 identificó se mantienen:
- **OCUPACION** = nivel (INGENIERO · MAESTRO · OBRERO).
- **TECNICO** = cuadrilla ("acero"=VARILLERO · "carpintería"=CARPINTERO · "personal de la casa"=AYUDANTE/CAPATAZ CSD).

---

## B. Modelo — sobre el esquema REAL de AR1 (verificado en prod)

`sgc.personal_obra` **ya existe** con: `proyecto_id, nombre, apellido, nacionalidad, tipo_documento, documento_numero, cargo_id, empleado_id, telefono, notas, carnet_*, estado, es_prueba, lote_import, registrado_por`. También existen `sgc.personal_obra_fotos` (multi-foto) y `sgc.personal_obra_firmas`. **La base de la ficha, el catálogo de cargos, el import por lote (`lote_import`) y el aislamiento `es_prueba` YA están.**

Lo que falta (todo **aditivo**, migración lista para aplicar tras el visto bueno de RRHH):
- **Aseguramiento** → `aseguramiento_estado text default 'desconocido'` (`asegurado`|`no_asegurado`|`desconocido`) + `aseguramiento_fecha date` + `aseguramiento_doc_path text`. **Default decidido:** flag manual con fecha + documento de respaldo opcional (el más simple que cubre "ver quién está asegurado de un vistazo"). ⚠️ Si RRHH quiere atarlo a TSS al día, se cambia el semáforo, no el modelo.
- **Dos ejes** (AT5): `tipo_documento` y `cargo_id` ya existen; el eje OCUPACION (nivel: INGENIERO/MAESTRO/OBRERO) se guarda en `cargo_id` (catálogo de cargos AR1) y el eje TECNICO (cuadrilla: VARILLERO/CARPINTERO/AYUDANTE/CAPATAZ) se agrega como `cuadrilla text` para no aplastar uno con otro.
- **Foto de cara vs documento:** `personal_obra_fotos` ya es multi-foto; se distinguen por un `tipo` ('rostro' | 'documento') — agregar la columna `tipo` si no está. Cara y documento son dos registros distintos.
- **Historial de listados** → `sgc.personal_obra_listados` (obra, fecha del listado, ENC. OBRA, archivo, quién importó) + `sgc.personal_obra_listado_items` (quién apareció en cuál). `personal_obra.lote_import` ya enlaza a la cabecera. Da la trazabilidad de **quién estuvo en qué obra y cuándo**.

**Tipo de documento — catálogo (default decidido, ⚠️ RRHH confirma nombres):** `cedula` (Cédula) · `id_permiso_trabajo` (ID / permiso de trabajo) · `pasaporte` (Pasaporte).

**Validación POR tipo** (nunca regex único): cédula RD `000-0000000-0`; pasaporte/ID = laxo (alfanumérico, longitud mínima). La nacionalidad NO fuerza cédula.

---

## C. Vista de control por obra (el pedido literal de RRHH)

Galería/lista de fichas del personal **activo** de la obra: **cara + documento + asegurado sí/no** de un vistazo, con **filtros** por nacionalidad, tipo de documento, cuadrilla y estado. Pensada para portería/supervisión e inspecciones.
- **Acceso por rol** (⚠️ confirmar): RRHH, admin, ingenieros de la obra (los N de AV3).
- **Cuidado con exponer números de documento** en exports abiertos (dato migratorio sensible).

---

## D. El import como CICLO periódico (extiende AT5)

Al subir el listado nuevo de una obra, la **previsualización obligatoria** muestra el **diff contra el estado actual**:
- **Altas** (número de documento nuevo) → crear.
- **Coincidencias** (por número de documento) → actualizar, mostrando el diff campo a campo.
- **Bajas** (estaban activos y ya no vienen) → ⚠️ **decisión RRHH** (§E): ¿marcar "inactivo en obra" automáticamente o solo señalar y que RRHH confirme?

Todo lo demás de AT5 sigue vigente: mapeo editable con **preset de Sonia**, normalización con diccionario, **deshacer por lote**, reporte de errores. Se **guarda el historial** de listados (C).

**Fotos embebidas:** paso de **emparejamiento manual opcional** (33 img vs 34 personas); el camino principal es la **captura en obra con la app** (AR1 / PROMPT-8 FASE 4). Cara y documento son dos campos distintos.

**Prueba de aceptación:** importar julio (28) → agosto (34) en secuencia sobre una obra `es_prueba`, verificando altas, bajas, cambio de ENC. OBRA (alimenta AV3) y que diff/historial/deshacer se comporten.

---

## E. Decisiones RRHH — defaults ELEGIDOS ("do the best"), RRHH ajusta si quiere

Xaviel dijo "do the best": fijo estos defaults para que el build arranque sin trabarse. Ninguno pinta a la BD todavía (dato migratorio sensible → un "OK" de RRHH de 5 minutos antes de aplicar la migración aditiva).

1. **"Asegurado" = flag manual + fecha + documento de respaldo opcional.** El semáforo verde/rojo se pinta de ese flag. Si RRHH lo quiere atado a TSS al día, se cambia la fuente del semáforo, no el modelo.
2. **Tipos de documento:** `Cédula` · `ID / permiso de trabajo` · `Pasaporte`.
3. **Bajas del listado nuevo = se SEÑALAN, RRHH confirma** (no inactivación automática). Menos destructivo; el diff los muestra en rojo con checkbox "confirmar baja".
4. **Fotos = dos campos separados** (cara y documento), con `tipo` en `personal_obra_fotos`. La captura en obra (app, PROMPT-8) toma ambas.
5. **Acceso:** RRHH + admin + ingenieros de la obra (los N de AV3). Números de documento **ocultos en exports abiertos** (solo visibles en la ficha con permiso).

> **Estado:** spec build-ready sobre el esquema real. **No se aplicó migración** (columnas de aseguramiento/cuadrilla/foto-tipo + tablas de historial) para no tocar datos personales sin el OK de RRHH. Al confirmarlo, es un build acotado que reutiliza AT5 (importador), AR1 (ficha/carnet + `lote_import` + fotos), el diccionario de normalización y el patrón de historial. La vista de control por obra y el ciclo de import con diff son la mayor parte del trabajo de UI.
