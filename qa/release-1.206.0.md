# Release 1.206.0

- Equipo/tester: Claude Code (sesión autónoma, ronda DE — documentos de flota con
  IA, badges honestos, transferencias con seguimiento). **Nota de cronología:**
  Xaviel escribió "ok i tested it" en el chat antes de que este código llegara a
  `dev` (en ese momento solo las migraciones estaban aplicadas en la base de
  datos de dev; el código del front seguía sin commitear). No está claro qué
  probó exactamente en ese momento — se documenta igual, pero la prueba humana
  real en `dev.sgcconstructorasd.com` (ya con el código mergeado) sigue pendiente.
- Qué se probó (automatizado + navegador, contra `sgc-dev` real):
  1. **37 smoke checks SQL** (BEGIN/ROLLBACK, nada queda guardado):
     `smoke-de1-sugerencias.mjs` (8 — sugerencias por puntaje con vehículos
     reales, placa tapada), `smoke-de2-reverso.mjs` (3 — reverso emparejado como
     2do documento, huérfano solo imagen), `smoke-de3-badges.mjs` (4 —
     `badges_modulos_app()` con datos reales de dev), `smoke-de4-transferencias.mjs`
     (9 — rechazo de destino sin usuario, cancelar, cron de recordatorio),
     `smoke-de-ronda.mjs` (6, resumen consolidado).
  2. **17/17 tests Deno** del lector (`lector.test.ts`, 5 nuevos de esta ronda:
     placa tapada, reverso con/sin datos del vehículo).
  3. **Navegador real** (Playwright headless contra `localhost` apuntando a
     `sgc-dev`, sesión de `qa_admin@constructorasd.com`): se subió el **PDF real**
     `MARBETES.pdf` (11 marbetes SURA) a Flota › Cargar documentos.
     - La IA leyó las 11 páginas reales (llamada real a Anthropic vía el edge).
     - Las 11 páginas de reverso se emparejaron correctamente con su anverso
       (badge "con reverso" en pág. 1, 3, 5… — nunca aparecen como fila propia).
     - La página 3 (placa leída `L441680`, 1 dígito distinto de la real
       `L441660` en el sistema) se resolvió por VIN, no se perdió.
     - La página 19 (placa `XXXXXXXX`) se marcó "Placa tapada" correctamente.
     - Se abrió el panel "Asignar…" de la página 17 (`L455286`, no existe en el
       sistema): visor con la imagen real, "Leído por la IA" con los 8 campos y
       su confianza, buscador probado con "nissan" → filtró a los 2 Nissan
       reales de la flota, aviso correcto de "Ya tiene otro documento del mismo
       tipo en este lote" (A631739 aparece 2 veces en el PDF).
     - Flota › Transferencias pendientes cargó sin error (vacío, consistente
       con 0 ofertas pendientes reales en dev).
     - Sin errores de consola relacionados (el único error de consola es un
       `fetch` fallido de telemetría de versión, ajeno a esta ronda).
  4. `npm run build` — verde (todos los guards de `prebuild`, incluido
     `verify-tokens` tras cambiar los hex del panel nuevo a tokens semánticos).
  5. 4 migraciones (`2026-10-30-de{1,2,3,4}-*.sql`) aplicadas y en el ledger de
     dev; edge `leer-documento-flota` en v11 (dev).
  6. `scripts/data-fixes/2026-10-30-de-transferencias-huerfanas.mjs --env prod`
     (dry-run, solo lectura): 0 ofertas fantasma encontradas en prod.
- **Resultado:** automatizado + navegador = OK, sin fallas encontradas.
  **Prueba humana de Xaviel en `dev.sgcconstructorasd.com` sigue recomendada**
  antes de abrir el PR `dev → main` (subir un documento real, revisar
  sugerencias, probar una transferencia con un chofer real).
- Fecha: 2026-11-01

**OK:** _(pendiente — Xaviel confirma tras probar en dev.sgcconstructorasd.com)_
