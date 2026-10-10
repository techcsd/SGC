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

### Rollout (incremental, opt-in — no rompe pantallas existentes)
- ✅ Base construida + montada (shell) + 1.ª demo: `inventario/conduces-externos` (tbody `appStagger`).
- ⬜ Pendiente: aplicar `appStagger`/`appCountUp`/`appEstadoPulse` y los disparadores de `momento(...)` módulo por módulo (tabla §C de CONTEXTO-45 / nota #187), por grupos con commit por grupo, y completar la fila por módulo aquí.
