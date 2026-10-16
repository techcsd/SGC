# Release 1.192.0

- Equipo/tester: Claude Code (sesión autónoma) + Xaviel
- Qué se probó:
  - RPCs `sgc.importar_conductores` y `sgc.importar_vehiculos` ejercitadas en dev (`fzfrnrvndzrjwyvdpkgg`) con un smoke SQL dentro de una transacción con `rollback` (sin dejar datos): alta de 2 choferes, dedup por cédula al reimportar la misma fila (actualiza, no duplica), alta de 1 vehículo sin "Año" (confirma el fix: ya no falla por `anio` NOT NULL, cae al año actual), `filas:[{i,id}]` devuelto correctamente para emparejar fotos, y `deshacer_importacion` limpiando la fila de `conductores` creada.
  - Bucket `conductores` creado y con las 3 políticas (insert/select/update) verificado por existencia en `storage.buckets`.
  - `npm run build` verde (incluye todos los guards del prebuild: i18n, dev-strings, regresiones, sin-ref-hardcodeado, etc.).
  - Flujo completo de UI (descargar plantilla → mapear → preview → importar → ver resultado → ficha con foto) **NO se pudo recorrer en navegador** en esta sesión por falta de credenciales de login de dev (la sesión de QA guardada había expirado). El código se revisó manualmente línea por línea (componente, servicio, rutas) y la lógica del backend quedó verificada por SQL.
- Versión de origen: 1.191.0
- Resultado: OK con la salvedad anterior (pendiente un clic-through manual de Xaviel en dev.sgcconstructorasd.com para cerrar la verificación de UI).
- Fecha: 2026-10-16

**OK de Xaviel**: autorizó explícitamente seguir y "push all the stuff to main" en esta sesión (2026-10-16), aceptando la salvedad de verificación de UI arriba indicada.
