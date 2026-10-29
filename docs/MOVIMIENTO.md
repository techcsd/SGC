# MOVIMIENTO — sistema de animación (CJ1-CJ4)

> Dónde y cómo se mueve la UI de SGC, para que se sienta "viva" sin ser ruidosa. Tres niveles.
> Regla (CLAUDE.md): **todo módulo nuevo elige el nivel de su momento de esta tabla** — nada
> de animaciones sueltas fuera de aquí. Respeta siempre `prefers-reduced-motion` y el ajuste
> *Configuración › Apariencia › Animaciones: completas/reducidas* (`html.motion-reduced`).

## Tokens (`src/styles/_tokens.scss`)
`--motion-fast 150ms` · `--motion-base 220ms` · `--motion-slow 320ms` · `--motion-hero 1600ms` ·
`--ease-out cubic-bezier(.2,.8,.2,1)` · `--ease-in cubic-bezier(.5,0,.75,0)`.

## Niveles
- **grande** (≤1.6s, overlay, se salta tocando, una por acción): hito celebrable.
- **mediano** (~0.8s, sin overlay): confirmación importante.
- **simple**: aviso con check (el toast de éxito que ya existe).

## Implementado (CJ1)
| Qué | Dónde | Nivel | Animación |
|---|---|---|---|
| Cambio de pantalla (ruta) | `app.config.ts` (`withViewTransitions`) + `styles.scss` (`::view-transition…(root)`) | base | crossfade + subida 8px, 220ms. El menú lateral (`.shell-sidebar`) no se anima (view-transition-name propio). |
| Abrir modal/panel/drawer | `form-drawer.scss` (`modalIn`) | base | escala .98→1 + fundido 220ms. |
| Guardar/registrar (genérico) | toasts de éxito (p. ej. `salidas.ts:1009/1019/1157`) | simple | aviso con check (toast existente). |

## Momentos y su nivel objetivo (mapa para los pendientes)
| Momento | Archivo (disparador) | Nivel | Estado |
|---|---|---|---|
| Conduce creado | `salidas.ts` (éxito de `confirmar()`), BO7, `conduce-externo-form` | **grande** | ⬜ CJ2 (mock `CJ2-conduce-creado.dc.html`) — pendiente |
| Ruta creada (chofer) | app `crear-ruta.ts` | **grande** | ⬜ CJ3 (mock `CJ3-ruta-creada.dc.html`) — app/PROMPT-89 |
| Recepción confirmada | `confirmar_recepcion_salida` (web) | mediano | ⬜ pendiente (caja con check, 0.8s) |
| Requisición enviada / aprobada | `requisiciones.ts` | mediano | ⬜ pendiente |
| Combustible registrado | app combustible | mediano | ⬜ app/PROMPT-89 (gota que llena) |
| El resto (guardar, editar, etc.) | toasts de éxito en todo `src/app` | simple | ✅ (toast existente) |

## Pendiente (próxima tanda)
- **CJ2/CJ3**: componente global `app-celebracion` montado en el shell + `MotionService.celebrar(tipo, datos)`; tipo `conduce` = copia exacta del mock CJ2 (papel sube → sello EMITIDO → carpeta → check + "Conduce creado · número · destino" + "Ver conduce"); tipo `ruta` = camión cruza (mock CJ3). No bloquean, se saltan tocando/Esc, `aria-live` con el texto, reduce-motion = solo el check.
- Niveles **mediano** (recepción, requisición, combustible): caja/sobre con check de 0.8s sin overlay.
- Directiva `appStagger` para listas/tablas (entrada escalonada 30ms, máx. 8 filas, solo primera carga).

## CL2 — Base de movimiento (1.163.0)
Registro único **`src/shared/motion/catalogo-movimiento.ts`** (`MOTION_IDS` + `CATALOGO_MOVIMIENTO`): la ÚNICA forma de referenciar una animación. Prueba unitaria `catalogo-movimiento.spec.ts` (todo id usado está registrado y viceversa). Lo consume el catálogo CL5 (`admin/animaciones`) y `sgc.movimiento_catalogo`.

