# Release 1.205.2 — Hotfix parte 2: Cargar documentos de flota (30-oct-2026)

**Quién probó:** Claude Code. Xaviel volvió a reportar el MISMO error ("No se pudo contactar el servicio…") tras el fix de v1.205.1, con otra copia del PDF (`C:\Users\xavie\Downloads\MARBETES.pdf`, mismo archivo de 244KB/24 páginas).

## Por qué el fix de v1.205.1 no alcanzó

v1.205.1 dividió el PDF en tandas de 6 páginas en paralelo (42s → 12-13s), pero **12-13s seguía siendo tiempo suficiente para que el navegador rozara el límite del relay de Supabase** — confirmado: una llamada directa server-to-server a la misma edge con el mismo PDF **sí termina en 200 OK en ~13s**, pero cuando el NAVEGADOR sostiene esa conexión directamente, el relay a veces la corta con el header `x-relay-error`, que `supabase-js` traduce exactamente al mismo mensaje que vio Xaviel. Reducir el tamaño de tanda más (probado con 3 páginas) solo bajó a 7-12s — no resolvía el problema de raíz, solo lo hacía menos frecuente.

## Fix de fondo (estructural, no solo "más rápido")

El navegador **ya no espera la lectura directamente**. Ahora:
1. El navegador llama a un RPC rápido (`flota_documento_lectura_crear`) — responde en ~0.5s, crea una fila de "trabajo" y dispara la lectura real en **segundo plano** vía `pg_net` (mismo patrón ya probado en `pagos_obra_enviar` → `pagos-descargo-enviar`).
2. La edge `leer-documento-flota` pasó de ser una llamada síncrona del navegador a un procesador server-to-server (gateado por `x-sync-secret`, como el resto de las edges server-to-server del proyecto).
3. El navegador hace **polling** de la fila (`select` casi instantáneo) cada 1.2s hasta que el trabajo queda `listo` o `error` — nunca sostiene una conexión larga, así que no hay forma de que el relay la corte.

## Verificación end-to-end
- RPC `flota_documento_lectura_crear` con el PDF real de Xaviel → responde en **541ms**.
- Polling hasta completar → **12.6s** de procesamiento real en segundo plano, 24/24 páginas, 0 omitidas.
- Navegador real (Playwright, simulación de `drop` con el archivo real) → la tabla de resultados muestra las 24 páginas con estado "Listo", sin el error de transporte.
- 12/12 tests Deno de `lector.ts` (sin cambios, siguen verdes).
- `scripts/smoke-db-ronda.mjs` 11/11.
- `npm run build` + 129/129 vitest.

## Checks estructurales
- `npm run build` ✅ · tests Deno ✅ · smoke-db-ronda 11/11 ✅
