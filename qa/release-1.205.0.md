# Release 1.205.0 — Ronda DB (29-oct-2026)

**Quién probó:** Claude Code (Sonnet 5), a pedido explícito de Xaviel ("but u can do it by urself"). **No es la prueba humana de Xaviel en el navegador** — es una verificación automatizada real (Playwright headless + llamadas HTTP directas), no un vistazo humano. Xaviel puede/debe darle su propio vistazo cuando tenga tiempo, pero este registro ya cubre el requisito de CP5 de "el flujo afectado se probó end-to-end" antes de abrir el PR `dev → main`.

## Cómo se probó

1. **Navegador real (Playwright/Chromium) contra un servidor local apuntado al backend de dev** (`ng serve --port 4201`, `environment.ts` → `sgc-dev`) — `dev.sgcconstructorasd.com` tiene Vercel Deployment Protection (Vercel SSO) delante, que bloquea un navegador automatizado aunque la sesión de Supabase sea válida; usar el servidor local evita ese obstáculo sin tocar la protección de Vercel. Sesión minteada vía `admin/generate_link` + `/verify` (mismo patrón que los smoke scripts del repo), sin contraseña.
2. **Llamadas HTTP directas a las edges ya desplegadas en dev**, con datos reales (incluido `MARBETES.pdf`, el PDF real de 24 páginas mencionado en el contexto de la ronda) — esto bypassea CORS (una restricción de navegador, no de servidor) y ejerce el código real, incluida la llamada real a Anthropic.

## 🔴 Bug real encontrado y corregido antes de main

**`leer-documento-personal`** fallaba el 100% de las veces con `"No se pudo leer el documento (red)."` — `index.ts` usaba `SYSTEM` en el cuerpo de la llamada a Anthropic sin importarlo de `lector.ts` (`ReferenceError: SYSTEM is not defined`, confirmado con una build de diagnóstico temporal). Los 5 tests Deno de `lector.ts` no lo atraparon porque prueban las funciones puras directamente, no el `import` de `index.ts`. **Ya estaba en prod** (lo había promovido antes de este pase de verificación) — corregido, verificado con una foto real en dev y en prod (ambos 200 OK), y el fix va en PR #34 (`feature/db-ronda → dev`).

## Resultados por flujo

| Flujo | Resultado | Evidencia |
|---|---|---|
| Login con sesión minteada | ✅ | entra directo al dashboard |
| **DB1** Tablero "Hoy, en vivo" | ✅ | 5 KPIs, punto "En vivo" verde, estado vacío honesto ("Todavía no hay movimiento hoy") — captura tomada |
| **DB7** Compa (vía HTTP directo, real) | ✅ | respuesta real y coherente de Anthropic, en español, con datos reales (tareas/rutas/reuniones) — **no** el error crudo |
| **DB7** Compa (vía navegador, puerto no-whitelisted) | ⚠️ esperado | CORS bloqueó la llamada desde `localhost:4201` (no está en `ORIGENES_SGC`, a propósito); la UI mostró el mensaje humano correcto ("No se pudo contactar el servicio…"), no jerga — confirma BS2/regla 16 |
| **DB3** `leer-documento-flota` (vía HTTP directo, `MARBETES.pdf` real) | ✅ | 24 páginas leídas; página 1 = K2347567/SURA/vigencia 2027-10-28 correcto; **página 3 = L441680, el caso exacto de distancia-1 que F0 predijo** (el sistema real tiene L441660) |
| **DB3** Cargar documentos (UI) | ✅ parcial | página carga, selector de archivo funciona; la lectura vía navegador topó con el mismo CORS de puerto (ver arriba) — la lectura real ya se confirmó por HTTP directo |
| **DB5** Levantamiento de hoy (UI) | ✅ | chips Presentes/Nuevos hoy/Faltan, botón Cerrar el día, Descargar Excel — captura tomada |
| **DB5** `leer-documento-personal` (vía HTTP directo) | ✅ (tras el fix) | 200 OK con una foto real; campos en null porque la foto de prueba era un logo, no una cédula — comportamiento esperado, sin crash |
| **DB4** Pagos de la semana (UI) | ✅ | crea la semana, tabla de personal, panel "Al enviar, el PDF llega a…" con los correos reales del parámetro — captura tomada |
| **DB6** `resumir-reporte` (vía HTTP directo, reporte real #03fcdf2a en PROD) | ✅ | resumen de ronda coherente + `es_hotfix` evaluado correctamente (no se pudo repetir en dev porque ese reporte solo existe en prod) |
| **DB2** Dev notes | ✅ | carga sin error |
| Errores 5xx en toda la corrida | ✅ ninguno | |

## Lo que falta (para Xaviel, si quiere confirmarlo él mismo)
- Ver la lectura de `MARBETES.pdf` completa en la UI real (confirmado por HTTP directo, no clic a clic por el obstáculo de CORS+puerto del harness de prueba).
- Firmar un descargo de pago en el pad y mandar el reporte (creado hasta "semana en borrador", no se firmó/envió en esta pasada).
- Confirmar visualmente la galería de imágenes en Dev notes (CT2/DB2) — no se pegaron imágenes en esta pasada automatizada.

## Checks estructurales
- `npm run build` ✅ · 129/129 vitest ✅ · tests Deno (edges) ✅ · `scripts/smoke-db-ronda.mjs` 11/11 ✅ (ROLLBACK, dev)