### Directivas base (`src/shared/motion/`)
| Directiva | Qué hace | Uso |
|---|---|---|
| `appStagger` | entrada escalonada de los hijos (30ms, máx. 8, 1.ª carga) | `<tbody appStagger>`, `<div class="cards" appStagger>` |
| `appCountUp` | el KPI sube de 0 a su valor (600ms) | `<span [appCountUp]="total()"></span>` |
| `appEstadoPulse` | el chip late al **cambiar** de estado (no en la 1.ª pintura) | `<span class="sgc-badge" [appEstadoPulse]="estado()">` |

Todas respetan `html.motion-reduced` + `prefers-reduced-motion` (`movimientoReducido()` en `reduced-motion.ts`). Solo `transform`/`opacity`.

### Momentos medianos — `MotionService.momento(tipo, datos)` + `<app-momento>` (shell)
Badge inferior-centro, ~0.8s, SIN velo, no bloquea, `aria-live`. Tipos: `entrada` (caja entra), `salida` (caja sale), `aprobado` (sello+check), `firma` (trazo), `combustible` (gota), `checklist` (tachado), `mantenimiento` (llave), `mensaje` (avión), `documento` (hoja). **Sin celebración** en accidente/multa/rechazo/eliminar/error/retiro dañado.

### Rollout
- ✅ Base construida + montada (shell).
- ✅ `appStagger` en **35 listados** (conduces-externos + 34 del sweep CL2: inventario/flota/bitácora/compras/rrhh/proyectos/legal/documentos).
- ✅ Disparadores de `momento(...)` (medianos) en los éxitos clave:
  - `inventario/salidas` despacho → `momento('salida')`
  - `inventario/entradas` recepción confirmada → `momento('entrada')`
  - `flota/mantenimientos` completar → `momento('mantenimiento')`
  - `flota/combustible-log` aprobar echada → `momento('combustible')`
  - `flota/checklists` aprobar → `momento('checklist')`
  - `rrhh/ausencias` aprobar → `momento('aprobado')`
  - `notas` compartir → `momento('mensaje')`
  - conduce externo emitido → celebración grande (CJ2) en `conduce-externo-form`.
- ⬜ Pendiente (mecánico, mismo patrón): más disparadores `momento(...)` (entrada, aprobado de requisición/OC/ausencia, firma, checklist, mensaje/nota, documento) y `appCountUp`/`appEstadoPulse` donde aporten, módulo por módulo.

## CM2 — Logo reveal al entrar (1.169.0)
`src/shared/ui/logo-reveal/` (variante A · Trazo): tras un login OK, `auth.ts` llama `LogoRevealService.reproducir()` y navega a la vez; el componente montado en el root (`app.html`) muestra el velo navy, dibuja el símbolo SD (stroke-dashoffset), rebota el punto, descubre el texto (clip-path wipe) y crece el subrayado. Se va a ~1,8s (rango 1,2-2,2s) o al tocar/tecla; una vez por sesión (`sessionStorage`); no sale en cambio de contraseña obligatorio. reduce-motion = estático + fundido 200ms. Registro `login-reveal` (nivel grande). Símbolo estático: `assets/imgs/logos/csd-logo-simbolo.svg` (geometría del mock §D.2), usado también en la pantalla de login. Vector pendiente de comparación PNG vs SVG por Xaviel.

