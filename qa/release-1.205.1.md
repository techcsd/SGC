# Release 1.205.1 — Hotfix: Cargar documentos de flota (29-oct-2026)

**Quién probó:** Claude Code. Xaviel reportó el bug con una captura real de producción (probando con `MARBETES.pdf` en `sgcconstructorasd.com`, como `tecnologia@constructorasd.com`) — ese reporte fue el disparador; esta vez no se esperó a una verificación aparte: se reprodujo con el mismo archivo real contra prod antes de tocar nada.

## Bugs reportados por Xaviel
1. **"No se pudo contactar el servicio (conexión o servidor ocupado)"** al subir `MARBETES.pdf` en `/flota/vehiculos/cargar-documentos`.
2. **Arrastrar y soltar no funciona** — la zona invita a soltar el archivo pero no pasa nada.

## Causa real y fix

**Bug 1 — reproducido con una llamada HTTP directa contra prod con el PDF real**: la llamada SÍ terminaba en 200 OK, pero tardaba **42 segundos** (una sola llamada a Anthropic con las 24 páginas del PDF en un solo tiro). Eso es tiempo de sobra para que algo en el camino (navegador, proxy, lo que sea) corte la conexión antes de que llegue la respuesta — exactamente el mensaje de "fallo de transporte" que vio Xaviel.

**Fix:** el PDF se divide en tandas de 6 páginas y se leen **en paralelo** (`dividirPdfEnTandas` con `pdf-lib`, numeración de página global reconstruida por el servidor, no por el modelo). Verificado con el mismo `MARBETES.pdf` real: **42s → 12s**, 24/24 páginas leídas, 0 omitidas. Si alguna tanda fallara igual, ahora se dice cuántas páginas quedaron sin leer (`omitidas`) en vez de fallar todo o callarlo (AT11).

**Bug 2 — confirmado en el código**: la zona de "soltar" (`<label class="cdoc__drop">`) nunca tuvo `(dragover)/(drop)` — solo el `<input type="file">` oculto funcionaba (clic sí, arrastrar no). **Fix:** agregados los 3 handlers + feedback visual (borde naranja) mientras se arrastra encima.

## Cómo se probó
- Llamada HTTP directa contra prod con el PDF real → reprodujo el bug 1 exactamente (200 OK en 42s).
- Tras el fix: misma llamada contra dev con el mismo PDF real → 200 OK en 12s, 24 páginas correctas (incluida la página 1 y la 24, confirmando que la re-numeración entre tandas no se rompe en los bordes).
- Playwright headless: simulación real de `drop` (con `DataTransfer` + `File`) sobre la zona → confirma que ahora SÍ dispara la lectura (antes no hacía nada); el feedback visual (clase `--sobre`) aparece en `dragover`.
- 12/12 tests Deno de `lector.ts` (incluye 3 nuevos para `dividirPdfEnTandas`: PDF corto no se divide, PDF de 24 se divide sin perder páginas, última tanda puede ser más chica).
- `npm run build` + 129/129 vitest.

## Checks estructurales
- `npm run build` ✅ · tests Deno ✅ (12/12 en `leer-documento-flota`)
