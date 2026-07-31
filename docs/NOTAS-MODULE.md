# Módulo Notas (personales + compartidas) — SGC

> AC4. Notas personales y compartidas estilo ClickUp. Research breve + feature set v1.

## 1. Research — cómo lo hacen apps similares

| App | Modelo relevante | Compartir | Formato |
|---|---|---|---|
| **ClickUp** (Notepad/Docs) | Notepad personal rápido; Docs colaborativos | Docs: por usuario con permisos view/comment/edit/full | Rich text + checklists, slash-commands |
| **Notion** | Página = bloques | Share por persona (can view/comment/edit) + workspace | Bloques (tiempo real) |
| **Google Keep** | Nota simple (texto/checklist/color/pin) | Colaboradores (editan) | Texto + checklist + color/pin/archivo |
| **Apple Notes** | Nota | Compartir con personas (ver/editar) | Rich text + checklist |

**Patrones comunes que adoptamos:**
- Lista de notas con **búsqueda** y orden por **última edición**; separación **Mías** vs **Compartidas conmigo**.
- Editor **simple**: título + cuerpo con **formato básico** (negrita, listas, títulos) y **checklists** dentro de la nota.
- **Compartir por usuario** con rol **viewer/editor**: el dueño gestiona; los editores editan contenido pero **no** comparten ni borran.
- **Color** y **pin** opcionales; **archivo/papelera**.

**Fuera de alcance v1** (deliberado): colaboración en tiempo real carácter-a-carácter, comentarios, historial de versiones. En su lugar: **última edición gana** (`updated_at`) con **detección de conflicto simple** (aviso si otro editó después de que cargaste la nota).

## 2. Feature set v1 (decidido)

- **Módulo general**, accesible por **todos los roles** (como Mensajes; incluidos choferes — asunción confirmada en el contexto ⚠️).
- **Mis notas** / **Compartidas conmigo** (tabs), búsqueda por título/contenido, orden por `updated_at`.
- **Editor**: título + contenido con formato básico y checklists; color y pin; archivar.
- **Compartir**: buscar usuario registrado → elegir permiso **ver** / **editar**; el dueño ve/edita/quita a los compartidos y puede cambiar el permiso.
- **Permisos** (RLS estricta): solo dueño y compartidos **leen**; **editan** dueño o compartidos-editor; **compartir/borrar** solo el dueño.
- **Conflicto**: `guardar_nota(..., p_expected_updated_at)` devuelve `conflict: true` si el servidor tiene una edición más nueva (última edición gana, pero se avisa).
- **Offline-first (app, PROMPT-14)**: outbox por nota; al reconectar, `guardar_nota` con `updated_at` esperado detecta el conflicto.

## 3. Modelo de datos (aplicado)

`sql/2026-07-30-ac4-notas-module.sql`.

- **`notas`** — `owner_id, titulo, contenido (texto con formato básico + checklists), color, pinned, archivada, created_at, updated_at`.
- **`nota_compartidos`** — `nota_id, usuario_id, permiso (ver|editar)`, `unique(nota_id, usuario_id)`.
- **RLS estricta** (ver arriba). Helper `sgc.puede_editar_nota(id)`.
- **RPC** `sgc.guardar_nota(p_id, p_titulo, p_contenido, p_color, p_pinned, p_archivada, p_expected_updated_at)` → crea o actualiza (según exista el id), valida permiso de edición, y devuelve `{ conflict, nota }`.

## 4. UI (web)

- Módulo **"Notas"** en el shell (sin gate de módulo), tabs **Mis notas / Compartidas conmigo**.
- Lista (tarjetas con título, extracto, color, pin, "compartida por…") + búsqueda + orden por última edición.
- Editor lateral/página: título, cuerpo con formato básico + checklist, color, pin, archivar/eliminar (eliminar solo el dueño).
- Flujo **Compartir**: buscar usuario → agregar con permiso ver/editar; lista de compartidos con cambio de permiso / quitar (solo dueño).
- **Papelera/archivo**: notas archivadas separadas; restaurar.

## 5. Contrato para la app (PROMPT-14, offline-first)

- Leer: `select * from notas` (RLS filtra) + `nota_compartidos`.
- Guardar: `guardar_nota(...)` con `p_expected_updated_at` para detección de conflicto.
- Compartir/gestionar: writes directos a `nota_compartidos` (RLS restringe al dueño).
- Búsqueda local sobre el cache; sincronización por outbox.
