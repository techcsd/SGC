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

## Tabla de lotes (F3 cablear HTML + F4 cablear `.ts`)

Orden acordado en el prompt: Claude, Configuración/perfil/shell, Dashboard,
Inventario, Compras, Flota, Bitácora, Transporte/apoyo, Proyectos, RRHH,
Legal, Documentos, Ingeniería, Reuniones/Tareas/Notas/Mensajes, Tecnología,
Admin, resto.

| # | Módulo | Pantallas | Literales HTML | Literales `.ts` | Estado | Commit | `enforce` |
|---|---|---:|---:|---:|---|---|---|
| 1 | Claude | claude, configuracion/claude, admin/claude | — | 30 (`claude.ts`) | ⏳ pendiente (solo CSS hecho en F1) | — | false |
| 2 | Configuración/perfil/shell | — | — | — | ⏳ pendiente | — | false |
| 3 | Dashboard | — | — | — | ⏳ pendiente | — | false |
| 4 | Inventario | — | — | — | ⏳ pendiente | — | false |
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
