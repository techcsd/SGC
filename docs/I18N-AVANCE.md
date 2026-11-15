# Avance de idioma 100% (DP-07..DP-13, CONTEXTO-72)

Este archivo es lo que permite **reanudar la ronda en otra sesión**. Se
actualiza al final de cada lote (F3/F4) con el comando corrido, el commit y
el nuevo % medido. Nunca declarar 100 % sin que `scripts/i18n-coverage.mjs`
lo mida.

## Baseline (F0, 13-nov-2026, antes de tocar nada)

- Pantallas medidas: 192 · literales HTML: ~16.095 · con `t()`: 1.302 (8,1 %)
- `en.json`: 1.452 claves · `ht.json`: 0 claves (vacío)
- `<html lang>`: `"en"` (incorrecto, la app es en español)
- `verify-i18n.mjs`: solo avisa (`process.exit(0)` siempre)
- `alcance.json`: 9 pantallas, todas `enforce:false`

## Medición tras F2 (escáner extendido a `.ts` + alcance.json con TODAS las pantallas)

- Pantallas medidas: **193** (ahora TODAS están "en alcance" — el escáner ya
  no mide un subconjunto, mide todo) · **alcance `en`: 8 %** · `ht`: 0 %
- Literales en `.ts` sin `t()` (DP-07c, categoría toasts/confirm/alert/
  placeholder/label/titulo/mensaje): **1.359** en 147 archivos (ver tabla
  completa en `docs/I18N-COVERAGE.md` § "Literales en `.ts`")
- `<html lang>` ahora sigue al idioma activo (`es`/`en`/`ht`), ver
  `I18nService.aplicarLangHtml()`
- Dev-miss logging activo: `console.warn` una vez por clave sin traducir,
  solo cuando `!environment.production`
- `alcance.json`: ahora se **regenera en cada corrida** del escáner con las
  193 pantallas detectadas; el campo `enforce` de una pantalla existente se
  preserva, una pantalla nueva entra en `false`

## Medición tras lote 1 (Claude, 13-nov-2026)

- **`claude`: 100% (117/117)** · **`admin/claude`: 100% (27/27)** ·
  **`configuracion/claude`: 100% (32/32)** — las 3 con `enforce:true`.
- Se corrigieron 2 falsos positivos del escáner mismo (no específicos de
  Claude, mejoran el % real de TODO el repo): (1) los bloques de control
  flow de Angular (`@if`/`@for`/`@else`/…) se contaban como "texto sin
  cubrir" por el regex de nodos; (2) los catálogos constantes module-level
  (`label:`/`placeholder:`/… declarados ANTES de la clase, ver DP-09) se
  contaban como ".ts sin t()" aunque su plantilla ya los traduce al mostrar
  (`| t`). Con estos 2 fixes el **alcance global subió de 8% a 12%** (en) y
  **0% a 8%** (ht) — ganancia real de precisión de medición, no de cableado.
- `scripts/i18n-wrap-html.mjs` (codemod, nuevo) corrió dry-run y `--write`
  sobre `--modulo claude`: envolvió 3 literales (2 `aria-label` + 1
  `placeholder`); el resto del HTML de Claude ya venía cableado de rondas
  anteriores (DM/DN/DO).
- `claude.ts`: 26 toasts envueltos con `this.i18n.t(...)` (título only, el
  detalle/subtítulo queda en español — mismo patrón que el resto del repo).
  `configuracion-claude.ts`: 2 toasts. `admin-claude.ts`: 1 `confirm()` + 1
  toast, ambos parametrizados (`{nombre}`).
- `PLANTILLAS_SKILL` (catálogo constante en `claude.ts`): labels NO se
  envuelven al declarar (DP-09); el `<option>` que los muestra pasa por
  `{{ p.label | t }}`.
- `public/i18n/en.json`: +123 claves (22 reutilizadas de `csd-app/public/i18n/en.json`,
  101 traducidas nuevas) → 1.575 claves totales.
  `public/i18n/ht.json`: +123 claves (0 reutilizables del app, su `ht.json`
  apenas tiene ~132 claves sin solape) → 123 claves totales. **Sin revisión
  humana** — ver `docs/I18N-REVISAR-HT.md`.
- Build + 362 tests verdes. Commit: ver `git log` rama `feature/dp-ronda-13nov`.