## CN — Animaciones en la web (Nota #204/#207) + logo al refrescar (1.177.0–1.178.0)
**Nota #204:** *"por qué las animaciones no están en la web sgc? acabo de crear rutas y registrar combustible y no vi ninguna animación, como sí pasa en la csd app."*
- ✅ **Ruta creada** (`flota/rutas/rutas.ts` `onSave`, solo al CREAR) → `celebrar('ruta', {destino, verUrl, verLabel})`. Escena **CJ3 portada de la app** (carretera + camión + pines) a `src/shared/ui/celebracion/` con los mismos keyframes/tiempos (`cel-rt-*`). Texto sr-only y título de la tarjeta ya varían por tipo (antes siempre decían "Conduce creado").
- ✅ **Combustible registrado** (`flota/combustible/combustible.ts` `onSave`) → `momento('combustible')`, como el resto de Flota.
- 1.177.0 — **Logo al refrescar**: `app.ts` reproduce el logo-reveal en cada recarga real de página (Navigation Timing API `type === 'reload'`, nunca en la navegación interna del SPA). Toggle por dispositivo en *Configuración › Apariencia › "Logo al refrescar"* (encendido por defecto); respeta reduce-motion; se salta en /auth y /set-password.
- ✅ **FASE 6 (Nota #207, 1.179.0):** los `momento(...)` salen como **escenas a pantalla completa** (mock `Escena.dc.html`), absorbidas por `app-celebracion`: velo navy 92 %, halo + onda, la escena, check naranja (1,1s), título + dato y "Toca para continuar"; 1,8s. 10 escenas (entrada, salida, aprobado, firma, combustible, checklist, mantenimiento, mensaje, documento, uso) + conduce (CJ2) y ruta (CJ3). **Ráfaga:** un momento dentro de los 10s del anterior sale en la tarjeta corta mediana (sin velo). Reducido = velo + check + texto. Disparador nuevo: `flota/responsabilidad` → `momento('uso')`.
- ✅ **Barrido de disparadores (1.181.0):** `momento(...)` cableado en los éxitos de requisición enviada (`solicitudes-material`→documento) y aprobada (`requisiciones`→aprobado), orden de compra (`compras/ordenes`→documento), conteo físico aplicado (`conteos`→checklist), orden de trabajo (`orden-trabajo`→firma), documento generado (`documentos/generar`→documento), bitácora enviada (`bitacora/nueva`→documento, **salvo incidente**), personal de obra alta (`personal-registro`→entrada), aprobación legal (`legal/aprobaciones`→firma **solo aprobado**). **Lote:** importar echadas de factura (`conciliacion-combustible`→combustible con el total en `datos.sub`).

## CN FASE 4.1 — Paridad EXHAUSTIVA de disparadores app ↔ web
Tabla 1:1 de **cada** sitio donde se celebra un momento, en ambas plataformas (verificada por
`grep` de `momento('…')` y `celebrar({tipo:'…'})` el **13/10/2026**). La app (csd-app, `dev2/csd-app`)
dispara en **30 sitios** (27 `momento` + 3 `celebrar` grandes); la web en **23** (20 `momento` + 3
`celebrar`). El menor número en la web es correcto: varias pantallas de la app son **solo-campo**
(obra/ingeniería/liberación/pre-uso) y no tienen pantalla web gemela — pero **su TIPO de momento sí
se dispara en la web** en otra acción, así que la "sensación" es idéntica entre plataformas.

**Guard `verify-momento-paridad.mjs` (prebuild)** es el que mantiene esto honesto: lee los
`MomentoTipo` de `motion.service.ts` y **falla el build** si algún tipo no se dispara (`momento('<t>')`)
en ningún lado de `src/app`. La tabla de abajo es el detalle humano; el guard es la red automática.

> Leyenda: **1:1** = misma acción de negocio en ambas · **≈** = el tipo lo cubre otra acción web ·
> **solo-campo** = la pantalla existe solo en la app (su tipo igual se dispara en la web).
> `admin/animaciones` (`celebrar` ×2) es **vista previa**, no cuenta como disparador real.

### Momentos medianos (`momento(tipo, datos)`)
| Tipo | App — sitio(s) | Web — sitio(s) | Paridad |
|---|---|---|---|
| **entrada** | `compras/solicitud-compra` · `inventario/entrada` · `inventario/recibir` ×2 · `proyectos/personal/personal-registro` · `solicitudes/pedir` · `transporte/por-confirmar` | `inventario/entradas` (recepción) · `proyectos/personal/personal-registro` (alta) | personal-registro **1:1**; entrada/recibir/por-confirmar → `inventario/entradas` **≈**; pedir compra/material → su gemelo web es la requisición (fila *documento*) |
| **salida** | `inventario/salida` (despachar) | `inventario/salidas` (despacho) | **1:1** |
| **aprobado** | `incentivos` · `ingenieria/cartilla/cartilla-detalle` · `inventario/conteo` · `solicitudes/detalle` | `inventario/requisiciones` (aprobar) · `rrhh/ausencias` (aprobar) | aprobar solicitud **1:1**; incentivos/cartilla **solo-campo** (≈ cubierto); conteo-app usa *aprobado*, la web usa *checklist* en `conteos` |
| **firma** | `bitacora/cl-detalle` · `bitacora/liberacion` · `bitacora/orden-trabajo` | `bitacora/orden-trabajo` · `legal/aprobaciones` (aprobado) · `inventario/por-firmar` (firmar conduce) | orden-trabajo **1:1**; cl-detalle/liberación **solo-campo** (≈) |
| **checklist** | `obra/checklists` · `transporte/checklist` · `transporte/preuso` | `flota/checklists` · `inventario/conteos` (aplicar) | transporte/checklist→`flota/checklists` **1:1**; preuso/obra **solo-campo** (≈) |
| **mantenimiento** | `transporte/mantenimiento` · `transporte/mantenimiento-cierre` | `flota/mantenimientos` (cubre registro y cierre) | **1:1** (web unifica los dos) |
| **combustible** | `transporte/combustible` ×2 | `flota/combustible` (registrar) · `flota/combustible-log` (aprobar) · `flota/conciliacion-combustible` (lote) | registrar **1:1**; la web dispara en **más** sitios |
| **uso** | `transporte/uso-vehiculo` | `flota/responsabilidad` | **1:1** |
| **documento** | `bitacora/parte` · `ingenieria/cartilla/cartilla-nueva` · `obra/charla` · `obra/informe` | `bitacora/nueva` · `bitacora/solicitudes-material` (requisición) · `compras/ordenes` (OC) · `documentos/generar` | parte diario→`bitacora/nueva` **1:1**; charla/informe/cartilla **solo-campo** (≈) |
| **mensaje** | — | `notas` (compartir) | **tipo extra de la web** (la app no lo usa) |

### Celebraciones grandes (`celebrar({tipo})`, overlay `app-celebracion`)
| Tipo | App — sitio(s) | Web — sitio(s) | Paridad |
|---|---|---|---|
| **conduce** (CJ2) | `transporte/conduce-externo` · `transporte/generar-conduce` | `inventario/conduce-externo-form` · `inventario/salidas` | **paridad** (2 y 2) |
| **ruta** (CJ3) | `transporte/rutas/crear-ruta` | `flota/rutas` (`onSave`, solo al crear) | **1:1** |

**Conclusión:** los **10 tipos** de momento + las **2 celebraciones grandes** de la app tienen
disparador equivalente en la web. Lo que la web no replica son pantallas **solo-campo** (su tipo ya
suena en otra acción web), y añade un tipo propio (`mensaje`, al compartir notas). El guard prebuild
garantiza que ningún tipo quede mudo en la web.

## DB1 — «Hoy, en vivo» (1.205.0)

Tablero del Inicio (mockup DB1): nivel **mediano** de la tabla CJ4.
- `tablero-vivo-feed` — cada evento nuevo del feed entra deslizándose (0.5 s, `--ease-out`).
- `tablero-vivo-flota` — los vehículos del mapa esquemático SVG se deslizan a su
  nueva posición al llegar un reporte GPS (1.2 s, solo `transform`).
- KPIs reutilizan `base-count-up`. Con `prefers-reduced-motion` / `html.motion-reduced`
  todo aparece sin animar (incluye el pulso del punto «En vivo»).
- Datos: `tablero_vivo_resumen()` re-pedido por Realtime (debounce 2 s) o polling 30 s;
  la suscripción vive SOLO con la pestaña visible. Sin datos reales de hoy → estado
  «Todavía no hay movimiento hoy» (no se inventa movimiento).
