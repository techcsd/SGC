# Release 1.208.0

- Equipo/tester: Xaviel (prueba en `dev.sgcconstructorasd.com`).
- Qué se probó / verificó, y por quién:
  - **Xaviel probó en `dev.sgcconstructorasd.com`** el contenido de PR #94 (ronda DG: módulo
    Developer, buscador maestro Ctrl+K, fix del dashboard "Hoy, en vivo", Dev notes con grupo
    nuevo + papelera de imágenes, Compa flotante, módulo Demo ampliado) y confirmó explícitamente
    ("yes i did the human qa, is good") que quedó bien.
  - **Claude Code verificó antes del merge** (sin navegador humano, sobre el worktree del PR):
    `npm run build` (todos los guards del prebuild, incluido `verify-version-notes.mjs` y
    `verify-i18n.mjs`) y `npx ng test --watch=false` — 31/31 archivos, 264/264 tests, todos verdes.
  - Se encontraron y aplicaron a dev (con OK explícito de Xaviel, preguntado antes de aplicar) 5
    migraciones de la ronda DF anterior que estaban mergeadas al código pero nunca ejecutadas
    contra la base de datos de dev — incluido el fix del cron `sgc-requisiciones-vencidas`, que
    llevaba fallando a diario desde el 24-oct. Detalle completo en `HANDOFF.md`.
- Versión de origen: 1.207.0.
- Contexto: PR #94 (`feature/dg-developer-buscador-compa-demo` → `dev`) mergeado 2026-11-03.
  Pendiente, sin incluir en esta promoción: acción manual de Xaviel sobre 5 filas atascadas en
  `sgc.outbox_atascados` (prod) y la promoción a prod de las migraciones de esta ronda + las de
  la ronda DF que quedaron sin aplicar — ambas fuera de alcance de este release de código.
OK: 2026-11-03 — Xaviel confirmó explícitamente ("yes i did the human qa, is good") haber
probado 1.208.0 en dev y que quedó bien.
- Fecha: 2026-11-03