## Medición tras lote 2 (Configuración/perfil/shell, 14-nov-2026)

- **`configuracion`: 100% (58/58)** · **`perfil`: 100% (24/24)** ·
  **`ajustes-notificaciones`: 100% (16/16)** — las 3 con `enforce:true`.
- Tercer fix de precisión al escáner: los catálogos constantes (`label:`/…)
  se exentaban solo si estaban **antes de la clase**; en este lote aparecieron
  catálogos declarados **dentro** de la clase (`secciones = computed(() =>
  [...])`) y extendidos con `.push({...})` condicional — ambos patrones
  legítimos de DP-09 que el escáner marcaba mal. Ahora la exención es por
  **rango de arreglo/`.push()` balanceado**, no por posición en el archivo
  (`spansDeArreglos()` en `scripts/i18n-coverage.mjs`). También se corrigió
  un falso positivo de `mensaje: '...'` disparado por un acceso a propiedad
  (`x.mensaje : y` dentro de un ternario, no una clave de objeto) con un
  lookbehind `(?<!\.)`.
- **Hallazgo real de `verify-i18n.mjs` (el guard estático, no solo el
  smoke):** su extracción de "claves usadas" solo miraba `| t` y `i18n.t(...)`
  literales — nunca veía `s.label | t` (variable, no literal), así que un
  catálogo con un label sin traducir podía pasar el guard sin que nadie lo
  notara. Se agregó la misma extracción de propiedades de catálogo
  (`PROP_RE`) al conjunto de "usados" — el guard pasó de medir ~1.400 textos
  a ~2.350 en todo el repo (solo medición, no cableado nuevo). Encontró y se
  corrigieron 19 claves reales sin traducir en los lotes enforce (temas,
  catálogo de notificaciones, plantillas de skill).
- `scripts/i18n-smoke.mjs`: se corrigió un bug real del propio script — `/perfil`
  redirige a `/configuracion#cuenta`; volver a `/configuracion#idioma` después
  era solo un cambio de fragmento sobre el MISMO componente, y Angular no
  re-dispara `ngOnInit` (que es donde se lee el fragmento) solo por eso — el
  selector de idioma nunca se montaba y el test fallaba por timeout, no por
  falta de traducción. Fix: forzar `page.reload()` tras cada navegación a
  `/configuracion#idioma` para garantizar que el fragmento se lea fresco.
  También se agregó el mapeo pantalla→ruta real para pantallas embebidas
  (`ajustes-notificaciones` → `/configuracion#notificaciones`).
- `public/i18n/en.json` +63 (algunas ya existían), `public/i18n/ht.json` +115
  (96 del lote + 19 del fix del guard). Build + 368 tests + smoke verdes.

## Medición tras lote 3 (Dashboard, 14-nov-2026)

- **`dashboard`: 100% (70/70), `enforce:true`.**
- Codemod (`--modulo dashboard --write`): 59 envueltos automático, 7 saltados
  (mixto/multilínea) resueltos a mano.
- **Cuarto fix de precisión al escáner:** los comentarios HTML (`<!-- ... -->`)
  se escaneaban como si fueran texto visible — el `<` de apertura y el `>` de
  cierre del comentario "engañaban" al regex de nodos de texto (`>texto<`),
  contando el contenido del comentario (a veces en español) como literal sin
  `t()`. Ahora se reemplazan por espacios antes de escanear. Se agregó
  `"RD$"` al whitelist (símbolo de moneda, no se traduce).
- Gaps reales cerrados a mano: banner "sin módulos asignados" (multilínea),
  fragmentos mixtos (`"% del mínimo ·"`, `"· avance"`, `"Presupuesto total:"`,
  `"Mantenimientos pendientes:"`), 2 atributos `[title]` con concatenación
  de string (`'Entradas: ' + d.entradas` → `i18n.t('Entradas: {n}', {n})`,
  requiere `i18n` inyectado y expuesto `protected` porque el pipe `| t` no
  funciona dentro de un binding de atributo, solo en interpolación), y un
  `label:` de catálogo retornado desde un `computed()` condicional (no
  detectado por `spansDeArreglos` porque no es un arreglo ni un `.push()`,
  es un `return { ... }` — caso puntual, resuelto a mano con `this.i18n.t()`).
