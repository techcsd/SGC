# DI2 — Visor grande de moldes (Ronda DI)

El esquema del molde (`app-molde-esquema`) se dibujaba dentro de una celda de tabla limitada a
200px — el texto de las cotas quedaba ilegible (~5px). Dos piezas nuevas:

1. **`app-molde-esquema` gana `ampliable` (`input<boolean>`, default `false`, retrocompatible)** +
   `ampliar` (`output<void>`). Cuando está encendido pinta un botón "Ampliar"; el propio componente
   nunca se abre a sí mismo — el padre decide (para poder navegar entre varios moldes).
   - Encendido en Moldes (`moldes.html`) e Historial (`historial.html`).
   - Apagado (explícito `[ampliable]="false"`) en Nueva (`nueva.html`) — es la pantalla de captura.

2. **`src/shared/ui/molde-visor/`** (nuevo, standalone) — `<dialog>` nativo en modo `showModal()`.
   API: `open`, `moldes: MoldeVisorItem[]`, `index` (`model`, two-way), `toleranciaCm`, `closed`.
   Incluye ←/→ entre moldes de la lista completa, zoom 0.5x–2.5x, descargar PNG (serializa el SVG a
   un `<canvas>`), imprimir (ventana nueva solo con el SVG), enlace "Abrir la bitácora de ese día", y
   devuelve el foco al elemento que lo abrió al cerrar.

`moldes.html` ganó también una vista **Tarjetas** (default, esquema grande, 6/página) y **Tabla**
(alterna, 10/página) — la preferencia se recuerda en `localStorage` (`sgc.moldes.vista`). Ambas
paginan con `app-paginador` (DI8).

CSS pendiente de aprobar el board DI2 (mockups en el lienzo "Rediseño CB") — el visor y las tarjetas
hoy usan solo el CSS funcional mínimo, marcado `// CSS tras OK (board DI2)`.
