# Notas — contrato de contenido web ↔ app (AD9 / AE4-web)

Para que una nota creada en la **app** (csd-app) se vea **idéntica** en la web (y viceversa),
ambas plataformas comparten el mismo modelo de contenido. Este documento lo fija.

## Estado de la toolbar web (verificado AE4-web)

El editor de página completa (`src/app/pages/notas/editor/nota-editor.*`) usa
`contentEditable` + `document.execCommand`. La toolbar YA incluye el set objetivo:

| Herramienta | Comando | Estado |
|---|---|---|
| **Negrita** | `bold` | ✅ |
| **Cursiva** | `italic` | ✅ |
| **Subrayado** | `underline` | ✅ |
| **Lista con viñetas** | `insertUnorderedList` | ✅ |
| **Lista numerada** | `insertOrderedList` | ✅ |
| **To-do / checklist** | sección estructurada (ver abajo) | ✅ |
| Título (H2) | `formatBlock=H2` | ✅ (extra) |
| Color de texto | `foreColor` | ✅ (extra) |
| Deshacer / Rehacer | `undo` / `redo` | ✅ (extra) |

> No falta nada del set pedido (negrita, cursiva, subrayado, viñetas, numerada, to-do).
> El **to-do** NO es un comando inline dentro del cuerpo: es una **sección de checklist**
> aparte (con enlace a Tareas), respaldada por su propia tabla. Es el mismo modelo que
> debe producir la app.

## Modelo de contenido (dos partes)

### 1) Cuerpo → **HTML** en `sgc.notas.contenido` (text)

El cuerpo formateado se guarda como **fragmento HTML** tal cual lo produce el editor
(`contenteditable.innerHTML`), vía RPC `guardar_nota(p_contenido, …)`. Etiquetas esperadas
(que ambas plataformas deben emitir/renderizar igual):

| Formato | HTML |
|---|---|
| Negrita | `<b>…</b>` (o `<strong>`) |
| Cursiva | `<i>…</i>` (o `<em>`) |
| Subrayado | `<u>…</u>` |
| Título | `<h2>…</h2>` |
| Lista viñetas | `<ul><li>…</li></ul>` |
| Lista numerada | `<ol><li>…</li></ol>` |
| Color | `<span style="color:#rrggbb">…</span>` |
| Párrafo / salto | `<div>…</div>` / `<br>` |

Reglas para la app:
- Emitir HTML **limpio** con estas etiquetas (la web inyecta el HTML verbatim en el editor).
- **No** meter checkboxes/markdown (`- [ ]`) dentro de `contenido` — eso era el editor v1
  muerto; el checklist va en su tabla.
- Otras columnas de `sgc.notas`: `titulo` (texto plano), `color` (uno de `NOTA_COLORES` o
  null), `pinned`, `archivada`. Concurrencia: pasar `p_expected_updated_at` (last-write-wins).

### 2) Checklist / to-do → tabla `sgc.nota_checklist_items` (una fila por ítem)

No se codifica dentro de `contenido`. Columnas relevantes: `nota_id`, `orden` (1..n),
`texto`, `done`, `done_auto`, `ref_tipo` (`'tarea'`), `ref_id` (Tarea enlazada), `done_at`.

CRUD vía `NotasService` (`getChecklist`/`addChecklistItem`/`updateChecklistItem`/
`removeChecklistItem`/`linkChecklistItem`/`reordenarChecklist`). Un ítem enlazado a una
Tarea se auto-marca `done` cuando la Tarea se completa (trigger + `sync_checklist_nota`).

## Render (lectura)

La web inyecta `contenido` (HTML) directo en el editor. La app debe renderizar el mismo
HTML con las mismas etiquetas para verse idéntica. La lista/tarjeta muestra solo un
extracto en texto plano.

> Seguridad (nota, no bloquea AE4): el HTML se asigna a `innerHTML` sin sanitizar. Como el
> contenido es de usuario y compartible, conviene sanitizar en una ronda futura (ambos
> lados del contrato). No es alcance de AE4.

## Prueba de aceptación

Nota creada en la app con **negrita + subrayado + lista numerada + viñetas + checklist**
→ abrir en web → se ve idéntica (y al revés). El checklist aparece como sección con sus
ítems; el formato del cuerpo respeta las etiquetas de la tabla de arriba.