- `public/i18n/en.json` +60, `public/i18n/ht.json` +62 (61 del lote + 1
  `"Bitácora"` que el guard atrapó al activar `enforce:true`). Build + 368
  tests + smoke (5 pantallas × 2 idiomas) verdes.

## Medición tras lote 4, parcial (Inventario, 14-nov-2026)

Inventario es grande: **28 pantallas reales** (no 24, corregido al medir con
el escáner — incluye `conduces-externos`/`stock-odoo` que ya venían al 100%
de rondas previas). En progreso, **8/28 a 100%** hasta ahora:
`conduces-por-implementar`, `lugares-por-registrar`, `por-firmar`,
`proveedores-transporte`, `reportes`, `conduce-externo-form`
(+ `conduces-externos`/`stock-odoo`).
**20 pantallas restantes** (con su % tras el codemod, antes de la limpieza
a mano): `conteos` 45%, `apertura` 47%, `conduces` 52%, `reposicion` 52%,
`ajuste-real` 55%, `articulos` 56%, `movimientos` 56%, `categorias` 57%,
`salidas` 59%, `bodegas` 60%, `activos` 61%, `confirmaciones` 61%,
`material-no-catalogado` 61%, `almacen-inventario` 63%, `conduce` 64%,
`kardex-modal` 64%, `requisiciones` 64%, `retiros` 66%, `entradas` 72%,
`conduce-externo-ficha` 73%.

## Medición tras lotes 5-9 (Inventario, 14-nov-2026 — sigue la misma sesión)

**21/28 pantallas de Inventario a 100% con `enforce:true`** (quedan 6:
`almacen-inventario`, `conduce`, `requisiciones`, `retiros`, `entradas`,
`conduce-externo-ficha`). Lotes y commits en `feature/dp-ronda-13nov`:

- **Lote 4 cont.** (`46a3c9c5`): `categorias`, `movimientos`,
  `confirmaciones`, `kardex-modal`, `material-no-catalogado`, `ajuste-real`,
  `reposicion` → 100%. Gotchas: `[attr.aria-label]="'Seleccionar ' + x"` no
  es alcanzable por `| t` (requiere `i18n.t()` directo + `protected i18n` en
  el componente); catálogos tipo `MOTIVOS_DECLINAR` (`label:` en object
  literal) pasan el guard de texto estático pero no un binding de variable
  (`m.label` sin `| t`) — hay que envolver en la plantilla, no en la
  declaración (DP-09).
- **Lote 5** (`84b3edfb`): `apertura`, `conteos` → 100%. Noveno… digo quinto
  fix de escáner: condición de `@if (a > b)` (sin comillas, control flow,
  NO un binding de atributo) tiene el mismo problema que el fix anterior de
  `[class.x]="a > b"` — el `>` se confunde con cierre de tag. Se neutraliza
  igual. También se amplió `esRuido()` para tolerar un separador "·" pegado
  justo antes de un `@if` cuando ambos caen en el mismo nodo de texto.
- **Lote 6** (`426bda7c`): `conduces`, `articulos` → 100%.
- **Enforce retro** (`57a81e08`): `conduces-externos`/`stock-odoo` ya
  estaban al 100% de rondas previas pero nunca se habían flipeado a
  `enforce:true` ni tenían sus 26 claves completas en ambos idiomas — se
  tradujeron y activó el guard.
- **Lote 7** (`f92fe158`): `salidas` → 100% (pantalla grande, 134
  literales). Varios `saveError.set()`/`toast` con ternarias no eran
  detectados por el escáner (no matchean sus patrones de `.ts`) — se
  envolvieron igual por consistencia real, no solo para pasar la medición.
- **Lote 8** (`df695e07`): `bodegas` → 100%. Séptimo fix de escáner:
  `spansDeArreglos()` solo detectaba `campo = [...]` pero no
  `campo = computed(() => [...])` (el arreglo sigue a un `=>`, no a un `=`
  directo) — un catálogo sintético mezclado con datos reales
  (`obrasFiltroOpt`) se contaba como ".ts sin t()" en vez de quedar exento
  por DP-09. `reArreglo` ahora matchea `(?:=>|=)\s*\[`.
- **Lote 9** (`33f874ed`): `activos` → 100%. Octavo fix, en **ambos**
  escáneres (`i18n-coverage.mjs` y `verify-i18n.mjs` tienen cada uno su
  propia copia del regex `PROP_RE`): un `label:` con TEMPLATE LITERAL de
  datos (`` label: `${e.nombre} ${e.apellido}` ``) se contaba como copy sin
  traducir — es interpolación de datos (nombre de empleado, placa de
  vehículo), no texto de UI. Ambos `PROP_RE` ahora ignoran el match si usa
  backtick y contiene `${`.
