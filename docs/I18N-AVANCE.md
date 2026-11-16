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

## Inventario — 100% COMPLETO (35/35 pantallas, 14-nov-2026)

Lotes 10-14 cerraron las 6 pantallas restantes:

- **Lote 10** (`e5c69459`): `almacen-inventario` → 100%.
- **Lote 11** (`15b5d7ea`): `conduce` → 100% (pantalla grande, 157
  literales: toolbar + 4 modales + cierre de conduce + vista imprimible).
  Noveno fix de escáner: `FASE_META` es un catálogo-MAPA
  (`Record<string, {label}> = {...}`), no un arreglo — se agregó detección
  de `: Record<...> = {...}` (balanceado por `<`/`>` y luego por `{`/`}`)
  para eximirlo igual que a los catálogos-arreglo. También se agregó
  "Constructora Scheker & Domínguez" al whitelist de nombres propios.
- **Lote 12** (`63df844d`): `requisiciones` → 100% (157 literales: 3 vistas
  lista/semana/mes + tabs activas/historial + aprobar/rechazar/cancelar).
  Dos fixes más: `esRuido()` no reconocía `@let` como palabra clave de
  control flow (se generalizó el prefijo tolerado de una lista fija de
  símbolos a "cualquier carácter que no sea letra", con `\p{L}`); y la
  neutralización de comparaciones dentro de un `@if (a > b)` asumía
  condiciones sin paréntesis anidados — una condición real con una llamada
  de cero argumentos (`fn() && a > b`) rompía esa asunción. Se reescribió
  balanceando paréntesis de verdad. También: `&nbsp;` se trataba como copy
  (tiene letras literales "nbsp") — ahora se reconoce como ruido.
- **Lote 13** (`aaa398b9`): `retiros` → 100% (flujo solicitar → aprobar/
  rechazar/cancelar → conduce de retiro → cuarentena → disposición).
- **Lote 14** (`9e839268`): `entradas` y `conduce-externo-ficha` → 100%.
  Décimo fix: `spansDeArreglos()` no reconocía `return [...]` dentro de un
  computed/método (solo `campo = [...]`) — un catálogo-arreglo construido
  y devuelto directo (ej. `lineaVida()`) se contaba como copy sin traducir.
  `reArreglo` ahora matchea `(?:=>|=|\breturn)\s*\[`.
- Cada fix de escáner se verificó que NO rompiera ninguna pantalla
  `enforce:true` previa (`verify-i18n.mjs` con 0 fallos) antes de seguir.
  Build + 368/368 tests verdes en todo momento.
- `public/i18n/en.json`: → **2.705** claves. `public/i18n/ht.json`:
  → **1.799** claves. Siguen **sin revisión humana** (`docs/I18N-REVISAR-HT.md`).

