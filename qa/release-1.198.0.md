# Release 1.198.0

- Equipo/tester: Claude Code (sesión autónoma, ronda CV — PROMPT-112)
- Contexto completo: `C:\developer\improvements\octubre 2026\imp 21102026\CONTEXTO-ACTUALIZACION-55.md`. IDs CV1-CV3, matriz filas 270-272.
- Qué se construyó:
  - **CV1** — nueva herramienta `preparar_echada` para Compa (canal `compa` únicamente, gate módulo `flota`). No ejecuta nada: arma una propuesta `accion:'abrir'` que abre el formulario real de Combustible con los datos ya puestos (vehículo resuelto con el JWT del usuario vía `sgc.vehiculo_display`, galones, monto, km/estación/producto si vinieron). El formulario web (`flota/combustible`) lee `?desde=compa&...` como entrada no confiable, prellena con chip "Compa" por campo, banner, y nunca autoenvía — fotos y odómetro siguen 100% obligatorios. Si hay un borrador BV5 sin terminar, se respeta (los datos de Compa solo se aplican si la persona lo descarta).
  - **CV2** — crear/renombrar grupos en Dev notes: fila editable en línea (reemplaza `prompt()`/`confirm()` nativos), validación de duplicados entre hermanos y máximo 4 niveles (`shared/utils/nota-grupos.util.ts`, 14 pruebas unitarias nuevas), resaltado del grupo recién creado.
  - **CV3** — arrastre HTML5 nativo (sin `@angular/cdk`) de notas y grupos en Dev notes, menú "⋯" (reemplaza el `<select>` flotante que tapaba el título), "Deshacer" tras mover una nota (extensión aditiva de `ToastService`).
  - Sin SQL esta ronda (CV1.1 — nada que registrar en el ledger de migraciones).
- Qué se verificó (no solo lectura de código — contra dev real):
  - `npm run build` (28 guards) y `npm run test:unit` (**105/105**, 14 nuevas) verdes.
  - Edge `assistant` desplegada a dev (v26 — incluye un fix real que encontró el propio smoke: el id del vehículo no viajaba como queryParam en el primer intento).
  - `node scripts/compa-evals.mjs --env dev --solo cv1-felix-registra-echada` → **1/1 OK**: Compa llama `listar_vehiculos`→`preparar_echada`, resuelve "la Suburban" a la placa real, nunca dice "ya quedó registrada".
  - Smoke de Playwright headless propio (`qa/cv-ronda.smoke.mjs`, sesión por magic link sin tocar contraseñas, reutilizable) contra `ng serve` local apuntando a dev: mensaje real a Compa → tarjeta "Echada preparada" → "Abrir formulario" → navega a Flota›Combustible con vehículo/galones/monto puestos, banner y chips visibles, odómetro y fotos marcados obligatorios, guardar sin ellos bloqueado (capturas iguales al mock aprobado). Crear un grupo en Dev notes → toast "Grupo creado". Arrastrar una nota real sobre el grupo → toast "Nota movida a «…»" con "Deshacer". Sin errores de consola en ninguno de los dos flujos.
- Deuda anotada (no corregida, documentada en `docs/SEGURIDAD.md`): `sgc.registrar_combustible_app` sigue sin exigir las 2 fotos server-side — por eso Compa nunca lo llama directo (camino "preparar + abrir formulario", nunca "preparar + ejecutar").
- **No se probó con un usuario real distinto de `qa_admin@constructorasd.com`, ni en el teléfono** — queda para Xaviel antes de promover a prod.
- Versión de origen: 1.197.0.
- Fecha: 2026-10-22

OK: 2026-10-22 — Xaviel dio el OK explícito ("si, dale a todo. tienes mi ok") para commitear, pushear `feature/cv-ronda` y mergearlo a `dev` con la verificación automatizada de arriba como base (sin prueba manual en el navegador de `dev.sgcconstructorasd.com` previa a esto). Promoción a `main`/prod queda pendiente de que Xaviel pruebe en dev primero (ver HANDOFF.md).