- Cada lote verificado: build + 368 tests verdes; lote 6 además con smoke
  (24 pantallas × 2 idiomas, sin fallos). Cada fix de escáner se verificó
  que NO rompiera ninguna pantalla `enforce:true` previa antes de seguir.
- `public/i18n/en.json`: 1.575 (tras lote 1) → **2.295** claves.
  `public/i18n/ht.json`: → **1.357** claves. Siguen **sin revisión humana**
  (`docs/I18N-REVISAR-HT.md`).

**Pendiente Inventario** (6 pantallas, % medido a esta altura):
`almacen-inventario` ~63%, `conduce` ~64%, `requisiciones` ~65%,
`retiros` ~66%, `entradas` ~72%, `conduce-externo-ficha` ~73% (esta última
es ruta dinámica `:id`, sin URL genérica para el smoke — igual que antes).

- `scripts/i18n-wrap-html.mjs --modulo inventario --write` corrido sobre
  TODO el módulo de una vez (28 archivos, +1193 envueltos, 86 saltados).
  **Bug crítico encontrado y corregido ANTES de aceptar el resultado:** una
  línea con una comparación TS dentro de un binding (`[class.cn-up]="a > b"`)
  tiene un `<`/`>` que NO delimita una etiqueta — el regex de nodos de texto
  no lo sabía y partió un atributo a la mitad en `conteos.html` (`npm run
  build` lo atrapó: `NG5002` parser error). El codemod ahora salta toda la
  línea si detecta ese patrón (`]="[^"]*[<>][^"]*"`) en vez de adivinar.
- **Sexto fix de precisión al escáner:** el regex de `@if`/`@for` como ruido
  no toleraba un `(` inmediatamente antes (`(@for (...) {...})`, un `@for`
  envuelto en paréntesis de texto) — se amplió el patrón.
- `public/i18n/en.json` +118, `ht.json` +173 (22 reutilizados de csd-app
  para `en`, 0 para `ht`). `alcance.json`: 6 pantallas nuevas `enforce:true`
  (total 13). Smoke: 11 pantallas × 2 idiomas, sin fallos — incluye 2 rutas
  "especiales" agregadas al mapeo del smoke (`por-firmar` vive en
  `/por-firmar`, no `/inventario/por-firmar` — AU8; `conduce-externo-form`
  vive en `/inventario/conduce-externo/nuevo`; `conduce-externo-ficha` es
  ruta dinámica `:id`, sin URL genérica — se excluye del smoke a propósito).
  Build + 368 tests verdes.

## Tabla de lotes (F3 cablear HTML + F4 cablear `.ts`)

Orden acordado en el prompt: Claude, Configuración/perfil/shell, Dashboard,
Inventario, Compras, Flota, Bitácora, Transporte/apoyo, Proyectos, RRHH,
Legal, Documentos, Ingeniería, Reuniones/Tareas/Notas/Mensajes, Tecnología,
Admin, resto.

| # | Módulo | Pantallas | Literales HTML | Literales `.ts` | Estado | Commit | `enforce` |
|---|---|---:|---:|---:|---|---|---|
| 1 | Claude | claude, configuracion/claude, admin/claude | 3 envueltos (resto ya venía) | 29 envueltos | ✅ **100% — hecho** | (ver rama) | **true** |
| 2 | Configuración/perfil/shell | configuracion, perfil, ajustes-notificaciones | ~55 envueltos | ~15 envueltos | ✅ **100% — hecho** | (ver rama) | **true** |
| 3 | Dashboard | dashboard | 59 auto + 7 a mano | 1 (label de computed) | ✅ **100% — hecho** | (ver rama) | **true** |
| 4 | Inventario | 21/28 pantallas 100% (ver detalle arriba) | ~1193 (codemod) + ~200 a mano | ~80 (toasts/confirm/error) | 🧪 **en progreso (21/28)** | 46a3c9c5..33f874ed | parcial |
| 5 | Compras | — | — | — | ⏳ pendiente | — | false |
| 6 | Flota | — | — | — | ⏳ pendiente | — | false |
| 7 | Bitácora | — | — | — | ⏳ pendiente | — | false |
| 8 | Transporte/apoyo | — | — | — | ⏳ pendiente | — | false |
| 9 | Proyectos | — | — | — | ⏳ pendiente | — | false |
| 10 | RRHH | — | — | — | ⏳ pendiente | — | false |
| 11 | Legal | — | — | — | ⏳ pendiente | — | false |
| 12 | Documentos | — | — | — | ⏳ pendiente | — | false |
| 13 | Ingeniería | — | — | — | ⏳ pendiente | — | false |
| 14 | Reuniones/Tareas/Notas/Mensajes | — | — | — | ⏳ pendiente | — | false |
| 15 | Tecnología | — | — | — | ⏳ pendiente | — | false |
| 16 | Admin | — | — | — | ⏳ pendiente | — | false |
| 17 | Resto | — | — | — | ⏳ pendiente | — | false |