**Módulo 4 (Inventario) CERRADO: 35/35 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Compras (#5).

## Compras — 100% COMPLETO (8/8 pantallas, 15-nov-2026)

8 pantallas: `gastos`, `productos-por-dar-de-alta`, `reportes`,
`solicitar-odoo`, `proveedores-odoo`, `proveedores`, `ordenes`,
`ordenes-odoo`. Lotes 15-19:

- **Lote 15** (`e61f8488`): `gastos` y `productos-por-dar-de-alta` → 100%.
- **Lote 16** (`5221c3de`): `reportes` y `solicitar-odoo` → 100%.
- **Lote 17** (`f4c7f771`): `proveedores-odoo` y `proveedores` → 100%.
- **Lote 18** (`08f2664b`): `ordenes` → 100%. Undécimo fix: `verify-i18n.mjs`
  compara claves con `.trim()`, pero el lookup en tiempo de ejecución
  (`I18nService.t()`) hace match exacto sin trim — una clave con espacio
  intencional (`' (y {n} más)'`, usada para concatenar con espaciado) nunca
  puede pasar ambos checks a la vez si se guarda con el espacio. Fix: el
  espacio sale del `t()` y se concatena aparte (`' ' + this.i18n.t('(y {n}
  más)', {...})`), la clave queda limpia.
- **Lote 19** (`8eda4b89`): `ordenes-odoo` → 100%, cierra el módulo. Pantalla
  estructuralmente casi idéntica a `ordenes` (misma tabla de reconciliación
  de recepción, panel de vincular artículo, historial de entradas) — mismo
  patrón de fix reutilizado. No tenía `I18nService`/`TranslatePipe`
  inyectados (quedó fuera del alcance del codemod automático) — se agregó
  desde cero junto con el envolver de 16 toasts.
- `public/i18n/en.json` y `ht.json`: pocas claves nuevas por módulo gracias
  al solapamiento entre `ordenes`/`ordenes-odoo` (comparten casi todo el
  vocabulario de reconciliación/recepción).
- `alcance.json`: 8 pantallas nuevas `enforce:true` (total **43**).
  `verify-i18n.mjs`: 43 pantallas enforce, 0 fallos. Build + 368/368 tests
  verdes en todo momento.

**Módulo 5 (Compras) CERRADO: 8/8 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Flota (#6).

## Flota — 100% COMPLETO (23/23 pantallas, 15-nov-2026)

El módulo más grande hasta ahora: 23 pantallas (29 archivos `.html` incl.
sub-rutas `detalle/`, `registrar-entrega/`, `cargar-documentos/`), 2109
literales totales. Lotes 20-33 (commits `a28cbf05`..`1a82044c`):

- **Lote 20** (`a28cbf05`): codemod masivo
  (`scripts/i18n-wrap-html.mjs --modulo flota --write`) sobre las 23
  pantallas: 1377 envueltos, 147 saltados a mano. **Bug encontrado y
  corregido antes de aceptar el resultado:** el codemod envolvió
  `"10 || d"` dentro de una condición `@if` numérica sin texto real
  (`@if (d > 10 || d < -10)` → `@if (d > {{ '10 || d' | t }} < -10)`,
  NG5002 parser error en `combustible.html`) — mismo patrón de bug que el
  de `@if (a > b)` ya corregido en el escáner de *medición*, pero esta vez
  en el codemod de *escritura* (lógica separada). Único caso real en todo
  el módulo.
- **Lotes 21-33**: cierre pantalla por pantalla, repartido entre 6 forks
  secuenciales (nunca en paralelo — el riesgo real es que dos forks
  escriban a la vez sobre `alcance.json`/`en.json`/`ht.json`/
  `docs/i18n-coverage.json`, que se regeneran enteros en cada corrida del
  escáner; una corrida paralela podría perder el enforce-flip o las
  traducciones de la otra). Cada fork recibió instrucciones explícitas
  (patrones + gotchas conocidos) y cada resultado se **reverificó
  independientemente** (`i18n-coverage.mjs` + `verify-i18n.mjs` + build +
  368 tests) antes de aceptarlo — un fork devolvió progreso real pero
  incompleto más de una vez (HTML envuelto al 100% pero sin traducir/
  enforce/commit), terminado a mano siguiendo el mismo patrón.
- **Gotcha recurrente, el más caro de todo el módulo:** una etiqueta
  devuelta por un método/getter (`estadoLabel(x)`, `tipoLabel()`,
  `confianzaTexto()`, `labelLectura()`) mostrada en el template SIN
  `| t` — ninguno de los dos escáneres lo detecta (solo matchean
  literales de texto, no expresiones de propiedad/método), así que la
  pantalla pasa "100%" con un bug real de "siempre en español sin
  importar el idioma". Apareció en `seguimiento`, `panel-dia`,
  `rendimiento-vehiculos`, `checklists`, `mantenimientos`,
  `conciliacion-combustible`, `combustible` (×2), `vehiculos` (×4) — una
  revisión manual de cada llamada a un helper de etiqueta en el template
  fue obligatoria en cada pantalla grande.
- **Gotcha nuevo:** `confirm()`/`alert()` con un literal envuelto NO
  tiene contraparte "ya cubierto" en el escáner — un template literal con
  `i18n.t()` anidado dentro de backticks se cuenta como texto crudo sin
  traducir (el regex captura todo el contenido entre backticks
  literalmente). Fix: usar el placeholder nombrado de
  `I18nService.t('texto {ph}', { ph })` como argumento completo de
  `confirm()`, nunca un template literal con `${}` anidando `i18n.t()`.
- **Gotcha nuevo:** un carácter `<`/`>` literal dentro de CUALQUIER
  string traducible (incluso una interpolación `{{ }}` plana, no solo
  dentro de `@if`/atributos vinculados) rompe la detección de límites de
  etiqueta del escáner. La entidad `&lt;` tampoco sirve (no se decodifica
  dentro de un literal JS interpolado — se mostraría literal al
  usuario). Fix: reformular el texto sin el símbolo, o mover el cálculo a
  un computed/método de `.ts` que devuelva el string ya formateado.
  Encontrado en `seguimiento.html` (texto original con `&lt; 2 min`).
- **Gotcha nuevo:** un `@Input()` de un componente compartido llamado
  `label` (o similar) puesto como atributo estático plano (`label="texto"`)
  NUNCA se traduce aunque la clave exista — hay que pasarlo como binding
  de propiedad (`[label]="'texto' | t"`).
- **Gotcha nuevo:** `i18n.t('texto {n}', { n: algo() })` donde `algo()`
  puede devolver `null` (ej. `number | null`) es un error de tipos real de
  TypeScript (`TS2322`) en build, no un problema de i18n —
  `I18nService.t()` exige `string | number` para sus placeholders. Fix:
  `algo() ?? 0` (o el fallback que corresponda). Encontrado en
  `conductor-detalle.html` (`diasParaVencer()`) y `vehiculos.ts`/
  `vehiculo-detalle.html` (placas `string | null` en `confirm()`).
- `public/i18n/en.json`/`ht.json`: crecieron de ~2906/~2037 a **~4200/
  ~3469** claves (el módulo más grande traducido hasta ahora).
- `alcance.json`: 23 pantallas nuevas `enforce:true` (total **66**).
  `verify-i18n.mjs`: 66 pantallas enforce, 0 fallos. Build + 368/368 tests
  verdes en todo momento.

**Módulo 6 (Flota) CERRADO: 23/23 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Bitácora (#7).

## Bitácora — 100% COMPLETO (11/11 pantallas, 15-nov-2026)

11 pantallas (13 archivos `.html` incl. sub-rutas `orden-trabajo-ficha/`,
`orden-trabajo-lista/`), 706 literales totales. Lotes 34-39 (commits
`8255e835`..`665235da`):

- **Lote 34** (`8255e835`): codemod masivo sobre las 11 pantallas: 474
  envueltos, 46 saltados a mano. Build limpio desde el primer intento —
  a diferencia de Flota (lote 20), ningún `@if` numérico corrompido; se
  revisó el diff completo buscando el mismo patrón, nada encontrado.
- **Lote 35** (`d9da9e1a`): 7 pantallas pequeñas/medianas (dashboard,
  entregas, moldes, solicitudes-compra, cobertura, mi-proyecto,
  orden-trabajo) cerradas por un fork en un solo pase, verificado
  independientemente antes de aceptar. Encontró el mismo patrón de bug
  de "etiqueta de método sin `| t`" en `cobertura.ts` (`estado()`
  devuelve `{label, tone}` sin pasar por `t()`) y el de `@Input()`
  estático nunca traducido (`titulo="texto"` en `app-donut-chart`/
  `app-bar-chart`, `ariaLabel="texto"` en `app-signature-pad` — ambos
  necesitan convertirse a binding `[titulo]="'texto' | t"`).
- **Lotes 36-39** (`6bab6bff`, `7a91af33`, `e6b201e0`, `665235da`):
  historial, solicitudes-material, cartillas, nueva (la pantalla más
  grande del módulo) — un segundo fork cerró los primeros 3 en un pase;
  `nueva` se quedó sin presupuesto del fork justo antes de flipear
  enforce/verificar/commitear (HTML/TS ya al 100% en el working tree) —
  terminado a mano.
- **Gotcha nuevo, encontrado en `nueva`:** un `&nbsp;` original en el
  texto fuente se había decodificado en algún punto a un carácter
  U+00A0 (espacio de no separación) real dentro del string de la
  plantilla, en vez de un espacio normal U+0020. La clave guardada en
  `en.json`/`ht.json` usaba espacio normal — `verify-i18n.mjs` hace
  match EXACTO (no normaliza espacios ni caracteres Unicode
  equivalentes), así que la traducción nunca calzaba aunque el texto
  pareciera idéntico a simple vista. Mismo principio que el gotcha de
  `&lt;`/`&gt;` ya documentado: cualquier carácter no-estándar dentro de
  un string traducible rompe el match exacto en algún punto de la
  cadena — hay que normalizarlo a su equivalente ASCII/espacio normal
  en la plantilla, nunca dejarlo como entidad o carácter Unicode
  "equivalente visualmente".
- `public/i18n/en.json`/`ht.json`: crecieron de ~4200/~3469 a **~4551/
  ~3859** claves.
- `alcance.json`: 11 pantallas nuevas `enforce:true` (total **77**).
  `verify-i18n.mjs`: 77 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes en todo momento.

**Módulo 7 (Bitácora) CERRADO: 11/11 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Transporte/apoyo (#8).

## Transporte/apoyo — 100% COMPLETO (3/3 pantallas, 15-nov-2026)

Módulo pequeño: `apoyo-transporte`, `trabajos-transporte`,
`solicitudes-movimiento` (175 literales totales). Lote 40 (codemod,
`405507d3`) + lote 41 (`3b044583`, terminado a mano completo, sin
fork — módulo lo bastante chico para no justificar el overhead de
verificación de un fork).

- Mismos gotchas de siempre: etiqueta de método sin `| t`
  (`tipoLabel(r)` en `trabajos-transporte.ts`, switch que devuelve
  'Movimiento'/'Retiro'/'Bote'/'Apoyo'/'Conduce'/'Actividad' crudo);
  catálogo-arreglo correctamente exento en declaración pero nunca
  envuelto en el display (`c.label` de `COLUMNAS`); espacio final
  dentro de un string traducible (`'Central — '`) movido fuera del
  `t()` proactivamente, sin que el escáner lo marcara primero.
- `confirm()` con interpolación de template literal reescrito con
  placeholder nombrado (`i18n.t('¿Cancelar la solicitud "{que}"?', {
  que })`) en vez de `${}` anidando `i18n.t()`.
- `public/i18n/en.json`/`ht.json`: +97/+100 claves nuevas.
- `alcance.json`: 3 pantallas nuevas `enforce:true` (total **80**).
  `verify-i18n.mjs`: 80 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes en todo momento.

**Módulo 8 (Transporte/apoyo) CERRADO: 3/3 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Proyectos (#9).

## Proyectos — 100% COMPLETO (10/10 pantallas, 15-nov-2026)

10 pantallas (15 archivos `.html` incl. las 5 de `personal/`), 768
literales totales. Lotes 42-46 (commits `84212977`..`7873a48a`):

- **Lote 42** (`84212977`): codemod masivo: 499 envueltos, 46 saltados
  a mano. **Segundo bug del codemod encontrado y corregido** (el
  primero fue el `@if` numérico de Flota/lote 20): el
  import-insertion de `asegurarTranslatePipe()` asumía que todo import
  existente es de 1 línea — insertó el nuevo `import { TranslatePipe }`
  EN MEDIO de un import multilínea ya existente en
  `personal-registro.ts` (`import {\n  Cargo, PersonalObra, ...\n}
  from '...'`), partiéndolo en dos bloques inválidos (38 errores de
  build en cascada, todo símbolo del import roto reportado como "no
  encontrado"). **Corregido en el script mismo** (no solo en el
  archivo): ahora busca el CIERRE real de cada import statement
  (`... from '...';`, multilínea incluido vía regex no-greedy) en vez
  de la última línea que empieza con "import", para que no vuelva a
  pasar en los módulos que faltan.
- **Lote 43** (`e25fc52b`): `costos` ya estaba al 100% tras el
  codemod — solo traducir + enforce.
- **Lote 44-45**: 8 pantallas más (kpi, cargos, cronograma-import,
  clima, cronograma, historial, compras, lista) cerradas por 2 forks
  secuenciales, cada uno verificado independientemente antes de
  aceptar — ambos dejaron 1 pantalla sin terminar al quedarse sin
  presupuesto (compras al 100% sin commitear; cronograma mid-edición
  real, confirmado por dos mediciones seguidas con el coverage subiendo).
- **Lote 46** (`91ed2f9b` + `7873a48a`): `personal` (5 archivos:
  `personal`, `personal-registro`, `personal-expediente`,
  `personal-import`, `personal-carnet`) cierra el módulo. El fork se
  quedó a 98% (4 fragmentos) sin commitear — terminado a mano.
  - **Gotcha nuevo**: un catálogo-arreglo envuelto en paréntesis y
    encadenado con `.filter()` dentro del propio `computed()`
    (`computed(() => ([...] as const).filter(...))`) NO calza con el
    regex de catálogo-exento del escáner (que solo reconoce `=>`/`=`
    seguido DIRECTAMENTE de `[`, sin paréntesis de por medio) — los
    labels se contaban como copy suelto. Fix: refactorizar a un
    catálogo constante a nivel de módulo + un `computed()` que solo
    adjunta los valores dinámicos (counts), separando la forma
    estática del cálculo — mejor código además de calzar con el
    escáner.
  - **Hallazgo mayor, fuera del árbol de pantallas**: `verify-i18n.mjs`
    exigía traducción para labels de catálogo que SÍ estaban
    correctamente exentas en su declaración — resultó ser que el
    componente COMPARTIDO `app-filter-select` (usado en Personal,
    Conductores, Requisiciones, Almacenes y más) **nunca había tenido
    `TranslatePipe`/`I18nService`**: `{{ o.label }}` (opciones), el
    placeholder de búsqueda, "Sin opciones" y "Quitar filtro" se
    mostraban siempre en español sin importar el idioma, en TODAS las
    pantallas que usan el componente — invisible a ambos escáneres
    porque viven fuera de `src/app/pages/**` (lo que escanean por
    pantalla). Corregido en el componente compartido (`filter-select.
    html`/`.ts`): beneficia TODAS las pantallas que ya lo usan
    (incluidas las de Flota/Compras/Bitácora ya cerradas) sin tocar
    ninguna de ellas ni requerir que agreguen nada.
- `public/i18n/en.json`/`ht.json`: crecieron de ~4651/~3961 a
  **~5136/~4512** claves.
- `alcance.json`: 10 pantallas nuevas `enforce:true` (total **90**).
  `verify-i18n.mjs`: 90 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes en todo momento.

**Módulo 9 (Proyectos) CERRADO: 10/10 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: RRHH (#10).

## RRHH — 100% COMPLETO (14/14 pantallas, 15-nov-2026)

14 pantallas, 627 literales totales. Lotes 47-51 (commits
`96846157`..`657519bf`):

- **Lote 47** (`96846157`): codemod masivo: 469 envueltos, 12
  saltados a mano. **Tercer bug del codemod encontrado y corregido**
  (primero: `@if` numérico de Flota/lote 20; segundo: import
  multilínea de Proyectos/lote 42): `asegurarTranslatePipe()` solo
  sabía agregar `TranslatePipe` a un `imports: [...]` YA EXISTENTE —
  si el `@Component` no tenía NINGÚN array `imports` (standalone sin
  dependencias hasta ahora), el import se agregaba pero el array
  nunca se creaba, dejando `NG8004` en TODO el archivo. Afectó 3/14
  pantallas (`contratos`, `evaluaciones`, `nomina`); corregido en el
  script: si no hay array `imports`, ahora inserta
  `imports: [TranslatePipe],` justo después de `selector: '...'`.
- **Lote 48**: `reportes` ya estaba al 100% tras el codemod — solo
  traducir + enforce.
- **Lotes 49-50**: 8 pantallas más (organigrama, evaluaciones,
  asistencia, capacitacion, contratos, proveedores, nomina,
  candidatos) cerradas por un fork en un solo pase, verificado
  independientemente antes de aceptar.
- **Lote 51** (`657519bf`): últimas 5 (ausencias, onboarding,
  tramites, activos, empleados — la más grande del módulo, 134
  literales) cerradas por un segundo fork. Se quedó sin presupuesto
  justo antes de traducir las 76 claves nuevas de `empleados` (HTML/
  TS ya al 100%, `enforce:true` ya flipeado) — terminado a mano. Dato
  curioso: 74 de esas 76 claves YA EXISTÍAN en `en.json`/`ht.json` de
  módulos anteriores (términos genéricos como "Banco"/"Supervisor"/
  "Correo electrónico" reaparecen en RRHH) — solo 2 eran genuinamente
  nuevas, confirmando que el solapamiento de vocabulario entre
  módulos reduce el trabajo de traducción real a medida que avanza el
  barrido completo de la app.
- `public/i18n/en.json`/`ht.json`: crecieron de ~5156/~4530 a
  **~5454/~4835** claves.
- `alcance.json`: 14 pantallas nuevas `enforce:true` (total **104**).
  `verify-i18n.mjs`: 104 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes en todo momento.

**Módulo 10 (RRHH) CERRADO: 14/14 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Legal (#11).

## Legal — 100% COMPLETO (5/5 pantallas, 15-nov-2026)

5 pantallas (aprobaciones, configuracion, contratos, expedientes,
firmas-pendientes), 221 literales totales. Lote 52 (codemod,
`c02a8f21`) + lote 53 (`7e606f94`, terminado a mano completo, sin
fork — módulo pequeño, mismo criterio que Transporte/apoyo).

- Mismos gotchas de siempre: `estadoLabel()`/`tipoLabel()`/
  `prioridadLabel()` sin `| t` en `expedientes`/`contratos`;
  catálogos (`ESTADOS`/`TIPOS`) con `e.label`/`t.label` mostrados sin
  `| t`; un `computed()` (`drawerTitle`) usado en un binding `[title]`
  necesitaba `i18n.t()` en construcción, no `| t` (el pipe no aplica
  dentro de un binding de propiedad).
- Gotcha evitado proactivamente: `[attr.aria-label]="'Ver ' +
  c.titulo"` (y `Editar`/`Eliminar`) con espacio final concatenado —
  reescrito como `i18n.t('Ver') + ' ' + c.titulo` antes de que
  `verify-i18n.mjs` lo marcara, aplicando el mismo patrón ya conocido
  de `compras/ordenes`/Transporte-apoyo.
- `public/i18n/en.json`/`ht.json`: +100/+108 claves nuevas (el lote
  más grande de traducción nueva desde Flota, por tratarse de
  vocabulario legal específico sin solapamiento con módulos
  anteriores).
- `alcance.json`: 5 pantallas nuevas `enforce:true` (total **109**).
  `verify-i18n.mjs`: 109 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes en todo momento.

**Módulo 11 (Legal) CERRADO: 5/5 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Documentos (#12).

## Documentos — 100% COMPLETO (4/4 pantallas, 15-nov-2026)

4 pantallas (generar, historial, plantillas, ver), 77 literales
totales. Lote 54 (codemod, `3086c82f`) + lote 55 (`4de5fba8`,
terminado a mano completo, sin fork — módulo muy pequeño).

- Mismos gotchas de siempre: `estadoRevisionLabel()`/
  `CATEGORIA_LABELS[c]` (2 sitios) sin `| t`; bindings `[title]` con
  concatenación ("Ver · ", "Versiones · ") reescritos con `i18n.t()`.
- **Gotcha nuevo en el ESCÁNER** (no en el código de la app):
  `@defer`/`@placeholder`/`@loading`/`@error` (bloques de carga
  diferida de Angular) no estaban en la lista de palabras clave de
  control-flow que `i18n-coverage.mjs` reconoce como ruido — un
  `} @placeholder {` aparecía como falso positivo de copy sin
  traducir. Agregado a la lista junto a
  `@if`/`@for`/`@else`/`@switch`/`@case`/`@default`/`@empty`/`@let`.
- `public/i18n/en.json`/`ht.json`: +46/+46 claves nuevas.
- `alcance.json`: 4 pantallas nuevas `enforce:true` (total **113**).
  `verify-i18n.mjs`: 113 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes en todo momento.

**Módulo 12 (Documentos) CERRADO: 4/4 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Ingeniería (#13).

## Ingeniería — 100% COMPLETO (1/1 pantalla, 15-nov-2026)

Módulo de una sola pantalla: `ingenieria/pagos` (68 literales, ya al
79% por trabajo previo a este barrido). Lote 56 (`bed92636`): solo
faltaba inyectar `I18nService` y envolver 11 toasts (título
solamente, dejando el detalle en español como de costumbre).

- `public/i18n/en.json`/`ht.json`: +9/+50 claves (ht estaba más
  atrasado en este módulo específicamente).
- `alcance.json`: 1 pantalla nueva `enforce:true` (total **114**).
  `verify-i18n.mjs`: 114 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes.

**Módulo 13 (Ingeniería) CERRADO: 1/1 pantalla con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Reuniones/Tareas/Notas/Mensajes (#14).

## Reuniones/Tareas/Notas/Mensajes — 100% COMPLETO (9/9 pantallas, 15-nov-2026)

9 pantallas (mensajes, mensajes/grupo-info, notas, notas/editor,
reuniones/reunion-ficha, reuniones/reuniones-lista, tareas/gestion,
tareas/historial, tareas/mis-tareas), 402 literales totales. Lote 57
(codemod, `b2e99b45`) + lote 58 (`f04be843`, terminado a mano
completo, sin fork). `reuniones/*` ya traía 82-91% de una ronda
anterior (CP8); el resto arrancaba en 0%.

- **Cuarto bug del codemod encontrado y corregido** (primero: `@if`
  numérico de Flota; segundo: import multilínea de Proyectos;
  tercero: `imports: []` faltante de RRHH): el regex de
  atributos-visibles usaba `\b(placeholder)="..."` sin excluir el
  caso en que el atributo real es un `data-*` personalizado — `\b`
  matchea igual dentro de "data-placeholder" porque el `-` no es
  carácter de palabra. Envolvió
  `data-placeholder="Escribe aquí…"` (placeholder de contenteditable
  vía CSS `content: attr(data-placeholder)`) como `data-placeholder=
  "{{ '...' | t }}"`, y Angular reescribe CUALQUIER atributo
  interpolado cuyo nombre (tras quitar "data-") calce con una
  propiedad DOM conocida como binding de propiedad — NG8002 "Can't
  bind to 'placeholder' … of 'div'". Corregido en el script con
  `(?<!-)` antes del `\b`; el sitio real se reescribió con
  `[attr.data-placeholder]="i18n.t('Escribe aquí…')"` (un binding
  `[attr.X]` nunca sufre esta reescritura).
- Mismos gotchas recurrentes: ternarias sin `| t` en templates
  (`pinned() ? 'Fijada' : 'Fijar'`), catálogos (`CATEGORIA_LABELS`/
  `e.label`/`t.label`/`p.label`) sin `| t` en varios selects de
  filtro, bindings `[title]`/`[attr.aria-label]` con concatenación
  "Ver "/"Editar "/"Quitar admin a " (espacio final) reescritos con
  `i18n.t()` + concatenación separada.
- `scripts/i18n-whitelist.json`: `"- [x]"` agregado (ejemplo de
  sintaxis markdown dentro de un `<code>`, no es prosa).
- `public/i18n/en.json`/`ht.json`: +168/+264 claves nuevas (el lote
  de traducción más grande desde Legal — vocabulario de mensajería/
  notas/reuniones sin solapamiento previo).
- `alcance.json`: 9 pantallas nuevas `enforce:true` (total **123**).
  `verify-i18n.mjs`: 123 pantallas enforce, 0 fallos. Build + 368/368
  tests verdes en todo momento.

**Módulo 14 (Reuniones/Tareas/Notas/Mensajes) CERRADO: 9/9 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Tecnología (#15).

## Tecnología — 100% COMPLETO (20/20 pantallas, 15/16-nov-2026)

20 pantallas (área de herramientas internas de desarrollo), 123 → **143**
pantallas enforce en total. Lotes 59-61 (commits `180dfc09`..`51da7fdf`) +
las últimas 5 pantallas (commits `8e14c319`..`318739d5`):

- **Lote 59** (`180dfc09`): codemod masivo sobre las 20 pantallas.
- **Lote 60** (`af243d76`): 9 pantallas (`whatsapp`, `estadisticas`,
  `consultas-compa`, `odoo-sync`, `envios-automaticos`, `guia`,
  `monitoreo` cerradas por un fork + `oficina-agentes`/`apis-consumo`
  terminadas a mano tras quedarse el fork sin presupuesto).
- **Lote 61** (`51da7fdf`): 6 pantallas (`matriz`, `resumen-operaciones`,
  `cotizaciones`, `reportes-errores`, `homologacion` commiteadas por un
  fork + `qa` terminada a mano).
- **Últimas 5 pantallas** (`8e14c319`, `aa136d97`, `13fa7e1b`, `816e1e61`,
  `318739d5` — cierra el módulo): `outbox-atascados`, `dev-notes`,
  `compras` (comparte clave de cobertura con su subruta
  `compras/compras-nueva` — ambos archivos se cerraron juntos),
  `design-system`, `inventario`.
  - **Gotcha de proceso, no de código:** dos dispatches consecutivos de
    `subagent_type: "fork"` para este último lote volvieron con **0 usos
    de herramientas** y una respuesta sin sentido (el fork describía
    estar "esperando a que termine" otro fork, como si fuera el
    orquestador y no el trabajador) — consistente con que un fork hereda
    TODO el contexto de la conversación padre, y esa conversación ya
    estaba saturada de lenguaje de "despaché un fork, reviso su
    progreso" de rondas anteriores, haciendo que la instancia recién
    bifurcada se confundiera de rol. Se resolvió cambiando a un agente
    SIN herencia de contexto (`subagent_type` omitido / `general-purpose`)
    con un prompt completamente autocontenido — terminó las 5 pantallas
    de verdad, cada una verificada+build+tests+commiteada por separado.
  - Mismos gotchas recurrentes de siempre: etiquetas de método sin
    `| t` (`estadoLabel`, `getEstadoLabel`, `getCondicionLabel`,
    `histTipoLabel`, `envioLabel`, `guardadoTexto`, `design-system`'s
    `group.title`); concatenación con espacio final en
    `[attr.aria-label]` (`'Editar ' + e.nombre`); `confirm()` con
    template-literal `${}` reescrito a placeholder nombrado;
    `@Component` con atributo estático de un `@Input()` compartido
    (`confirmLabel="Eliminar"`, `heading="..."`) convertido a binding
    (`[confirmLabel]="'Eliminar' | t"`).
  - **Gotcha nuevo**: texto con entidades HTML de código de ejemplo
    (`&amp;lt;app-card&amp;gt;`, `&amp;#64;supports`) en `design-system`
    rompía el parseo del escáner — reformulado sin el símbolo, mismo
    principio que el gotcha de `&lt;`/`&gt;` ya documentado.
  - **Decisión de criterio en `inventario`**: `tipos()`/
    `comprasOpciones()`/`getTipoLabel()`/`getUbicacionLabel()`/
    `compraLabel()` quedaron sin traducir a propósito — son catálogos
    libres administrados desde la BD (datos del negocio, no copy de
    UI), a diferencia de `estados()`/`condiciones()` que sí mapean a
    los catálogos fijos `TEC_EQUIPO_ESTADOS`/`TEC_EQUIPO_CONDICIONES`
    y sí se envolvieron + tradujeron.
  - Se agregaron ayudantes de pluralización (`{n} solicitud/
    solicitudes`, `{n} renglón/renglones`, `{n} equipo/equipos`) en vez
    de la concatenación rota `'s' : ''`.
- `public/i18n/en.json`: → **6.596** claves. `public/i18n/ht.json`: →
  **6.361** claves. Siguen **sin revisión humana**
  (`docs/I18N-REVISAR-HT.md`).
- `verify-i18n.mjs`: **143 pantallas enforce, 0 fallos.** Build + 368/368
  tests verdes en todo momento (verificado independientemente, no solo
  reportado por el agente).

**Módulo 15 (Tecnología) CERRADO: 20/20 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Admin (#16).

## Admin — 100% COMPLETO (25/25 pantallas, 16-nov-2026)

25 pantallas (herramientas solo-admin: usuarios, roles, parámetros,
catálogos, versiones, jira interno). 143 → **167** pantallas enforce en
total. Lote 62 (codemod, `9deccdab`) + 3 lotes de cierre por pantalla
(`e8fe9b40`..`d3b254bf`):

- **Lote 62** (`9deccdab`): codemod masivo: 607 envueltos, 35 saltados a
  mano.
- **Batch 1** (11 pantallas pequeñas, `e8fe9b40`..`a6515821`):
  `almacenes-duplicados`, `bitacora-catalogos`, `solicitudes-eliminacion`,
  `conduces-huerfanos`, `parametros`, `orden-modulos`, `otros-valores`,
  `unidades`, `importar`, `pulso-sistema`, `auditoria`. `auditoria` tenía
  1 solo fragmento marcado por el escáner pero **6 llamadas más** a
  `tablaLabel()`/`accionLabel()`/`adminAccionLabel()` sin `| t` encontradas
  en revisión manual de plantilla — mismo patrón "etiqueta de método" de
  siempre, bug real (siempre en español) invisible al escáner. Se encontró
  también una clave de `confirm()` guardada con SALTOS DE LÍNEA LITERALES
  en vez del escape `\n` — nunca hubiera calzado en runtime
  (`verify-i18n.mjs` lo atrapó antes de commitear).
- **Batch 2** (8 pantallas medianas, `6cc8edfe`..`e0c3aa4b`):
  `animaciones`, `reportes`, `usuarios-test`, `empresa`,
  `usuarios-duplicados`, `compa-conversaciones`, `historial-versiones`,
  `vault`. **Gotcha nuevo**: un `confirm()` con `\n\n` real (newline
  evaluado por JS) dentro de UN SOLO string traducido nunca calza —
  el escáner extrae el escape literal de 2 caracteres del código fuente,
  pero el string evaluado en runtime tiene un salto de línea real. Fix:
  partir el mensaje en 2 llamadas `i18n.t()` SIN newline, unidas por
  `'\n\n'` fuera de las partes traducidas.
- **Batch 3** (las 5 más grandes/complejas, `6590354b`..`d3b254bf`):
  `jira` (board Kanban interno), `matriz-notificaciones`,
  `app-versiones` (chips de tipo nuevo/mejora/arreglo/seguridad del
  historial de versiones — SÍ son copy de UI, se envolvieron; el
  changelog libre de cada versión queda sin traducir, es contenido
  autorado por el admin, no copy de UI), `roles` (incluye
  `role-permisos-editor.html`/`.ts`, que comparte el cupo de cobertura
  de `admin/roles` por no ser una ruta propia — sus catálogos
  `PRESETS_CARGO` se tradujeron; el catálogo grande de
  `MODULOS_DISPONIBLES`/`SUBMODULOS` queda sin traducir a propósito, cae
  a español por diseño sin afectar el % medido), `usuarios` (cierra el
  módulo, 67 literales). Mismos gotchas recurrentes de siempre: ternarias
  sin `| t` (`'Operar'/'Ver'`, `'Encendido'/'Apagado'`,
  `'Guardando…'/'Guardar'`), etiquetas de método sin `| t` (`tipoLabel`,
  `getModuloLabel`, `labelSubmodulo`, `tipoConductorLabel`), `confirm()`
  reescritos con placeholder nombrado, concatenación con espacio final
  en `[attr.aria-label]`, una entidad `&amp;quot;` en un `title` reescrita
  con comillas angulares para evitar el gotcha de tag-boundary ya
  conocido.
- Los 3 lotes se dispacharon como agentes `general-purpose` SIN contexto
  heredado (no `subagent_type: "fork"`) — ver la sección de Tecnología
  arriba para el porqué (forks devolviendo 0 usos de herramienta por
  contexto de orquestación heredado). Los 3 terminaron de verdad, sin
  dejar trabajo a medias, cada uno reverificado independientemente
  (`verify-i18n.mjs` + build + 368 tests) antes de aceptarlo.
- `public/i18n/en.json`: → **7.321** claves. `public/i18n/ht.json`: →
  **7.162** claves. Siguen **sin revisión humana**
  (`docs/I18N-REVISAR-HT.md`).
- `verify-i18n.mjs`: **167 pantallas enforce, 0 fallos.** Build + 368/368
  tests verdes en todo momento (verificado independientemente, no solo
  reportado por los agentes).

**Módulo 16 (Admin) CERRADO: 25/25 pantallas con `enforce:true`.**
Siguiente módulo en la tabla de lotes: Resto (#17).

## Resto — 100% COMPLETO (23/23 pantallas) — BARRIDO COMPLETO DE LA APP (192/192), 16-nov-2026

Último módulo: 28 pantallas que no caían en ningún módulo nombrado (5 ya
cerradas de antes — `apoyo-transporte`/`solicitudes-movimiento`/
`trabajos-transporte` del módulo 8, más `demo/escenarios`/`demo/progreso`
que resultaron estar al 100% sin enforce — ver cierre final abajo). 167 →
**192** pantallas enforce en total — **TODA pantalla medida por
`i18n-coverage.mjs` tiene `enforce:true`**. Lote 63 (codemod, `a3cc5a66`)
+ fix de codemod (`dcb7644`) + 3 batches de cierre (`8e461924`..`562b0559`)
+ cierre final de 2 pantallas sueltas (`059814dc`):

- **Quinto bug del codemod, encontrado ANTES de aceptar el resultado**
  (primero: `@if` numérico de Flota/lote 20; segundo: import multilínea
  de Proyectos; tercero: `imports: []` faltante de RRHH; cuarto: `data-*`
  de Reuniones): al correr `i18n-wrap-html.mjs --write` SIN `--modulo`
  (resto no tiene una carpeta común — abarca `incentivos`, `obra/*`,
  `auth`, `direccion`, `dudas`, `politicas`, etc.), el codemod reprodujo
  EXACTO el bug original de Flota lote 20 (`@if (d > 10 || d < -10)` →
  `@if (d > {{ '10 || d' | t }} < -10)`, NG5002) en el MISMO archivo
  (`flota/combustible.html`) — resultó que el "fix" documentado en el
  lote 20 nunca se aplicó al script, solo se corrigió el archivo a mano
  esa vez. Esta vez sí se corrigió en el script (`dcb7644`): nuevo guard
  que salta toda la línea si detecta `@if`/`@else if`/`@for`/`@switch`
  con un `<`/`>` de comparación dentro de la condición. Se revirtió el
  write completo, se aplicó el fix, y se re-corrió limpio (confirmado:
  `flota/combustible.html` ya no aparece en la lista de archivos
  tocados). **Lección: un "corregido" en este documento para el CODEMOD
  DE ESCRITURA debe verificarse releyendo el script, no solo la nota —
  la nota puede describir un parche al archivo, no al script.**
- **Batch 1** (13 pantallas pequeñas, `8e461924`..`a62f5d18`): `forbidden`,
  `politicas`, `auth/set-password`, `mis-choferes`,
  `politicas/eliminar-cuenta`, `verificar`, `dudas`, `direccion`,
  `practica`, `app-movil`, `borrador-claude`, `asistente`,
  `oauth-consent`. **Gotcha nuevo** (`0e342c5a`): un carácter `©` crudo
  dentro de una plantilla (contenido visible normal, no un ícono) activó
  el guard `AW12` de emoji-icono porque `©` cae en la categoría Unicode
  `Extended_Pictographic` — el guard no distingue "ícono de botón" de
  "símbolo de copyright en texto". Fix: usar la entidad `&copy;` en vez
  del carácter crudo, fuera de cualquier string traducido.
- **Batch 2** (7 pantallas medianas, `4f963ee7`..`4f5bf99c`):
  `mi-rendimiento`, `auth`, `soporte`, `obra/informes`, `obra/avance`,
  `obra/checklists`, `obra/plan-dia` — pantallas de bitácora/seguimiento
  de obra en campo (checklists, avance, plan del día). Mismos gotchas
  recurrentes de siempre (etiquetas de catálogo sin `| t`, fallback
  estático sin traducir dentro de un binding `[title]`, agrupación por
  clave de fallback — `'Sin brigada'` — traducida en el `.ts` antes de
  llegar a la plantilla).
- **Batch 3** (las 3 más grandes, cierra el módulo, `eb8e4b35`..`562b0559`):
  `obra/subcontratistas`, `obra/no-conformidades`, `incentivos` (la
  pantalla más grande de TODO el barrido completo, 72 literales:
  catálogos de tier/umbral/estado del programa de incentivos). Una línea
  de historial que mezclaba varios fragmentos literales alrededor de
  interpolaciones (`decision`/`decidido_por_nombre`) se colapsó en una
  sola llamada `i18n.t()` con placeholders en vez de fragmentos sueltos
  con puntuación suelta sin traducir entre medio.
- **Cierre final** (`059814dc`): al terminar el batch 3, `verify-i18n.mjs`
  reportaba 190/192 pantallas enforce — quedaban 2 sueltas
  (`demo/escenarios`, `demo/progreso`) que YA estaban al 100% de
  cobertura (wrapeadas por trabajo previo del módulo `practica`/demo)
  pero nunca se habían flippeado a `enforce:true` ni tenían sus 15 claves
  en `ht.json`. Se completaron las traducciones faltantes y se activó el
  guard — con esto, **TODA pantalla que mide `i18n-coverage.mjs` tiene
  `enforce:true`**, cerrando el barrido completo de la app.
- `public/i18n/en.json`: → **7.930** claves. `public/i18n/ht.json`: →
  **7.831** claves. Siguen **sin revisión humana**
  (`docs/I18N-REVISAR-HT.md`).
- `verify-i18n.mjs`: **192 pantallas enforce, 0 fallos — TODA la app.**
  Build + 368/368 tests verdes en todo momento (verificado
  independientemente, no solo reportado por los agentes).

**Módulo 17 (Resto) CERRADO: 23/23 pantallas con `enforce:true`.**
**BARRIDO COMPLETO DE LA APP: 192/192 pantallas con `enforce:true`,
0 fallos. No queda ninguna pantalla sin `enforce:true`.** Trabajo
realizado en `feature/dq-compras-i18n`; los módulos 5-16 (Compras hasta
Admin) ya se mergearon a `dev` vía PR #150 — el resto de este trabajo
(módulo 17) sigue pendiente de mergear.

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
| 4 | Inventario | 35/35 pantallas 100% (ver detalle arriba) | ~1193 (codemod) + ~350 a mano | ~130 (toasts/confirm/error) | ✅ **100% — hecho** | 46a3c9c5..9e839268 | **true** |
| 5 | Compras | 8/8 pantallas 100% (ver detalle arriba) | ~cablear HTML a mano (sin codemod) | toasts/confirm/error | ✅ **100% — hecho** | e61f8488..8eda4b89 | **true** |
| 6 | Flota | 23/23 pantallas 100% (ver detalle arriba) | 1377 (codemod) + ~730 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | a28cbf05..1a82044c | **true** |
| 7 | Bitácora | 11/11 pantallas 100% (ver detalle arriba) | 474 (codemod) + ~230 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | 8255e835..665235da | **true** |
| 8 | Transporte/apoyo | 3/3 pantallas 100% (ver detalle arriba) | 103 (codemod) + ~72 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | 405507d3..3b044583 | **true** |
| 9 | Proyectos | 10/10 pantallas 100% (ver detalle arriba) | 499 (codemod) + ~190 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | 84212977..7873a48a | **true** |
| 10 | RRHH | 14/14 pantallas 100% (ver detalle arriba) | 469 (codemod) + ~160 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | 96846157..657519bf | **true** |
| 11 | Legal | 5/5 pantallas 100% (ver detalle arriba) | 168 (codemod) + ~50 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | c02a8f21..7e606f94 | **true** |
| 12 | Documentos | 4/4 pantallas 100% (ver detalle arriba) | 51 (codemod) + ~26 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | 3086c82f..4de5fba8 | **true** |
| 13 | Ingeniería | 1/1 pantalla 100% (ver detalle arriba) | ~14 a mano (ya 79% por trabajo previo) | toasts | ✅ **100% — hecho** | bed92636 | **true** |
| 14 | Reuniones/Tareas/Notas/Mensajes | 9/9 pantallas 100% (ver detalle arriba) | 176 (codemod) + ~120 a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | b2e99b45..f04be843 | **true** |
| 15 | Tecnología | 20/20 pantallas 100% (ver detalle arriba) | codemod + a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | 180dfc09..318739d5 | **true** |
| 16 | Admin | 25/25 pantallas 100% (ver detalle arriba) | codemod + a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho** | 9deccdab..d3b254bf | **true** |
| 17 | Resto | 23/23 pantallas 100% (ver detalle arriba) | codemod + a mano | toasts/confirm/error + labels sin `\| t` | ✅ **100% — hecho (192/192 TODA la app)** | a3cc5a66..059814dc | **true** |

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
