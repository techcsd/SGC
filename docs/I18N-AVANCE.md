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