## F7 — selector honesto + guardias estrictas (13-nov-2026)

- `I18N_UMBRAL` pasa de `{en:95, ht:90}` a **`{en:100, ht:100}`** (generado por
  `scripts/i18n-coverage.mjs`, DP-12: nunca se pone `ok` a mano). `estado()`
  en `language-selector.ts`/`language-onboarding.ts` ya derivaba del número
  medido (sin cambios de lógica), solo cambió el umbral.
- Tooltip, nombres de idioma y badges (`beta`/`próximamente`) del selector y
  del diálogo de primer ingreso ahora pasan por `t()` (antes texto fijo en
  español, hablaba solo de "Inglés"). Texto de Configuración › Idioma
  actualizado para listar TODO lo que sigue en español (de `I18N-ALCANCE.md`):
  catálogos, nombres de obra/proyecto/proveedor, mensajes de negocio del
  servidor, notificaciones, PDFs, respuestas de Compa/Claude.
- **`verify-i18n.mjs` reescrito — ahora SÍ puede fallar (exit 1), con alcance
  acotado al enforce por lote** (no global, para no romper el build antes de
  que todos los módulos lleguen a 100%): para cada pantalla `enforce:true` en
  `alcance.json`, toda clave usada en sus archivos debe existir en `en.json`
  **y** `ht.json`; si falta, el build falla y dice exactamente cuál pantalla/
  clave/idioma. El resto del repo (191/192 pantallas aún sin enforce) sigue
  en modo aviso, igual que antes — así el guard es real HOY (ya corre en
  `prebuild`) sin bloquear el trabajo pendiente.
- `scripts/i18n-smoke.mjs` (Playwright, nuevo, `npm run i18n:smoke`): inicia
  sesión real, cambia de idioma **por la UI** (Configuración › Idioma — un
  `localStorage` a secas no alcanza: `adoptFromServer()` lo pisa de vuelta
  con el idioma guardado en `usuarios.idioma`), recorre las pantallas
  `enforce:true`, falla si `<html lang>` no coincide o si `t()` registró
  dev-miss (consola) en `en`/`ht`.
  **Corriéndolo de verdad encontró un hallazgo real:** la pantalla "claude"
  está a 100% en su propio alcance, pero el **shell/sidebar global** (menú de
  navegación, buscador maestro, widget flotante de Compa) — visible en TODAS
  las pantallas pero fuera del escaneo por `pages/` — tenía ~165 claves sin
  traducir en `ht` y 22 en `en`. Se tradujeron todas (shell.ts: ~162 labels
  de menú + 3 del buscador; compa-flotante: 7 cadenas). `npm run i18n:smoke`
  ahora pasa limpio para `claude`/`en`/`ht`.
- `public/i18n/en.json`: 1.452 → **1.608** claves. `public/i18n/ht.json`: 0 →
  **~370** claves (lote Claude 123 + shell/nav 159+5 + Compa 7 + ajustes).
  **Sin revisión humana** (ver `docs/I18N-REVISAR-HT.md`).
- Build + 368 tests verdes en todo momento durante este lote.
- **Pendiente para el F7 "final":** `alcance.json` con TODAS las pantallas en
  `enforce:true` (DP-13b) solo tiene sentido cuando los 16 módulos restantes
  lleguen a 100% — hacerlo ahora rompería el build (191 pantallas fallarían).
  Mismo razonamiento para correr `i18n:smoke` sobre TODAS las rutas (hoy solo
  cubre las `enforce:true`).

