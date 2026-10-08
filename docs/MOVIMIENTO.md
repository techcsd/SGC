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