## F6 — pipe `fecha` + `localeActual()` (13-nov-2026)

- `src/shared/i18n/fecha.pipe.ts` (reemplaza `| date`) + `src/shared/i18n/locale.util.ts`
  (`localeActual()`, tablas `MESES_HT`/`MESES_HT_ABR`/`DIAS_HT`). Test unitario
  en `fecha.pipe.spec.ts` (es/en/ht + patrón numérico puro + valor nulo).
- **Hallazgo importante:** ni Angular (`@angular/common/locales/ht.js`) ni
  `Intl.DateTimeFormat` (Node, probado en esta sesión) tienen datos CLDR
  reales para Kreyòl ayisyen — ambos devuelven nombres de mes en **francés**
  (`enero` → `janvier`/`janv.`) aunque acepten el locale `ht` sin error. Por
  eso `fecha.pipe.ts` **nunca** le pasa `'ht'` a `DatePipe`/`Intl`: para
  patrones con `MMM`/`MMMM` usa la tabla propia del prompt; para patrones
  solo numéricos usa `es-DO` (orden día/mes, igual que el resto de la app).
- Aplicado a `claude.html`/`admin-claude.html` (4 usos de `| date` → `| fecha`,
  `DatePipe` → `FechaPipe` en `imports`) — módulo ya a 100%, sirve de prueba
  de concepto verificada (build + 368 tests verdes).
- **Pendiente (30 archivos, fuera de esta sesión):** el resto de `| date` en
  el repo sigue sin tocar — mismo patrón mecánico (buscar/reemplazar `| date`
  por `| fecha`, cambiar `DatePipe` por `FechaPipe` en `imports` del
  componente). Lista completa:
  `admin/compa-conversaciones`, `admin/conduces-huerfanos`, `admin/jira`,
  `admin/roles`, `admin/solicitudes-eliminacion`,
  `bitacora/orden-trabajo/orden-trabajo-ficha`, `bitacora/orden-trabajo/orden-trabajo-lista`,
  `compras/productos-por-dar-de-alta`, `documentos/plantillas`,
  `flota/reporte-semanal`, `flota/responsabilidad/registrar-entrega`,
  `inventario/bodegas`, `inventario/conduce-externo-ficha`,
  `inventario/conduces-externos`, `inventario/conduces-por-implementar`,
  `inventario/lugares-por-registrar`, `inventario/proveedores-transporte`,
  `inventario/reportes`, `inventario/retiros`, `legal/aprobaciones`,
  `legal/contratos`, `legal/expedientes`, `mensajes`, `notas`, `perfil`,
  `proyectos/clima`, `solicitudes-movimiento`, `tareas/historial`,
  `tecnologia/consultas-compa`, `tecnologia/odoo-sync`,
  `tecnologia/outbox-atascados`, `tecnologia/resumen-operaciones`.
- También pendiente: localizar los `toLocale*String('es…')`/`Intl.*('es…')`
  directos (DP3f estimaba 14+2 en SGC) para pasarlos por `localeActual()`.

## Casos que el codemod (`scripts/i18n-wrap-html.mjs`) deja para revisión manual

(se llena cuando F3 corra el codemod por primera vez — lista de archivo:línea
con entidades `&nbsp;`/`&amp;`, texto pegado a iconos, plurales, `<option>`
con valor y texto, texto dentro de `<pre>`/`<code>`.)

- _(vacío — aún no corrió el codemod)_

## Hallazgo DP-05 (no se toca en esta ronda)

Otras plantillas usan `sgc-card` pelado (sin padding propio), igual que el
módulo Claude antes de F1: `rrhh/ausencias`, `rrhh/asistencia`,
`rrhh/empleados` (confirmado: sus `.scss` no mencionan `sgc-card`). Xaviel
decide qué ronda las arregla (paso físico 5 de CONTEXTO-72).

## Capturas visuales (DP-05, módulo Claude F1)

`scratchpad/dp-claude/antes/` y `scratchpad/dp-claude/despues/` — Inicio,
Skills, Crear, Auditoría (4 sub-pestañas), claro/oscuro, 1440px/390px (28
capturas por lote). Confirmado a ojo: tarjetas separadas, insignia
«PUBLICADA» con ancho natural, viñetas dentro de la tarjeta, sin scroll
horizontal a 390px.
